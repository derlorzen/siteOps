import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { normalizeDemoHosts, demoHostMatches, demoPolicy, environmentDemoPolicy } from '../runner/video-policy.mjs';
import { validatedDemoUrl } from '../runner/video-demo.mjs';
import { createDemoPolicySettings } from '../lib/video-policy-settings.mjs';
import { createVideoStudio, registerVideoStudioRoutes } from '../lib/video-studio.mjs';
import { createDashboardSessions } from '../lib/dashboard-session.mjs';

const policy = { version: 1, hosts: ['*.lorzen.de', 'shop.lorzen.link'] };
test('strict normalized wildcard rules match only true subdomains', () => {
  assert.deepEqual(normalizeDemoHosts([' SHOP.lorzen.link ', '*.lorzen.de', '*.lorzen.de']), policy.hosts);
  for (const host of ['demo.lorzen.de', 'a.demo.lorzen.de', 'shop.lorzen.link', 'DEMO.LORZEN.DE'])
    assert.equal(demoHostMatches(host, policy.hosts), true, host);
  for (const host of [
    'lorzen.de',
    'evillorzen.de',
    'demo.lorzen.de.evil.test',
    'shop.lorzen.link.evil.test',
    'sub.shop.lorzen.link',
    'evil.test'
  ])
    assert.equal(demoHostMatches(host, policy.hosts), false, host);
  assert.equal(demoHostMatches('demo.lorzen.de', []), false);
  for (const rule of [
    '*',
    '*.com',
    '*lorzen.de',
    'foo.*.de',
    'https://lorzen.de',
    'lorzen.de:443',
    'lorzen.de/',
    'lorzen.de.',
    '.lorzen.de',
    'a..lorzen.de',
    '-a.lorzen.de',
    '127.0.0.1',
    '[::1]',
    '2130706433',
    '0x7f.0.0.1',
    'a@lorzen.de',
    'lörzen.de',
    '',
    'a'.repeat(64) + '.de'
  ])
    assert.throws(() => normalizeDemoHosts([rule]), undefined, rule);
  assert.throws(() => normalizeDemoHosts(Array(101).fill('demo.example.com')));
  assert.throws(() => demoPolicy({ ...policy, allowAll: true }));
  assert.throws(() => demoPolicy({ ...policy, version: 2 }));
  for (const url of [
    'http://demo.lorzen.de',
    'https://demo.lorzen.de:8443',
    'https://x:secret@demo.lorzen.de',
    'https://demo.lorzen.de/#secret',
    'https://lorzen.de',
    'https://127.0.0.1'
  ])
    assert.throws(() => validatedDemoUrl(url, policy.hosts));
  assert.equal(validatedDemoUrl('https://demo.lorzen.de:443/a', policy.hosts), 'https://demo.lorzen.de/a');
});

test('MySQL persistence distinguishes absent fallback, deny-all, invalid settings and reset', async () => {
  let stored;
  const db = {
    query: async (sql, args) => {
      if (sql.startsWith('SELECT')) return [stored === undefined ? [] : [{ setting_value: stored }]];
      if (sql.startsWith('INSERT')) stored = args[1];
      if (sql.startsWith('DELETE')) stored = undefined;
      return [[]];
    }
  };
  const settings = createDemoPolicySettings(db);
  assert.equal(await settings.read(), null);
  assert.deepEqual(environmentDemoPolicy(' *.lorzen.de, shop.lorzen.link '), policy);
  await settings.save(policy);
  assert.deepEqual(await createDemoPolicySettings(db).read(), policy);
  await assert.rejects(settings.save({ version: 1, hosts: ['*'] }));
  assert.deepEqual(await settings.read(), policy);
  await settings.save({ version: 1, hosts: [] });
  assert.deepEqual(await settings.read(), { version: 1, hosts: [] });
  stored = '{broken';
  await assert.rejects(settings.read(), { code: 'INVALID_SAVED_DEMO_POLICY' });
  await settings.save(null);
  assert.equal(await settings.read(), null);
  assert.throws(() => environmentDemoPolicy('demo.example.com,*'));
});

test('GUI settings require supported runner, preserve settings on failure, and fail closed on storage errors', async t => {
  let writes = 0;
  const db = {
    query: async sql => {
      if (!sql.startsWith('SELECT')) writes++;
      return [[]];
    }
  };
  const studio = createVideoStudio({ db, runnerUrl: () => 'https://runner.example.com', runnerToken: () => 'secret' });
  let info = {};
  t.mock.method(globalThis, 'fetch', async () => Response.json(info));
  await assert.rejects(studio.saveDemoPolicy(policy), { statusCode: 409 });
  await assert.rejects(studio.saveDemoPolicy(null), { statusCode: 409 });
  assert.equal(writes, 0);
  info = { demoPolicyVersion: 1, demoEnvironmentPolicy: { version: 1, hosts: [] } };
  await studio.saveDemoPolicy(policy);
  assert.equal(writes, 1);
  const brokenDb = {
    query: async () => {
      throw new Error('db unavailable');
    }
  };
  await assert.rejects(createDemoPolicySettings(brokenDb).save(policy), /db unavailable/);
});

test('dashboard session and same-origin JSON protect domain read/write; Bearer is not a dashboard session', async t => {
  const app = Fastify();
  t.after(() => app.close());
  const rows = new Map();
  const sessions = createDashboardSessions({
    q: async (sql, args) => {
      if (sql.startsWith('INSERT')) rows.set(args[0], { subject: args[1], credential_revision: args[2] });
      return { rows: sql.startsWith('SELECT') ? [rows.get(args[0])].filter(Boolean) : [] };
    },
    baseUrl: () => 'https://siteops.example.com',
    username: () => 'admin',
    password: () => 'test-password',
    masterKey: () => Buffer.alloc(32).toString('base64')
  });
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/login') && !(await sessions.guard(req, reply))) return reply;
  });
  app.get('/login', sessions.loginPage);
  app.post('/login', sessions.loginSubmit);
  let saves = 0;
  registerVideoStudioRoutes(
    app,
    {
      getDemoPolicy: async () => ({ policy }),
      saveDemoPolicy: async () => {
        saves++;
        return { policy };
      }
    },
    () => '',
    () => '',
    () => 'https://siteops.example.com'
  );
  const url = '/api/video-studio/demo-policy';
  for (const method of ['GET', 'POST']) {
    const r = await app.inject({ method, url, headers: { authorization: 'Bearer arbitrary' } });
    assert.equal(r.statusCode, 401);
  }
  const login = await app.inject('/login');
  const nonce = login.headers['set-cookie'].split(';')[0];
  const csrf = login.body.match(/name="csrf" value="([^"]+)"/)[1];
  const loggedIn = await app.inject({
    method: 'POST',
    url: '/login',
    headers: { cookie: nonce },
    payload: { csrf, username: 'admin', password: 'test-password' }
  });
  const cookie = loggedIn.headers['set-cookie'][0].split(';')[0];
  assert.equal((await app.inject({ url, headers: { cookie } })).statusCode, 200);
  for (const extra of [
    {},
    { origin: 'https://evil.test' },
    { origin: 'null' },
    { origin: 'https://siteops.example.com', 'sec-fetch-site': 'cross-site' }
  ]) {
    assert.equal(
      (await app.inject({ method: 'POST', url, headers: { cookie, ...extra }, payload: { policy } })).statusCode,
      403
    );
  }
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: {
          cookie,
          origin: 'https://siteops.example.com',
          'content-type': 'text/plain'
        },
        payload: '{}'
      })
    ).statusCode,
    415
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: {
          cookie,
          origin: 'https://siteops.example.com'
        },
        payload: { policy }
      })
    ).statusCode,
    200
  );
  assert.equal(saves, 1);
});
