import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../runner/update-existing.sh', import.meta.url));

test('existing runner upgrade script has valid shell syntax', () => {
  execFileSync('bash', ['-n', script], { stdio: 'pipe' });
});

test('safe upgrade --check does not install or alter existing services', () => {
  const output = execFileSync('bash', [script, '--check'], { encoding: 'utf8', timeout: 15000 });
  assert.match(output, /No changes made/);
});

test('upgrade refuses an apply without an explicit deployment method', () => {
  const r = spawnSync('bash', [script, '--apply'], { encoding: 'utf8', timeout: 15000 });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Specify exactly one existing deployment type/);
});
