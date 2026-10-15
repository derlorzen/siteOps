import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hostingTargetSchema, websiteProvisionSchema, prepareEmptyHostingTarget } from '../lib/site-provisioning.mjs';

const uuid = '11111111-1111-4111-8111-111111111111';
test('hosting targets must be non-root, absolute and traversal-free', () => {
  for (const root of ['/kunden/projekt', '/public_html/demo', '/ein ordner/web']) {
    assert.equal(hostingTargetSchema.safeParse(root).success, true, root);
  }
  for (const root of ['/', '', 'public_html', '/a/../b', '/a/./b', '/a//b', '/a/', '/a\\b', '/a/\0b']) {
    assert.equal(hostingTargetSchema.safeParse(root).success, false, root);
  }
});
test('new websites select one stored hosting connection', () => {
  const base = { slug: 'demo', name: 'Demo', domain: 'demo.example.org', remoteRoot: '/demo' };
  assert.equal(websiteProvisionSchema.safeParse({ ...base, profileId: uuid }).success, true);
  assert.equal(websiteProvisionSchema.safeParse({ ...base, existingSiteId: uuid }).success, true);
  assert.equal(websiteProvisionSchema.safeParse(base).success, false);
  assert.equal(websiteProvisionSchema.safeParse({ ...base, profileId: uuid, existingSiteId: uuid }).success, false);
});
test('directory is prepared recursively before content check', async () => {
  const calls = [];
  const remote = {
    async ensureDirectory(path) { calls.push(['mkdir', path]); },
    async list(path) { calls.push(['list', path]); return []; }
  };
  assert.deepEqual(await prepareEmptyHostingTarget(remote, '/project/public'), {
    remoteRoot: '/project/public',
    empty: true
  });
  assert.deepEqual(calls, [['mkdir', '/project/public'], ['list', '/project/public']]);
});
test('existing site files are never overwritten', async () => {
  const remote = {
    async ensureDirectory() {},
    async list() { return [{ name: 'index.php', type: 'file' }]; }
  };
  await assert.rejects(prepareEmptyHostingTarget(remote, '/existing'), /nicht leer/);
});
