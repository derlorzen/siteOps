import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { registerIntroRunner, introAsset } from '../runner/video-intros.mjs';
import { createVideoIntros } from '../lib/video-intros.mjs';
const project = '11111111-1111-4111-8111-111111111111';
const auth = (req, reply) => {
  if (req.headers.authorization === 'Bearer test') return true;
  reply.code(401).send({ error: 'unauthorized' });
  return false;
};
test('intro uploads authenticate, require ordered bounded blocks and accept identical retries', async t => {
  const app = Fastify(),
    id = crypto.randomUUID();
  t.after(() => app.close());
  t.after(() =>
    rm(path.join(process.env.VIDEO_OUTPUT_DIR || path.join(os.tmpdir(), 'siteops-video-studio'), 'intros', id), {
      recursive: true,
      force: true
    })
  );
  registerIntroRunner(app, auth, { probe: async () => ({ duration: 2, width: 1280, height: 720, has_audio: true }) });
  const headers = { authorization: 'Bearer test' },
    post = (action, payload) =>
      app.inject({ method: 'POST', url: '/video/intros/' + id + '/' + action, headers, payload });
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/video/intros/' + id + '/chunks',
        payload: { index: 0, data: 'dGVzdA==' }
      })
    ).statusCode,
    401
  );
  assert.equal((await post('chunks', { index: 1, data: 'dGVzdA==' })).statusCode, 409);
  assert.equal((await post('chunks', { index: 0, data: 'dGVzdA==' })).statusCode, 200);
  assert.equal((await post('chunks', { index: 0, data: 'dGVzdA==' })).statusCode, 200);
  assert.equal((await post('chunks', { index: 0, data: 'YmFk' })).statusCode, 409);
  assert.equal((await post('chunks', { index: 50, data: 'dGVzdA==' })).statusCode, 422);
  const done = await post('complete', {});
  assert.equal(done.statusCode, 200, done.body);
  assert.equal(done.json().duration, 2);
  assert.equal((await post('complete', {})).statusCode, 200);
  assert.equal((await post('cancel', {})).statusCode, 409);
  assert.equal((await post('chunks', { index: 1, data: 'dGVzdA==' })).statusCode, 409);
  const range = await app.inject({ url: '/video/intros/' + id + '/file', headers: { ...headers, range: 'bytes=1-2' } });
  assert.equal(range.statusCode, 206);
  assert.equal(range.rawPayload.toString(), 'es');
  assert.equal((await introAsset(id)).has_audio, true);
  await assert.rejects(introAsset('../../outside'), /Ungültig/);
});
test('failed intro validation discards temporary files and never marks a clip ready', async t => {
  const app = Fastify(),
    id = crypto.randomUUID();
  t.after(() => app.close());
  registerIntroRunner(app, auth, {
    probe: async () => {
      throw Error('decoder failed');
    }
  });
  const headers = { authorization: 'Bearer test' };
  await app.inject({
    method: 'POST',
    url: '/video/intros/' + id + '/chunks',
    headers,
    payload: { index: 0, data: 'dGVzdA==' }
  });
  assert.equal(
    (await app.inject({ method: 'POST', url: '/video/intros/' + id + '/complete', headers, payload: {} })).statusCode,
    422
  );
  await assert.rejects(introAsset(id), /nicht verfügbar/);
});
test("SiteOps intro library negotiates capabilities and prevents selecting another project's asset", async () => {
  let inserts = 0;
  const db = {
    query: async sql => {
      if (sql.startsWith('SELECT * FROM video_studio_intro_assets'))
        return [[{ id: project, project_id: project, status: 'ready', metadata: { duration: 2 } }]];
      inserts++;
      return [[]];
    }
  };
  const service = createVideoIntros({
    db,
    getProject: async () => ({ id: project }),
    capabilities: async () => ({ introVersion: 0 })
  });
  await assert.rejects(service.start({ project_id: project, name: 'Intro.mp4' }), /1.4.0/);
  assert.equal(inserts, 0);
  await assert.rejects(service.get(project, crypto.randomUUID()), /diesem Projekt/);
});

test('video jobs snapshot a project-owned intro and forward its ID only to a compatible runner', async t => {
  const { createVideoStudio } = await import('../lib/video-studio.mjs');
  let stored;
  const db = {
    query: async (sql, p = []) => {
      if (sql.startsWith('SELECT * FROM video_studio_projects'))
        return [[{ id: project, channel: 'Lorzen', language: 'en', voice_provider: 'kokoro', voice: 'am_adam' }]];
      if (sql.startsWith('SELECT * FROM video_studio_intro_assets'))
        return [
          [
            {
              id: project,
              project_id: project,
              name: 'Brand intro',
              status: 'ready',
              metadata: { id: project, duration: 2, width: 1280, height: 720, has_audio: true, size: 1000 }
            }
          ]
        ];
      if (sql.startsWith('INSERT INTO video_studio_jobs'))
        stored = {
          id: p[0],
          project_id: p[1],
          title: p[2],
          script: p[4],
          scenes: p[5],
          status: p[7],
          render_settings: p[8],
          youtube_metadata: p[9]
        };
      if (sql.startsWith('SELECT * FROM video_studio_jobs')) return [[stored]];
      return [[]];
    }
  };
  let payload;
  t.mock.method(globalThis, 'fetch', async (url, options) =>
    url.endsWith('/capabilities')
      ? Response.json({ introVersion: 1 })
      : ((payload = JSON.parse(options.body)), Response.json({ id: payload.id }, { status: 202 }))
  );
  const studio = createVideoStudio({ db, runnerUrl: () => 'https://runner.example.com', runnerToken: () => 'token' });
  const job = await studio.createJob({
    project_id: project,
    intro_id: project,
    title: 'Tutorial with intro',
    script: 'This is the real tutorial narration, after the uploaded intro.'
  });
  assert.equal(job.render_settings.intro.name, 'Brand intro');
  assert.equal(job.render_settings.intro.id, project);
  await studio.renderJob(job.id);
  assert.equal(payload.introId, project);
  assert.equal(payload.scenes[0].narration, job.script);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ introVersion: 0 }));
  await assert.rejects(studio.renderJob(job.id), /1.4.0/);
});
