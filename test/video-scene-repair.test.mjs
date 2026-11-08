import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoStudio } from '../lib/video-studio.mjs';

const id = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const rendererId = '33333333-3333-4333-8333-333333333333';

test('scene repair creates a distinct draft with the exact approved retake indices', async t => {
  const rows = new Map();
  const original = {
    id,
    project_id: projectId,
    title: 'Real Bagisto tutorial',
    topic: 'Convert a plugin',
    script: 'This is a complete introductory narration for the Bagisto tutorial.',
    format: 'landscape',
    status: 'done',
    runner_job_id: rendererId,
    scenes: [
      {
        headline: 'Converter',
        narration: 'This is a real tutorial scene for the plugin converter.',
        capture_mode: 'text'
      }
    ],
    render_settings: { language: 'en', voice_provider: 'kokoro', voice: 'am_adam' },
    result: { captures: [{ scene: 1, sha256: 'test-integrity-hash' }] }
  };
  rows.set(id, original);
  const db = {
    query: async (sql, params = []) => {
      if (sql.startsWith('SELECT * FROM video_studio_jobs')) return [[rows.get(params[0])].filter(Boolean)];
      if (sql.startsWith('SELECT * FROM video_studio_projects'))
        return [[
          { id: projectId, language: 'en', name: 'Tutorials', channel: 'Lorzen', voice_provider: 'kokoro', voice: 'am_adam' }
        ]];
      if (sql.startsWith('INSERT INTO video_studio_jobs')) {
        rows.set(params[0], {
          id: params[0],
          project_id: params[1],
          title: params[2],
          topic: params[3],
          script: params[4],
          scenes: params[5],
          format: params[6],
          status: params[7],
          render_settings: params[8],
          youtube_metadata: params[9]
        });
        return [[{ affectedRows: 1 }]];
      }
      if (sql.startsWith('UPDATE video_studio_jobs SET render_settings')) {
        rows.get(params[1]).render_settings = params[0];
        return [[{ affectedRows: 1 }]];
      }
      if (sql.includes('app_settings')) return [[]];
      throw Error('Unexpected query: ' + sql);
    }
  };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(url, /video\/capabilities$/);
    assert.equal(options.headers.Authorization, 'Bearer test');
    return Response.json({ sceneReuseVersion: 1 });
  });
  const studio = createVideoStudio({
    db,
    runnerUrl: () => 'https://runner.example.com',
    runnerToken: () => 'test',
    encrypt: x => x,
    decrypt: x => x
  });
  await assert.rejects(studio.repairJob(id, { scenes: [1], confirm_demo_replay: false }));
  await assert.rejects(studio.repairJob(id, { scenes: [1, 1], confirm_demo_replay: true }), { statusCode: 422 });
  const result = await studio.repairJob(id, { scenes: [1], confirm_demo_replay: true });
  assert.notEqual(result.id, id);
  assert.equal(result.status, 'draft');
  assert.equal(result.render_settings.retry.source_runner_job_id, rendererId);
  assert.deepEqual(result.render_settings.retry.scenes, [1]);
  assert.equal(rows.get(id), original);
  assert.equal(original.status, 'done');
});
