import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { get } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import crypto from 'node:crypto';
import { bundledRelease } from '../lib/lorzcms.mjs';
import { buildCmsProject } from '../scripts/build-cms-project.mjs';

const php = process.env.SITEOPS_PHP || 'php';
const phpArgs = process.env.SITEOPS_PHP_INI ? ['-c', process.env.SITEOPS_PHP_INI] : [];
const available =
  spawnSync(
    php,
    [
      ...phpArgs,
      '-r',
      "exit(PHP_VERSION_ID>=80300 && extension_loaded('pdo_sqlite') && extension_loaded('mbstring') ? 0 : 1);"
    ],
    { windowsHide: true }
  ).status === 0;
if (process.env.CI && !available) throw new Error('CI requires PHP for project installation tests.');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function binaryDownload(url) {
  return new Promise((resolve, reject) => {
    const request = get(url, { agent: false }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, bytes: Buffer.concat(chunks) }));
    });
    request.setTimeout(15000, () => request.destroy(new Error('Binary response timed out')));
    request.on('error', reject);
  });
}

test(
  'real PHP project provision: reject corrupt media, import preserved routes/people and serve binary files',
  { skip: !available, timeout: 120000 },
  async t => {
    const temp = await mkdtemp(join(tmpdir(), 'siteops-project-'));
    const root = join(temp, 'target');
    let server;
    t.after(async () => {
      server?.kill();
      if (server && server.exitCode === null) await new Promise(resolve => server.once('exit', resolve));
      assert.equal(dirname(resolve(temp)), resolve(tmpdir()));
      await rm(temp, { recursive: true, force: true });
    });
    for (const path of ['.lorzcms', 'config', 'var', 'public']) await mkdir(join(root, path), { recursive: true });
    const version = await bundledRelease();
    for (const file of version.files) {
      const target = join(root, '.lorzcms/releases', version.version, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(file.content, 'base64'));
    }
    await writeFile(join(root, '.lorzcms/releases', version.version, 'manifest.json'), version.manifestText);
    let source = process.env.SITEOPS_CMS_PROJECT;
    const project = source ? 'nordiamed' : 'practice';
    if (!source) {
      source = join(temp, 'source');
      for (const dir of ['projects/practice', 'migration', 'public/wp-content/uploads/2022/05'])
        await mkdir(join(source, dir), { recursive: true });
      let definition = await readFile(
        new URL('../packages/lorzcms-core/projects/base/project.php', import.meta.url),
        'utf8'
      );
      definition = definition.replace(
        "'types'=>['page'=>",
        "'types'=>['person'=>['label'=>'Mein Team','fields'=>['role'=>['label'=>'Rolle']]],'page'=>"
      );
      await writeFile(join(source, 'projects/practice/project.php'), definition);
      await writeFile(
        join(source, 'migration/practice-content.json'),
        JSON.stringify({
          format: 'sitecms-content-v1',
          project: 'practice',
          site_configuration: { settings: { name: 'Praxisimport' } },
          contents: [
            {
              id: 'home',
              type: 'page',
              title: 'Moin',
              path: '/',
              status: 'published',
              fields: { body: '<p>Praxisimport</p>' },
              seo: {}
            },
            {
              id: 'team',
              type: 'page',
              title: 'Team',
              path: '/unser-team/',
              status: 'published',
              fields: { body: '<p>Team</p>' },
              seo: {}
            },
            {
              id: 'person',
              type: 'person',
              title: 'Mitarbeiterin',
              path: null,
              status: 'published',
              fields: { role: 'Assistenz' },
              seo: {}
            }
          ]
        })
      );
      await writeFile(join(source, 'public/wp-content/uploads/2022/05/photo.jpg'), Buffer.from([0, 255, 128, 99]));
    }
    const bundle = await buildCmsProject(source, project, 'Praxisimport');
    const packageId = crypto.randomUUID();
    for (const file of bundle.files) {
      await mkdir(dirname(join(root, file.path)), { recursive: true });
      await writeFile(join(root, file.path), Buffer.from(file.content, 'base64'));
    }
    await mkdir(join(root, '.lorzcms/projects', packageId), { recursive: true });
    await writeFile(join(root, '.lorzcms/projects', packageId, 'manifest.json'), JSON.stringify(bundle.manifest));
    const key = crypto.randomBytes(32).toString('hex');
    await writeFile(
      join(root, 'config/siteops.php'),
      `<?php return ['instance_id'=>'project-test','key_hash'=>'${hash(key)}','allow_local_http'=>true];`
    );
    for (const [file, target] of [
      ['agent.php', '.lorzcms/agent.php'],
      ['project.php', '.lorzcms/project.php'],
      ['siteops.php', 'public/siteops.php'],
      ['bootstrap.php', 'bootstrap.php'],
      ['index.php', 'public/index.php'],
      ['router.php', 'public/router.php']
    ])
      await cp(new URL('../lib/lorzcms/' + file, import.meta.url), join(root, target));
    const probe = createServer();
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    await writeFile(
      join(root, 'test-router.php'),
      "<?php $_SERVER['HTTPS']='on'; require __DIR__.'/public/router.php';"
    );
    server = spawn(
      php,
      [...phpArgs, '-S', `127.0.0.1:${port}`, '-t', join(root, 'public'), join(root, 'test-router.php')],
      { stdio: 'ignore', windowsHide: true }
    );
    const base = `http://127.0.0.1:${port}`;
    // The single-threaded PHP development server closes each HTTP connection.
    const fetch = (url, options = {}) =>
      globalThis.fetch(url, { signal: AbortSignal.timeout(15000), headers: { connection: 'close' }, ...options });
    async function call(body) {
      const response = await fetch(base + '/siteops.php', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      return { status: response.status, result: await response.json() };
    }
    for (let i = 0; i < 100; i++) {
      try {
        await fetch(base + '/siteops.php');
        break;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 30));
      }
    }
    const provision = {
      action: 'provision',
      version: version.version,
      digest: version.digest,
      jobId: 'project-install',
      baseUrl: 'https://praxis.example.com',
      adminName: 'Admin',
      adminEmail: 'admin@example.com',
      adminPassword: 'fixture-only-long-password',
      database: { engine: 'sqlite' },
      projectPackage: { id: packageId, digest: bundle.digest, project, seedPath: bundle.manifest.seedPath }
    };
    const media = bundle.files.find(file => file.path.startsWith('public/wp-content/uploads/'));
    await writeFile(join(root, media.path), 'corrupt');
    assert.equal((await call(provision)).status, 422);
    await writeFile(join(root, media.path), Buffer.from(media.content, 'base64'));
    const installed = await call(provision);
    assert.equal(installed.status, 200, JSON.stringify(installed));
    assert.equal((await call(provision)).status, 200, 'same job is idempotent');
    const configuration = await readFile(join(root, 'config/local.php'), 'utf8');
    assert.ok(configuration.includes("'project'=>'" + project + "'"));
    for (const route of bundle.summary.routes) {
      const page = await fetch(base + route);
      assert.equal(page.status, 200, route);
      await page.arrayBuffer();
    }
    const homepageHtml = await (await fetch(base + '/')).text();
    assert.match(homepageHtml, project === 'nordiamed' ? /nordiamed\.css/ : /Praxisimport/);
    for (const file of bundle.files.filter(file => file.path.startsWith('public/wp-content/uploads/'))) {
      try {
        // This is a functional byte-integrity check, not a load test of the
        // single-threaded Windows PHP development server.
        if (process.platform === 'win32') await new Promise(resolve => setTimeout(resolve, 100));
        const response = await binaryDownload(base + '/' + file.path.slice(7));
        assert.equal(response.status, 200, file.path);
        assert.equal(hash(response.bytes), hash(Buffer.from(file.content, 'base64')), file.path);
      } catch (error) {
        throw new Error('Imported media test failed: ' + file.path, { cause: error });
      }
    }
    for (const path of [
      '/config/local.php',
      '/migration/' + project + '-content.json',
      '/wp-content/uploads/../../config/local.php'
    ])
      assert.equal((await fetch(base + path)).status, 404, path);
    const login = await fetch(base + '/admin/login/');
    const csrf = (await login.text()).match(/name="csrf" value="([a-f0-9]+)"/)[1];
    const loggedIn = await fetch(base + '/admin/login/', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie: login.headers.get('set-cookie').split(';')[0],
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ csrf, email: provision.adminEmail, password: provision.adminPassword })
    });
    assert.equal(loggedIn.status, 303, 'provisioned administrator can log in');
    const session = loggedIn.headers.get('set-cookie').split(';')[0];
    assert.match(await (await fetch(base + '/admin/', { headers: { cookie: session } })).text(), /Mein Team/);
    const count = spawnSync(
      php,
      [
        ...phpArgs,
        '-r',
        '$db=new PDO("sqlite:".$argv[1]);echo $db->query("SELECT COUNT(*) FROM contents")->fetchColumn();',
        join(root, 'var/cms.sqlite')
      ],
      { encoding: 'utf8', windowsHide: true }
    );
    assert.equal(count.status, 0);
    assert.equal(Number(count.stdout), bundle.summary.contents, 'the complete content export was imported');
  }
);
