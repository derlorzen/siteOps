import crypto from 'node:crypto';

const SESSION_SECONDS = 12 * 60 * 60;
const LOGIN_NONCE_SECONDS = 15 * 60;
const COOKIE_SESSION = '__Host-siteops_session';
const COOKIE_LOGIN = '__Host-siteops_login';
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ESCAPES[char]);

export function safeReturnPath(input) {
  const raw = String(input ?? '/');
  // OAuth uses path + query, never an absolute/foreign URL.
  if (
    raw.length > 8000 ||
    !raw.startsWith('/') ||
    raw.startsWith('//') ||
    raw.includes('\\') ||
    Array.from(raw).some(char => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127;
    })
  )
    return '/';
  return raw;
}

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const constantEqual = (left, right) => {
  const a = Buffer.from(String(left ?? ''));
  const b = Buffer.from(String(right ?? ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const randomToken = () => crypto.randomBytes(32).toString('base64url');
const cookieRead = (header, name) => {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i >= 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
};
const publicOrigin = baseUrl => new URL(baseUrl()).origin;
const cookieNames = baseUrl => {
  const secure = new URL(baseUrl()).protocol === 'https:';
  return {
    secure,
    session: secure ? COOKIE_SESSION : 'siteops_session',
    login: secure ? COOKIE_LOGIN : 'siteops_login'
  };
};
const cookieHeader = (name, value, maxAge, secure) =>
  name + '=' + value + '; Path=/; Max-Age=' + maxAge + '; HttpOnly; SameSite=Lax' + (secure ? '; Secure' : '');
const shell = (title, content) =>
  '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<meta name="robots" content="noindex,nofollow"><title>' +
  escapeHtml(title) +
  ' · SiteOps</title>' +
  '<style>:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f3f5f8;color:#172c44;font-family:system-ui,-apple-system,Segoe UI,sans-serif}' +
  'main{width:100%;max-width:420px;padding:32px;border:1px solid #dfe5ed;background:white;border-radius:14px;box-shadow:0 15px 44px #172c440a}' +
  'h1{font-size:1.65rem;margin:6px 0 14px}.mark{font-size:.77rem;letter-spacing:.13em;color:#6d7c90;font-weight:750}p{line-height:1.5;color:#465d75}' +
  'label{display:block;margin:18px 0 5px;font-size:.89rem;font-weight:650}input{display:block;width:100%;padding:12px 14px;border:1px solid #a7b9cd;border-radius:9px;font:inherit}' +
  'button{display:block;margin-top:22px;width:100%;background:#2465e8;color:white;font:inherit;font-weight:700;padding:13px;border:0;border-radius:9px;cursor:pointer}' +
  '.error{padding:12px;background:#fff2f2;color:#a01d2d;border-radius:8px}.small{font-size:.82rem}a{color:#2465e8}</style></head><body>' +
  '<main><div style="display:grid;place-items:center;width:42px;height:42px;border-radius:12px;background:#172c44;color:#ffb574;font-weight:800;font-size:20px;margin-bottom:22px">S</div><div class="mark">SITEOPS · SICHERER ZUGANG</div>' +
  content +
  '</main></body></html>';

export function createDashboardSessions({ q, baseUrl, username, password, masterKey }) {
  const key = () => {
    const raw = Buffer.from(String(masterKey() || ''), 'base64');
    if (raw.length !== 32) throw new Error('SITEOPS_MASTER_KEY must contain a base64-encoded 32-byte key');
    return raw;
  };
  const sign = value => crypto.createHmac('sha256', key()).update(value).digest('base64url');
  const credentialsRevision = () => sign('dashboard-login-credentials\n' + username() + '\n' + password());
  const loginSignature = (nonce, next) => sign('siteops-login\n' + nonce + '\n' + next);
  const csrfForToken = token => sign('siteops-session-csrf\n' + token);

  async function session(req) {
    const names = cookieNames(baseUrl);
    const token = cookieRead(req.headers.cookie, names.session);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const rows = (
      await q(
        'SELECT subject, credential_revision FROM dashboard_sessions WHERE token_hash=? AND expires_at>NOW() LIMIT 1',
        [hash(token)]
      )
    ).rows;
    const data = rows[0];
    if (!data || data.subject !== username() || !constantEqual(data.credential_revision, credentialsRevision()))
      return null;
    return { subject: data.subject, csrf: csrfForToken(token), tokenHash: hash(token) };
  }

  async function loginPage(req, reply, { error = '' } = {}) {
    const next = safeReturnPath(req.query?.next || '/');
    if (await session(req)) return reply.redirect(next);
    const nonce = randomToken();
    const { login, secure } = cookieNames(baseUrl);
    const csrf = loginSignature(nonce, next);
    reply.header('Set-Cookie', cookieHeader(login, nonce, LOGIN_NONCE_SECONDS, secure));
    const message = error ? '<p class="error" role="alert">' + escapeHtml(error) + '</p>' : '';
    return reply
      .type('text/html')
      .send(
        shell(
          'Anmelden',
          '<h1>Bei SiteOps anmelden</h1><p>Verwende deine bisherigen SiteOps-Zugangsdaten. Die Sitzung gilt auch für die Freigabe von MCP-Verbindungen.</p>' +
            message +
            '<form method="post" action="/login" autocomplete="on">' +
            '<input type="hidden" name="next" value="' +
            escapeHtml(next) +
            '">' +
            '<input type="hidden" name="csrf" value="' +
            escapeHtml(csrf) +
            '">' +
            '<label for="username">Benutzername</label><input id="username" name="username" autocomplete="username" required autofocus>' +
            '<label for="password">Passwort</label><input id="password" name="password" type="password" autocomplete="current-password" required>' +
            '<button type="submit">Sicher anmelden</button></form><p class="small">Deine Zugangsdaten werden nicht an ChatGPT weitergegeben.</p>'
        )
      );
  }

  async function loginSubmit(req, reply) {
    const body = req.body || {};
    const next = safeReturnPath(body.next || '/');
    const { login, session: sessionName, secure } = cookieNames(baseUrl);
    const nonce = cookieRead(req.headers.cookie, login);
    const validCsrf = /^[A-Za-z0-9_-]{43}$/.test(nonce) && constantEqual(body.csrf, loginSignature(nonce, next));
    if (!validCsrf)
      return reply
        .code(403)
        .type('text/html')
        .send(
          shell(
            'Anmeldung abgelaufen',
            '<h1>Anmeldung abgelaufen</h1><p>Bitte öffne die Login-Seite erneut.</p>' +
              '<p><a href="/login?next=' +
              encodeURIComponent(next) +
              '">Zur Anmeldung</a></p>'
          )
        );
    const userOK = constantEqual(body.username, username());
    const passwordOK = constantEqual(body.password, password());
    if (!userOK || !passwordOK) {
      // Different responses for unknown usernames enable enumeration; always use the same message.
      return loginPage({ ...req, query: { next }, headers: { ...req.headers, cookie: '' } }, reply, {
        error: 'Benutzername oder Passwort ist nicht korrekt.'
      });
    }
    const token = randomToken();
    await q(
      'INSERT INTO dashboard_sessions(token_hash,subject,credential_revision,expires_at) VALUES(?,?,?,DATE_ADD(NOW(),INTERVAL ? SECOND))',
      [hash(token), username(), credentialsRevision(), SESSION_SECONDS]
    );
    await q('DELETE FROM dashboard_sessions WHERE expires_at<NOW()');
    reply.header('Set-Cookie', [
      cookieHeader(sessionName, token, SESSION_SECONDS, secure),
      cookieHeader(login, '', 0, secure)
    ]);
    return reply.code(303).redirect(next);
  }

  async function logoutPage(req, reply) {
    const current = req.siteopsSession || (await session(req));
    if (!current) return reply.redirect('/login');
    return reply
      .type('text/html')
      .send(
        shell(
          'Abmelden',
          '<h1>SiteOps abmelden</h1>' +
            '<p>Die aktuelle Sitzung wird auf diesem Gerät beendet. Bestehende MCP-OAuth-Token bleiben unabhängig davon gültig.</p>' +
            '<form method="post" action="/logout"><input type="hidden" name="csrf" value="' +
            escapeHtml(current.csrf) +
            '">' +
            '<button type="submit">Jetzt abmelden</button></form><p><a href="/">Zurück zum Dashboard</a></p>'
        )
      );
  }

  async function logoutSubmit(req, reply) {
    const current = req.siteopsSession || (await session(req));
    if (!current || !constantEqual(req.body?.csrf, current.csrf))
      return reply.code(403).send({ error: 'Ungültige Abmeldeanfrage.' });
    await q('DELETE FROM dashboard_sessions WHERE token_hash=?', [current.tokenHash]);
    const { session: sessionName, secure } = cookieNames(baseUrl);
    reply.header('Set-Cookie', cookieHeader(sessionName, '', 0, secure));
    return reply.code(303).redirect('/login');
  }

  async function guard(req, reply) {
    const current = await session(req);
    const pathname = req.url.split('?')[0];
    if (!current) {
      if (pathname.startsWith('/api/')) {
        reply.code(401).send({ error: 'authentication_required', login: '/login' });
        return false;
      }
      const next = safeReturnPath(req.url);
      reply.code(303).redirect('/login?next=' + encodeURIComponent(next));
      return false;
    }
    req.siteopsSession = current;
    req.siteopsAuth = { type: 'dashboard_session', subject: current.subject };
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = publicOrigin(baseUrl);
      const requestOrigin = String(req.headers.origin || '');
      const referrer = String(req.headers.referer || '');
      // Browser POSTs provide Origin; fallback for clients that omit Origin is same-origin
      // Referer, or a per-session CSRF header. Never accept cross-origin writes with cookies.
      const fetchSite = String(req.headers['sec-fetch-site'] || '');
      if (
        (fetchSite && !['same-origin', 'none'].includes(fetchSite)) ||
        (requestOrigin
          ? requestOrigin !== origin
          : !(referrer.startsWith(origin + '/') || constantEqual(req.headers['x-siteops-csrf'], current.csrf)))
      ) {
        reply.code(403).send({ error: 'csrf_validation_failed' });
        return false;
      }
    }
    return true;
  }

  return { guard, session, loginPage, loginSubmit, logoutPage, logoutSubmit };
}
