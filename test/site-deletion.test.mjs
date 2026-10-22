import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSiteDeletion, safeDeletionRoot } from '../lib/site-deletion.mjs';
import { renderSiteDeletion } from '../lib/site-deletion-ui.mjs';
function fixture(extra = {}) {
  const calls = [];
  const site = {
    id: 'one',
    slug: 'demo',
    name: 'Demo',
    domain: 'demo.example.com',
    deployment_mode: 'webspace',
    host: 'ftp',
    username: 'u',
    remote_root: '/demo'
  };
  const service = createSiteDeletion({
    getSite: async () => site,
    listSites: async () => [site],
    db: { query: async () => calls.push('entry') },
    connectSite: async () => ({ removeDirectory: async () => calls.push('folder'), close: async () => {} }),
    allInklService: {
      deletionTarget: async () => ({ hostname: site.domain }),
      deleteTarget: async () => calls.push('domain')
    },
    ...extra
  });
  return { service, calls, site };
}
test('explicit scope required; preview does not delete; entry-only preserves hosting', async () => {
  const { service, calls } = fixture();
  await assert.rejects(service.preview({ site: 'demo' }));
  const p = await service.preview({ site: 'demo', deleteFolder: false, deleteDomain: false });
  assert.deepEqual(calls, []);
  await service.confirm({ token: p.token, confirmation: 'demo' });
  assert.deepEqual(calls, ['entry']);
  await assert.rejects(service.confirm({ token: p.token, confirmation: 'demo' }));
});
test('folder and domain are deleted before the entry', async () => {
  const { service, calls } = fixture();
  const p = await service.preview({
    site: 'demo',
    deleteFolder: true,
    deleteDomain: true,
    accountId: '123e4567-e89b-42d3-a456-426614174000'
  });
  await service.confirm({ token: p.token, confirmation: 'demo' });
  assert.deepEqual(calls, ['folder', 'domain', 'entry']);
});
test('wrong confirmation, expiration and changed configuration block execution', async () => {
  let time = 0;
  const { service, calls, site } = fixture({ now: () => time });
  let p = await service.preview({ site: 'demo', deleteFolder: false, deleteDomain: false });
  await assert.rejects(service.confirm({ token: p.token, confirmation: 'wrong' }));
  p = await service.preview({ site: 'demo', deleteFolder: false, deleteDomain: false });
  time = 600001;
  await assert.rejects(service.confirm({ token: p.token, confirmation: 'demo' }));
  p = await service.preview({ site: 'demo', deleteFolder: false, deleteDomain: false });
  site.remote_root = '/changed';
  await assert.rejects(service.confirm({ token: p.token, confirmation: 'demo' }));
  assert.deepEqual(calls, []);
});
test('unsafe roots and overlapping websites are refused', async () => {
  for (const root of ['/', '/.', '/../demo', 'relative', '/demo/../other', '/demo\\other'])
    assert.throws(() => safeDeletionRoot(root));
  const { service } = fixture({
    listSites: async () => [{ id: 'other', name: 'Other', host: 'ftp', username: 'u', remote_root: '/demo/child' }]
  });
  await assert.rejects(service.preview({ site: 'demo', deleteFolder: true, deleteDomain: false }));
});
test('partial failure retains entry and reports completed operations', async () => {
  const { service, calls } = fixture({
    allInklService: {
      deletionTarget: async () => ({ hostname: 'demo.example.com' }),
      deleteTarget: async () => {
        throw Error('KAS failed');
      }
    }
  });
  const p = await service.preview({
    site: 'demo',
    deleteFolder: true,
    deleteDomain: true,
    accountId: '123e4567-e89b-42d3-a456-426614174000'
  });
  const result = await service.confirm({ token: p.token, confirmation: 'demo' });
  assert.equal(result.ok, false);
  assert.equal(result.entryRetained, true);
  assert.deepEqual(result.completed, ['folder']);
  assert.deepEqual(calls, ['folder']);
});
test('concurrent confirmation executes once', async () => {
  const { service, calls } = fixture();
  const p = await service.preview({ site: 'demo', deleteFolder: false, deleteDomain: false });
  const results = await Promise.allSettled([
    service.confirm({ token: p.token, confirmation: 'demo' }),
    service.confirm({ token: p.token, confirmation: 'demo' })
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.deepEqual(calls, ['entry']);
});
test('deletion page script parses and scope is not preselected', () => {
  const html = renderSiteDeletion({ slug: 'demo', name: 'Demo' }, [], s => s);
  assert.ok(!html.includes('checked'));
  new Function(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
});
