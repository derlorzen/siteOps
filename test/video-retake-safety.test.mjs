import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Fastify from 'fastify';
import { registerVideoRunner } from '../runner/video-studio.mjs';

test('runner rejects unapproved, ambiguous, or missing-source scene retakes before queueing', async t => {
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
  const source = crypto.randomUUID();
  const base = {
    id: crypto.randomUUID(),
    title: 'Retake safety',
    voiceProvider: 'kokoro',
    voice: 'am_adam',
    language: 'en',
    format: 'landscape',
    demoPolicy: { version: 1, hosts: ['demo.example.com'] },
    scenes: [
      { headline: 'Intro', narration: 'This is a complete narration for the product tutorial.', capture_mode: 'text' }
    ]
  };
  const post = async extra =>
    app.inject({
      method: 'POST',
      url: '/video/jobs',
      headers: { authorization: 'Bearer test' },
      payload: { ...base, id: crypto.randomUUID(), ...extra }
    });
  assert.equal((await post({ recaptureScenes: [1] })).statusCode, 422);
  assert.equal((await post({ resumeFrom: source })).statusCode, 422);
  assert.equal((await post({ resumeFrom: source, recaptureScenes: [1, 1] })).statusCode, 422);
  assert.equal((await post({ resumeFrom: source, recaptureScenes: [2] })).statusCode, 422);
  assert.equal((await post({ resumeFrom: source, recaptureScenes: [1] })).statusCode, 409);
  assert.equal((await app.inject({ method: 'GET', url: '/video/jobs/' + source })).statusCode, 401);
});
