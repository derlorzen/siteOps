import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerVideoRunner } from '../runner/video-studio.mjs';

test('runner requires Bearer authorization for policy capabilities and every video route', async t => {
  const app = Fastify();
  t.after(() => app.close());
  registerVideoRunner(app, (req, reply) => {
    if (req.headers.authorization === 'Bearer test') return true;
    reply.code(401).send({ error: 'unauthorized' });
    return false;
  });
  for (const [method, url] of [
    ['GET', '/video/capabilities'],
    ['POST', '/video/jobs'],
    ['GET', '/video/jobs/invalid'],
    ['GET', '/video/jobs/invalid/file']
  ]) {
    assert.equal((await app.inject({ method, url })).statusCode, 401);
  }
  const info = await app.inject({ url: '/video/capabilities', headers: { authorization: 'Bearer test' } });
  assert.equal(info.json().demoPolicyVersion, 1);
  const job = {
    id: '11111111-1111-4111-8111-111111111111',
    voice: 'am_michael',
    language: 'en',
    format: 'landscape',
    scenes: [{ narration: 'A safe test narration.', demoUrl: 'https://lorzen.de/' }],
    demoPolicy: { version: 1, hosts: ['*.lorzen.de'] }
  };
  for (const demoPolicy of [
    job.demoPolicy,
    { version: 1, hosts: [] },
    { version: 1, hosts: ['*'] },
    { version: 2, hosts: ['lorzen.de'] },
    null
  ]) {
    const r = await app.inject({
      method: 'POST',
      url: '/video/jobs',
      headers: { authorization: 'Bearer test' },
      payload: { ...job, demoPolicy }
    });
    assert.equal(r.statusCode, 422);
    assert.equal(typeof r.json().error, 'string');
  }
  assert.equal(
    (await app.inject({ url: '/video/jobs/' + job.id, headers: { authorization: 'Bearer test' } })).statusCode,
    404
  );
});
