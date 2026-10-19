import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Script } from 'node:vm';
import { resolveBuildInfo } from '../lib/build-info.mjs';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'siteops-build-'));
  try {
    for (const directory of ['lib', 'public', 'migrations', 'packages/lorzcms-core']) {
      await mkdir(join(root, directory), { recursive: true });
    }
    for (const file of ['app.mjs', 'package-lock.json', 'schema.sql']) await writeFile(join(root, file), 'base');
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: '1.2.0' }));
    await writeFile(join(root, 'public', 'crm-app.js'), 'initial');
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('footer build fingerprint reflects the real deployed files, without Git metadata', async () => {
  await fixture(async root => {
    const first = await resolveBuildInfo({ root, environ: {} });
    const again = await resolveBuildInfo({ root, environ: {} });
    assert.deepEqual(first, again);
    assert.equal(first.version, '1.2.0+build.' + first.build.slice(0, 8));
    assert.equal(first.commit, null);
    assert.match(first.build, /^[a-f0-9]{12}$/);
    await writeFile(join(root, 'public', 'crm-app.js'), 'changed deployment');
    const second = await resolveBuildInfo({ root, environ: {} });
    assert.notEqual(second.build, first.build);
    assert.notEqual(second.version, first.version);
    assert.equal(second.fingerprint.length, 64);
  });
});

test('version resolution includes valid injected Git revision, but never trusts malformed values', async () => {
  await fixture(async root => {
    const commit = 'a'.repeat(40);
    const info = await resolveBuildInfo({ root, environ: { SITEOPS_GIT_SHA: commit } });
    assert.equal(info.commit, commit);
    assert.equal(info.commitShort, commit.slice(0, 12));
    const invalid = await resolveBuildInfo({ root, environ: { SITEOPS_GIT_SHA: 'invalid' } });
    assert.equal(invalid.commit, null);
  });
});

test('can read Git commit from checked-out repository metadata', async () => {
  await fixture(async root => {
    await mkdir(join(root, '.git', 'refs', 'heads'), { recursive: true });
    await writeFile(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    await writeFile(join(root, '.git', 'refs', 'heads', 'main'), 'b'.repeat(40) + '\n');
    const info = await resolveBuildInfo({ root, environ: {} });
    assert.equal(info.commit, 'b'.repeat(40));
  });
});

test('a shared, no-store build endpoint and footer are available on all workspace pages', async () => {
  const app = await readFile(new URL('../app.mjs', import.meta.url), 'utf8');
  const footer = await readFile(new URL('../public/build-footer.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../public/build-footer.css', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new Script(footer));
  assert.match(app, /app\.get\('\/api\/build-info'/);
  assert.match(app, /<meta name="siteops-build"/);
  assert.match(app, /<script defer src="\/assets\/build-footer\.js"/);
  assert.match(footer, /cache: 'no-store'/);
  assert.match(footer, /'Geladene Ansicht: '/);
  assert.match(styles, /bottom:calc\(69px \+ env\(safe-area-inset-bottom\)\)/);
});
