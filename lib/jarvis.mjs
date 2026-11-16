import { Readable } from 'node:stream';
import { z } from 'zod';

const conversation = z.strictObject({
  messages: z
    .array(
      z.strictObject({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(32_000)
      })
    )
    .min(1)
    .max(39)
    .refine(
      messages =>
        messages.length % 2 === 1 && messages.every(({ role }, index) => role === (index % 2 ? 'assistant' : 'user'))
    )
});

function hermesConfig(env) {
  if (!env.JARVIS_HERMES_URL && !env.JARVIS_HERMES_KEY) return { state: 'unconfigured' };
  try {
    const base = new URL(env.JARVIS_HERMES_URL);
    if (
      base.protocol !== 'https:' ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      !env.JARVIS_HERMES_KEY?.trim()
    )
      return { state: 'misconfigured' };
    base.pathname = base.pathname.replace(/\/$/, '') + '/';
    const model = env.JARVIS_HERMES_MODEL?.trim() || 'hermes-agent';
    return { state: 'configured', base, model, key: env.JARVIS_HERMES_KEY.trim() };
  } catch {
    return { state: 'misconfigured' };
  }
}

function requestHermes(config, path, options, fetcher) {
  return fetcher(new URL(path, config.base), {
    ...options,
    redirect: 'error',
    headers: {
      Authorization: 'Bearer ' + config.key,
      ...options.headers
    }
  });
}

function event(data) {
  return 'data: ' + JSON.stringify(data) + '\n\n';
}

// Only relay answer text. Upstream request IDs, tool arguments and reasoning stay on the server.
async function* answerEvents(body) {
  try {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of body) {
      buffer += decoder.decode(chunk, { stream: true });
      if (buffer.length > 1024 * 1024) throw new Error('Hermes event too large');
      let separator;
      while ((separator = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        const data = frame
          .split(/\r?\n/)
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trimStart())
          .join('\n');
        if (data === '[DONE]') {
          yield event({ done: true });
          return;
        }
        if (!data) continue;
        const payload = JSON.parse(data);
        if (payload.error) throw new Error('Hermes stream failed');
        const delta = payload.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) yield event({ delta });
      }
    }
  } catch {
    // The browser gets the same recoverable message for incomplete and failed streams.
  }
  yield event({ error: 'Die Antwort wurde unterbrochen. Du kannst deine Nachricht erneut senden.' });
}

export function registerJarvisApi(app, { env = process.env, fetcher = fetch } = {}) {
  const config = hermesConfig(env);
  const unavailable = 'Hermes ist gerade nicht erreichbar.';
  app.get('/api/jarvis/status', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async () => {
    if (config.state !== 'configured') return { state: config.state };
    try {
      const response = await requestHermes(config, 'v1/models', { signal: AbortSignal.timeout(5000) }, fetcher);
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
        await response.body?.cancel();
        return { state: 'unavailable' };
      }
      const models = await response.json();
      return { state: models.data?.some(model => model?.id === config.model) ? 'online' : 'model_unavailable' };
    } catch {
      return { state: 'unavailable' };
    }
  });

  app.post(
    '/api/jarvis/chat',
    {
      bodyLimit: 192 * 1024,
      config: { rateLimit: { max: 12, timeWindow: '1 minute' } }
    },
    async (req, reply) => {
      if (
        !String(req.headers['content-type'] || '')
          .toLowerCase()
          .startsWith('application/json')
      ) {
        return reply.code(415).send({ message: 'JSON erforderlich.' });
      }
      const incoming = conversation.safeParse(req.body);
      if (!incoming.success)
        return reply.code(422).send({ message: 'Der Gesprächsverlauf ist ungültig oder zu lang.' });
      if (config.state !== 'configured')
        return reply.code(503).send({ message: 'Hermes ist in SiteOps noch nicht eingerichtet.' });

      const disconnect = new AbortController();
      reply.raw.once('close', () => disconnect.abort());
      try {
        const response = await requestHermes(
          config,
          'v1/chat/completions',
          {
            method: 'POST',
            signal: AbortSignal.any([disconnect.signal, AbortSignal.timeout(180_000)]),
            headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
            body: JSON.stringify({ model: config.model, messages: incoming.data.messages, stream: true })
          },
          fetcher
        );
        if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
          await response.body?.cancel();
          return reply.code(502).send({ message: unavailable });
        }
        return reply
          .type('text/event-stream; charset=utf-8')
          .header('X-Accel-Buffering', 'no')
          .send(Readable.from(answerEvents(response.body)));
      } catch {
        if (!disconnect.signal.aborted) return reply.code(502).send({ message: unavailable });
      }
    }
  );
}
