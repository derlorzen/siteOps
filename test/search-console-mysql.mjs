import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createSearchConsoleService } from '../lib/search-console.mjs';
import { encryptWithKey, decryptWithKey } from '../lib/crypto.mjs';

// Called from the existing serial migration test after migrate(), avoiding
// concurrent schema migration runners against the shared CI database.
export async function checkSearchConsoleMysql(db, migrate) {
  const id = crypto.randomUUID(),
    accountId = crypto.randomUUID(),
    subject = 'gsc-ci-' + id,
    googleId = 'google-' + id;
  const key = Buffer.alloc(32, 6),
    encrypt = x => encryptWithKey(x, key),
    decrypt = x => decryptWithKey(x, key);
  const site = { id, slug: 'gsc-' + id, domain: 'example.com', enabled: true };
  const calls = [],
    dnsWrites = [];
  let dnsGate = null;
  const service = createSearchConsoleService({
    db,
    encrypt,
    decrypt,
    owner: () => subject,
    getSite: async value => {
      const [rows] = await db.query('SELECT * FROM sites WHERE id=? OR slug=?', [value, value]);
      if (!rows[0]) throw new Error('Site missing');
      return rows[0];
    },
    publicBaseUrl: () => 'https://siteops.example.com',
    dns: {
      inspect: async (_domain, value) => ({
        zone: 'example.com',
        name: '@',
        value,
        type: 'TXT',
        provider: 'allinkl',
        servers: ['ns1.kasserver.com']
      }),
      apply: async plan => {
        dnsWrites.push(plan);
        if (dnsGate) await dnsGate();
        return { dns_status: 'submitted' };
      },
      present: async () => true
    },
    fetcher: async (url, init) => {
      calls.push({ url, init });
      if (url.includes('/token')) return Response.json({ token: 'google-site-verification=abcdefghijklmnop' });
      if (url.includes('/searchAnalytics/')) {
        const x = JSON.parse(init.body);
        return Response.json({
          rows: [
            {
              keys: [x.dimensions[0] === 'date' ? x.endDate : 'test'],
              clicks: 3,
              impressions: 200,
              ctr: 0.015,
              position: 9
            }
          ]
        });
      }
      if (url.endsWith('/sites'))
        return Response.json({ siteEntry: [{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }] });
      if (url.endsWith('/sitemaps')) return Response.json({ sitemap: [] });
      return Response.json({ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' });
    }
  });
  await db.query(
    'INSERT INTO sites(id,slug,name,domain,protocol,host,port,username,encrypted_credentials,remote_root) VALUES(?,?,?,?,?,?,?,?,?,?)',
    [id, site.slug, 'GSC CI', site.domain, 'sftp', 'example.com', 22, 'test', encrypt({}), '/ci']
  );
  await db.query(
    'INSERT INTO search_console_accounts(id,subject,google_id,email,encrypted_credentials) VALUES(?,?,?,?,?)',
    [
      accountId,
      subject,
      googleId,
      'ci@example.com',
      encrypt({ access_token: 'ci-access', refresh_token: 'ci-refresh', expires_at: Date.now() + 3600000 })
    ]
  );
  const approve = async action => {
    const p = await service.preview({ site: id, action });
    return service.execute({ preview_token: p.preview_token, approved: true, confirmation: p.confirmation });
  };
  try {
    await service.link({ site: id, account_id: accountId, property: 'sc-domain:example.com' });
    await assert.rejects(service.sync(id), { statusCode: 403 });
    await approve('live');
    const p = await service.preview({ site: id, action: 'dns' });
    const input = { preview_token: p.preview_token, approved: true, confirmation: p.confirmation };
    const results = await Promise.allSettled([service.execute(input), service.execute(input)]);
    assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
    assert.equal(dnsWrites.length, 1);
    assert.equal((await service.changeStatus(p.preview_token)).status, 'done');
    // A concurrent project-domain edit must wait while the approved DNS write
    // holds the real MySQL project lock. No live DNS provider is contacted.
    let entered, release;
    const insideDns = new Promise(resolve => {
      entered = resolve;
    });
    const finishDns = new Promise(resolve => {
      release = resolve;
    });
    dnsGate = () => {
      entered();
      return finishDns;
    };
    const executing = approve('dns');
    await Promise.race([insideDns, executing.then(() => assert.fail('DNS gate was not entered'))]);
    const concurrent = await db.getConnection();
    try {
      await concurrent.query('SET SESSION innodb_lock_wait_timeout=1');
      await assert.rejects(
        concurrent.query('UPDATE sites SET domain=? WHERE id=?', ['changed.example.com', id]),
        error => error.code === 'ER_LOCK_WAIT_TIMEOUT'
      );
    } finally {
      await concurrent.query('SET SESSION innodb_lock_wait_timeout=50');
      concurrent.release();
      release();
      await executing;
      dnsGate = null;
    }
    const report = await service.sync(id);
    assert.equal(report.totals.clicks, 3);
    assert.equal((await service.performance(id)).totals.clicks, 3);
    const state = await service.status(id);
    assert.ok(state.linkage.last_sync_at);
    assert.ok(state.linkage.last_complete_date);
    assert.equal(state.linkage.sync_error, null);
    // The real migration runner remains idempotent with live feature data.
    await migrate();
    assert.equal((await service.performance(id)).available, true);
    const before = calls.length;
    await service.tick();
    assert.equal(calls.length, before, 'daily sync must not refetch before next_sync_at');
    await service.link({ site: id, account_id: accountId, property: 'sc-domain:example.com' });
    assert.equal((await service.status(id)).linkage.live_approved_at, null);
    assert.equal((await service.performance(id)).available, false);
    await db.query('DELETE FROM sites WHERE id=?', [id]);
    assert.equal((await db.query('SELECT * FROM search_console_sites WHERE site_id=?', [id]))[0].length, 0);
    assert.equal((await db.query('SELECT * FROM search_console_previews WHERE site_id=?', [id]))[0].length, 0);
  } finally {
    await db.query('DELETE FROM sites WHERE id=?', [id]);
    await db.query('DELETE FROM search_console_accounts WHERE id=?', [accountId]);
  }
}
