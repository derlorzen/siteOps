import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { cmsAgentRoutingHtaccess, verifiedLegacyStartFile } from '../lib/lorzcms.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// Exact original HSG Angeln TEST Apache startup file before the SiteOps connector
// exception was added. This hash is explicitly allowlisted in supported-legacy.json.
const legacyHtaccess =
  [
    'Options -Indexes',
    'RewriteEngine On',
    'RewriteRule ^api/cms/ - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]',
    'RewriteCond %{REQUEST_FILENAME} -f',
    'RewriteRule ^assets/([a-zA-Z0-9._-]+\\.(css|js|svg)|fonts/[a-zA-Z0-9._-]+\\.(ttf|woff2?|txt))$ - [L]',
    'RewriteRule ^ index.php [L,QSA]',
    '<IfModule mod_mime.c>',
    'AddType font/ttf .ttf',
    'AddType font/woff2 .woff2',
    '</IfModule>'
  ].join('\n') + '\n';
const loadSupported = async () =>
  JSON.parse(await readFile(new URL('../lib/lorzcms/supported-legacy.json', import.meta.url), 'utf8'));

test('HSG TEST legacy .htaccess baseline is the allowlisted original', async () => {
  const supported = await loadSupported();
  assert.equal(sha(legacyHtaccess), '5c36811aeaaf4929faf4ed59c3a2bda83ada76294731a3aaf246ec1e433e92a9');
  assert.ok(supported['public/.htaccess'].includes(sha(legacyHtaccess)));
});

test('retry recognizes connector exception even if previous SiteOps preview lost the final newline', async () => {
  const supported = await loadSupported();
  const patched = cmsAgentRoutingHtaccess(legacyHtaccess).trimEnd();
  assert.notEqual(sha(patched), sha(legacyHtaccess));
  assert.ok(patched.includes('RewriteRule ^siteops\\.php$ - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization},L]'));
  const restored = verifiedLegacyStartFile('public/.htaccess', Buffer.from(patched), supported);
  assert.deepEqual(restored, Buffer.from(legacyHtaccess));
  assert.equal(sha(restored), sha(legacyHtaccess));
});

test('retry tolerates unchanged baseline and the injected exception with intact newline', async () => {
  const supported = await loadSupported();
  assert.deepEqual(
    verifiedLegacyStartFile('public/.htaccess', Buffer.from(legacyHtaccess), supported),
    Buffer.from(legacyHtaccess)
  );
  assert.deepEqual(
    verifiedLegacyStartFile('public/.htaccess', Buffer.from(cmsAgentRoutingHtaccess(legacyHtaccess)), supported),
    Buffer.from(legacyHtaccess)
  );
});

test('the fix does not permit arbitrary edits to any legacy startup file', async () => {
  const supported = await loadSupported();
  const patched = cmsAgentRoutingHtaccess(legacyHtaccess).trimEnd();
  assert.throws(
    () =>
      verifiedLegacyStartFile(
        'public/.htaccess',
        Buffer.from(patched.replace('index.php [L,QSA]', 'hacked.php [L,QSA]')),
        supported
      ),
    /public\/\.htaccess/
  );
  assert.throws(
    () =>
      verifiedLegacyStartFile(
        'public/.htaccess',
        Buffer.from(patched.replace('RewriteEngine On', 'RewriteEngine Off')),
        supported
      ),
    /public\/\.htaccess/
  );
  assert.throws(
    () =>
      verifiedLegacyStartFile(
        'public/.htaccess',
        Buffer.from(patched.replace('RewriteRule ^api/cms/', 'RewriteRule ^api/other/')),
        supported
      ),
    /public\/\.htaccess/
  );
  assert.throws(
    () =>
      verifiedLegacyStartFile(
        'public/.htaccess',
        Buffer.from(
          patched.replace(
            'RewriteRule ^ index.php',
            'RewriteRule ^siteops\\.php$ - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization},L]\nRewriteRule ^ index.php'
          )
        ),
        supported
      ),
    /public\/\.htaccess/
  );
  assert.throws(
    () => verifiedLegacyStartFile('bootstrap.php', Buffer.from('<?php echo 1;'), supported),
    /bootstrap\.php/
  );
});

test('unsupported files cannot become trusted through line-ending normalization alone', async () => {
  const supported = await loadSupported();
  const changed = legacyHtaccess.replace('Options -Indexes', 'Options +Indexes');
  assert.throws(
    () =>
      verifiedLegacyStartFile('public/.htaccess', Buffer.from(cmsAgentRoutingHtaccess(changed).trimEnd()), supported),
    /Anschluss muss zuerst geprüft/
  );
});
