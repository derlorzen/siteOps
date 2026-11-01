import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { load } from 'cheerio';
import { readFile } from 'node:fs/promises';
import { createVideoSuiteAgent, registerVideoSuiteRoutes } from '../lib/video-suite-agent.mjs';
import { renderVideoStudio } from '../lib/video-studio-ui.mjs';
import { renderYouTube } from '../lib/youtube-ui.mjs';
const project = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
function fixture(fetcher, templates = []) {
  const settings = new Map(),
    conversations = new Map(),
    drafts = new Map(),
    images = new Map(),
    calls = [];
  const db = {
    query: async (query, p = []) => {
      if (query.startsWith('INSERT INTO video_suite_chat_images')) {
        images.set(p[0], { id: p[0], project_id: p[1], name: p[2], mime_type: p[3], image: p[4] });
        return [[]];
      }
      if (query.startsWith('SELECT id,project_id,name,mime_type,image')) {
        const image = images.get(p[0]);
        return [[...(image && (!p[1] || image.project_id === p[1]) ? [image] : [])]];
      }
      if (query.startsWith('SELECT setting'))
        return [[...(settings.has(p[0]) ? [{ setting_value: settings.get(p[0]) }] : [])]];
      if (query.startsWith('INSERT INTO app_settings')) {
        settings.set(p[0], p[1]);
        return [[]];
      }
      if (query.startsWith('INSERT INTO video_suite_conversations')) {
        conversations.set(p[0], { id: p[0], project_id: p[1], title: p[2], messages: JSON.parse(p[3]) });
        return [[]];
      }
      if (query.startsWith('SELECT id,messages')) {
        const row = conversations.get(p[0]);
        return [[...(row?.project_id === p[1] ? [row] : [])]];
      }
      if (query.startsWith('UPDATE video_suite_conversations')) {
        conversations.get(p[1]).messages = JSON.parse(p[0]);
        return [[]];
      }
      if (query.startsWith('INSERT INTO video_suite_drafts')) {
        drafts.set(p[0], p[1]);
        return [[]];
      }
      if (query.startsWith('SELECT content')) return [[...(drafts.has(p[0]) ? [{ content: drafts.get(p[0]) }] : [])]];
      throw Error('Unexpected query: ' + query);
    }
  };
  const service = createVideoSuiteAgent({
    db,
    encrypt: x => 'encrypted:' + JSON.stringify(x),
    decrypt: x => JSON.parse(x.slice(10)),
    studio: {
      listDemoTemplates: async () => templates,
      getProject: async id => {
        if (id !== project) throw Object.assign(Error('Missing'), { statusCode: 404 });
        return { name: 'Software tutorials', channel: 'Lorzen', language: 'en' };
      }
    },
    env: {},
    fetcher: async (...args) => {
      calls.push(args);
      return fetcher(...args);
    }
  });
  return { service, calls, settings, conversations };
}
const context = {
  title: 'Tutorial',
  topic: 'Verified product features',
  script: 'This is a sufficiently long test narration for the tutorial.',
  format: 'landscape'
};
const answer = {
  reply: 'Here is the plan.',
  draft: null,
  thumbnail_prompt: 'A simple navy and orange illustration without fictitious UI.',
  social_posts: [{ platform: 'LinkedIn', text: 'A useful tutorial.' }]
};
const response = result =>
  Response.json({
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }],
    usage: { total_tokens: 123 }
  });
test('encrypted OpenAI configuration preserves key and never exposes it', async () => {
  const { service, settings } = fixture();
  assert.equal((await service.status()).configured, false);
  await service.configure({ api_key: 'sk-test-private', model: 'gpt-4.1', image_model: 'gpt-image-1' });
  await service.configure({ api_key: '', model: 'another-model', image_model: 'gpt-image-1' });
  assert.match(settings.get('video_suite_openai'), /^encrypted:/);
  assert.doesNotMatch(JSON.stringify(await service.status()), /sk-test-private/);
  assert.equal(JSON.parse(settings.get('video_suite_openai').slice(10)).api_key, 'sk-test-private');
});
test('agent uses Responses API with trusted project context and server-side history', async () => {
  const { service, calls } = fixture(() => response(answer));
  await service.configure({ api_key: 'sk-test', model: 'gpt-4.1', image_model: 'gpt-image-1' });
  const first = await service.chat({ project_id: project, message: 'Plan this tutorial', context });
  const payload = JSON.parse(calls[0][1].body);
  assert.equal(calls[0][0], 'https://api.openai.com/v1/responses');
  assert.equal(payload.store, false);
  assert.equal(JSON.parse(payload.input[0].content).project.language, 'en');
  assert.equal(payload.text.format.type, 'json_schema');
  assert.equal(payload.text.format.strict, true);
  await service.chat({
    project_id: project,
    conversation_id: first.conversation_id,
    message: 'Improve the hook',
    context
  });
  assert.equal(JSON.parse(calls[1][1].body).input.length, 3);
  await assert.rejects(service.conversation(first.conversation_id, other), { statusCode: 404 });
});
test('agent rejects invalid output and masks upstream secrets and error details', async () => {
  const { service } = fixture(() => response({ ...answer, draft: { title: 'invalid' } }));
  await service.configure({ api_key: 'sk-test', model: 'gpt-4.1', image_model: 'gpt-image-1' });
  await assert.rejects(service.chat({ project_id: project, message: 'Plan a video', context }), { statusCode: 502 });
  const failed = fixture(() => new Response('sk-test secret upstream error', { status: 401 }));
  await failed.service.configure({ api_key: 'sk-test', model: 'gpt-4.1', image_model: 'gpt-image-1' });
  await assert.rejects(
    failed.service.chat({ project_id: project, message: 'Plan a video', context }),
    e => e.statusCode === 401 && !e.message.includes('sk-test')
  );
});
test('working draft survives a reload without saving a render job', async () => {
  const { service } = fixture();
  const draft = { ...context, scene_json: '[]', youtube_json: '{}' };
  assert.equal(await service.loadDraft(project), null);
  await service.saveDraft(project, draft);
  assert.deepEqual(await service.loadDraft(project), draft);
  await assert.rejects(service.saveDraft(other, draft), { statusCode: 404 });
});
test('suite mutation endpoints reject cross-origin and non-JSON requests', async () => {
  const app = Fastify();
  const { service } = fixture();
  registerVideoSuiteRoutes(app, service, {
    page: (_t, body) => body,
    render: renderVideoStudio,
    origin: () => 'https://siteops.test'
  });
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/video-suite/settings',
        headers: { origin: 'https://evil.test' },
        payload: {}
      })
    ).statusCode,
    403
  );
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/video-suite/settings', payload: 'text' })).statusCode,
    415
  );
  const r = await app.inject('/video-suite');
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /Creative Agent/);
  await app.close();
});
test('suite preserves all existing control bindings and moves advanced controls behind settings', async () => {
  const html = renderVideoStudio(),
    $ = load(html);
  const ids = $('[id]')
    .map((_i, e) => $(e).attr('id'))
    .get();
  assert.equal(new Set(ids).size, ids.length);
  for (const id of [
    'vs-policy-form',
    'vs-project',
    'vs-form',
    'vs-jobs',
    'vs-template-json',
    'suite-agent-form',
    'suite-settings-form'
  ])
    assert.equal($('#' + id).length, 1, id);
  assert.equal($('#vs-policy-form').closest('[data-suite-pane]').attr('data-suite-pane'), 'settings');
  assert.equal($('#vs-form').closest('[data-suite-pane]').attr('data-suite-pane'), 'script');
  const js = await readFile(new URL('../public/video-studio.js', import.meta.url), 'utf8');
  for (const match of js.matchAll(/\$\('#([^']+)'\)/g)) assert.equal($('#' + match[1]).length, 1, match[1]);
  assert.match(renderYouTube(), /class="yt-workspace analytics-workspace"/);
  assert.doesNotMatch(renderYouTube(), /assets\/video-suite\.css/);
  assert.doesNotMatch(renderYouTube(), /class="suite-rail"/);
});

test('protected production preview streams runner ranges without buffering', async () => {
  const calls = [];
  const service = createVideoSuiteAgent({
    db: {},
    encrypt: x => x,
    decrypt: x => x,
    studio: {
      artifactResponse: async (...args) => {
        calls.push(args);
        return new Response(Buffer.from('test'), {
          status: 206,
          headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-3/100', 'accept-ranges': 'bytes' }
        });
      }
    }
  });
  await assert.rejects(service.preview(project, 'bytes=9-2'), { statusCode: 416 });
  await assert.rejects(service.preview(project, 'bytes=0-3,6-9'), { statusCode: 416 });
  const app = Fastify();
  registerVideoSuiteRoutes(app, service, {
    page: (_t, b) => b,
    render: renderVideoStudio,
    origin: () => 'https://siteops.test'
  });
  const result = await app.inject({ url: '/api/video-suite/preview/' + project, headers: { range: 'bytes=0-3' } });
  assert.equal(result.statusCode, 206);
  assert.equal(result.body, 'test');
  assert.equal(result.headers['content-range'], 'bytes 0-3/100');
  assert.deepEqual(calls[0], [project, 'video', { start: 0, end: '3' }]);
  await app.close();
});

test('connection diagnosis preserves provider code, parameter and request ID while masking keys', async () => {
  const { service } = fixture(() =>
    Response.json(
      {
        error: {
          code: 'unsupported_parameter',
          param: 'text.format',
          message: 'Unsupported format; key sk-private-secret'
        }
      },
      { status: 400, headers: { 'x-request-id': 'req_123' } }
    )
  );
  await service.configure({ api_key: 'sk-private-secret', model: 'gpt-6-luna', image_model: 'gpt-image-1' });
  const result = await service.testConnection();
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.http_status, 400);
  assert.equal(result.diagnostic.parameter, 'text.format');
  assert.equal(result.diagnostic.request_id, 'req_123');
  assert.match(result.message, /kein Nachweis/);
  assert.doesNotMatch(JSON.stringify(result), /sk-private-secret/);
  assert.equal((await service.status()).last_error.error_code, 'unsupported_parameter');
});
test('encrypted private plugin knowledge is validated and included in every agent request', async () => {
  const { service, settings, calls } = fixture(() => response(answer));
  const knowledge = {
    plugins: [
      {
        id: 'sample-plugin',
        name: 'Example plugin',
        version: '1.0.0',
        summary: 'Verified example plugin functions.',
        features: ['Verified function'],
        limitations: ['No fabricated workflow'],
        availability: 'internal',
        source: 'Installed package README',
        verified_at: '2026-10-26'
      }
    ]
  };
  await service.saveKnowledge(knowledge);
  assert.match(settings.get('video_suite_plugin_knowledge'), /^encrypted:/);
  assert.deepEqual(await service.knowledge(), knowledge);
  await assert.rejects(service.saveKnowledge({ plugins: [...knowledge.plugins, ...knowledge.plugins] }), {
    statusCode: 422
  });
  await service.configure({ api_key: 'sk-test', model: 'gpt-6-luna', image_model: 'gpt-image-1' });
  await service.chat({ project_id: project, message: 'Plan a Bagisto tutorial', context });
  const payload = JSON.parse(calls[0][1].body);
  assert.deepEqual(JSON.parse(payload.input[0].content).product_knowledge, knowledge);
  assert.equal(JSON.parse(payload.input[0].content).production_guidelines.project_id, project);
  assert.ok(
    JSON.parse(payload.input[0].content).production_guidelines.guidelines.some(rule =>
      rule.includes('durchgehende Browsersitzung')
    )
  );
  assert.match(payload.instructions, /effective editorial policy for the selected project/);
  assert.match(payload.instructions, /must not be advertised as publicly available/);
});
test('connection test uses saved model and same output schema as the agent', async () => {
  const { service, calls } = fixture(() => response(answer));
  await service.configure({ api_key: 'sk-test', model: 'gpt-6-luna', image_model: 'gpt-image-1' });
  assert.equal((await service.testConnection()).ok, true);
  const payload = JSON.parse(calls[0][1].body);
  assert.equal(payload.model, 'gpt-6-luna');
  assert.equal(payload.text.format.type, 'json_schema');
});

test('screenshots are project-bound, validated, sent as images and retained for follow-up questions', async () => {
  const { service, calls } = fixture(() => response(answer));
  await service.configure({ api_key: 'sk-test', model: 'gpt-6-luna', image_model: 'gpt-image-1' });
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6gS8AAAAASUVORK5CYII=';
  const image = await service.uploadChatImage({
    project_id: project,
    name: 'A screenshot.png',
    mime_type: 'image/png',
    data: png
  });
  await assert.rejects(
    service.uploadChatImage({
      project_id: project,
      name: 'bad.png',
      mime_type: 'image/png',
      data: Buffer.from('<svg>bad</svg>').toString('base64')
    }),
    { statusCode: 422 }
  );
  await assert.rejects(
    service.chat({ project_id: other, message: 'Use another project image', context, image_ids: [image.id] }),
    { statusCode: 404 }
  );
  const first = await service.chat({
    project_id: project,
    message: 'Explain this screenshot',
    context,
    image_ids: [image.id]
  });
  const payload = JSON.parse(calls[0][1].body);
  assert.equal(payload.input[0].content[1].type, 'input_image');
  assert.equal(payload.input[0].content[1].image_url, 'data:image/png;base64,' + png);
  assert.equal(first.attachments[0].id, image.id);
  const saved = await service.conversation(first.conversation_id, project);
  assert.equal(saved.messages[0].attachments[0].name, 'A screenshot.png');
  assert.doesNotMatch(JSON.stringify(saved), /data:image/);
  await service.chat({
    project_id: project,
    conversation_id: first.conversation_id,
    message: 'What should I change?',
    context
  });
  assert.equal(JSON.parse(calls[1][1].body).input[0].content[1].type, 'input_image');
});
test('agent gets verified language-matching demo references without login secrets or raw actions', async () => {
  const templates = [
    {
      id: other,
      name: 'Products demo',
      language: 'en',
      scene: {
        headline: 'Products',
        narration: 'Open the verified product list.',
        login_profile_id: other,
        demoSteps: [{ action: 'fill', value: 'Do not send raw fields' }]
      }
    },
    { id: project, name: 'German only', language: 'de', scene: {} }
  ];
  const { service, calls } = fixture(() => response(answer), templates);
  await service.configure({ api_key: 'sk-test', model: 'gpt-6-luna', image_model: 'gpt-image-1' });
  await service.chat({ project_id: project, message: 'Plan a real screen recording', context });
  const request = JSON.parse(calls[0][1].body),
    data = JSON.parse(request.input[0].content);
  assert.equal(data.available_demo_templates.length, 1);
  assert.equal(data.available_demo_templates[0].template_id, other);
  assert.doesNotMatch(request.input[0].content, /Do not send raw fields/);
  assert.match(request.instructions, /real screen recording is not configured/);
});
