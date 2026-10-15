import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import crypto from 'node:crypto';
import { load } from 'cheerio';
import { bundledRelease, validateRelease } from '../lib/lorzcms.mjs';

const php = process.env.SITEOPS_PHP || 'php';
const phpArgs = process.env.SITEOPS_PHP_INI ? ['-c', process.env.SITEOPS_PHP_INI] : [];
const available =
  spawnSync(
    php,
    [
      ...phpArgs,
      '-r',
      "exit(PHP_VERSION_ID >= 80300 && extension_loaded('pdo_sqlite') && extension_loaded('mbstring') && extension_loaded('fileinfo') ? 0 : 1);"
    ],
    { windowsHide: true }
  ).status === 0;
if (process.env.CI && !available) throw new Error('CI requires PHP 8.3+ with SQLite, mbstring and fileinfo.');

test(
  'real PHP CMS: install, authenticate, update, edit content, rollback and retain private data',
  { skip: !available, timeout: 60000 },
  async t => {
    const root = await mkdtemp(join(tmpdir(), 'siteops-cms-'));
    let server;
    t.after(async () => {
      server?.kill();
      if (server)
        await new Promise(resolve => {
          if (server.exitCode !== null) resolve();
          else server.once('exit', resolve);
        });
      assert.equal(dirname(resolve(root)), resolve(tmpdir()));
      await rm(root, { recursive: true, force: true });
    });
    for (const dir of ['.lorzcms', 'config', 'var', 'public', 'projects/base'])
      await mkdir(join(root, dir), { recursive: true });
    const key = crypto.randomBytes(32).toString('hex');
    await writeFile(
      join(root, 'config/siteops.php'),
      `<?php return ['instance_id'=>'test-instance','key_hash'=>'${crypto.createHash('sha256').update(key).digest('hex')}','allow_local_http'=>true];`
    );
    for (const [file, target] of [
      ['agent.php', '.lorzcms/agent.php'],
      ['siteops.php', 'public/siteops.php'],
      ['bootstrap.php', 'bootstrap.php'],
      ['index.php', 'public/index.php'],
      ['router.php', 'public/router.php']
    ])
      await cp(new URL('../lib/lorzcms/' + file, import.meta.url), join(root, target));
    await cp(
      new URL('../packages/lorzcms-core/projects/base/project.php', import.meta.url),
      join(root, 'projects/base/project.php')
    );
    const initial = await bundledRelease();
    async function stage(pkg) {
      const releaseRoot = join(root, '.lorzcms/releases', pkg.version);
      for (const file of pkg.files) {
        const path = join(releaseRoot, file.path);
        await mkdir(join(path, '..'), { recursive: true });
        await writeFile(path, Buffer.from(file.content, 'base64'));
      }
      await writeFile(join(releaseRoot, 'manifest.json'), pkg.manifestText);
    }
    await stage(initial);
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
    async function call(body = null, token = key) {
      const r = await fetch(base + '/siteops.php', {
        method: body ? 'POST' : 'GET',
        headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      return { status: r.status, data: await r.json() };
    }
    for (let i = 0; i < 100; i++) {
      try {
        await call();
        break;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 30));
      }
    }
    assert.equal((await call(null, 'wrong')).status, 401);
    assert.equal((await call({ action: 'preflight', version: initial.version, digest: initial.digest })).status, 200);
    const provision = {
      action: 'provision',
      jobId: 'install-test',
      version: initial.version,
      digest: initial.digest,
      baseUrl: 'https://example.de',
      siteName: 'Test Website',
      adminName: 'Admin',
      adminEmail: 'admin@example.de',
      adminPassword: 'a-strong-test-password',
      database: { engine: 'sqlite' }
    };
    const installed = await call(provision);
    assert.equal(installed.status, 200, JSON.stringify(installed));
    assert.equal((await call(provision)).status, 200, 'identical install is idempotent');
    assert.equal(
      (await call({ ...provision, adminPassword: 'another-password' })).status,
      409,
      'different install request cannot reuse the job'
    );
    const homepage = await fetch(base + '/');
    assert.equal(homepage.status, 200);
    const homepageHtml = await homepage.text();
    assert.match(homepageHtml, /<meta name="robots" content="noindex,follow">/, 'new websites stay out of the index until launch approval');
    assert.match(homepageHtml, /application\/ld\+json/, 'CMS renders JSON-LD from the start');
    assert.match(homepageHtml, /"@type":"Organization"/, 'the site identity is published as organization data');
    assert.doesNotMatch(await (await fetch(base + '/sitemap.xml')).text(), /<loc>/, 'prelaunch sitemap is empty');
    const login = await fetch(base + '/admin/login/');
    assert.equal(login.status, 200);
    const loginHtml = await login.text();
    assert.match(loginHtml, /Test Website/);
    const csrf = loginHtml.match(/name="csrf" value="([a-f0-9]+)"/)[1];
    const loggedIn = await fetch(base + '/admin/login/', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie: login.headers.get('set-cookie').split(';')[0],
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ csrf, email: provision.adminEmail, password: provision.adminPassword })
    });
    assert.equal(loggedIn.status, 303, 'generated administrator can sign in');
    const session = loggedIn.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(base + '/admin/', { headers: { cookie: session } })).status, 200);
    const layoutResponse = await fetch(base + '/admin/layout/', { headers: { cookie: session } });
    assert.equal(layoutResponse.status, 200);
    const layout = load(await layoutResponse.text());
    const settings = new URLSearchParams();
    layout('.settings-form [name]').each((_, element) => {
      const field = layout(element);
      settings.set(field.attr('name'), String(field.val() ?? ''));
    });
    settings.set('values[page_template]', 'editorial');
    settings.set(
      'values[header_template]',
      '<div class="custom-header header-inner site-container">{{brand}}{{navigation}}</div>'
    );
    settings.set('values[custom_css]', '.custom-header { border-bottom: 3px solid #123456; }');
    const savedLayout = await fetch(base + '/admin/layout/', {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie: session, 'content-type': 'application/x-www-form-urlencoded' },
      body: settings
    });
    assert.equal(savedLayout.status, 303, 'layout form saves with session and CSRF protection');
    const themedHome = await (await fetch(base + '/')).text();
    assert.match(themedHome, /page-editorial/);
    assert.match(themedHome, /custom-header/);
    assert.equal((themedHome.match(/<h1>/g) || []).length, 1);
    assert.match(await (await fetch(base + '/assets/site-theme.css')).text(), /border-bottom: 3px solid #123456/);
    assert.equal((await fetch(base + '/assets/page-templates.css')).status, 200);
    const preview = await fetch(base + '/admin/page-preview/?layout=split', { headers: { cookie: session } });
    assert.equal(preview.status, 200);
    assert.match(await preview.text(), /page-split/);
    assert.match(await (await fetch(base + '/')).text(), /page-editorial/, 'preview does not change the saved layout');
    const contents = load(await (await fetch(base + '/admin/contents/', { headers: { cookie: session } })).text());
    const contentUrl = contents('a[href^="/admin/content/"]').first().attr('href');
    assert.ok(contentUrl, 'installed homepage appears in the content list');
    const editorForm = load(await (await fetch(base + contentUrl, { headers: { cookie: session } })).text());
    const pageFields = new URLSearchParams();
    editorForm('form.editor input[name], form.editor textarea[name], form.editor select[name]').each((_, element) => {
      const field = editorForm(element);
      if (['checkbox', 'radio'].includes(field.attr('type')) && !field.is(':checked')) return;
      pageFields.append(field.attr('name'), String(field.val() ?? ''));
    });
    pageFields.set('page_template', 'split');
    const savedPage = await fetch(base + contentUrl, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie: session, 'content-type': 'application/x-www-form-urlencoded' },
      body: pageFields
    });
    assert.equal(savedPage.status, 303, 'content editor saves the individual page layout');
    assert.match(await (await fetch(base + '/')).text(), /page-split/);
    const editorPreview = await fetch(base + contentUrl.replace('/content/', '/preview/'), {
      headers: { cookie: session }
    });
    assert.equal(editorPreview.status, 200);
    assert.match(await editorPreview.text(), /page-split/);
    const css = await fetch(base + '/assets/cms.css');
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);
    assert.equal((await fetch(base + '/config/local.php')).status, 404);
    assert.equal((await fetch(base + '/.lorzcms/backups/test/database.sqlite')).status, 404);
    const config = await readFile(join(root, 'config/local.php'));
    const next = validateRelease({ ...initial, version: '3.4.1', notes: 'Test update' });
    await stage(next);
    assert.equal(
      (
        await call({
          action: 'activate',
          jobId: 'wrong-base',
          version: next.version,
          digest: next.digest,
          expectedVersion: '0.0.0'
        })
      ).status,
      409
    );
    const update = {
      action: 'activate',
      jobId: 'update-test',
      version: next.version,
      digest: next.digest,
      expectedVersion: initial.version
    };
    assert.equal((await call(update)).status, 200);
    assert.equal((await call(update)).status, 200);
    const editor = `require $argv[1].'/bootstrap.php'; [$config,$project,$store,$schema,$access,$content]=cms_boot(); $actor=$access->user($store->query('SELECT id FROM users')->fetchColumn()); $item=$content->at('/'); $content->save($item['id'],$item['version'],['fields'=>['body'=>'<p>Redaktion nach Update</p>']],$actor);`;
    const edited = spawnSync(php, [...phpArgs, '-r', editor, root], { encoding: 'utf8', windowsHide: true });
    assert.equal(edited.status, 0, edited.stderr);
    await mkdir(join(root, 'var/media'), { recursive: true });
    await writeFile(join(root, 'var/media/test.txt'), 'New upload');
    assert.equal(
      (
        await call({
          action: 'activate',
          jobId: 'rollback-test',
          version: initial.version,
          digest: initial.digest,
          expectedVersion: next.version
        })
      ).status,
      200
    );
    assert.match(await (await fetch(base + '/')).text(), /Redaktion nach Update/);
    assert.equal(await readFile(join(root, 'var/media/test.txt'), 'utf8'), 'New upload');
    assert.deepEqual(await readFile(join(root, 'config/local.php')), config);
    assert.equal((await call()).data.version, initial.version);
    const snapshot = spawnSync(
      php,
      [
        ...phpArgs,
        '-r',
        "$db=new PDO('sqlite:'.$argv[1]); echo $db->query(\"SELECT fields FROM contents WHERE path='/'\")->fetchColumn();",
        join(root, '.lorzcms/backups/update-test/database.sqlite')
      ],
      { encoding: 'utf8', windowsHide: true }
    );
    assert.equal(snapshot.status, 0, snapshot.stderr);
    assert.doesNotMatch(snapshot.stdout, /Redaktion nach Update/);
    const tampered = join(root, '.lorzcms/releases/3.4.1/src/Store.php');
    await writeFile(tampered, '<?php echo "bad";');
    assert.equal(
      (
        await call({
          action: 'activate',
          jobId: 'bad-package',
          version: next.version,
          digest: next.digest,
          expectedVersion: initial.version
        })
      ).status,
      422
    );
    assert.equal((await call()).data.version, initial.version);
    const active = await readFile(join(root, '.lorzcms/active.json'));
    await writeFile(join(root, '.lorzcms/releases/3.4.1/manifest.json'), '{}');
    assert.equal(
      (
        await call({
          action: 'activate',
          jobId: 'bad-manifest',
          version: next.version,
          digest: next.digest,
          expectedVersion: initial.version
        })
      ).status,
      422
    );
    assert.deepEqual(await readFile(join(root, '.lorzcms/active.json')), active);
  }
);
