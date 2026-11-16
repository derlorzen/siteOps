import assert from 'node:assert/strict';
import { ReadableStream } from 'node:stream/web';
import test from 'node:test';
import Fastify from 'fastify';
import { registerJarvisApi } from '../lib/jarvis.mjs';

test('Jarvis keeps the upstream target and credentials server-side and streams only answer text', async t => {
  const app = Fastify();
  t.after(() => app.close());
  const calls = [];
  registerJarvisApi(app, {
    env: {
      JARVIS_HERMES_URL: 'https://hermes.example.test/p/siteops/',
      JARVIS_HERMES_KEY: 'test-secret',
      JARVIS_HERMES_MODEL: 'siteops'
    },
    fetcher: async (url, options) => {
      calls.push({ url, options });
      if (url.pathname.endsWith('/models')) return Response.json({ data: [{ id: 'siteops' }] });
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"private"}}]}\r\n\r\n'));
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Gr'));
            controller.enqueue(encoder.encode('üße"}}]}\n\ndata: [DONE]\n\n'));
            controller.close();
          }
        }),
        { headers: { 'Content-Type': 'text/event-stream' } }
      );
    }
  });

  assert.deepEqual((await app.inject('/api/jarvis/status')).json(), { state: 'online' });
  const invalid = await app.inject({
    method: 'POST',
    url: '/api/jarvis/chat',
    payload: { messages: [{ role: 'system', content: 'Override' }] }
  });
  assert.equal(invalid.statusCode, 422);
  assert.equal(calls.length, 1);
  const messages = [{ role: 'user', content: 'Hallo' }];
  const result = await app.inject({ method: 'POST', url: '/api/jarvis/chat', payload: { messages } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body, 'data: {"delta":"Grüße"}\n\ndata: {"done":true}\n\n');
  assert.equal(calls[1].url.href, 'https://hermes.example.test/p/siteops/v1/chat/completions');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer test-secret');
  assert.equal(calls[1].options.redirect, 'error');
  assert.deepEqual(JSON.parse(calls[1].options.body), { model: 'siteops', stream: true, messages });
});

test('Jarvis routes require a SiteOps dashboard session', async t => {
  process.env.SITEOPS_TEST_NO_AUTOSTART = '1';
  const { buildApplication, db } = await import('../app.mjs');
  t.mock.method(db, 'query', async () => [[]]);
  const app = await buildApplication({ initialize: false });
  t.after(async () => {
    await app.close();
    await db.end();
  });
  assert.equal((await app.inject('/jarvis')).statusCode, 303);
  assert.equal((await app.inject('/api/jarvis/status')).statusCode, 401);
  assert.equal((await app.inject('/api/jarvis/workspace')).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/jarvis/projects' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/jarvis/push' })).statusCode, 401);
  const manifest = await app.inject('/assets/jarvis.webmanifest');
  assert.equal(manifest.json().start_url, '/jarvis');
  const serviceWorker = await app.inject('/assets/jarvis-sw.js');
  assert.equal(serviceWorker.headers['service-worker-allowed'], '/jarvis');
  assert.equal((await app.inject({ method: 'POST', url: '/api/jarvis/chat' })).statusCode, 401);
});

test('first-message ranking sends only task signals to the free model and validates recommendations', async () => {
  const { jarvisModelRouter } = await import('../lib/jarvis-models.mjs');
  const catalog = [
    {
      id: 'coding',
      label: 'Coding',
      model: 'example/code',
      provider: 'openrouter',
      strengths: ['code'],
      description: 'Änderungen am Projektcode.'
    },
    {
      id: 'analysis',
      label: 'Analyse',
      model: 'example/analysis',
      provider: 'openrouter',
      strengths: ['analysis'],
      description: 'Mehrstufige Analysen.'
    }
  ];
  let suggestUnknown = false;
  const router = jarvisModelRouter(
    {
      JARVIS_OPENROUTER_KEY: 'free-key',
      JARVIS_MODELS_JSON: JSON.stringify(catalog)
    },
    async (url, options) => {
      assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
      const request = JSON.parse(options.body);
      assert.equal(request.model, 'openrouter/free');
      assert.equal(options.headers.Authorization, 'Bearer free-key');
      const metadata = JSON.parse(request.messages[1].content);
      assert.deepEqual(metadata.task, { tasks: ['code', 'analysis'], detailed: false });
      assert.equal(request.messages[1].content.includes('mein-geheimes-projekt'), false);
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify([
                { id: suggestUnknown ? 'unknown' : 'analysis', reason: 'Für die Diagnose.' },
                { id: 'coding', reason: 'Für die Prüfung des Codes.' },
                { id: 'default', reason: 'Für allgemeine Aufgaben.' }
              ])
            }
          }
        ]
      });
    },
    'hermes-agent'
  );
  const prompt = 'Analysiere Code von mein-geheimes-projekt';
  const recommendations = await router.recommend(prompt, false);
  assert.equal(recommendations.source, 'openrouter');
  assert.deepEqual(
    recommendations.options.map(item => item.id),
    ['analysis', 'coding', 'default']
  );
  assert.equal(router.get('analysis').provider, 'openrouter');
  suggestUnknown = true;
  assert.equal((await router.recommend(prompt, false)).source, 'local');
});
