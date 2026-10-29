import crypto from 'node:crypto';
import * as z from 'zod/v4';
import * as cheerio from 'cheerio';
import { SaxesParser } from 'saxes';
import { createSearchConsoleClient, searchConsoleScopes, searchConsoleJson } from './search-console-client.mjs';
import { createSearchConsoleDns, googleTxt } from './search-console-dns.mjs';
import { publicHttp } from './coolify-public-http.mjs';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const random = () => crypto.randomBytes(32).toString('base64url');
const fail = (statusCode, message) => {
  throw Object.assign(new Error(message), { statusCode });
};
const json = value => (typeof value === 'string' ? JSON.parse(value) : value);
export const searchConsoleOAuthScopes = [
  ...searchConsoleScopes,
  'openid',
  'https://www.googleapis.com/auth/userinfo.email'
];
const scopes = searchConsoleOAuthScopes;
const parse = (schema, value) => {
  const r = schema.safeParse(value);
  if (!r.success) fail(422, 'Ungültige Search-Console-Eingaben.');
  return r.data;
};
const date = value => value.toISOString().slice(0, 10);
const shift = (day, days) => date(new Date(Date.parse(day + 'T12:00:00Z') + days * 86400000));
export const searchConsolePreviewSchema = z
  .object({
    site: z.string().min(1).max(200),
    action: z.enum(['live', 'property', 'dns', 'verify', 'sitemap']),
    allinkl_account_id: z.uuid().optional(),
    sitemap_url: z.url().max(2000).optional()
  })
  .strict();
export const searchConsoleApprovalSchema = z
  .object({
    preview_token: z.string().length(43),
    approved: z.literal(true),
    confirmation: z.string().min(1).max(500)
  })
  .strict();
export function siteOrigin(site) {
  const url = new URL('https://' + site.domain);
  if (
    url.hostname !== site.domain.toLowerCase() ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    fail(422, 'Projekt benötigt eine kanonische Domain ohne Pfad.');
  return url.origin;
}
export function propertyForSite(site, raw) {
  const host = new URL(siteOrigin(site)).hostname;
  if (raw.startsWith('sc-domain:')) {
    const domain = raw.slice(10);
    if (
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) ||
      !(host === domain || host.endsWith('.' + domain))
    )
      fail(422, 'Domain-Property gehört nicht zu diesem Projekt.');
    return raw;
  }
  if (raw !== siteOrigin(site) + '/') fail(422, 'URL-Property muss der kanonischen HTTPS-Projektdomain entsprechen.');
  return raw;
}
export function performanceSummary(rows = []) {
  const clicks = rows.reduce((n, r) => n + Number(r.clicks || 0), 0);
  const impressions = rows.reduce((n, r) => n + Number(r.impressions || 0), 0);
  return {
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : 0,
    position: impressions
      ? rows.reduce((n, r) => n + Number(r.position || 0) * Number(r.impressions || 0), 0) / impressions
      : 0
  };
}
export function searchOpportunities(queries, pages) {
  return [
    ...queries
      .filter(r => r.impressions >= 100 && r.position >= 4 && r.position <= 20 && r.ctr < 0.03)
      .map(r => ({
        kind: 'query',
        value: r.keys[0],
        impressions: r.impressions,
        suggestion: 'Title und Beschreibung für diese häufige Suchanfrage prüfen.'
      })),
    ...pages
      .filter(r => r.impressions >= 100 && r.position > 10 && r.position <= 30)
      .map(r => ({
        kind: 'page',
        value: r.keys[0],
        impressions: r.impressions,
        suggestion: 'Inhalt und interne Verlinkung für diese sichtbare Seite verbessern.'
      }))
  ]
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 20);
}

export function createSearchConsoleService({
  db,
  encrypt,
  decrypt,
  getSite,
  owner,
  publicBaseUrl,
  allInklService,
  fetcher = (...args) => fetch(...args),
  http = publicHttp,
  now = () => Date.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  dns: injectedDns
}) {
  const sql = async (query, args = []) => (await db.query(query, args))[0];
  const refreshes = new Map();
  const setting = async key => {
    const row = (await sql('SELECT setting_value FROM app_settings WHERE setting_key=? LIMIT 1', [key]))[0];
    return row ? decrypt(row.setting_value) : null;
  };
  const saveSetting = (key, value) =>
    sql(
      'INSERT INTO app_settings(setting_key,setting_value,encrypted) VALUES(?,?,1) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),encrypted=1,updated_at=NOW()',
      [key, encrypt(value)]
    );
  const dns =
    injectedDns ||
    createSearchConsoleDns({
      allInklService,
      hostingerToken: async () => (await setting('search_console_hostinger'))?.token,
      fetcher
    });
  const redirectUri = () => {
    const u = new URL(publicBaseUrl());
    if (u.protocol !== 'https:') fail(503, 'Google-Anmeldung benötigt eine öffentliche HTTPS-Adresse.');
    return u.origin + '/api/search-console/oauth/callback';
  };
  const configuration = async () => {
    const cfg = (await setting('search_console_oauth')) || (await setting('youtube_oauth_client'));
    if (!cfg?.client_id || !cfg?.client_secret) fail(503, 'Google-OAuth-Client zuerst konfigurieren.');
    return cfg;
  };
  async function google(url, options = {}) {
    let response;
    try {
      response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) });
    } catch {
      fail(503, 'Google ist nicht erreichbar.');
    }
    if (!response.ok)
      fail(
        response.status === 400 || response.status === 401 ? 401 : 502,
        'Google-Anmeldung fehlgeschlagen. Verbindung erneuern.'
      );
    return searchConsoleJson(response);
  }
  const accounts = () =>
    sql('SELECT id,email,created_at FROM search_console_accounts WHERE subject=? ORDER BY email', [owner()]);
  async function account(id) {
    parse(z.uuid(), id);
    const row = (await sql('SELECT * FROM search_console_accounts WHERE id=? AND subject=?', [id, owner()]))[0];
    if (!row) fail(403, 'Google-Konto ist für diesen SiteOps-Benutzer nicht verbunden.');
    return row;
  }
  async function status(siteId) {
    const ownCfg = await setting('search_console_oauth');
    const youtubeCfg = await setting('youtube_oauth_client');
    const cfg = ownCfg || youtubeCfg;
    let linkage = null;
    if (siteId) {
      const site = await getSite(siteId);
      linkage = (await sql('SELECT * FROM search_console_sites WHERE site_id=?', [site.id]))[0] || null;
      if (linkage) {
        await account(linkage.account_id);
        if (linkage.domain !== site.domain)
          linkage = { invalidated: true, reason: 'Projektdomain wurde geändert. Neu verknüpfen.' };
        else {
          const { sync_lease_token: _lease, sync_lease_until: _until, ...safe } = linkage;
          linkage = safe;
        }
      }
    }
    return {
      configured: Boolean(cfg?.client_id && cfg?.client_secret),
      client_id: cfg?.client_id || '',
      oauth_source: ownCfg ? 'search_console' : youtubeCfg ? 'youtube' : null,
      redirect_uri: redirectUri(),
      accounts: await accounts(),
      hostinger_configured: Boolean((await setting('search_console_hostinger'))?.token),
      linkage,
      limitations: [
        'Google liefert Top-Zeilen, keine vollständigen Suchanfragen.',
        'URL-Prüfung ist eine Einzelprüfung; die API bietet keinen vollständigen Indexabdeckungsbericht.',
        'Sitemap-Einreichung garantiert keine Indexierung.'
      ]
    };
  }
  async function configure(input) {
    const x = parse(
      z
        .object({
          client_id: z.string().trim().min(10).max(300),
          client_secret: z.string().max(500).optional(),
          hostinger_token: z.string().max(4000).optional()
        })
        .strict(),
      input
    );
    const old = await setting('search_console_oauth');
    // Prevent another administrator's credentials from being silently rebound.
    if (old?.client_id !== x.client_id && (await sql('SELECT id FROM search_console_accounts LIMIT 1')).length)
      fail(409, 'Vor einem OAuth-Client-Wechsel alle Google-Verbindungen trennen.');
    const cfg = { client_id: x.client_id, client_secret: x.client_secret || old?.client_secret };
    if (!cfg.client_secret) fail(422, 'Google-Client-Secret fehlt.');
    await saveSetting('search_console_oauth', cfg);
    if (x.hostinger_token) await saveSetting('search_console_hostinger', { token: x.hostinger_token });
    return status();
  }
  async function beginOAuth(session) {
    if (!session?.tokenHash || session.subject !== owner()) fail(401, 'SiteOps-Sitzung erforderlich.');
    const cfg = await configuration(),
      state = random(),
      verifier = random(),
      expires = now() + 600000;
    await sql('DELETE FROM search_console_states WHERE expires_at<NOW()');
    await sql('INSERT INTO search_console_states(state_hash,encrypted_payload,expires_at) VALUES(?,?,?)', [
      hash(state),
      encrypt({ verifier, session: session.tokenHash, subject: session.subject, client_id: cfg.client_id, expires }),
      new Date(expires)
    ]);
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    for (const [k, v] of Object.entries({
      client_id: cfg.client_id,
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: scopes.join(' '),
      state,
      code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent'
    }))
      u.searchParams.set(k, v);
    return { url: u.href };
  }
  async function completeOAuth(input, session) {
    const x = parse(
      z
        .object({
          state: z.string().min(20).max(200),
          code: z.string().max(4000).optional(),
          error: z.string().max(200).optional()
        })
        .passthrough(),
      input
    );
    const row = (await sql('SELECT * FROM search_console_states WHERE state_hash=?', [hash(x.state)]))[0];
    if (!row) fail(403, 'OAuth-State ungültig oder bereits verwendet.');
    const pending = decrypt(row.encrypted_payload);
    if (
      !session?.tokenHash ||
      pending.session !== session.tokenHash ||
      pending.subject !== session.subject ||
      session.subject !== owner() ||
      pending.expires <= now()
    )
      fail(403, 'OAuth-State gehört nicht zur aktuellen Sitzung oder ist abgelaufen.');
    if ((await sql('DELETE FROM search_console_states WHERE state_hash=?', [hash(x.state)])).affectedRows !== 1)
      fail(403, 'OAuth-State wurde bereits verwendet.');
    if (x.error || !x.code) fail(422, 'Google-Anmeldung abgebrochen.');
    const cfg = await configuration();
    if (cfg.client_id !== pending.client_id) fail(409, 'OAuth-Konfiguration wurde geändert.');
    const token = await google('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.client_id,
        client_secret: cfg.client_secret,
        code: x.code,
        code_verifier: pending.verifier,
        redirect_uri: redirectUri(),
        grant_type: 'authorization_code'
      })
    });
    if (
      !token.access_token ||
      !token.refresh_token ||
      !scopes.every(s =>
        String(token.scope || '')
          .split(' ')
          .includes(s)
      )
    )
      fail(403, 'Google hat nicht alle Berechtigungen und dauerhaften Zugriff erteilt. Erneut verbinden.');
    const user = await google('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: 'Bearer ' + token.access_token }
    });
    if (!user.sub || !user.email || !user.email_verified) fail(403, 'Google-Konto konnte nicht bestätigt werden.');
    await sql(
      'INSERT INTO search_console_accounts(id,subject,google_id,email,encrypted_credentials) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE email=VALUES(email),encrypted_credentials=VALUES(encrypted_credentials)',
      [
        crypto.randomUUID(),
        owner(),
        String(user.sub).slice(0, 200),
        String(user.email).slice(0, 254),
        encrypt({
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          expires_at: now() + Math.min(Number(token.expires_in || 3600), 3600) * 1000
        })
      ]
    );
    return accounts();
  }
  async function accessToken(id, force = false) {
    const row = await account(id),
      credentials = decrypt(row.encrypted_credentials);
    if (!force && credentials.expires_at > now() + 90000) return credentials.access_token;
    if (!refreshes.has(id))
      refreshes.set(
        id,
        (async () => {
          const cfg = await configuration();
          const token = await google('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: cfg.client_id,
              client_secret: cfg.client_secret,
              grant_type: 'refresh_token',
              refresh_token: credentials.refresh_token
            })
          });
          if (!token.access_token) fail(401, 'Google-Verbindung erneuern.');
          await sql('UPDATE search_console_accounts SET encrypted_credentials=? WHERE id=? AND subject=?', [
            encrypt({
              ...credentials,
              access_token: token.access_token,
              refresh_token: token.refresh_token || credentials.refresh_token,
              expires_at: now() + Math.min(Number(token.expires_in || 3600), 3600) * 1000
            }),
            id,
            owner()
          ]);
          return token.access_token;
        })().finally(() => refreshes.delete(id))
      );
    return refreshes.get(id);
  }
  async function call(id, method, ...args) {
    const read = [
      'listProperties',
      'getProperty',
      'searchAnalytics',
      'listSitemaps',
      'inspectUrl',
      'getDnsToken'
    ].includes(method);
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      try {
        return await createSearchConsoleClient({ accessToken: await accessToken(id), fetcher })[method](...args);
      } catch (error) {
        if (error.statusCode === 401 && !refreshed) {
          await accessToken(id, true);
          refreshed = true;
          continue;
        }
        if (read && [429, 502, 503].includes(error.statusCode) && attempt < 3) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw error;
      }
    }
  }
  async function properties(id, siteId) {
    const site = await getSite(siteId);
    const result = await call(id, 'listProperties');
    return (result.siteEntry || []).filter(p => {
      try {
        propertyForSite(site, p.siteUrl);
        return true;
      } catch {
        return false;
      }
    });
  }
  async function link(input) {
    const x = parse(
      z
        .object({ site: z.string().min(1).max(200), account_id: z.uuid(), property: z.string().min(1).max(500) })
        .strict(),
      input
    );
    const site = await getSite(x.site),
      property = propertyForSite(site, x.property);
    await account(x.account_id);
    // sites.get can return 403 for an unregistered site. An authorized list
    // distinguishes a new local draft from a missing Google API permission.
    const remote = (await call(x.account_id, 'listProperties')).siteEntry?.find(p => p.siteUrl === property);
    const permission = remote?.permissionLevel || null;
    await sql(
      "INSERT INTO search_console_sites(site_id,account_id,property,domain,revision,verified_at,permission_level) VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE account_id=VALUES(account_id),property=VALUES(property),domain=VALUES(domain),revision=VALUES(revision),live_approved_at=NULL,verified_at=VALUES(verified_at),permission_level=VALUES(permission_level),sitemap_url=NULL,sitemap_status='not_submitted',last_sync_at=NULL,last_complete_date=NULL,next_sync_at=NOW(),sync_error=NULL,sync_lease_until=NULL,sync_lease_token=NULL",
      [
        site.id,
        x.account_id,
        property,
        site.domain,
        crypto.randomUUID(),
        permission === 'siteOwner' ? new Date(now()) : null,
        permission
      ]
    );
    await sql('DELETE FROM search_console_reports WHERE site_id=?', [site.id]);
    return status(site.id);
  }
  async function context(siteId, live = false) {
    const site = await getSite(siteId);
    const link = (await sql('SELECT * FROM search_console_sites WHERE site_id=?', [site.id]))[0];
    if (!link) fail(409, 'Projekt zuerst mit einem Google-Konto und einer Property verknüpfen.');
    await account(link.account_id);
    propertyForSite(site, link.property);
    if (link.domain !== site.domain) fail(409, 'Projektdomain geändert. Verknüpfung und Livegang erneut freigeben.');
    if (live && (!link.live_approved_at || !site.enabled))
      fail(403, 'Für dieses aktive Projekt ist eine ausdrückliche Livegang-Freigabe erforderlich.');
    return { site, link };
  }
  async function sitemapCheck(site, property, raw) {
    const u = new URL(raw);
    if (u.origin !== siteOrigin(site) || u.username || u.password || u.hash || u.search)
      fail(422, 'Sitemap muss eine kanonische HTTPS-URL dieses Projekts sein.');
    const response = await http(u.href, { maxBytes: 3_000_000, redirects: 0 });
    if (
      response.status !== 200 ||
      response.url !== u.href ||
      !/\bxml\b/i.test(response.headers['content-type'] || '') ||
      /<!DOCTYPE|<!ENTITY/i.test(response.body)
    )
      fail(422, 'Sitemap ist nicht als kanonisches XML erreichbar.');
    try {
      new SaxesParser({ xmlns: true }).write(response.body).close();
    } catch {
      fail(422, 'Sitemap ist kein wohlgeformtes XML.');
    }
    const $ = cheerio.load(response.body, { xml: true }),
      root = $.root().children().first();
    if (
      !['urlset', 'sitemapindex'].includes(root[0]?.name) ||
      root.attr('xmlns') !== 'http://www.sitemaps.org/schemas/sitemap/0.9'
    )
      fail(422, 'Ungültiges Sitemap-XML.');
    const locations = $('loc')
      .toArray()
      .map(el => $(el).text().trim());
    if (
      !locations.length ||
      locations.some(loc => {
        try {
          const v = new URL(loc),
            host = property.startsWith('sc-domain:') ? property.slice(10) : new URL(property).hostname;
          return (
            v.protocol !== 'https:' ||
            v.username ||
            v.password ||
            v.port ||
            !(v.hostname === host || (property.startsWith('sc-domain:') && v.hostname.endsWith('.' + host)))
          );
        } catch {
          return true;
        }
      })
    )
      fail(422, 'Sitemap enthält keine gültigen URLs innerhalb der Property.');
    return { url: u.href, sha256: hash(response.body), entries: locations.length };
  }
  async function preview(input) {
    const x = parse(searchConsolePreviewSchema, input),
      { site, link } = await context(x.site, x.action !== 'live');
    const payload = {
      action: x.action,
      site_id: site.id,
      slug: site.slug,
      domain: site.domain,
      property: link.property,
      account_email: (await account(link.account_id)).email,
      account_id: link.account_id,
      revision: link.revision,
      subject: owner(),
      expires: now() + 600000,
      confirmation: site.slug + ' ' + site.domain
    };
    if (['dns', 'verify'].includes(x.action)) {
      if (!link.property.startsWith('sc-domain:'))
        fail(
          422,
          'DNS-Verifizierung benötigt eine Domain-Property. Bestehende URL-Properties können wiederverwendet werden.'
        );
      const result = await call(link.account_id, 'getDnsToken', link.property);
      if (!googleTxt(result.token)) fail(502, 'Google hat keinen gültigen TXT-Token geliefert.');
      payload.record = await dns.inspect(link.property.slice(10), result.token, x.allinkl_account_id);
    }
    if (x.action === 'sitemap')
      payload.sitemap = await sitemapCheck(site, link.property, x.sitemap_url || siteOrigin(site) + '/sitemap.xml');
    await sql('DELETE FROM search_console_previews WHERE expires_at<DATE_SUB(NOW(),INTERVAL 30 DAY)');
    const token = random();
    await sql('INSERT INTO search_console_previews(token_hash,site_id,encrypted_payload,expires_at) VALUES(?,?,?,?)', [
      hash(token),
      site.id,
      encrypt(payload),
      new Date(payload.expires)
    ]);
    return {
      preview_token: token,
      ...payload,
      expires_at: new Date(payload.expires).toISOString(),
      warning:
        x.action === 'live'
          ? 'Gibt nur dieses Projekt für einzeln freizugebende Google-/DNS-Schritte frei.'
          : 'Nur diese konkrete Aktion wird ausgeführt. DNS-Eintrag, Google-Verifizierung, Property und Sitemap haben getrennte Zustände.'
    };
  }
  async function previewStatus(token) {
    parse(z.string().length(43), token);
    const row = (await sql('SELECT * FROM search_console_previews WHERE token_hash=?', [hash(token)]))[0];
    if (!row) fail(404, 'Vorschau nicht gefunden.');
    const p = decrypt(row.encrypted_payload);
    if (p.subject !== owner()) fail(403, 'Vorschau gehört einem anderen Benutzer.');
    return { row, payload: p };
  }
  async function changeStatus(token) {
    const { row } = await previewStatus(token);
    return { status: row.status, result: row.result ? json(row.result) : null, error: row.error || null };
  }
  async function execute(input) {
    const x = parse(searchConsoleApprovalSchema, input),
      { row, payload: p } = await previewStatus(x.preview_token);
    if (row.status !== 'pending')
      fail(409, 'Vorschau bereits verbraucht. Ergebnis prüfen; keine automatische Wiederholung.');
    if (p.expires <= now() || x.confirmation !== p.confirmation)
      fail(403, 'Vorschau abgelaufen oder Projektbestätigung stimmt nicht überein.');
    const { site, link } = await context(p.site_id, p.action !== 'live');
    if (
      link.revision !== p.revision ||
      site.slug !== p.slug ||
      site.domain !== p.domain ||
      link.account_id !== p.account_id ||
      link.property !== p.property
    )
      fail(409, 'Projekt oder Verknüpfung wurde geändert. Neue Vorschau erstellen.');
    if (
      (
        await sql(
          "UPDATE search_console_previews SET status='running' WHERE token_hash=? AND status='pending' AND expires_at>NOW()",
          [hash(x.preview_token)]
        )
      ).affectedRows !== 1
    )
      fail(409, 'Vorschau wird bereits ausgeführt oder ist abgelaufen.');
    let result;
    // Hold project and linkage locks across the external operation. Domain edits,
    // relinks and account deletion must not race an already-reviewed write.
    const connection = await db.getConnection();
    const write = async (query, args = []) => (await connection.query(query, args))[0];
    try {
      await connection.beginTransaction();
      const lockedSite = (await write('SELECT * FROM sites WHERE id=? FOR UPDATE', [site.id]))[0];
      const lockedLink = (await write('SELECT * FROM search_console_sites WHERE site_id=? FOR UPDATE', [site.id]))[0];
      if (
        p.expires <= now() ||
        !lockedSite ||
        !lockedLink ||
        lockedSite.domain !== p.domain ||
        lockedSite.slug !== p.slug ||
        !lockedSite.enabled ||
        lockedLink.revision !== p.revision ||
        lockedLink.property !== p.property ||
        lockedLink.account_id !== p.account_id ||
        (p.action !== 'live' && !lockedLink.live_approved_at)
      )
        fail(409, 'Projekt oder Livegang-Freigabe wurde inzwischen geändert.');
      if (p.action === 'live') {
        if (!site.enabled) fail(403, 'Projekt ist deaktiviert.');
        await write('UPDATE search_console_sites SET live_approved_at=? WHERE site_id=? AND revision=?', [
          new Date(now()),
          site.id,
          p.revision
        ]);
        result = { live_approved: true, site: site.slug };
      } else if (p.action === 'dns') result = await dns.apply(p.record);
      else if (p.action === 'verify') {
        let visible = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          visible = await dns.present(link.property.slice(10), p.record.value);
          if (visible) break;
          if (attempt < 2) await sleep(2000);
        }
        if (!visible)
          fail(
            409,
            'TXT-Eintrag noch nicht auf allen autoritativen Nameservern sichtbar. Später neue Vorschau erstellen.'
          );
        const verified = await call(link.account_id, 'confirmDnsVerification', link.property);
        if (verified.site?.identifier !== link.property.slice(10) || verified.site?.type !== 'INET_DOMAIN')
          fail(502, 'Google hat die Domain-Verifizierung nicht bestätigt.');
        await write('UPDATE search_console_sites SET verified_at=? WHERE site_id=? AND revision=?', [
          new Date(now()),
          site.id,
          p.revision
        ]);
        result = { google_verified: true, property_registered: false };
      } else if (p.action === 'property') {
        if (!link.verified_at) fail(403, 'Google-Eigentumsverifizierung zuerst bestätigen.');
        await call(link.account_id, 'addProperty', link.property);
        const property = await call(link.account_id, 'getProperty', link.property);
        await write('UPDATE search_console_sites SET permission_level=? WHERE site_id=? AND revision=?', [
          property.permissionLevel,
          site.id,
          p.revision
        ]);
        result = { property_registered: true, permission_level: property.permissionLevel };
      } else if (p.action === 'sitemap') {
        const property = await call(link.account_id, 'getProperty', link.property);
        if (!['siteOwner', 'siteFullUser'].includes(property.permissionLevel))
          fail(403, 'Google-Schreibberechtigung für diese Property fehlt.');
        const current = await sitemapCheck(site, link.property, p.sitemap.url);
        if (current.sha256 !== p.sitemap.sha256) fail(409, 'Sitemap hat sich geändert. Neue Vorschau erforderlich.');
        await call(link.account_id, 'submitSitemap', link.property, p.sitemap.url);
        await write(
          "UPDATE search_console_sites SET sitemap_url=?,sitemap_status='submitted' WHERE site_id=? AND revision=?",
          [p.sitemap.url, site.id, p.revision]
        );
        result = { sitemap_submitted: true, indexing_guaranteed: false };
      }
      await write("UPDATE search_console_previews SET status='done',result=? WHERE token_hash=?", [
        JSON.stringify(result),
        hash(x.preview_token)
      ]);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      // A timeout may have happened after the provider applied a change. Never retry this token.
      await sql("UPDATE search_console_previews SET status='failed',error=? WHERE token_hash=?", [
        'Aktion nicht bestätigt (HTTP ' +
          (error.statusCode || 500) +
          '). Remote-Status prüfen und neue Vorschau erstellen.',
        hash(x.preview_token)
      ]);
      throw error;
    } finally {
      connection.release();
    }
  }
  async function analytics(link, range, dimensions) {
    const rows = [];
    const rowLimit = 5000;
    for (let startRow = 0; startRow < 50000; startRow += rowLimit) {
      const result = await call(link.account_id, 'searchAnalytics', link.property, {
        ...range,
        dimensions,
        rowLimit,
        startRow
      });
      if (
        !Array.isArray(result.rows || []) ||
        (result.rows || []).length > rowLimit ||
        (result.rows || []).some(
          r =>
            !Array.isArray(r.keys) ||
            r.keys.length !== dimensions.length ||
            r.keys.some(k => typeof k !== 'string') ||
            ['clicks', 'impressions', 'ctr', 'position'].some(k => !Number.isFinite(r[k]) || r[k] < 0)
        )
      )
        fail(502, 'Ungültige Google-Analysedaten.');
      rows.push(...(result.rows || []));
      if ((result.rows || []).length < rowLimit) return { rows, truncated: false };
    }
    return { rows, truncated: true };
  }
  async function sync(siteId) {
    const { site, link } = await context(siteId, true),
      lease = crypto.randomUUID();
    const locked = await sql(
      'UPDATE search_console_sites SET sync_lease_token=?,sync_lease_until=DATE_ADD(NOW(),INTERVAL 30 MINUTE) WHERE site_id=? AND revision=? AND (sync_lease_until IS NULL OR sync_lease_until<NOW())',
      [lease, site.id, link.revision]
    );
    if (locked.affectedRows !== 1) fail(409, 'Synchronisierung läuft bereits.');
    try {
      const remote = await call(link.account_id, 'getProperty', link.property);
      if (!['siteOwner', 'siteFullUser', 'siteRestrictedUser'].includes(remote.permissionLevel))
        fail(403, 'Keine Google-Leseberechtigung für diese Property.');
      const pt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date(now()));
      const endDate = shift(pt, -3),
        startDate = shift(endDate, -27),
        previousEnd = shift(startDate, -1),
        previousStart = shift(previousEnd, -27);
      const daily = await analytics(link, { startDate, endDate }, ['date']);
      const previous = await analytics(link, { startDate: previousStart, endDate: previousEnd }, ['date']);
      const queries = await analytics(link, { startDate, endDate }, ['query']);
      const pages = await analytics(link, { startDate, endDate }, ['page']);
      const lastDate =
        daily.rows
          .map(r => r.keys[0])
          .sort()
          .at(-1) || null;
      const sitemaps = await call(link.account_id, 'listSitemaps', link.property);
      const report = {
        source: 'Google Search Console',
        data_state: 'final',
        time_zone: 'America/Los_Angeles',
        range: { startDate, endDate },
        previous_range: { startDate: previousStart, endDate: previousEnd },
        totals: performanceSummary(daily.rows),
        previous_totals: performanceSummary(previous.rows),
        daily: daily.rows,
        queries: queries.rows,
        pages: pages.rows,
        last_complete_date: lastDate,
        truncated: daily.truncated || previous.truncated || queries.truncated || pages.truncated,
        opportunities: searchOpportunities(queries.rows, pages.rows),
        sitemaps: sitemaps.sitemap || [],
        limitations: [
          'Google liefert Top-Zeilen; anonymisierte Suchanfragen fehlen.',
          'Keine Daten bedeuten nicht, dass Seiten nicht indexiert sind.'
        ],
        synced_at: new Date(now()).toISOString()
      };
      // Serialize report publication with relinks using a single conditional SQL write.
      await sql(
        'INSERT INTO search_console_reports(site_id,revision,report) SELECT site_id,revision,? FROM search_console_sites WHERE site_id=? AND revision=? AND sync_lease_token=? ON DUPLICATE KEY UPDATE revision=VALUES(revision),report=VALUES(report)',
        [JSON.stringify(report), site.id, link.revision, lease]
      );
      const submitted = report.sitemaps.find(s => s.path === link.sitemap_url);
      await sql(
        'UPDATE search_console_sites SET last_sync_at=NOW(),last_complete_date=?,permission_level=?,sitemap_status=?,sync_error=NULL,next_sync_at=DATE_ADD(NOW(),INTERVAL 1 DAY),sync_lease_token=NULL,sync_lease_until=NULL WHERE site_id=? AND revision=? AND sync_lease_token=?',
        [
          lastDate,
          remote.permissionLevel,
          submitted
            ? submitted.isPending
              ? 'pending'
              : Number(submitted.errors)
                ? 'errors'
                : 'processed'
            : link.sitemap_status,
          site.id,
          link.revision,
          lease
        ]
      );
      return report;
    } catch (error) {
      await sql(
        'UPDATE search_console_sites SET sync_error=?,next_sync_at=DATE_ADD(NOW(),INTERVAL 1 HOUR),sync_lease_token=NULL,sync_lease_until=NULL WHERE site_id=? AND sync_lease_token=?',
        [
          'Google-Synchronisierung fehlgeschlagen (HTTP ' +
            (error.statusCode || 500) +
            '). Verbindung und Property prüfen.',
          site.id,
          lease
        ]
      );
      throw error;
    }
  }
  async function performance(siteId, { dimension = 'query', offset = 0, limit = 100 } = {}) {
    const x = parse(
      z.object({
        dimension: z.enum(['query', 'page', 'date']),
        offset: z.coerce.number().int().min(0).max(50000),
        limit: z.coerce.number().int().min(1).max(500)
      }),
      { dimension, offset, limit }
    );
    let ctx;
    try {
      ctx = await context(siteId);
    } catch (error) {
      if (error.statusCode === 409) return { available: false, reason: error.message };
      throw error;
    }
    const { site, link } = ctx;
    const row = (
      await sql('SELECT report FROM search_console_reports WHERE site_id=? AND revision=?', [site.id, link.revision])
    )[0];
    if (!row) return { available: false, reason: 'Noch keine abgeschlossene Synchronisierung.' };
    const report = json(row.report),
      key = { query: 'queries', page: 'pages', date: 'daily' }[x.dimension];
    const { queries: _queries, pages: _pages, daily: _daily, ...summary } = report;
    const rows = report[key];
    return {
      available: true,
      ...summary,
      dimension: x.dimension,
      rows: rows.slice(x.offset, x.offset + x.limit),
      total_rows: rows.length,
      next_offset: rows.length > x.offset + x.limit ? x.offset + x.limit : null
    };
  }
  async function inspect(siteId, url) {
    const { link } = await context(siteId, true),
      propertyHash = hash(link.property),
      today = date(new Date(now()));
    await sql('INSERT IGNORE INTO search_console_inspections(property_hash,quota_date,used) VALUES(?,?,0)', [
      propertyHash,
      today
    ]);
    const quota = await sql(
      'UPDATE search_console_inspections SET used=used+1 WHERE property_hash=? AND quota_date=? AND used<100',
      [propertyHash, today]
    );
    if (quota.affectedRows !== 1) fail(429, 'Lokales URL-Prüflimit von 100 Anfragen je Property und Tag erreicht.');
    return {
      ...(await call(link.account_id, 'inspectUrl', link.property, parse(z.url().max(2000), url))),
      limitation: 'Einzelne URL-Prüfung; kein vollständiger Indexabdeckungsbericht.'
    };
  }
  async function unlink(siteId) {
    const { site } = await context(siteId);
    await sql('DELETE FROM search_console_sites WHERE site_id=?', [site.id]);
    await sql('DELETE FROM search_console_reports WHERE site_id=?', [site.id]);
    return { unlinked: true, remote_changed: false };
  }
  async function disconnect(id) {
    await account(id);
    // Local deletion avoids revoking unrelated Google products sharing a grant.
    await sql('DELETE FROM search_console_accounts WHERE id=? AND subject=?', [id, owner()]);
    return { disconnected: true, remote_changed: false };
  }
  let ticking = false;
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const due = await sql(
        'SELECT g.site_id FROM search_console_sites g JOIN sites s ON s.id=g.site_id JOIN search_console_accounts a ON a.id=g.account_id WHERE g.live_approved_at IS NOT NULL AND g.next_sync_at<=NOW() AND s.enabled=1 AND a.subject=? ORDER BY g.next_sync_at LIMIT 20',
        [owner()]
      );
      for (const item of due) {
        try {
          await sync(item.site_id);
        } catch {
          /* Per-site error persisted by sync. */
        }
      }
      await sql('DELETE FROM search_console_inspections WHERE quota_date<DATE_SUB(CURDATE(),INTERVAL 30 DAY)');
    } finally {
      ticking = false;
    }
  }
  return {
    status,
    configure,
    beginOAuth,
    completeOAuth,
    properties,
    link,
    preview,
    execute,
    changeStatus,
    sync,
    performance,
    inspect,
    unlink,
    disconnect,
    tick,
    start() {
      tick().catch(() => {});
      const timer = setInterval(() => tick().catch(() => {}), 15 * 60 * 1000);
      timer.unref();
      return () => clearInterval(timer);
    }
  };
}
