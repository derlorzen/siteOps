import crypto from 'node:crypto';
import { createSearchConsoleService, searchConsoleOAuthScopes } from '../lib/search-console.mjs';
import { encryptWithKey, decryptWithKey } from '../lib/crypto.mjs';

export const accountId = '11111111-1111-4111-8111-111111111111';
export const siteId = '22222222-2222-4222-8222-222222222222';
export const txt = 'google-site-verification=abcdefghijklmnop1234';
export function searchConsoleFixture(options = {}) {
  const key = Buffer.alloc(32, 7),
    encrypt = v => encryptWithKey(v, key),
    decrypt = v => decryptWithKey(v, key);
  const settings = new Map(),
    accounts = new Map(),
    states = new Map(),
    previews = new Map(),
    reports = new Map(),
    quotas = new Map(),
    requests = [];
  let linkage = null,
    clock = Date.now(),
    subject = 'admin',
    remoteProperty = { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' };
  const site = { id: siteId, slug: 'demo', name: 'Demo', domain: 'example.com', enabled: true };
  const db = {
    async query(sql, a = []) {
      if (sql.startsWith('SELECT setting_value'))
        return [[settings.has(a[0]) ? { setting_value: settings.get(a[0]) } : null].filter(Boolean)];
      if (sql.startsWith('INSERT INTO app_settings')) {
        settings.set(a[0], a[1]);
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT id FROM search_console_accounts')) return [[...accounts.values()].slice(0, 1)];
      if (sql.startsWith('SELECT id,email'))
        return [[...accounts.values()].filter(x => x.subject === a[0]).map(({ id, email }) => ({ id, email }))];
      if (sql.startsWith('SELECT * FROM search_console_accounts'))
        return [[accounts.get(a[0])].filter(x => x?.subject === a[1])];
      if (sql.startsWith('INSERT INTO search_console_accounts')) {
        const old = [...accounts.values()].find(x => x.subject === a[1] && x.google_id === a[2]);
        accounts.set(old?.id || a[0], {
          id: old?.id || a[0],
          subject: a[1],
          google_id: a[2],
          email: a[3],
          encrypted_credentials: a[4]
        });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE search_console_accounts')) {
        accounts.get(a[1]).encrypted_credentials = a[0];
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT encrypted_payload FROM search_console_previews')) {
        const rows = [...previews.values()]
          .filter(x => x.status === 'done')
          .map(x => ({ encrypted_payload: x.encrypted_payload }));
        return [rows];
      }
      if (sql.startsWith('INSERT INTO search_console_states')) {
        states.set(a[0], { encrypted_payload: a[1], expires_at: a[2] });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT * FROM search_console_states')) return [[states.get(a[0])].filter(Boolean)];
      if (sql.startsWith('DELETE FROM search_console_states WHERE state_hash'))
        return [{ affectedRows: states.delete(a[0]) ? 1 : 0 }];
      if (sql.startsWith('DELETE FROM search_console_states WHERE expires')) return [{ affectedRows: 0 }];
      if (sql.startsWith('INSERT INTO search_console_sites')) {
        linkage = {
          site_id: a[0],
          account_id: a[1],
          property: a[2],
          domain: a[3],
          revision: a[4],
          verified_at: a[5],
          permission_level: a[6],
          live_approved_at: null,
          sitemap_status: 'not_submitted'
        };
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT * FROM search_console_sites')) return [[linkage].filter(Boolean)];
      if (sql.startsWith('SELECT sc.site_id'))
        return [
          [
            linkage && accounts.get(linkage.account_id)?.subject === a[0]
              ? { ...linkage, current_domain: site.domain, site_enabled: site.enabled }
              : null
          ].filter(Boolean)
        ];
      if (sql.startsWith('SELECT * FROM sites')) return [[{ ...site }]];
      if (sql.startsWith('SELECT g.site_id'))
        return [[linkage?.live_approved_at ? { site_id: site.id } : null].filter(Boolean)];
      if (sql.startsWith('UPDATE search_console_sites SET live_approved_at')) linkage.live_approved_at = a[0];
      else if (sql.startsWith('UPDATE search_console_sites SET verified_at')) linkage.verified_at = a[0];
      else if (sql.startsWith('UPDATE search_console_sites SET permission_level')) linkage.permission_level = a[0];
      else if (sql.startsWith('UPDATE search_console_sites SET sitemap_url')) {
        linkage.sitemap_url = a[0];
        linkage.sitemap_status = 'submitted';
      } else if (sql.startsWith('UPDATE search_console_sites SET sync_lease_token')) {
        if (linkage.sync_lease_token) return [{ affectedRows: 0 }];
        linkage.sync_lease_token = a[0];
      } else if (sql.startsWith('UPDATE search_console_sites SET last_sync_at')) {
        linkage.last_complete_date = a[0];
        linkage.last_sync_at = new Date(clock);
        linkage.sync_lease_token = null;
      } else if (sql.startsWith('UPDATE search_console_sites SET sync_error')) {
        linkage.sync_error = a[0];
        linkage.sync_lease_token = null;
      } else if (sql.startsWith('UPDATE search_console_sites')) throw new Error('Unhandled update: ' + sql);
      if (sql.startsWith('UPDATE search_console_sites')) return [{ affectedRows: 1 }];
      if (sql.startsWith('INSERT INTO search_console_previews')) {
        previews.set(a[0], { encrypted_payload: a[2], status: 'pending', expires_at: a[3] });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT * FROM search_console_previews')) return [[previews.get(a[0])].filter(Boolean)];
      if (sql.startsWith("UPDATE search_console_previews SET status='running'")) {
        const row = previews.get(a[0]);
        if (!row || row.status !== 'pending' || row.expires_at.getTime() <= clock) return [{ affectedRows: 0 }];
        row.status = 'running';
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith("UPDATE search_console_previews SET status='done'")) {
        const p = previews.get(a[1]);
        p.status = 'done';
        p.result = a[0];
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith("UPDATE search_console_previews SET status='failed'")) {
        const p = previews.get(a[1]);
        p.status = 'failed';
        p.error = a[0];
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('DELETE FROM search_console_previews')) return [{ affectedRows: 0 }];
      if (sql.startsWith('INSERT INTO search_console_reports')) {
        if (linkage?.revision === a[2] && linkage.sync_lease_token === a[3])
          reports.set(a[1], { revision: a[2], report: a[0] });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT report')) return [[reports.get(a[0])].filter(x => x?.revision === a[1])];
      if (sql.startsWith('DELETE FROM search_console_reports')) {
        reports.delete(a[0]);
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('DELETE FROM search_console_sites')) {
        linkage = null;
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('DELETE FROM search_console_accounts')) {
        accounts.delete(a[0]);
        linkage = null;
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('INSERT IGNORE INTO search_console_inspections')) {
        if (!quotas.has(a.join(':'))) quotas.set(a.join(':'), 0);
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE search_console_inspections')) {
        const key = a.join(':');
        const used = quotas.get(key);
        if (used >= 100) return [{ affectedRows: 0 }];
        quotas.set(key, used + 1);
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('DELETE FROM search_console_inspections')) return [{ affectedRows: 0 }];
      throw new Error('Unhandled SQL: ' + sql);
    },
    async getConnection() {
      return {
        query: db.query,
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release() {}
      };
    }
  };
  const fetcher = async (url, init) => {
    requests.push({ url, init });
    const override = await options.fetcher?.(url, init, requests);
    if (override) return override;
    if (url.includes('/token')) {
      if (url.includes('siteVerification')) return Response.json({ token: txt, method: 'DNS_TXT' });
      return Response.json({
        access_token: 'access-test',
        refresh_token: 'refresh-test',
        expires_in: 3600,
        scope: searchConsoleOAuthScopes.join(' ')
      });
    }
    if (url.includes('/userinfo'))
      return Response.json({ sub: 'google-user', email: 'test@example.com', email_verified: true });
    if (url.includes('/searchAnalytics/')) {
      const p = JSON.parse(init.body);
      return Response.json({
        rows: [
          {
            keys: [
              p.dimensions[0] === 'date'
                ? p.endDate
                : p.dimensions[0] === 'page'
                  ? 'https://example.com/'
                  : 'test query'
            ],
            clicks: 10,
            impressions: 1000,
            ctr: 0.01,
            position: 12
          }
        ]
      });
    }
    if (url.includes('/urlInspection/'))
      return Response.json({ inspectionResult: { indexStatusResult: { verdict: 'PASS' } } });
    if (url.includes('/webResource?'))
      return Response.json({ site: { type: 'INET_DOMAIN', identifier: 'example.com' } });
    if (url.endsWith('/sitemaps')) return Response.json({ sitemap: [] });
    if (url.endsWith('/sites')) return Response.json({ siteEntry: remoteProperty ? [remoteProperty] : [] });
    if (init.method === 'PUT') return new Response(null, { status: 204 });
    return remoteProperty
      ? Response.json(remoteProperty)
      : Response.json({ error: { status: 'NOT_FOUND' } }, { status: 404 });
  };
  const dnsEvents = [],
    dns = {
      inspect: async (_domain, value, accountId) => ({
        zone: 'example.com',
        servers: ['ns1.kasserver.com'],
        provider: 'allinkl',
        name: '@',
        type: 'TXT',
        value,
        accountId,
        action: 'append'
      }),
      apply: async plan => {
        dnsEvents.push(plan);
        if (options.dnsFailure) throw Object.assign(new Error('uncertain'), { statusCode: 503 });
        return { dns_status: 'submitted', google_verified: false };
      },
      present: async () => options.dnsPresent !== false
    };
  let sitemapBody =
    '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/</loc></url></urlset>';
  const service = createSearchConsoleService({
    db,
    encrypt,
    decrypt,
    getSite: async id => {
      if (![site.id, site.slug].includes(id)) throw Object.assign(new Error('Unknown site'), { statusCode: 404 });
      return { ...site };
    },
    owner: () => subject,
    publicBaseUrl: () => 'https://siteops.example.com',
    fetcher,
    now: () => clock,
    sleep: async ms => options.onSleep?.(ms),
    dns,
    http: async url => ({ url, status: 200, headers: { 'content-type': 'application/xml' }, body: sitemapBody })
  });
  settings.set('search_console_oauth', encrypt({ client_id: 'google-client-id', client_secret: 'secret-test' }));
  accounts.set(accountId, {
    id: accountId,
    google_id: 'google-user',
    subject: 'admin',
    email: 'test@example.com',
    encrypted_credentials: encrypt({
      access_token: 'access-test',
      refresh_token: 'refresh-test',
      expires_at: clock + 3600000
    })
  });
  const session = { tokenHash: crypto.randomBytes(32).toString('hex'), subject: 'admin' };
  const link = () => service.link({ site: site.slug, account_id: accountId, property: 'sc-domain:example.com' });
  const approve = async (action, more = {}) => {
    const p = await service.preview({ site: site.slug, action, ...more });
    return service.execute({ preview_token: p.preview_token, approved: true, confirmation: p.confirmation });
  };
  return {
    service,
    db,
    site,
    session,
    accounts,
    settings,
    states,
    previews,
    requests,
    reports,
    dnsEvents,
    quotas,
    encrypt,
    decrypt,
    link,
    approve,
    get linkage() {
      return linkage;
    },
    advance(ms) {
      clock += ms;
    },
    setSubject(s) {
      subject = s;
    },
    setRemoteProperty(p) {
      remoteProperty = p;
    },
    setSitemap(body) {
      sitemapBody = body;
    },
    expireToken() {
      accounts.get(accountId).encrypted_credentials = encrypt({
        access_token: 'expired',
        refresh_token: 'refresh-test',
        expires_at: clock - 1
      });
    }
  };
}
