/*
 * Client for a self-hosted Umami instance (https://umami.is, MIT).
 * SiteOps only reads statistics and creates website entries; it never embeds
 * tracking into SiteOps itself. Credentials come from environment variables.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function umamiOrigin(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.pathname !== '/' && url.pathname !== ''))
    return null;
  return url.origin;
}

export function createUmamiClient({ url, username, password, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
  const origin = umamiOrigin(url);
  let token = null;
  const fail = (message, statusCode = 502) => {
    throw Object.assign(new Error(message), { statusCode });
  };
  const configured = () => Boolean(origin && username && password);

  async function login() {
    if (!configured()) fail('Umami ist nicht eingerichtet. UMAMI_URL, UMAMI_USERNAME und UMAMI_PASSWORD setzen.', 503);
    const response = await fetchImpl(origin + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(10000)
    });
    if (response.status === 401 || response.status === 403)
      fail('Umami-Anmeldung abgelehnt. Zugangsdaten prüfen.', 502);
    if (!response.ok) fail('Umami ist nicht erreichbar (HTTP ' + response.status + ').');
    const body = await response.json();
    if (!body?.token) fail('Umami hat kein Token geliefert.');
    token = body.token;
    return token;
  }

  async function request(path, { method = 'GET', body, retry = true } = {}) {
    if (!token) await login();
    const response = await fetchImpl(origin + path, {
      method,
      headers: {
        authorization: 'Bearer ' + token,
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000)
    });
    if (response.status === 401 && retry) {
      token = null;
      return request(path, { method, body, retry: false });
    }
    if (response.status === 404) fail('Umami-Objekt nicht gefunden.', 404);
    if (!response.ok) fail('Umami-Anfrage fehlgeschlagen (HTTP ' + response.status + ').');
    return response.json();
  }

  async function websites() {
    const rows = [];
    for (let page = 1; page <= 20; page++) {
      const body = await request('/api/websites?pageSize=100&page=' + page);
      const data = Array.isArray(body) ? body : body?.data || [];
      rows.push(...data);
      if (Array.isArray(body) || data.length < 100) break;
    }
    return rows.map(w => ({ id: w.id, name: w.name, domain: w.domain, createdAt: w.createdAt || null }));
  }

  function normalizeDomain(domain) {
    const value = String(domain || '')
      .trim()
      .toLowerCase()
      .replace(/^www\./, '');
    if (!DOMAIN.test(value)) fail('Ungültige Domain für Umami.', 400);
    return value;
  }

  async function findWebsite(domain) {
    const wanted = normalizeDomain(domain);
    const matches = (await websites()).filter(w => normalizeDomain(w.domain) === wanted);
    if (matches.length > 1) fail('Mehrere Umami-Websites für ' + wanted + '. In Umami bereinigen.', 409);
    return matches[0] || null;
  }

  async function ensureWebsite({ domain, name }) {
    const wanted = normalizeDomain(domain);
    const existing = await findWebsite(wanted);
    if (existing) return { ...existing, created: false };
    const created = await request('/api/websites', {
      method: 'POST',
      body: { name: String(name || wanted).slice(0, 100), domain: wanted }
    });
    if (!UUID.test(created?.id || '')) fail('Umami hat keine Website-ID geliefert.');
    return {
      id: created.id,
      name: created.name,
      domain: created.domain,
      createdAt: created.createdAt || null,
      created: true
    };
  }

  async function stats(websiteId, { days = 30 } = {}) {
    if (!UUID.test(websiteId || '')) fail('Ungültige Umami-Website-ID.', 400);
    const span = Math.min(Math.max(Math.trunc(days) || 30, 1), 366);
    const endAt = now(),
      startAt = endAt - span * 86400000;
    const range = 'startAt=' + startAt + '&endAt=' + endAt;
    const [summary, pages, referrers] = await Promise.all([
      request('/api/websites/' + websiteId + '/stats?' + range),
      request('/api/websites/' + websiteId + '/metrics?type=path&limit=10&' + range),
      request('/api/websites/' + websiteId + '/metrics?type=referrer&limit=10&' + range)
    ]);
    const value = v => (v && typeof v === 'object' ? Number(v.value ?? 0) : Number(v ?? 0));
    const metric = rows => (Array.isArray(rows) ? rows : []).map(r => ({ value: r.x, count: Number(r.y) || 0 }));
    return {
      websiteId,
      days: span,
      from: new Date(startAt).toISOString(),
      to: new Date(endAt).toISOString(),
      pageviews: value(summary?.pageviews),
      visitors: value(summary?.visitors),
      visits: value(summary?.visits),
      bounces: value(summary?.bounces),
      totalTimeSeconds: value(summary?.totaltime),
      topPages: metric(pages),
      topReferrers: metric(referrers)
    };
  }

  async function status() {
    if (!configured())
      return { configured: false, url: origin, reason: 'UMAMI_URL, UMAMI_USERNAME und UMAMI_PASSWORD setzen.' };
    const heartbeat = await fetchImpl(origin + '/api/heartbeat', { signal: AbortSignal.timeout(10000) });
    const list = await websites();
    return { configured: true, url: origin, reachable: heartbeat.ok, websites: list.length };
  }

  return { origin, configured, status, websites, findWebsite, ensureWebsite, stats };
}
