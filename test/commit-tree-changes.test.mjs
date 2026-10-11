// commitTreeChanges is the piece applyPreview's pre/post-change snapshots both call to write
// to the backup repo. applyPreview now passes the state its pre-change snapshot already
// resolved into the post-change snapshot (see commitPaths' knownState parameter), skipping a
// second full recursive GET /git/trees of the whole backup repo - the applyTreeMapUpdates
// tests below cover the local patching that replaces that refetch, and the commitTreeChanges
// tests (with a mocked fetch) confirm the network call sequence itself is unchanged and that
// the returned treeSha is the one needed to chain into that patched state.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SITEOPS_MASTER_KEY ||= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
process.env.DASHBOARD_USER ||= 'test';
process.env.DASHBOARD_PASSWORD ||= 'test-password';
process.env.GITHUB_BACKUP_REPO ||= 'example/backups';
process.env.GITHUB_BACKUP_TOKEN ||= 'test-token';
process.env.SITEOPS_TEST_NO_AUTOSTART = '1';
const { applyTreeMapUpdates, commitTreeChanges } = await import('../app.mjs');

function fakeResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => headers[name.toLowerCase()] ?? null },
    text: async () => JSON.stringify(body)
  };
}

test('applyTreeMapUpdates adds, overwrites and removes entries without mutating the input map', () => {
  const original = new Map([
    ['sites/x/public/keep.php', { path: 'sites/x/public/keep.php', sha: 'unchanged' }],
    ['sites/x/public/old.php', { path: 'sites/x/public/old.php', sha: 'stale' }]
  ]);
  const next = applyTreeMapUpdates(original, [
    { path: 'sites/x/public/old.php', mode: '100644', type: 'blob', sha: 'new-sha' },
    { path: 'sites/x/public/added.php', mode: '100644', type: 'blob', sha: 'added-sha' },
    { path: 'sites/x/public/removed.php', sha: null }
  ]);
  assert.equal(next.get('sites/x/public/keep.php').sha, 'unchanged');
  assert.equal(next.get('sites/x/public/old.php').sha, 'new-sha');
  assert.equal(next.get('sites/x/public/added.php').sha, 'added-sha');
  assert.equal(next.has('sites/x/public/removed.php'), false);
  assert.equal(original.get('sites/x/public/old.php').sha, 'stale', 'original map must not be mutated');
});

test('applyTreeMapUpdates deleting a path that was never present is a no-op', () => {
  const original = new Map([['a', { path: 'a', sha: '1' }]]);
  const next = applyTreeMapUpdates(original, [{ path: 'never-existed', sha: null }]);
  assert.equal(next.size, 1);
  assert.equal(next.get('a').sha, '1');
});

test('commitTreeChanges returns the current state untouched and makes no network calls when there are no changes', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch');
  const state = { headSha: 'head1', rootTreeSha: 'tree1', treeMap: new Map() };
  const result = await commitTreeChanges(state, [], 'message');
  assert.deepEqual(result, { sha: 'head1', treeSha: 'tree1' });
  assert.equal(fetchMock.mock.calls.length, 0);
});

test('commitTreeChanges short-circuits after the tree call when the resulting tree is unchanged', async t => {
  const state = { headSha: 'head1', rootTreeSha: 'tree1', treeMap: new Map() };
  t.mock.method(globalThis, 'fetch', async () => fakeResponse({ sha: 'tree1' }));
  const result = await commitTreeChanges(state, [{ path: 'a', mode: '100644', type: 'blob', sha: null }], 'message');
  assert.deepEqual(result, { sha: 'head1', treeSha: 'tree1' });
});

test('commitTreeChanges creates a tree, commit and moves the ref, returning the new shas', async t => {
  const state = { headSha: 'head1', rootTreeSha: 'tree1', treeMap: new Map() };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    if (String(url).endsWith('/git/trees')) return fakeResponse({ sha: 'tree2' });
    if (String(url).endsWith('/git/commits')) return fakeResponse({ sha: 'commit2' });
    if (String(url).includes('/git/refs/heads/')) return fakeResponse({ object: { sha: 'commit2' } });
    throw new Error('Unexpected fetch call: ' + url);
  });
  const change = { path: 'sites/x/public/a.php', mode: '100644', type: 'blob', content: '<?php?>' };
  const result = await commitTreeChanges(state, [change], 'message');
  assert.deepEqual(result, { sha: 'commit2', treeSha: 'tree2' });
  assert.deepEqual(
    calls.map(c => c.method),
    ['POST', 'POST', 'PATCH']
  );
});
