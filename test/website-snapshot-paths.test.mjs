import test from 'node:test';
import assert from 'node:assert/strict';
import { siteFilePath, normalizeChangeFiles } from '../lib/site-paths.mjs';
import { websiteToolResult } from '../lib/website-tool-result.mjs';

process.env.SITEOPS_MASTER_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
process.env.GITHUB_BACKUP_REPO = 'example/backups';
process.env.GITHUB_BACKUP_TOKEN = 'test-token';
process.env.SITEOPS_TEST_NO_AUTOSTART = '1';
const { commitPaths, readCommitMaybe, createPreview, FtpAdapter, db, gitBlobSha, mcpServer } =
  await import('../app.mjs');
import { createMcpHandler } from '@modelcontextprotocol/server';

test('website paths have one identity and cannot escape the root or alias two changes', () => {
  for (const value of ['/en/index.php', 'en/index.php', '\\en\\index.php', '///en//./index.php'])
    assert.equal(siteFilePath(value), 'en/index.php');
  for (const value of ['', '/', '.', '../index.php', 'en/../index.php', 'x\0.php'])
    assert.throws(() => siteFilePath(value));
  assert.throws(() => normalizeChangeFiles([{ path: '/index.php' }, { path: 'index.php' }]), /Duplicate/);
});

test('absolute-style preview paths use the existing full-backup entry for snapshot and restore', async t => {
  const content = Buffer.from('original website');
  const sha = gitBlobSha(content);
  const site = { slug: 'lorzen-de', remote_root: '/', protocol: 'ftp', encrypted_credentials: '' };
  // connectSite decrypts before opening FTP. A valid fixture keeps this on the real code path.
  const { encryptWithKey } = await import('../lib/crypto.mjs');
  site.encrypted_credentials = encryptWithKey({}, Buffer.alloc(32));
  const state = {
    branch: 'main',
    headSha: 'head',
    rootTreeSha: 'tree',
    treeMap: new Map([['sites/lorzen-de/public/index.php', { path: 'sites/lorzen-de/public/index.php', sha: 'old' }]])
  };
  const ftpPaths = [],
    treePaths = [];
  let closed = 0;
  t.mock.method(FtpAdapter, 'connect', async () => ({
    list: async () => [{ name: 'index.php', type: 'file' }],
    exists: async path => {
      ftpPaths.push(path);
      return true;
    },
    read: async path => {
      ftpPaths.push(path);
      return content;
    },
    close: async () => {
      closed++;
    }
  }));
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const path = new URL(url).pathname;
    let data;
    if (path.includes('/git/ref/heads/')) data = { object: { sha: 'head' } };
    else if (path.endsWith('/git/trees')) {
      const entries = JSON.parse(init.body).tree;
      for (const entry of entries) {
        assert.ok(!entry.path.includes('//'), 'GitHub rejects empty path segments');
        treePaths.push(entry.path);
      }
      data = { sha: 'updated-tree' };
    } else if (path.endsWith('/git/commits')) data = { sha: 'updated-head' };
    else if (path.includes('/git/refs/heads/')) data = {};
    else if (path.endsWith('/git/commits/restore-head')) data = { tree: { sha: 'restore-tree' } };
    else if (path.endsWith('/git/trees/restore-tree'))
      data = { tree: [{ path: 'sites/lorzen-de/public/index.php', sha, type: 'blob' }] };
    else if (path.endsWith('/git/blobs/' + sha)) data = { content: content.toString('base64') };
    else assert.fail('Unexpected GitHub request: ' + path);
    return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(data) };
  });
  const result = await commitPaths(site, ['/index.php'], 'pre snapshot', state);
  assert.deepEqual(treePaths, ['sites/lorzen-de/public/index.php']);
  assert.deepEqual(ftpPaths, ['/index.php', '/index.php']);
  assert.equal(result.state.treeMap.get('sites/lorzen-de/public/index.php').sha, sha);
  assert.equal(closed, 1);
  assert.deepEqual(await readCommitMaybe(site, '/index.php', 'restore-head'), content);
});

test('duplicate aliases are rejected before any database or FTP connection is opened', async t => {
  const query = t.mock.method(db, 'query', async () => assert.fail('must validate before database access'));
  await assert.rejects(createPreview('site', [{ path: '/a.php' }, { path: './a.php' }], 'duplicate'), /Duplicate/);
  assert.equal(query.mock.calls.length, 0);
});

test('real MCP backup and apply failures return actionable tool errors, never raw secrets or JSON-RPC Internal error', async t => {
  t.mock.method(db, 'query', async () => {
    throw new Error('database password=private-secret');
  });
  t.mock.method(console, 'error', () => {});
  const handler = createMcpHandler(() => mcpServer());
  t.after(() => handler.close());
  for (const [name, args] of [
    ['site_backup', { site: 'lorzen-de' }],
    ['change_apply', { preview_id: '26835a3a-4e57-4816-97d7-119a0e82000f' }]
  ]) {
    const response = await handler.fetch(
      new globalThis.Request('http://localhost/mcp', {
        method: 'POST',
        headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
      })
    );
    const text = await response.text();
    const body = JSON.parse(
      text
        .split('\n')
        .find(line => line.startsWith('data: '))
        .slice(6)
    );
    assert.equal(body.error, undefined);
    assert.equal(body.result.isError, true);
    assert.equal(JSON.parse(body.result.content[0].text).operation, name);
    assert.ok(!text.includes('private-secret'));
  }
});

test('GitHub rejection identifies the failing pre-snapshot phase without leaking exception content', async t => {
  t.mock.method(console, 'error', () => {});
  const result = await websiteToolResult('change_apply', async () => {
    throw Object.assign(new Error('GitHub POST /git/trees failed (422): token=private-secret'), {
      siteopsStage: 'pre_snapshot'
    });
  });
  assert.equal(result.isError, true);
  const detail = JSON.parse(result.content[0].text);
  assert.equal(detail.stage, 'pre_snapshot');
  assert.equal(detail.code, 'GITHUB_BACKUP_FAILED');
  assert.ok(!JSON.stringify(result).includes('private-secret'));
});
