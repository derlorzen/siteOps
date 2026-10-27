import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardSessions, safeReturnPath } from '../lib/dashboard-session.mjs';

const master = Buffer.alloc(32, 7).toString('base64');
function fakeReply() {
  return {
    status: 200,
    headers: {},
    result: null,
    redirectTo: null,
    code(n) {
      this.status = n;
      return this;
    },
    type(v) {
      this.headers['content-type'] = v;
      return this;
    },
    header(n, v) {
      this.headers[n.toLowerCase()] = v;
      return this;
    },
    send(v) {
      this.result = v;
      return this;
    },
    redirect(v) {
      this.redirectTo = v;
      return this;
    }
  };
}
function fakeStore() {
  const sessions = new Map();
  const calls = [];
  async function q(sql, params = []) {
    calls.push({ sql, params });
    if (sql.startsWith('INSERT INTO dashboard_sessions')) {
      sessions.set(params[0], { subject: params[1], credential_revision: params[2] });
      return { rows: [], meta: { affectedRows: 1 } };
    }
    if (sql.startsWith('SELECT subject, credential_revision')) {
      const item = sessions.get(params[0]);
      return { rows: item ? [item] : [] };
    }
    if (sql.startsWith('DELETE FROM dashboard_sessions WHERE token_hash=')) {
      sessions.delete(params[0]);
      return { rows: [], meta: { affectedRows: 1 } };
    }
    return { rows: [], meta: { affectedRows: 1 } };
  }
  return { q, sessions, calls };
}
const setup = () => {
  const store = fakeStore();
  const credentials = { username: 'siteops-admin', password: 'correct-long-password' };
  const service = createDashboardSessions({
    q: store.q,
    baseUrl: () => 'https://siteops.example.com',
    username: () => credentials.username,
    password: () => credentials.password,
    masterKey: () => master
  });
  return { store, credentials, service };
};
function parseLogin(reply) {
  const nonce = reply.headers['set-cookie'].split(';')[0];
  const csrf = reply.result.match(/name="csrf" value="([^"]+)"/)?.[1];
  assert.ok(csrf);
  return { nonce, csrf };
}
function sessionCookie(reply) {
  const header = reply.headers['set-cookie'];
  assert.ok(Array.isArray(header));
  assert.match(header[0], /__Host-siteops_session=/);
  assert.match(header[0], /HttpOnly; SameSite=Lax; Secure/);
  return header[0].split(';')[0];
}
async function login(service, next = '/oauth/authorize?state=test') {
  const loginReply = fakeReply();
  await service.loginPage({ headers: {}, query: { next } }, loginReply);
  const { nonce, csrf } = parseLogin(loginReply);
  const reply = fakeReply();
  await service.loginSubmit(
    {
      headers: { cookie: nonce },
      body: {
        next,
        csrf,
        username: 'siteops-admin',
        password: 'correct-long-password'
      }
    },
    reply
  );
  assert.equal(reply.status, 303);
  assert.equal(reply.redirectTo, next);
  return sessionCookie(reply);
}

test('safe return path rejects off-site, protocol-relative and control-character redirects', () => {
  for (const value of [
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/\ninvalid',
    'javascript:alert(1)'
  ])
    assert.equal(safeReturnPath(value), '/');
  assert.equal(safeReturnPath('/oauth/authorize?client_id=a&state=b'), '/oauth/authorize?client_id=a&state=b');
});

test('login sets scoped HttpOnly session and preserves OAuth authorization request', async () => {
  const { service, store } = setup();
  const next = '/oauth/authorize?client_id=test&code_challenge=abc&state=xyz';
  const cookie = await login(service, next);
  assert.equal(store.sessions.size, 1);
  assert.ok(!JSON.stringify([...store.sessions.keys()]).includes(cookie.split('=')[1]));
  const reply = fakeReply();
  const req = { headers: { cookie }, url: next, method: 'GET' };
  assert.equal(await service.guard(req, reply), true);
  assert.equal(req.siteopsAuth.subject, 'siteops-admin');
});

test('login rejects invalid credentials and CSRF without creating a session', async () => {
  const { service, store } = setup();
  const form = fakeReply();
  await service.loginPage({ headers: {}, query: { next: '/' } }, form);
  const { nonce, csrf } = parseLogin(form);
  const incorrect = fakeReply();
  await service.loginSubmit(
    {
      headers: { cookie: nonce },
      body: {
        next: '/',
        csrf,
        username: 'siteops-admin',
        password: 'incorrect'
      }
    },
    incorrect
  );
  assert.match(incorrect.result, /nicht korrekt/);
  assert.equal(store.sessions.size, 0);
  const invalidCsrf = fakeReply();
  await service.loginSubmit(
    {
      headers: { cookie: nonce },
      body: {
        next: '/',
        csrf: 'wrong',
        username: 'siteops-admin',
        password: 'correct-long-password'
      }
    },
    invalidCsrf
  );
  assert.equal(invalidCsrf.status, 403);
});

test('background favicon login redirect does not expire the visible login form', async () => {
  const { service, store } = setup();
  const next = '/oauth/authorize?client_id=test&state=original';
  const visibleForm = fakeReply();
  await service.loginPage({ headers: {}, query: { next } }, visibleForm);
  const original = parseLogin(visibleForm);

  // Browsers request the implicit favicon after receiving the login page. The
  // protected resource redirects to a second login page in the background.
  const faviconRedirect = fakeReply();
  assert.equal(
    await service.guard({ headers: { cookie: original.nonce }, url: '/favicon.ico', method: 'GET' }, faviconRedirect),
    false
  );
  assert.equal(faviconRedirect.redirectTo, '/login?next=%2Ffavicon.ico');
  const backgroundForm = fakeReply();
  await service.loginPage({ headers: { cookie: original.nonce }, query: { next: '/favicon.ico' } }, backgroundForm);
  const background = parseLogin(backgroundForm);

  const submitted = fakeReply();
  await service.loginSubmit(
    {
      headers: { cookie: background.nonce },
      body: { next, csrf: original.csrf, username: 'siteops-admin', password: 'correct-long-password' }
    },
    submitted
  );
  assert.equal(submitted.status, 303, 'background login must not cause Anmeldung abgelaufen');
  assert.equal(submitted.redirectTo, next);
  assert.equal(store.sessions.size, 1);
  assert.equal(background.nonce, original.nonce);
  assert.notEqual(background.csrf, original.csrf, 'CSRF stays bound to the form return path');
});

test('login page replaces malformed nonce cookies instead of trusting them', async () => {
  const { service } = setup();
  for (const value of ['', 'short', 'a'.repeat(42), 'a'.repeat(44), '!'.repeat(43)]) {
    const reply = fakeReply();
    await service.loginPage({ headers: { cookie: '__Host-siteops_login=' + value }, query: {} }, reply);
    const { nonce } = parseLogin(reply);
    const token = nonce.split('=')[1];
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(token, value);
  }
});

test('protected API returns JSON 401 without WWW-Authenticate and page redirects to login', async () => {
  const { service } = setup();
  const api = fakeReply();
  assert.equal(await service.guard({ headers: {}, url: '/api/settings', method: 'GET' }, api), false);
  assert.equal(api.status, 401);
  assert.equal(api.headers['www-authenticate'], undefined);
  const page = fakeReply();
  assert.equal(await service.guard({ headers: {}, url: '/oauth/authorize?state=a', method: 'GET' }, page), false);
  assert.equal(page.status, 303);
  assert.equal(page.redirectTo, '/login?next=%2Foauth%2Fauthorize%3Fstate%3Da');
});

test('session writes require same-origin request or session CSRF; logout revokes session', async () => {
  const { service } = setup();
  const cookie = await login(service);
  const bad = fakeReply();
  assert.equal(
    await service.guard(
      { headers: { cookie, origin: 'https://evil.example' }, url: '/api/settings', method: 'POST' },
      bad
    ),
    false
  );
  assert.equal(bad.status, 403);
  const good = fakeReply();
  const req = { headers: { cookie, origin: 'https://siteops.example.com' }, url: '/api/settings', method: 'POST' };
  assert.equal(await service.guard(req, good), true);
  const token = req.siteopsSession.csrf;
  const csrfReq = { headers: { cookie, 'x-siteops-csrf': token }, url: '/api/settings', method: 'POST' };
  assert.equal(await service.guard(csrfReq, fakeReply()), true);
  const logout = fakeReply();
  await service.logoutSubmit(
    { headers: { cookie }, body: { csrf: token }, siteopsSession: req.siteopsSession },
    logout
  );
  assert.equal(logout.status, 303);
  assert.equal(logout.redirectTo, '/login');
  assert.equal(await service.guard({ headers: { cookie }, url: '/', method: 'GET' }, fakeReply()), false);
});

test('password change invalidates existing dashboard session', async () => {
  const { service, credentials } = setup();
  const cookie = await login(service);
  credentials.password = 'rotated-password';
  const reply = fakeReply();
  assert.equal(await service.guard({ headers: { cookie }, url: '/', method: 'GET' }, reply), false);
  assert.equal(reply.status, 303);
});
