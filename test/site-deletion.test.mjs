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

test('a child website can be deleted while parent and siblings remain untouched', async () => {
  const { service, calls } = fixture({
    listSites: async () => [
      { id: 'lorzen', name: 'Lorzen', host: 'ftp', username: 'u', remote_root: '/' },
      { id: 'sibling', name: 'Sibling', host: 'ftp', username: 'u', remote_root: '/another' }
    ]
  });
  const p = await service.preview({ site: 'demo', deleteFolder: true, deleteDomain: false });
  assert.equal(p.folder, '/demo');
  await service.confirm({ token: p.token, confirmation: 'demo' });
  assert.deepEqual(calls, ['folder', 'entry']);
});

test('nested parent website does not prevent deleting its child', async () => {
  const f = fixture({
    listSites: async () => [{ id: 'lorzen', name: 'Lorzen', host: 'ftp', username: 'u', remote_root: '/web' }]
  });
  f.site.remote_root = '/web/demo';
  assert.equal(
    (await f.service.preview({ site: 'demo', deleteFolder: true, deleteDomain: false })).folder,
    '/web/demo'
  );
});

test('HTTP deletion conflicts return an actionable client error instead of Internal Server Error', async () => {
  const { default: Fastify } = await import('fastify');
  const app = Fastify();
  const { service } = fixture({
    listSites: async () => [{ id: 'child', name: 'Child', host: 'ftp', username: 'u', remote_root: '/demo/child' }]
  });
  app.post('/preview', req => service.preview(req.body));
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/preview',
      payload: {
        site: 'demo',
        deleteFolder: true,
        deleteDomain: false
      }
    });
    assert.equal(response.statusCode, 409);
    assert.match(response.json().message, /Child/);
  } finally {
    await app.close();
  }
});

test('unrelated monitoring metadata does not invalidate a deletion preview', async () => {
  const { service, site, calls } = fixture();
  site.updated_at = '2026-10-22T20:00:00Z';
  const p = await service.preview({ site: 'demo', deleteFolder: true, deleteDomain: false });
  site.updated_at = '2026-10-22T20:01:00Z';
  site.monitor_enabled = false;
  assert.equal((await service.confirm({ token: p.token, confirmation: 'demo' })).ok, true);
  assert.deepEqual(calls, ['folder', 'entry']);
});

test('equivalent database rows with different property order have the same deletion identity', async () => {
  const { site } = fixture();
  let reads = 0;
  const { service } = fixture({
    getSite: async () => (++reads === 1 ? { ...site } : Object.fromEntries(Object.entries(site).reverse()))
  });
  const p = await service.preview({ site: 'demo', deleteFolder: false, deleteDomain: false });
  assert.equal((await service.confirm({ token: p.token, confirmation: 'demo' })).ok, true);
});

test('confirmation tolerates surrounding whitespace and wrong input can be corrected', async () => {
  const { service, calls } = fixture();
  const p = await service.preview({ site: 'demo', deleteFolder: false, deleteDomain: false });
  await assert.rejects(
    service.confirm({ token: p.token, confirmation: 'wrong' }),
    error => error.message.includes('demo') && !error.message.includes('Website wurde geändert')
  );
  assert.deepEqual(calls, []);
  assert.equal((await service.confirm({ token: p.token, confirmation: ' demo ' })).ok, true);
});

test('full displayed website name can confirm a deletion', async () => {
  const { service, site, calls } = fixture();
  site.name = 'Containerdienst Schartau';
  site.slug = 'containerdienst-schartau';
  const p = await service.preview({ site: site.slug, deleteFolder: false, deleteDomain: false });
  assert.equal((await service.confirm({ token: p.token, confirmation: ' Containerdienst Schartau ' })).ok, true);
  assert.deepEqual(calls, ['entry']);
});

test('changed FTP destination or credentials still invalidates confirmation', async () => {
  for (const field of ['host', 'username', 'port', 'protocol', 'encrypted_credentials', 'domain']) {
    const { service, site, calls } = fixture();
    const p = await service.preview({ site: 'demo', deleteFolder: true, deleteDomain: false });
    site[field] = 'changed';
    await assert.rejects(service.confirm({ token: p.token, confirmation: 'demo' }), /Löschziel oder Verbindungsdaten/);
    assert.deepEqual(calls, []);
  }
});
