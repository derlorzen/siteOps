import test from 'node:test';
import assert from 'node:assert/strict';
import {
  projectSettings,
  projectChangesSchema,
  defaultVideoMetadata,
  metadataSchema
} from '../lib/video-production.mjs';
import { createVideoDownloadTickets } from '../lib/video-downloads.mjs';
import { registerVideoStudioTools } from '../lib/video-studio-mcp.mjs';
import { createVideoStudio } from '../lib/video-studio.mjs';

test('EN defaults to Adam, DE to Thorsten, explicit existing voices survive and partial updates have no defaults', () => {
  assert.equal(projectSettings({ name: 'English' }).voice, 'am_adam');
  assert.equal(projectSettings({ name: 'Deutsch', language: 'de' }).voice, 'de_DE-thorsten-medium');
  assert.equal(projectSettings({ name: 'Existing', voice: 'am_michael' }).voice, 'am_michael');
  assert.deepEqual(projectChangesSchema.parse({ name: 'New name' }), { name: 'New name' });
  for (const language of ['en', 'de'])
    assert.equal(projectSettings({ name: 'OpenAI', language, voice_provider: 'openai' }).voice, 'alloy');
});

test('signed video downloads are file-bound, expire, reject tampering and do not contain the signing key', () => {
  let now = 1000000;
  const key = Buffer.alloc(32, 7),
    signer = createVideoDownloadTickets(
      () => key,
      () => now
    );
  const id = '11111111-1111-4111-8111-111111111111',
    token = signer.issue(id, 'video');
  assert.deepEqual(
    { ...signer.verify(token), nonce: undefined },
    { id, kind: 'video', exp: 1300000, nonce: undefined }
  );
  assert.throws(() => signer.verify(token + 'x'), { statusCode: 403 });
  assert.throws(() => signer.verify(token.replace(token[0], token[0] === 'a' ? 'b' : 'a')), { statusCode: 403 });
  now += 300001;
  assert.throws(() => signer.verify(token), { statusCode: 403 });
  assert.throws(() => signer.issue(id, 'private-key'));
});

test('each language receives editable YouTube preparation and validates chapter order', () => {
  for (const language of ['de', 'en']) {
    const metadata = defaultVideoMetadata(
      { title: 'Bagisto product management', topic: 'Bagisto products' },
      { language, channel: 'Bagisto' },
      [{ headline: 'Introduction', narration: 'This is a meaningful narration.' }]
    );
    assert.equal(metadata.chapters[0].start_seconds, 0);
    assert.ok(metadata.thumbnail_concept.length > 5);
    assert.ok(metadata.description.startsWith(language === 'de' ? 'In diesem Video:' : 'In this video:'));
    assert.equal(metadata.sources.length, 0);
    assert.throws(() => metadataSchema.parse({ ...metadata, chapters: [{ start_seconds: 10, title: 'Wrong' }] }));
  }
});

test('MCP registers all legacy and requested tools with valid schemas, approval guard and controlled errors', async () => {
  const tools = new Map(),
    server = { registerTool: (name, definition, run) => tools.set(name, { definition, run }) };
  let renders = 0;
  registerVideoStudioTools(
    server,
    () => ({
      renderJob: async () => {
        renders++;
        return {};
      },
      createProject: async () => {
        throw Object.assign(new Error('Invalid voice'), { statusCode: 422 });
      }
    }),
    value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] })
  );
  for (const name of [
    'projects',
    'create_project',
    'update_project',
    'runner_status',
    'list_jobs',
    'downloads',
    'create_job',
    'render_job',
    'job_status',
    'demo_templates',
    'save_demo_template',
    'update_metadata'
  ])
    assert.ok(tools.has('video_studio_' + name), name);
  const render = tools.get('video_studio_render_job');
  const id = '11111111-1111-4111-8111-111111111111';
  assert.equal(render.definition.inputSchema.safeParse({ id }).success, false);
  assert.equal(render.definition.inputSchema.safeParse({ id, approved: true }).success, true);
  await render.run({ id, approved: true });
  assert.equal(renders, 1);
  assert.equal((await render.run({ id })).isError, true);
  assert.equal(renders, 1);
  const error = await tools.get('video_studio_create_project').run({ name: 'Valid project' });
  assert.equal(error.isError, true);
  assert.match(error.content[0].text, /Invalid voice/);
});

test('project updates retain language, data, existing voices and do not alter prior jobs', async () => {
  let project = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Deutsch',
    channel: 'Bagisto',
    language: 'de',
    voice_provider: 'piper',
    voice: 'de_DE-thorsten-medium'
  };
  const queries = [];
  const db = {
    query: async (sql, args) => {
      queries.push(sql);
      if (sql.startsWith('SELECT * FROM video_studio_projects')) return [[project]];
      if (sql.startsWith('UPDATE video_studio_projects'))
        project = {
          ...project,
          name: args[0],
          channel: args[1],
          language: args[2],
          voice_provider: args[3],
          voice: args[4]
        };
      return [[]];
    }
  };
  const studio = createVideoStudio({ db });
  assert.equal((await studio.updateProject(project.id, { name: 'Neue Reihe' })).language, 'de');
  assert.equal((await studio.updateProject(project.id, { language: 'en' })).voice, 'am_adam');
  assert.equal(
    queries.some(q => q.includes('video_studio_jobs')),
    false
  );
});

test('reusable demo scenes validate test-only domains and snapshot actions into jobs', async t => {
  const id = '11111111-1111-4111-8111-111111111111';
  let template, job;
  const project = {
    id,
    name: 'Test project',
    channel: 'Bagisto',
    language: 'en',
    voice_provider: 'kokoro',
    voice: 'am_adam'
  };
  const db = {
    query: async (sql, args) => {
      if (sql.includes('app_settings')) return [[]];
      if (sql.startsWith('SELECT * FROM video_studio_projects')) return [[project]];
      if (sql.startsWith('INSERT INTO video_studio_demo_templates'))
        template = { id: args[0], name: args[1], language: args[2], scene: args[3] };
      if (sql.startsWith('SELECT * FROM video_studio_demo_templates')) return [[template].filter(Boolean)];
      if (sql.startsWith('INSERT INTO video_studio_jobs'))
        job = {
          id: args[0],
          project_id: args[1],
          scenes: args[5],
          status: args[7],
          render_settings: args[8],
          youtube_metadata: args[9]
        };
      if (sql.startsWith('SELECT * FROM video_studio_jobs')) return [[job]];
      return [[]];
    }
  };
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ demoPolicyVersion: 1, demoEnvironmentPolicy: { version: 1, hosts: ['*.lorzen.de'] } })
  );
  const studio = createVideoStudio({ db, runnerUrl: () => 'https://runner.example.com', runnerToken: () => 'test' });
  const scene = {
    headline: 'Test products',
    narration: 'Create a demonstration product using test data.',
    demoUrl: 'https://demo.lorzen.de',
    test_data_only: true,
    demoSteps: [{ action: 'click', selector: '#products' }]
  };
  await assert.rejects(
    studio.saveDemoTemplate({ name: 'Bad host', language: 'en', scene: { ...scene, demoUrl: 'https://evil.test' } }),
    { statusCode: 422 }
  );
  await assert.rejects(
    studio.saveDemoTemplate({ name: 'No attestation', language: 'en', scene: { ...scene, test_data_only: undefined } }),
    { statusCode: 422 }
  );
  const saved = await studio.saveDemoTemplate({ name: 'Bagisto products', language: 'en', scene });
  const draft = await studio.createJob({
    project_id: id,
    title: 'Demonstration',
    script: scene.narration,
    scenes: [{ template_id: saved.id, narration: scene.narration }]
  });
  assert.deepEqual(draft.scenes[0].demoSteps, scene.demoSteps);
  assert.equal(draft.render_settings.voice, 'am_adam');
  assert.equal(draft.youtube.title, 'Demonstration');
  template.scene = JSON.stringify({ ...scene, demoSteps: [] });
  assert.equal((await studio.getJob(draft.id)).scenes[0].demoSteps.length, 1);
});


test('video tickets fit the router default parameter limit for every file type', () => {
  let now = 1793544000000;
  const tickets = createVideoDownloadTickets(() => 'test-key-only', () => now);
  const id = 'c9b2f259-9a55-4ffc-aa7e-7b6aae508924';
  for (const kind of ['video', 'short', 'subtitles', 'thumbnail', 'metadata']) {
    const token = tickets.issue(id, kind);
    assert.ok(token.length <= 100, 'signed ticket must fit Fastify default maxParamLength');
    const result = tickets.verify(token);
    assert.equal(result.id, id);
    assert.equal(result.kind, kind);
    assert.equal(result.nonce.length, 32);
    assert.throws(() => tickets.verify(token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')));
  }
  const token = tickets.issue(id, 'video');
  now += 300000;
  assert.throws(() => tickets.verify(token));
});
