import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { createCmsController, bundledRelease, validateRelease } from '../lib/lorzcms.mjs';
import { encryptWithKey, decryptWithKey } from '../lib/crypto.mjs';

const hasDb = Boolean(process.env.DATABASE_URL || (process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME));

test(
  'persisted CMS queue: secret storage, delayed execution, health rollback, conflict detection and retry',
  { skip: !hasDb, timeout: 60000 },
  async t => {
    const db = mysql.createPool(
      process.env.DATABASE_URL || {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME,
        connectionLimit: 5
      }
    );
    const prefix = 'cms_test_' + crypto.randomBytes(5).toString('hex') + '_';
    const names = ['cms_releases', 'cms_installations', 'cms_jobs', 'sites'];
    function sql(text) {
      for (const name of names) text = text.replace(new RegExp('\\b' + name + '\\b', 'g'), prefix + name);
      return text.replace(/\bfk_cms_([a-z_]+)\b/g, (_, suffix) => prefix + 'fk_' + suffix);
    }
    const q = async (text, params = []) => {
      const [raw] = await db.query(sql(text), params);
      return { rows: Array.isArray(raw) ? raw : [], meta: raw };
    };
    t.after(async () => {
      for (const name of ['cms_jobs', 'cms_installations', 'cms_releases', 'sites'])
        await db.query('DROP TABLE IF EXISTS ' + prefix + name);
      await db.end();
    });
    await q(
      'CREATE TABLE sites (id CHAR(36) PRIMARY KEY,slug VARCHAR(100),name VARCHAR(190),domain VARCHAR(255),deployment_mode VARCHAR(30),protocol VARCHAR(10),host VARCHAR(255),port INT,username VARCHAR(255),encrypted_credentials LONGTEXT,remote_root VARCHAR(500),exclude_patterns LONGTEXT,monitor_enabled INT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
    const migration = await readFile(new URL('../migrations/0003_lorzcms.sql', import.meta.url), 'utf8');
    for (const statement of migration.split(/;\s*(?:\n|$)/).filter(x => x.trim())) await q(statement);
    const key = crypto.randomBytes(32),
      files = new Map(),
      directories = new Set(['/']),
      live = new Map(),
      calls = [];
    let unhealthy = false,
      activationConflict = false;
    const remote = {
      async ensureDirectory(path) {
        directories.add(path);
      },
      async list(path) {
        if (path === '/') return [];
        const start = path.replace(/\/$/, '') + '/';
        if (!directories.has(path) && ![...files.keys()].some(p => p.startsWith(start)))
          throw new Error('not found');
        return [...files.keys()]
          .filter(p => p.startsWith(start))
          .map(p => ({
            name: p.slice(start.length).split('/')[0],
            type: p.slice(start.length).includes('/') ? 'directory' : 'file'
          }));
      },
      async exists(path) {
        return files.has(path);
      },
      async read(path) {
        if (!files.has(path)) throw new Error('missing');
        return files.get(path);
      },
      async write(path, bytes) {
        files.set(path, Buffer.from(bytes));
      },
      async close() {}
    };
    const getSite = async id => (await q('select * from sites where id=?', [id])).rows[0];
    const createSite = async x => {
      const id = crypto.randomUUID();
      await q(
        'insert into sites(id,slug,name,domain,deployment_mode,protocol,host,port,username,encrypted_credentials,remote_root,monitor_enabled) values(?,?,?,?,?,?,?,?,?,?,?,?)',
        [
          id,
          x.slug,
          x.name,
          x.domain,
          'webspace',
          x.protocol,
          x.host,
          x.port,
          x.username,
          encryptWithKey({ password: x.password }, key),
          x.remoteRoot,
          0
        ]
      );
      return getSite(id);
    };
    const deps = {
      q,
      db,
      getSite,
      createSite,
      listSites: async () => (await q('select * from sites')).rows,
      connectSite: async () => remote,
      encrypt: x => encryptWithKey(x, key),
      decrypt: x => decryptWithKey(x, key),
      request: async (url, options = {}) => {
        const origin = new URL(url).origin;
        if (!url.endsWith('/siteops.php'))
          return new Response('website', { status: unhealthy && live.get(origin)?.version === '3.4.1' ? 500 : 200 });
        const inst = (await q('select * from cms_installations where base_url=?', [origin])).rows[0];
        if (!options.body) return Response.json({ instanceId: inst.id, ...live.get(origin), maintenance: false });
        const body = JSON.parse(options.body);
        calls.push(body);
        if (body.action === 'preflight') return Response.json({ ok: true, instanceId: inst.id });
        if (activationConflict) return new Response('conflict', { status: 409 });
        live.set(origin, { version: body.version, jobId: body.jobId });
        return Response.json({ ok: true, instanceId: inst.id, version: body.version });
      }
    };
    let controller = createCmsController(deps);
    const base = await bundledRelease();
    await controller.importRelease(base);
    await assert.rejects(() => controller.importRelease({ ...base, notes: 'different' }), /existiert bereits/);
    const installInput = {
      slug: 'queue-test',
      name: 'Queue test',
      baseUrl: 'https://cms.example.de',
      version: base.version,
      protocol: 'sftp',
      host: 'host',
      port: 22,
      username: 'user',
      password: 'ftp-secret',
      remoteRoot: '/empty',
      adminName: 'Admin',
      adminEmail: 'admin@example.de',
      adminPassword: 'strong-admin-password',
      database: { engine: 'sqlite' },
      publicRootReady: true,
      runAt: '2099-01-01T00:00:00Z'
    };
    const created = await controller.create(installInput);
    const stored = (await q('select * from cms_jobs where id=?', [created.jobId])).rows[0];
    assert.ok(!stored.encrypted_payload.includes('strong-admin-password'));
    assert.equal(decryptWithKey(stored.encrypted_payload, key).adminPassword, 'strong-admin-password');
    assert.ok(!JSON.stringify(await controller.overview()).includes('ftp-secret'));
    await controller.tick();
    assert.equal(calls.length, 0, 'future job does not execute');
    await controller.cancel(created.jobId);
    assert.equal((await q('select * from cms_jobs where id=?', [created.jobId])).rows[0].encrypted_payload, null);
    const resumed = await controller.create({ ...installInput, adminPassword: 'resupplied-admin-password' });
    assert.equal(resumed.jobId, created.jobId);
    assert.equal(resumed.installationId, created.installationId);
    assert.equal((await q('select * from sites')).rows.length, 1);
    assert.equal(
      decryptWithKey((await q('select * from cms_jobs where id=?', [created.jobId])).rows[0].encrypted_payload, key)
        .adminPassword,
      'resupplied-admin-password'
    );
    await q('update cms_jobs set run_at=UTC_TIMESTAMP(3) where id=?', [created.jobId]);
    controller = createCmsController(deps);
    await controller.tick();
    const finished = (await q('select * from cms_jobs where id=?', [created.jobId])).rows[0];
    assert.equal(finished.state, 'succeeded');
    assert.equal(finished.encrypted_payload, null);
    const inst = (await controller.overview()).installations[0];
    assert.equal(inst.version, base.version);
    const next = validateRelease({ ...base, version: '3.4.1', notes: 'Next version' });
    await controller.importRelease(next);
    unhealthy = true;
    const scheduled = await controller.schedule({ installations: [inst.id], version: next.version });
    await controller.tick();
    const failed = (await q('select * from cms_jobs where id=?', [scheduled.jobs[0].jobId])).rows[0];
    assert.equal(failed.state, 'rolled_back');
    assert.equal(live.get('https://cms.example.de').version, base.version);
    unhealthy = false;
    const update = await controller.schedule({ installations: [inst.id], version: next.version });
    await controller.tick();
    const rollback = await controller.rollback(update.jobs[0].jobId);
    await controller.tick();
    assert.equal((await q('select * from cms_jobs where id=?', [rollback.jobId])).rows[0].state, 'succeeded');
    assert.equal(live.get('https://cms.example.de').version, base.version);
    const conflict = await controller.schedule({ installations: [inst.id], version: next.version });
    activationConflict = true;
    await controller.tick();
    assert.equal(
      (await q('select * from cms_jobs where id=?', [conflict.jobs[0].jobId])).rows[0].state,
      'needs_attention'
    );
    activationConflict = false;
    await controller.retry(conflict.jobs[0].jobId);
    await controller.tick();
    assert.equal((await q('select * from cms_jobs where id=?', [conflict.jobs[0].jobId])).rows[0].state, 'succeeded');
    const cancelled = await controller.schedule({
      installations: [inst.id],
      version: base.version,
      runAt: '2099-01-01T00:00:00Z'
    });
    await controller.cancel(cancelled.jobs[0].jobId);
    await controller.tick();
    assert.equal((await q('select * from cms_jobs where id=?', [cancelled.jobs[0].jobId])).rows[0].state, 'cancelled');
    const oldSite = await createSite({
      ...installInput,
      slug: 'existing',
      domain: 'existing.example.de',
      remoteRoot: '/existing'
    });
    const adopted = await controller.attach({
      site: oldSite.id,
      baseUrl: 'https://existing.example.de',
      publicRootReady: true
    });
    await controller.cancel(adopted.jobId);
    const readopted = await controller.attach({
      site: oldSite.id,
      baseUrl: 'https://existing.example.de',
      publicRootReady: true
    });
    assert.equal(readopted.jobId, adopted.jobId);
    assert.equal(readopted.installationId, adopted.installationId);
    await controller.cancel(readopted.jobId);
  }
);
