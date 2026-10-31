import test from 'node:test';
import assert from 'node:assert/strict';
import { websitePathAllowed, assertWebsitePath, assertNoRemoteLinks } from '../lib/website-file-policy.mjs';

test('website file inspection rejects traversal and credential stores while preserving normal source files', () => {
  for (const path of [
    '../index.php',
    'a/../b',
    'a\\..\\b',
    '.env',
    '.env.production',
    'config/.env.local',
    '.git/config',
    '.ssh/id_ed25519',
    '.htpasswd',
    'wp-config.php',
    'backup.sql',
    'database.sqlite',
    'certificate.key',
    'credentials.json'
  ]) {
    assert.equal(websitePathAllowed(path), false, path);
    assert.throws(() => assertWebsitePath(path), { statusCode: 403 });
  }
  for (const path of ['index.php', 'assets/app.css', '.htaccess', 'package.json', 'src/.gitignore'])
    assert.equal(websitePathAllowed(path), true, path);
});
test('remote inspection rejects symlink ancestors before reading their targets', async () => {
  const visited = [],
    remote = {
      list: async path => {
        visited.push(path);
        return path === '/public'
          ? [
              { name: 'assets', type: 'directory' },
              { name: 'outside', type: 'link' }
            ]
          : [
              { name: 'secrets', type: 'link' },
              { name: 'app.css', type: 'file' }
            ];
      }
    };
  await assertNoRemoteLinks(remote, '/public', 'assets/app.css');
  await assert.rejects(assertNoRemoteLinks(remote, '/public', 'assets/secrets/token'), { statusCode: 403 });
  await assert.rejects(assertNoRemoteLinks(remote, '/public', 'outside/file'), { statusCode: 403 });
  assert.ok(!visited.some(path => path.includes('outside') || path.includes('secrets')));
});
