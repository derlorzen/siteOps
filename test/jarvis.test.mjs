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
  assert.equal((await app.inject({ method: 'POST', url: '/api/jarvis/chat' })).statusCode, 401);
});
