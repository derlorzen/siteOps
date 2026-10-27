import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Fastify from 'fastify';
import { capturePlan, requireCapturePlan, captureMode } from '../runner/video-capture.mjs';
import { createVideoStudio } from '../lib/video-studio.mjs';
import { registerVideoRunner } from '../runner/video-studio.mjs';
const id = '11111111-1111-4111-8111-111111111111';
const scene = {
  headline: 'Show products',
  narration: 'Now we demonstrate the product screen.',
  capture_mode: 'recording',
  demoUrl: 'https://demo.example.com/admin/products',
  demoSteps: [{ action: 'click', selector: '#products' }],
  test_data_only: true
};
test('explicit capture intent cannot degrade into a slide or static screenshot', () => {
  assert.throws(
    () => requireCapturePlan([{ capture_mode: 'recording', visual_directions: 'Show the store' }]),
    /Szene 1: Keine Demo-URL/
  );
  assert.throws(() => requireCapturePlan([{ ...scene, demoSteps: [] }]), /keine?[^]*Aktionen|Kein ausführbarer/);
  assert.throws(() => requireCapturePlan([{ ...scene, capture_mode: 'text' }]), /Texttafel enthält/);
  assert.throws(() => requireCapturePlan([{ ...scene, capture_mode: 'screenshot' }]), /Aktionen erfordern/);
  assert.equal(requireCapturePlan([scene])[0].mode, 'recording');
  assert.equal(captureMode({ demoUrl: scene.demoUrl }), 'screenshot');
  assert.equal(captureMode({ demoUrl: scene.demoUrl, demoSteps: scene.demoSteps }), 'recording');
  assert.equal(capturePlan([{}])[0].mode, 'text');
});
function fixture(t, jobScene = scene, protocol = 1) {
  const calls = [];
  const db = {
    query: async sql => {
      if (sql.startsWith('SELECT * FROM video_studio_projects'))
        return [[{ id, language: 'en', voice_provider: 'kokoro', voice: 'am_adam' }]];
      if (sql.startsWith('SELECT * FROM video_studio_jobs'))
        return [
          [
            {
              id,
              project_id: id,
              status: 'draft',
              scenes: [jobScene],
              render_settings: { language: 'en', voice_provider: 'kokoro', voice: 'am_adam' }
            }
          ]
        ];
      if (sql.startsWith('SELECT * FROM video_studio_demo_templates')) return [[{ id, language: 'en', scene }]];
      return [[]];
    }
  };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/capabilities'))
      return Response.json({
        capturePreflightVersion: protocol,
        demoPolicyVersion: 1,
        demoEnvironmentPolicy: { version: 1, hosts: ['demo.example.com'] }
      });
    if (url.endsWith('/capture-test'))
      return Response.json({ ok: true, message: 'Recorded', resolution: { width: 1920, height: 1080 } });
    return Response.json({ id: JSON.parse(options.body).id }, { status: 202 });
  });
  return {
    calls,
    studio: createVideoStudio({
      db,
      runnerUrl: () => 'https://runner.example.com',
      runnerToken: () => 'private-runner-token'
    })
  };
}
test('render blocks missing recording setup before any runner request', async t => {
  const { studio, calls } = fixture(t, { ...scene, demoUrl: undefined, demoSteps: undefined });
  await assert.rejects(studio.renderJob(id), /Keine Demo-URL/);
  assert.equal(calls.length, 0);
});
test('old runner cannot silently ignore the capture intent', async t => {
  const { studio, calls } = fixture(t, scene, 0);
  await assert.rejects(studio.renderJob(id), /1.2.0/);
  assert.equal(calls.filter(x => x.url.endsWith('/video/jobs')).length, 0);
});
test('capture test resolves template, forwards no narration key and verifies format on the authenticated runner', async t => {
  const { studio, calls } = fixture(t);
  const result = await studio.testCapture({
    project_id: id,
    scene: { headline: 'Demo', narration: scene.narration, capture_mode: 'recording', template_id: id },
    format: 'portrait'
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'recording');
  const request = calls.find(x => x.url.endsWith('/capture-test'));
  const body = JSON.parse(request.options.body);
  assert.equal(body.scene.demoUrl, scene.demoUrl);
  assert.equal(body.format, 'portrait');
  assert.equal(body.openaiApiKey, undefined);
  assert.equal(request.options.headers.Authorization, 'Bearer private-runner-token');
  assert.equal(request.options.redirect, 'error');
  assert.ok(result.checked_at);
});
test('recording test returns structural blockers without trying to record', async t => {
  const { studio, calls } = fixture(t);
  const result = await studio.testCapture({
    project_id: id,
    scene: { narration: scene.narration, capture_mode: 'recording' }
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /Keine Demo-URL/);
  assert.equal(calls.length, 0);
});
test('runner rejects invalid recording jobs and protects the capture test route', async t => {
  const app = Fastify();
  t.after(() => app.close());
  registerVideoRunner(
    app,
    (req, reply) => {
      if (req.headers.authorization === 'Bearer test') return true;
      reply.code(401).send({ error: 'unauthorized' });
      return false;
    },
    { dispatchJobs: () => {} }
  );
  assert.equal((await app.inject({ method: 'POST', url: '/video/capture-test', payload: { scene } })).statusCode, 401);
  const headers = { authorization: 'Bearer test' };
  for (const incomplete of [
    { capture_mode: 'recording' },
    { ...scene, demoSteps: [] },
    { ...scene, capture_mode: 'text' }
  ]) {
    const response = await app.inject({
      method: 'POST',
      url: '/video/jobs',
      headers,
      payload: {
        id: crypto.randomUUID(),
        title: 'Capture validation',
        voiceProvider: 'kokoro',
        voice: 'am_adam',
        language: 'en',
        format: 'landscape',
        demoPolicy: { version: 1, hosts: ['demo.example.com'] },
        scenes: [{ narration: scene.narration, ...incomplete }]
      }
    });
    assert.equal(response.statusCode, 422, response.body);
  }
  const blocked = await app.inject({
    method: 'POST',
    url: '/video/capture-test',
    headers,
    payload: {
      scene: { narration: scene.narration, capture_mode: 'recording' },
      demoPolicy: { version: 1, hosts: ['demo.example.com'] },
      format: 'landscape'
    }
  });
  assert.equal(blocked.statusCode, 422);
  assert.match(blocked.json().error, /Keine Demo-URL/);
});
