import { createServer } from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkUrls, classifyStatus, retryAfterMs } from '../lib/seo-link-check.mjs';

async function serve(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('HEAD rejected by the server falls back to a ranged GET', async t => {
  const seen = [];
  const base = await serve(t, (req, res) => {
    seen.push(req.method + ' ' + (req.headers.range || ''));
    if (req.method === 'HEAD') return res.writeHead(405).end();
    res.writeHead(206).end('x');
  });
  const result = (await checkUrls([base + '/file.pdf'], { userAgent: 'test' })).get(base + '/file.pdf');
  assert.equal(result.kind, 'ok');
  assert.equal(result.method, 'GET');
  assert.deepEqual(seen, ['HEAD ', 'GET bytes=0-0']);
});

test('429 is retried once after Retry-After', async t => {
  let calls = 0;
  const base = await serve(t, (req, res) => {
    calls++;
    if (calls <= 2) return res.writeHead(429, { 'retry-after': '0' }).end();
    res.writeHead(200).end();
  });
  const result = (await checkUrls([base + '/'], { userAgent: 'test' })).get(base + '/');
  assert.equal(result.kind, 'ok');
});

test('classifies broken, blocked and network failures and checks each URL once', async t => {
  let hits = 0;
  const base = await serve(t, (req, res) => {
    hits++;
    if (req.url === '/gone') return res.writeHead(404).end();
    if (req.url === '/bot') return res.writeHead(403).end();
    res.writeHead(200).end();
  });
  const results = await checkUrls([base + '/gone', base + '/bot', base + '/ok', base + '/ok', 'http://127.0.0.1:9/'], {
    userAgent: 'test'
  });
  assert.equal(results.get(base + '/gone').kind, 'broken');
  assert.equal(results.get(base + '/bot').kind, 'blocked');
  assert.equal(results.get(base + '/ok').kind, 'ok');
  assert.equal(results.get('http://127.0.0.1:9/').kind, 'broken');
  // /gone and /bot: HEAD + GET fallback; /ok once.
  assert.equal(hits, 5);
});

test('a guard refuses URLs before any request is made', async t => {
  let hits = 0;
  const base = await serve(t, (req, res) => {
    hits++;
    res.writeHead(200).end();
  });
  const results = await checkUrls([base + '/', 'mailto:a@example.com'], {
    userAgent: 'test',
    guard: async () => {
      throw new Error('Interne Adresse nicht geprüft');
    }
  });
  assert.equal(results.get(base + '/').kind, 'skipped');
  assert.equal(results.get('mailto:a@example.com').kind, 'skipped');
  assert.equal(hits, 0);
});

test('helpers', () => {
  assert.equal(classifyStatus(301), 'ok');
  assert.equal(classifyStatus(999), 'blocked');
  assert.equal(classifyStatus(500), 'broken');
  assert.equal(classifyStatus(429), 'unchecked');
  assert.equal(retryAfterMs('2'), 2000);
  assert.equal(retryAfterMs('120'), 10000);
});

test('reports resource size and type from HEAD or the ranged GET', async t => {
  const base = await serve(t, (req, res) => {
    if (req.url === '/head.jpg')
      return res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': '2048' }).end();
    if (req.method === 'HEAD') return res.writeHead(405).end();
    res.writeHead(206, { 'content-type': 'image/png; charset=binary', 'content-range': 'bytes 0-0/4096' }).end('x');
  });
  const results = await checkUrls([base + '/head.jpg', base + '/range.png'], { userAgent: 'test' });
  assert.deepEqual(
    [results.get(base + '/head.jpg').bytes, results.get(base + '/head.jpg').contentType],
    [2048, 'image/jpeg']
  );
  assert.deepEqual(
    [results.get(base + '/range.png').bytes, results.get(base + '/range.png').contentType],
    [4096, 'image/png']
  );
});
