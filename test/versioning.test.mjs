import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { bumpVersion, nextPatchVersion } from '../scripts/bump-version.mjs';

test('automatic patch version keeps package manifest and lockfile in sync', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'siteops-release-'));
  try {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ version: '1.2.0' }));
    await writeFile(
      join(dir, 'package-lock.json'),
      JSON.stringify({ version: '1.2.0', packages: { '': { version: '1.2.0' } } })
    );
    assert.equal(await bumpVersion(dir), '1.2.1');
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    const lock = JSON.parse(await readFile(join(dir, 'package-lock.json'), 'utf8'));
    assert.equal(pkg.version, '1.2.1');
    assert.equal(lock.version, '1.2.1');
    assert.equal(lock.packages[''].version, '1.2.1');
    assert.equal(nextPatchVersion('1.9.99'), '1.9.100');
    assert.throws(() => nextPatchVersion('latest'), /Major.Minor.Patch/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
