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

test('Jarvis sends the actual first message to the free OpenRouter ranker with a current model catalog', async () => {
  const { jarvisModelRouter } = await import('../lib/jarvis-models.mjs');
  const model = (id, options = {}) => ({
    id,
    name: id,
    description: 'Model for text and tool calls',
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    supported_parameters: ['tools'],
    pricing: { prompt: '0.000001', completion: '0.000002' },
    ...options
  });
  const catalog = [
    model('alpha/code-model-with-an-id-that-exceeds-forty-characters'),
    model('beta/analysis:free', { pricing: { prompt: '0', completion: '0' } }),
    model('gamma/creative'),
    model('gamma/creative:free'),
    model('other/no-tools', { supported_parameters: [] }),
    model('openrouter/auto')
  ];
  const prompt = 'Analysiere den Warenkorb von meinem Projekt und finde die Ursache für verlorene Bestellungen.';
  const validIds = ['beta/analysis:free', catalog[0].id, 'gamma/creative'];
  let catalogRequests = 0;
  let rankedIds = validIds;
  const router = jarvisModelRouter({ JARVIS_OPENROUTER_KEY: 'free-key' }, async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer free-key');
    if (url === 'https://openrouter.ai/api/v1/models') {
      catalogRequests++;
      return Response.json({ data: catalog });
    }
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    const request = JSON.parse(options.body);
    assert.equal(request.model, 'openrouter/free');
    const payload = JSON.parse(request.messages[1].content);
    assert.equal(payload.firstMessage, prompt);
    assert.deepEqual(
      payload.models.map(entry => entry[0]),
      catalog.slice(0, 4).map(entry => entry.id)
    );
    return Response.json({
      choices: [
        { message: { content: JSON.stringify(rankedIds.map(id => ({ id, reason: 'Für die Diagnose geeignet.' }))) } }
      ]
    });
  });
  const recommendations = await router.recommend(prompt);
  assert.equal(recommendations.source, 'openrouter');
  assert.deepEqual(
    recommendations.options.map(item => item.id),
    validIds
  );
  assert.deepEqual(recommendations.options[0].prices, { input: 0, output: 0 });
  assert.deepEqual(recommendations.options[1].prices, { input: 1, output: 2 });
  rankedIds = [validIds[0], 'unknown/model', validIds[2]];
  assert.deepEqual(await router.recommend(prompt), { source: 'unavailable', options: [] });
  rankedIds = [validIds[0], 'gamma/creative:free', validIds[2]];
  assert.deepEqual(await router.recommend(prompt), { source: 'unavailable', options: [] });
  assert.equal(catalogRequests, 1);
  assert.deepEqual(await jarvisModelRouter({}, () => assert.fail('Unexpected request')).recommend(prompt), {
    source: 'unconfigured',
    options: []
  });
});
