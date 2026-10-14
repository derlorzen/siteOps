import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundledRelease, validateRelease, cmsOrigin, cmsRunAt, cmsInstallSchema } from '../lib/lorzcms.mjs';
import { cmsDashboardBody } from '../lib/lorzcms-ui.mjs';
import * as z from 'zod/v4';

test('bundled CMS releases are complete, reproducible and do not contain installation data', async () => {
  const a = await bundledRelease(),
    b = await bundledRelease();
  assert.equal(a.digest, b.digest);
  assert.ok(a.files.length > 25);
  assert.ok(a.files.every(x => !/^(config|var|projects)\//.test(x.path)));
  assert.equal(validateRelease(JSON.parse(JSON.stringify(a))).digest, a.digest);
});

test('CMS release validation rejects corruption, traversal, duplicate files and destructive schema changes', async () => {
  const source = await bundledRelease();
  const corrupt = JSON.parse(JSON.stringify(source));
  corrupt.files[0].content = Buffer.from('changed').toString('base64');
  assert.throws(() => validateRelease(corrupt), /Prüfsumme/);
  const traversal = JSON.parse(JSON.stringify(source));
  traversal.files[0].path = 'src/../../config/local.php';
  assert.throws(() => validateRelease(traversal), /Paketdatei/);
  const duplicate = JSON.parse(JSON.stringify(source));
  duplicate.files.push(duplicate.files[0]);
  assert.throws(() => validateRelease(duplicate), /doppelte/);
  assert.throws(() => validateRelease({ ...source, schemaVersion: 2 }), /Datenbankversion/);
  assert.throws(() => validateRelease({ ...source, compatibleSchemas: [1, 2] }), /Datenbankversion/);
});

test('CMS origins require HTTPS and refuse embedded secrets, redirects and subpaths', () => {
  assert.equal(cmsOrigin('https://www.example.de/'), 'https://www.example.de');
  for (const value of [
    'http://example.de',
    'https://user:password@example.de',
    'https://example.de/cms',
    'https://example.de/?token=secret',
    'https://example.de/#x'
  ])
    assert.throws(() => cmsOrigin(value));
});

test('scheduled updates retain their explicit instant across time zones and DST', () => {
  assert.equal(cmsRunAt('2026-10-14T20:30:00+02:00'), '2026-10-14 18:30:00.000');
  assert.equal(cmsRunAt('2026-11-14T20:30:00+01:00'), '2026-11-14 19:30:00.000');
});

test('CMS creation validates document root, admin password bytes and database credentials', () => {
  assert.doesNotThrow(() => z.toJSONSchema(cmsInstallSchema), 'MCP can advertise the input schema');
  const source = {
    slug: 'new',
    name: 'New site',
    baseUrl: 'https://example.de',
    version: '3.3.0',
    protocol: 'sftp',
    host: 'hosting',
    port: 22,
    username: 'account',
    password: 'secret',
    remoteRoot: '/cms/new',
    adminName: 'Admin',
    adminEmail: 'admin@example.de',
    adminPassword: 'strong-test-password',
    database: { engine: 'sqlite' },
    publicRootReady: true
  };
  assert.equal(cmsInstallSchema.parse(source).database.engine, 'sqlite');
  assert.throws(() => cmsInstallSchema.parse({ ...source, publicRootReady: false }));
  assert.throws(() => cmsInstallSchema.parse({ ...source, adminPassword: 'ä'.repeat(40) }));
  assert.throws(() => cmsInstallSchema.parse({ ...source, remoteRoot: '/cms/../other' }));
  assert.throws(() =>
    cmsInstallSchema.parse({
      ...source,
      database: { engine: 'mysql', host: 'localhost;port=1', name: 'cms', user: 'user', password: 'secret' }
    })
  );
});

test('CMS dashboard escapes website titles, release notes and errors', () => {
  const escape = value =>
    String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  const html = cmsDashboardBody(
    {
      releases: [{ version: '3.3.0', notes: '<script>bad()</script>', digest: 'abc' }],
      installations: [],
      existingSites: [],
      jobs: []
    },
    escape
  );
  assert.ok(!html.includes('<script>bad()'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('cmsCreate') && html.includes('publicRootReady'));
});
