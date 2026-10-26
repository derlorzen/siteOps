import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoLogins } from '../lib/video-demo-logins.mjs';
import { validateDemoLogin, authenticateDemo } from '../runner/video-login.mjs';
const profile = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Bagisto demo',
  login_url: 'https://demo.example.com/admin/login',
  landing_url: 'https://demo.example.com/admin/catalog/products',
  username: 'demo@example.com',
  password: 'secret-only-for-test',
  username_selector: 'input[name=email]',
  password_selector: 'input[name=password]',
  submit_selector: 'form button',
  ready_selector: '#ready',
  test_data_only: true
};
test('demo credentials stay encrypted and redacted; destination changes require re-entry', async () => {
  const settings = new Map();
  const store = createDemoLogins({
    db: {
      query: async (sql, p) => {
        if (sql.startsWith('SELECT')) return [[...(settings.has(p[0]) ? [{ setting_value: settings.get(p[0]) }] : [])]];
        settings.set(p[0], p[1]);
        return [[]];
      }
    },
    encrypt: x => 'enc:' + JSON.stringify(x),
    decrypt: x => JSON.parse(x.slice(4))
  });
  const { id: _id, ...newProfile } = profile;
  const saved = await store.save(newProfile);
  assert.match(settings.get('video_demo_logins'), /^enc:/);
  assert.doesNotMatch(JSON.stringify(await store.list()), /secret-only-for-test/);
  await store.save({ ...newProfile, id: saved.id, password: '' });
  assert.equal((await store.get(saved.id)).password, profile.password);
  await assert.rejects(
    store.save({ ...newProfile, id: saved.id, password: '', login_url: 'https://other.example.com/login' }),
    { statusCode: 422 }
  );
  await assert.rejects(store.save({ ...newProfile, test_data_only: false }), { statusCode: 422 });
});
test('login profiles bind authentication to one approved HTTPS origin and confirmed test data', () => {
  assert.equal(validateDemoLogin(profile, ['demo.example.com']).username, profile.username);
  for (const change of [
    { landing_url: 'https://other.example.com/products' },
    { test_data_only: false },
    { password: '' },
    { ready_selector: '' },
    { login_url: 'http://demo.example.com/login' }
  ])
    assert.throws(() => validateDemoLogin({ ...profile, ...change }, ['demo.example.com', 'other.example.com']));
});
test('login happens without recording and returns only an in-memory same-origin session', async () => {
  let current = profile.login_url,
    filled = [],
    options,
    closed = false;
  const loc = selector => ({
    first() {
      return this;
    },
    getAttribute: async () => (selector === profile.password_selector ? 'password' : null),
    evaluate: async () => profile.login_url,
    fill: async value => filled.push(value),
    click: async () => {
      current = profile.landing_url;
    },
    waitFor: async () => {},
    isVisible: async () => false
  });
  const page = {
    setDefaultTimeout() {},
    goto: async url => {
      current = url;
      return { ok: () => true };
    },
    url: () => current,
    locator: loc,
    waitForURL: async fn => {
      assert.equal(fn(new URL(current)), true);
    }
  };
  const state = {
    cookies: [
      { name: 'session', value: 'session-token', domain: '.example.com', path: '/' },
      { name: 'bad', value: 'other', domain: '.elsewhere.com' }
    ],
    origins: [
      { origin: 'https://demo.example.com', localStorage: [] },
      { origin: 'https://elsewhere.com', localStorage: [] }
    ]
  };
  const browser = {
    newContext: async value => {
      options = value;
      return {
        route: async () => {},
        routeWebSocket: async () => {},
        newPage: async () => page,
        storageState: async () => state,
        close: async () => {
          closed = true;
        }
      };
    }
  };
  const session = await authenticateDemo(browser, profile, ['demo.example.com'], async () => ({
    proxy: { server: 'http://proxy' },
    close: async () => {}
  }));
  assert.equal(options.recordVideo, undefined);
  assert.equal(options.storageState, undefined);
  assert.equal(closed, true);
  assert.deepEqual(filled, [profile.username, profile.password]);
  assert.equal(session.cookies.length, 1);
  assert.equal(session.cookies[0].domain, 'demo.example.com');
  assert.equal(session.origins.length, 1);
  assert.doesNotMatch(JSON.stringify(session), /secret-only-for-test/);
});
test('login errors expose neither password nor browser details', async () => {
  const browser = {
    newContext: async () => {
      throw Error(profile.password);
    }
  };
  await assert.rejects(
    authenticateDemo(browser, profile, ['demo.example.com'], async () => ({
      proxy: { server: 'http://proxy' },
      close: async () => {}
    })),
    error => !error.message.includes(profile.password) && error.message.includes('keine Aufnahme')
  );
});
