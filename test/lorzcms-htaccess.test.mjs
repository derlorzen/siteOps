import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('LorzCMS Apache rewrite serves real HTTP-01 token files before the front controller', async () => {
  const rules = await readFile(new URL('../lib/lorzcms/htaccess.txt', import.meta.url), 'utf8');
  const lines = rules.split(/\r?\n/);
  const acmeIndex = lines.findIndex(line => line.startsWith('RewriteRule ^\\.well-known/acme-challenge/'));
  const catchAllIndex = lines.findIndex(line => line === 'RewriteRule ^ index.php [L,QSA]');
  assert.ok(acmeIndex > 1, 'ACME rewrite exception must exist');
  assert.ok(catchAllIndex > acmeIndex, 'ACME exception must precede CMS catch-all rewrite');
  assert.equal(lines[acmeIndex - 1], 'RewriteCond %{REQUEST_FILENAME} -f', 'only existing files may bypass routing');
  assert.match(lines[acmeIndex], /\[A-Za-z0-9_-\]\+/);
  assert.ok(lines.some(line => line.startsWith('RewriteRule ^siteops\\.php$')), 'MCP agent routing stays intact');
});
