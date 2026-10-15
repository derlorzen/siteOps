import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, cp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';
import { bundledRelease } from '../lib/lorzcms.mjs';
import { accidentInsuranceBlueprint } from '../lib/website-presets.mjs';

const php = process.env.SITEOPS_PHP || 'php';
const phpArgs = process.env.SITEOPS_PHP_INI ? ['-c', process.env.SITEOPS_PHP_INI] : [];
const phpSupported = spawnSync(php, [...phpArgs, '-r',
  "exit(PHP_VERSION_ID >= 80300 && extension_loaded('pdo_sqlite') && extension_loaded('mbstring') && extension_loaded('dom') ? 0 : 1);"
]).status === 0;
if (process.env.CI && !phpSupported) throw new Error('CI requires PHP 8.3+, SQLite, mbstring and DOM');

test('real LorzCMS first installation publishes insurance site and sport landing pages without enabling indexing',
  { skip: !phpSupported, timeout: 90000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'siteops-insurance-'));
    let server;
    t.after(async () => {
      server?.kill();
      if (server) await new Promise(resolve => {
        if (server.exitCode !== null) resolve();
        else server.once('exit', resolve);
      });
      await rm(root, { recursive: true, force: true });
    });
    for (const dir of ['.lorzcms', 'config', 'var', 'public', 'projects/base'])
      await mkdir(join(root, dir), { recursive: true });
    const token = crypto.randomBytes(32).toString('hex');
    await writeFile(join(root, 'config/siteops.php'),
      `<?php return ['instance_id'=>'insurance-test','key_hash'=>'${crypto.createHash('sha256').update(token).digest('hex')}','allow_local_http'=>true];`);
    for (const [file, target] of [
      ['agent.php', '.lorzcms/agent.php'],
      ['siteops.php', 'public/siteops.php'],
      ['bootstrap.php', 'bootstrap.php'],
      ['index.php', 'public/index.php'],
      ['router.php', 'public/router.php']
    ]) await cp(new URL('../lib/lorzcms/' + file, import.meta.url), join(root, target));
    await cp(new URL('../packages/lorzcms-core/projects/base/project.php', import.meta.url),
      join(root, 'projects/base/project.php'));
    const release = await bundledRelease();
    const releaseRoot = join(root, '.lorzcms/releases', release.version);
    for (const file of release.files) {
      const filename = join(releaseRoot, file.path);
      await mkdir(join(filename, '..'), { recursive: true });
      await writeFile(filename, Buffer.from(file.content, 'base64'));
    }
    await writeFile(join(releaseRoot, 'manifest.json'), release.manifestText);
    const probe = createServer();
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    await writeFile(join(root, 'test-router.php'), "<?php $_SERVER['HTTPS']='on'; require __DIR__.'/public/router.php';");
    server = spawn(php, [...phpArgs, '-S', '127.0.0.1:' + port,
      '-t', join(root, 'public'), join(root, 'test-router.php')], { stdio: 'ignore', windowsHide: true });
    const base = 'http://127.0.0.1:' + port;
    async function agent(payload) {
      const response = await fetch(base + '/siteops.php', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return { status: response.status, body: await response.json() };
    }
    for (let i = 0; i < 100; i++) {
      try { await fetch(base + '/'); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 30)); }
    }
    assert.equal((await agent({ action: 'preflight', version: release.version, digest: release.digest })).status, 200);
    const install = await agent({
      action: 'provision',
      jobId: 'insurance-test',
      version: release.version,
      digest: release.digest,
      baseUrl: 'https://unfall.lorzen.de',
      siteName: 'Unfallversicherung verständlich erklärt',
      adminName: 'Website-Administration',
      adminEmail: 'admin@example.de',
      adminPassword: 'long-test-secret-password',
      database: { engine: 'sqlite' },
      websiteBlueprint: accidentInsuranceBlueprint({ origin: 'https://unfall.lorzen.de' })
    });
    assert.equal(install.status, 200, JSON.stringify(install));
    const pages = ['/', '/gesetzlich-privat', '/unfallversicherung-fussball',
      '/unfallversicherung-skisport', '/unfallversicherung-radfahren', '/unfallversicherung-handball'];
    for (const path of pages) {
      const r = await fetch(base + path);
      assert.equal(r.status, 200, path);
      const html = await r.text();
      assert.match(html, /<meta name="robots" content="noindex,follow">/);
      assert.match(html, /<meta name="description"/);
      assert.match(html, /<link rel="canonical"/);
      assert.match(html, /Unfallversicherung|Fußball|Handball|Skisport|Radfahren/);
    }
    const home = await (await fetch(base + '/')).text();
    assert.match(home, /35,6/);
    assert.match(home, /gesetzliche Unfallversicherung/);
    assert.match(home, /unfallversicherung-handball/);
    const comparison = await (await fetch(base + '/gesetzlich-privat')).text();
    assert.match(comparison, /Verletztengeld/);
    assert.match(comparison, /Schulsport/);
    const css = await (await fetch(base + '/assets/site-theme.css')).text();
    assert.match(css, /#1c658f/);
    assert.match(css, /max-width:720px/);
    assert.equal((await fetch(base + '/admin/login/')).status, 200);
  });
