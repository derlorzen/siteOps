import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { bundledRelease, validateRelease } from '../lib/lorzcms.mjs';

const enabled = Boolean(process.env.CI && process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);
test(
  'real MySQL CMS snapshot restores text, IDs and revision numbers without rolling back live content',
  { skip: !enabled, timeout: 60000 },
  async t => {
    const php = process.env.SITEOPS_PHP || 'php',
      args = process.env.SITEOPS_PHP_INI ? ['-c', process.env.SITEOPS_PHP_INI] : [];
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD || ''
    });
    const suffix = crypto.randomBytes(5).toString('hex'),
      name = 'siteops_cms_' + suffix,
      restore = 'siteops_cms_restore_' + suffix;
    const root = await mkdtemp(join(tmpdir(), 'siteops-cms-mysql-'));
    let server;
    t.after(async () => {
      server?.kill();
      if (server && server.exitCode === null) await new Promise(done => server.once('exit', done));
      assert.match(name, /^siteops_cms_[a-f0-9]{10}$/);
      assert.match(restore, /^siteops_cms_restore_[a-f0-9]{10}$/);
      await connection.query('DROP DATABASE IF EXISTS ' + restore);
      await connection.query('DROP DATABASE IF EXISTS ' + name);
      await connection.end();
      assert.equal(dirname(resolve(root)), resolve(tmpdir()));
      await rm(root, { recursive: true, force: true });
    });
    await connection.query('CREATE DATABASE ' + name + ' CHARACTER SET utf8mb4');
    await connection.query('CREATE DATABASE ' + restore + ' CHARACTER SET utf8mb4');
    for (const dir of ['.lorzcms', 'config', 'public', 'projects/base'])
      await mkdir(join(root, dir), { recursive: true });
    const key = crypto.randomBytes(32).toString('hex');
    await writeFile(
      join(root, 'config/siteops.php'),
      `<?php return ['instance_id'=>'mysql-test','key_hash'=>'${crypto.createHash('sha256').update(key).digest('hex')}','allow_local_http'=>true];`
    );
    for (const [source, target] of [
      ['agent.php', '.lorzcms/agent.php'],
      ['siteops.php', 'public/siteops.php'],
      ['index.php', 'public/index.php'],
      ['bootstrap.php', 'bootstrap.php'],
      ['router.php', 'public/router.php']
    ])
      await cp(new URL('../lib/lorzcms/' + source, import.meta.url), join(root, target));
    await cp(
      new URL('../packages/lorzcms-core/projects/base/project.php', import.meta.url),
      join(root, 'projects/base/project.php')
    );
    const initial = await bundledRelease(),
      next = validateRelease({ ...initial, version: '3.4.1', notes: 'Snapshot test' });
    for (const pkg of [initial, next]) {
      const target = join(root, '.lorzcms/releases', pkg.version);
      for (const file of pkg.files) {
        const path = join(target, file.path);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, Buffer.from(file.content, 'base64'));
      }
      await writeFile(join(target, 'manifest.json'), pkg.manifestText);
    }
    const probe = createServer();
    await new Promise(done => probe.listen(0, '127.0.0.1', done));
    const port = probe.address().port;
    await new Promise(done => probe.close(done));
    await writeFile(
      join(root, 'test-router.php'),
      "<?php $_SERVER['HTTPS']='on';require __DIR__.'/public/router.php';"
    );
    server = spawn(
      php,
      [...args, '-S', `127.0.0.1:${port}`, '-t', join(root, 'public'), join(root, 'test-router.php')],
      { stdio: 'ignore', windowsHide: true }
    );
    async function call(body) {
      const r = await fetch(`http://127.0.0.1:${port}/siteops.php`, {
        method: body ? 'POST' : 'GET',
        headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      return { status: r.status, data: await r.json() };
    }
    for (let i = 0; i < 100; i++) {
      try {
        await call();
        break;
      } catch {
        await new Promise(done => setTimeout(done, 30));
      }
    }
    const provision = await call({
      action: 'provision',
      jobId: 'mysql-install',
      version: initial.version,
      digest: initial.digest,
      baseUrl: 'https://example.de',
      siteName: 'MySQL Test',
      adminName: 'Admin',
      adminEmail: 'admin@example.de',
      adminPassword: 'strong-test-password',
      database: {
        engine: 'mysql',
        host: process.env.DB_HOST,
        name,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD || ''
      }
    });
    assert.equal(provision.status, 200, JSON.stringify(provision));
    await connection.query('USE ' + name);
    const [before] = await connection.query('SELECT id,title,version,fields FROM contents');
    const update = await call({
      action: 'activate',
      jobId: 'mysql-update',
      version: next.version,
      digest: next.digest,
      expectedVersion: initial.version
    });
    assert.equal(update.status, 200, JSON.stringify(update));
    const edit = spawnSync(
      php,
      [
        ...args,
        '-r',
        "require $argv[1].'/bootstrap.php';[$configuration,$project,$store,$schema,$access,$content]=cms_boot();$actor=$access->user($store->query('SELECT id FROM users')->fetchColumn());$item=$content->at('/');$content->save($item['id'],$item['version'],['title'=>'Änderung nach Update 📷','fields'=>['body'=>'<p>Aktuelle Redaktion</p>']],$actor);",
        root
      ],
      { encoding: 'utf8', windowsHide: true }
    );
    assert.equal(edit.status, 0, edit.stderr);
    const rollback = await call({
      action: 'activate',
      jobId: 'mysql-rollback',
      version: initial.version,
      digest: initial.digest,
      expectedVersion: next.version
    });
    assert.equal(rollback.status, 200, JSON.stringify(rollback));
    const [after] = await connection.query('SELECT id,title,version,fields FROM contents');
    assert.equal(after[0].title, 'Änderung nach Update 📷');
    assert.equal(after[0].version, before[0].version + 1);
    const snapshot = await readFile(join(root, '.lorzcms/backups/mysql-update/database.sql'), 'utf8');
    await connection.query('USE ' + restore);
    for (const statement of snapshot.split(/;\s*(?:\n|$)/).filter(x => x.trim())) await connection.query(statement);
    const [restored] = await connection.query('SELECT id,title,version,fields FROM contents');
    assert.deepEqual(restored, before);
    const [users] = await connection.query('SELECT email FROM users');
    assert.equal(users[0].email, 'admin@example.de');
  }
);
