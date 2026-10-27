import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { registerRunnerHealth, RUNNER_VERSION } from '../runner/version.mjs';
import { registerVideoRunner } from '../runner/video-studio.mjs';
import { authenticatedRunnerStatus } from '../lib/runner-status.mjs';
import { createVideoStudio } from '../lib/video-studio.mjs';
const id = '11111111-1111-4111-8111-111111111111';
const secret = 'sk-private-unit-test-only';
const auth = (req, reply) => {
  if (req.headers.authorization === 'Bearer test') return true;
  reply.code(401).send({ error: 'unauthorized' });
  return false;
};
test('health and authenticated version use the same package source', async t => {
  const app = Fastify();
  t.after(() => app.close());
  registerRunnerHealth(app, auth);
  assert.equal((await app.inject('/health')).json().version, RUNNER_VERSION);
  assert.equal(
    (await app.inject({ url: '/auth-test', headers: { authorization: 'Bearer test' } })).json().version,
    RUNNER_VERSION
  );
  assert.equal((await app.inject('/auth-test')).statusCode, 401);
  const pkg = JSON.parse(await readFile(new URL('../runner/package.json', import.meta.url), 'utf8'));
  assert.equal(RUNNER_VERSION, pkg.version);
});
function studioFixture(t, { protocol = 1, status = 'draft', provider = 'openai' } = {}) {
  const requests = [];
  const db = {
    query: async (sql, p = []) => {
      if (sql.startsWith('SELECT setting'))
        return [[...(p[0] === 'video_suite_openai' ? [{ setting_value: 'encrypted' }] : [])]];
      if (sql.startsWith('SELECT * FROM video_studio_jobs'))
        return [
          [
            {
              id,
              project_id: id,
              status,
              scenes: [],
              render_settings: {
                language: 'en',
                voice_provider: provider,
                voice: provider === 'openai' ? 'alloy' : 'am_adam'
              }
            }
          ]
        ];
      return [[]];
    }
  };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/capabilities'))
      return Response.json({ openaiKeyForwardingVersion: protocol, openaiConfigured: false });
    if (url.endsWith('/openai-audio-test')) return Response.json({ ok: true, model: 'gpt-audio-1.5' });
    return Response.json({ id: JSON.parse(options.body).id }, { status: 202 });
  });
  const studio = createVideoStudio({
    db,
    decrypt: () => ({ api_key: secret }),
    runnerUrl: () => 'https://runner.example.com',
    runnerToken: () => 'runner-test'
  });
  return { studio, requests };
}
test('suite key reaches only a compatible authenticated runner for OpenAI rendering', async t => {
  const { studio, requests } = studioFixture(t);
  await studio.renderJob(id);
  const request = requests.find(x => x.url.endsWith('/video/jobs'));
  assert.equal(JSON.parse(request.options.body).openaiApiKey, secret);
  assert.equal(request.options.headers.Authorization, 'Bearer runner-test');
  assert.equal(request.options.redirect, 'error');
  const info = await studio.capabilities();
  assert.equal(info.openaiNarration.source, 'suite');
  assert.doesNotMatch(JSON.stringify(info), new RegExp(secret));
});
test('old runner is stopped before receiving any Suite key or queuing a broken render', async t => {
  const { studio, requests } = studioFixture(t, { protocol: undefined });
  // A zero protocol models a runner that has not advertised this feature.
  requests.length = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return Response.json({ openaiConfigured: false });
  });
  await assert.rejects(studio.renderJob(id), error => error.statusCode === 409 && error.message.includes('1.1.1'));
  assert.ok(requests.every(x => !x.options.body));
});
test('local narration never forwards the OpenAI key, and failed jobs get a fresh runner ID', async t => {
  const { studio, requests } = studioFixture(t, { provider: 'kokoro', status: 'failed' });
  await studio.renderJob(id);
  const body = JSON.parse(requests.find(x => x.url.endsWith('/video/jobs')).options.body);
  assert.equal(body.openaiApiKey, undefined);
  assert.notEqual(body.id, id);
  assert.match(body.id, /^[a-f0-9-]{36}$/);
});
test('audio test uses the saved Suite key through the runner', async t => {
  const { studio, requests } = studioFixture(t);
  assert.equal((await studio.testOpenAINarration()).ok, true);
  assert.equal(JSON.parse(requests.find(x => x.url.endsWith('/openai-audio-test')).options.body).apiKey, secret);
});
test('runner audio test checks authentication and redacts provider errors', async t => {
  const app = Fastify();
  t.after(() => app.close());
  let called = 0;
  registerVideoRunner(app, auth, {
    narrate: async (_text, _file, options) => {
      called++;
      assert.equal(options.apiKey, secret);
      throw Error('Provider rejected ' + secret);
    }
  });
  assert.equal(
    (await app.inject({ method: 'POST', url: '/video/openai-audio-test', payload: { apiKey: secret } })).statusCode,
    401
  );
  const result = await app.inject({
    method: 'POST',
    url: '/video/openai-audio-test',
    headers: { authorization: 'Bearer test' },
    payload: { apiKey: secret }
  });
  assert.equal(called, 1);
  assert.equal(result.statusCode, 422);
  assert.doesNotMatch(result.body, new RegExp(secret));
});
test('accepted runner jobs persist only public metadata, never the forwarded key', async t => {
  const app = Fastify();
  t.after(() => app.close());
  registerVideoRunner(app, auth, { dispatchJobs: () => {} });
  const jobId = crypto.randomUUID();
  const dir = path.join(process.env.VIDEO_OUTPUT_DIR || path.join(os.tmpdir(), 'siteops-video-studio'), jobId);
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = await app.inject({
    method: 'POST',
    url: '/video/jobs',
    headers: { authorization: 'Bearer test' },
    payload: {
      id: jobId,
      title: 'Secret handling test',
      voiceProvider: 'openai',
      voice: 'alloy',
      language: 'en',
      format: 'landscape',
      scenes: [{ headline: 'Test', narration: 'This is a safe test narration.' }],
      demoPolicy: { version: 1, hosts: [] },
      openaiApiKey: secret
    }
  });
  assert.equal(result.statusCode, 202);
  assert.doesNotMatch(await readFile(path.join(dir, 'status.json'), 'utf8'), new RegExp(secret));
  assert.doesNotMatch(
    (await app.inject({ url: '/video/jobs/' + jobId, headers: { authorization: 'Bearer test' } })).body,
    new RegExp(secret)
  );
});

test('SiteOps displays the actual health version even when an older auth endpoint is stale', async () => {
  const calls = [];
  const status = await authenticatedRunnerStatus(async path => {
    calls.push(path);
    return path === '/auth-test'
      ? { ok: true, version: '1.0.0' }
      : { status: 'ok', service: 'siteops-browser-runner', version: '1.1.0' };
  });
  assert.equal(status.version, '1.1.0');
  assert.deepEqual(calls, ['/auth-test', '/health']);
  await assert.rejects(
    authenticatedRunnerStatus(async () => {
      throw Error('unauthorized');
    }),
    /unauthorized/
  );
});
