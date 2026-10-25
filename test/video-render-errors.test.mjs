import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createVideoStudio } from '../lib/video-studio.mjs';

test('runner render HTTP 422 remains a readable validation error, never Bad Gateway', async t => {
  const id = '11111111-1111-4111-8111-111111111111';
  let updates = 0;
  const db = {
    query: async sql => {
      if (sql.includes('video_studio_jobs') && sql.startsWith('SELECT'))
        return [[{ id, project_id: id, status: 'draft', scenes: [] }]];
      if (sql.includes('video_studio_projects')) return [[{ voice: 'alloy', voice_provider: 'openai' }]];
      if (sql.startsWith('UPDATE')) updates++;
      return [[]];
    }
  };
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          error: 'Only explicitly allowed HTTPS demo URLs are supported.'
        }),
        { status: 422 }
      )
  );
  const studio = createVideoStudio({ db, runnerUrl: () => 'https://runner.example.com', runnerToken: () => 'test' });
  await assert.rejects(studio.renderJob(id), error => {
    assert.equal(error.statusCode, 422);
    assert.match(error.message, /Demo-Domains/);
    assert.doesNotMatch(error.message, /Bad Gateway/);
    return true;
  });
  assert.equal(updates, 0);
});

test('real runner API redirect is rejected without reaching its destination', async t => {
  let redirected = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/sink') {
      redirected++;
      res.end('{}');
      return;
    }
    res.writeHead(302, { location: '/sink' });
    res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise(resolve => server.close(resolve));
  });
  const studio = createVideoStudio({
    db: {},
    runnerUrl: () => 'http://127.0.0.1:' + server.address().port,
    runnerToken: () => 'test-secret'
  });
  await assert.rejects(studio.capabilities(), { statusCode: 503 });
  assert.equal(redirected, 0);
});

test('render carries a validated policy snapshot only after protocol negotiation and never forwards Bearer across redirects', async t => {
  const id = '11111111-1111-4111-8111-111111111111';
  const policy = { version: 1, hosts: ['*.lorzen.de', 'shop.lorzen.link'] };
  let queued = false;
  const db = {
    query: async sql => {
      if (sql.includes('app_settings')) return [[{ setting_value: JSON.stringify(policy) }]];
      if (sql.includes('video_studio_jobs') && sql.startsWith('SELECT'))
        return [[{ id, project_id: id, status: queued ? 'queued' : 'draft', scenes: [] }]];
      if (sql.includes('video_studio_projects')) return [[{ voice: 'alloy', voice_provider: 'openai' }]];
      if (sql.startsWith('UPDATE')) queued = true;
      return [[]];
    }
  };
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    seen.push(url);
    if (url.endsWith('/capabilities')) return Response.json({ demoPolicyVersion: 1 });
    assert.deepEqual(JSON.parse(options.body).demoPolicy, policy);
    return Response.json({ id, status: 'queued' }, { status: 202 });
  });
  const studio = createVideoStudio({
    db,
    runnerUrl: () => 'https://runner.example.com',
    runnerToken: () => 'test-secret'
  });
  assert.equal((await studio.renderJob(id)).status, 'queued');
  assert.equal(seen.length, 2);
});

test('renderer distinguishes unauthorized, conflict, full queue, malformed response, timeout and connectivity errors', async t => {
  const id = '11111111-1111-4111-8111-111111111111';
  const db = {
    query: async sql => {
      if (sql.includes('app_settings')) return [[]];
      if (sql.includes('video_studio_jobs')) return [[{ id, project_id: id, status: 'draft', scenes: [] }]];
      return [[{ voice: 'alloy' }]];
    }
  };
  let status = 401,
    networkError = null;
  t.mock.method(globalThis, 'fetch', async () => {
    if (networkError) throw networkError;
    return new Response('not json', { status });
  });
  const studio = createVideoStudio({ db, runnerUrl: () => 'https://runner.example.com', runnerToken: () => 'test' });
  for (const [input, expected, message] of [
    [401, 503, /Token/],
    [403, 503, /Token/],
    [409, 409, /vorhanden/],
    [429, 429, /Warteschlange/],
    [500, 502, /HTTP 500/],
    [202, 502, /ungültige/]
  ]) {
    status = input;
    await assert.rejects(studio.renderJob(id), e => e.statusCode === expected && message.test(e.message));
  }
  networkError = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
  await assert.rejects(studio.renderJob(id), { statusCode: 504 });
  networkError = new Error('network failure');
  await assert.rejects(studio.renderJob(id), { statusCode: 503 });
});
