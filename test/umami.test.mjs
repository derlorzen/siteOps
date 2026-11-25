import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUmamiClient, umamiOrigin } from '../lib/umami.mjs';

function fakeUmami() {
  const calls = [];
  const websites = [{ id: '11111111-2222-4333-8444-555555555555', name: 'Schleishare', domain: 'schleishare.de' }];
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url);
    calls.push({ method: init.method || 'GET', pathname, auth: init.headers?.authorization });
    if (pathname === '/api/auth/login') {
      const body = JSON.parse(init.body);
      return body.password === 'secret' ? json({ token: 'jwt' }) : json({ error: 'no' }, 401);
    }
    if (init.headers?.authorization !== 'Bearer jwt') return json({}, 401);
    if (pathname === '/api/heartbeat') return json({ ok: true });
    if (pathname === '/api/websites' && (init.method || 'GET') === 'GET')
      return json({ data: websites, count: websites.length });
    if (pathname === '/api/websites' && init.method === 'POST') {
      const body = JSON.parse(init.body);
      const created = { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', ...body };
      websites.push(created);
      return json(created);
    }
    if (pathname.endsWith('/stats')) {
      assert.ok(Number(searchParams.get('endAt')) - Number(searchParams.get('startAt')) === 7 * 86400000);
      return json({ pageviews: { value: 42 }, visitors: { value: 10 }, visits: 12, bounces: 3, totaltime: 600 });
    }
    if (pathname.endsWith('/metrics'))
      return json([{ x: searchParams.get('type') === 'path' ? '/' : 'google.com', y: 5 }]);
    return json({}, 404);
  };
  return { calls, fetchImpl };
}

test('umami origin accepts only plain HTTPS origins', () => {
  assert.equal(umamiOrigin('https://stats.lorzen.de/'), 'https://stats.lorzen.de');
  assert.equal(umamiOrigin('http://stats.lorzen.de'), null);
  assert.equal(umamiOrigin('https://user:pw@stats.lorzen.de'), null);
  assert.equal(umamiOrigin('https://stats.lorzen.de/umami'), null);
});

test('umami client finds, creates and reads websites', async () => {
  const { calls, fetchImpl } = fakeUmami();
  const client = createUmamiClient({
    url: 'https://stats.example.de',
    username: 'admin',
    password: 'secret',
    fetchImpl,
    now: () => 1_800_000_000_000
  });
  assert.equal((await client.findWebsite('www.schleishare.de')).id, '11111111-2222-4333-8444-555555555555');
  const existing = await client.ensureWebsite({ domain: 'schleishare.de' });
  assert.equal(existing.created, false);
  const created = await client.ensureWebsite({ domain: 'Shop.Lorzen.Link', name: 'Lorzen Shop' });
  assert.equal(created.created, true);
  assert.equal(created.domain, 'shop.lorzen.link');
  const stats = await client.stats(existing.id, { days: 7 });
  assert.equal(stats.pageviews, 42);
  assert.equal(stats.visits, 12);
  assert.deepEqual(stats.topPages, [{ value: '/', count: 5 }]);
  assert.deepEqual(stats.topReferrers, [{ value: 'google.com', count: 5 }]);
  assert.equal(calls.filter(c => c.pathname === '/api/auth/login').length, 1, 'token is reused');
  assert.equal((await client.status()).websites, 2);
});

test('umami client reports missing configuration and rejected logins', async () => {
  const { fetchImpl } = fakeUmami();
  assert.equal((await createUmamiClient({ url: '', fetchImpl }).status()).configured, false);
  const wrong = createUmamiClient({ url: 'https://stats.example.de', username: 'admin', password: 'nope', fetchImpl });
  await assert.rejects(wrong.websites(), /Anmeldung abgelehnt/);
  await assert.rejects(
    createUmamiClient({ url: 'https://stats.example.de', username: 'a', password: 'secret', fetchImpl }).stats('x'),
    /Website-ID/
  );
});
