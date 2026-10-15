import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cmsInstallRequestSchema } from '../lib/lorzcms.mjs';

const uuid = '11111111-1111-4111-8111-111111111111';
const base = {
  slug: 'demo-cms',
  name: 'Demo CMS',
  baseUrl: 'https://cms.example.de',
  version: '3.4.0',
  remoteRoot: '/cms/example',
  adminName: 'Admin',
  adminEmail: 'admin@example.de',
  adminPassword: 'safe-admin-password',
  database: { engine: 'sqlite' },
  publicRootReady: true
};

test('MCP installer accepts a saved server profile without transmitting FTP credentials', () => {
  const result = cmsInstallRequestSchema.safeParse({ ...base, profileId: uuid });
  assert.equal(result.success, true, JSON.stringify(result.error?.issues));
});

test('MCP installer accepts an existing website connection instead', () => {
  assert.equal(cmsInstallRequestSchema.safeParse({ ...base, existingSiteId: uuid }).success, true);
});

test('MCP installer rejects ambiguous or missing hosting connections', () => {
  assert.equal(cmsInstallRequestSchema.safeParse(base).success, false);
  assert.equal(cmsInstallRequestSchema.safeParse({ ...base, profileId: uuid, existingSiteId: uuid }).success, false);
});

test('MCP installer continues to accept explicit connection credentials', () => {
  const direct = { ...base, protocol: 'sftp', host: 'example.org', port: 22, username: 'user', password: 'secret' };
  assert.equal(cmsInstallRequestSchema.safeParse(direct).success, true);
});
