import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createFullBackup } from '../lib/full-backup.mjs';
import { createSerialLock } from '../lib/serial-lock.mjs';

const sha = content => crypto.createHash('sha1').update(String(content)).digest('hex');
const SITE = { id: 'site-a', slug: 'a', domain: 'a.example', remote_root: '/www', exclude_patterns: ['cache/'] };
const repoPath = rel => 'sites/a/public/' + rel;

// In-memory stand-in for the backup repository: one branch, content-addressed entries.
function fakeRepo(initial = {}) {
  let head = 1;
  let tree = new Map(Object.entries(initial).map(([path, content]) => [path, { path, sha: sha(content) }]));
  const commits = [];
  const repo = {
    commits,
    get head() {
      return 'commit-' + head;
    },
    content: path => tree.get(path)?.content,
    has: path => tree.has(path),
    paths: () => [...tree.keys()].sort(),
    branchState: async () => ({
      headSha: 'commit-' + head,
      rootTreeSha: 'tree-' + head,
      treeMap: new Map(tree),
      branch: 'main'
    }),
    branchHeadMatches: async (_branch, expected) => expected === 'commit-' + head,
    commitTreeChanges: async (state, changes, message) => {
      assert.equal(state.headSha, 'commit-' + head, 'commit must be based on the current branch head');
      if (!changes.length) return { sha: state.headSha, treeSha: state.rootTreeSha };
      const next = new Map(tree);
      for (const change of changes) {
        if (change.sha === null) next.delete(change.path);
        else next.set(change.path, { path: change.path, sha: sha(change.content), content: change.content });
      }
      tree = next;
      head++;
      commits.push({ message, paths: changes.map(change => change.path) });
      return { sha: 'commit-' + head, treeSha: 'tree-' + head };
    },
    // What a change_apply snapshot does: write the file's current content for a few paths.
    snapshot(files) {
      const next = new Map(tree);
      for (const [path, content] of Object.entries(files)) {
        if (content === null) next.delete(path);
        else next.set(path, { path, sha: sha(content), content });
      }
      tree = next;
      head++;
    }
  };
  for (const [path, content] of Object.entries(initial)) tree.get(path).content = content;
  return repo;
}

// Website with nested paths; `onRead`/`onList` let a test interleave other writers.
function fakeRemote(files, hooks = {}) {
  const state = { files: { ...files }, closed: 0, connections: 0 };
  state.connect = async () => {
    state.connections++;
    return {
      async list(dir) {
        await hooks.onList?.(dir, state);
        const base = dir.replace(/^\/www\/?/, '');
        const names = new Map();
        for (const path of Object.keys(state.files)) {
          if (base && !path.startsWith(base + '/')) continue;
          const [name, ...rest] = path.slice(base ? base.length + 1 : 0).split('/');
          names.set(name, rest.length ? 'directory' : 'file');
        }
        return [...names].map(([name, type]) => ({ name, type }));
      },
      async read(path) {
        const rel = path.replace(/^\/www\//, '');
        const content = state.files[rel];
        await hooks.onRead?.(rel, state);
        return content;
      },
      async close() {
        state.closed++;
      }
    };
  };
  return state;
}

function setup({ repo, remote, lock = createSerialLock({ maxHoldMs: 1000 }), ...options }) {
  const recorded = [];
  const backup = createFullBackup({
    withLock: lock,
    branchState: repo.branchState,
    branchHeadMatches: repo.branchHeadMatches,
    connectSite: remote.connect,
    joinRemote: (root, path) => (path ? root + '/' + path : root),
    pathAllowed: path => !path.endsWith('.htpasswd'),
    gitBlobSha: sha,
    treeChangeFor: async (path, content) => ({ path, mode: '100644', type: 'blob', content: String(content) }),
    commitTreeChanges: repo.commitTreeChanges,
    recordBackup: async row => recorded.push(row),
    ...options
  });
  return { backup, recorded, lock };
}

test('a full backup commits changed, new and vanished files and leaves other websites alone', async () => {
  const repo = fakeRepo({
    [repoPath('index.php')]: 'old',
    [repoPath('same.css')]: 'same',
    [repoPath('gone.php')]: 'gone',
    'sites/b/public/index.php': 'other site',
    'sites/a2/public/index.php': 'similar slug'
  });
  const remote = fakeRemote({
    'index.php': 'new',
    'same.css': 'same',
    'img/logo.svg': '<svg/>',
    'cache/tmp.bin': 'skip',
    '.htpasswd': 'secret'
  });
  const { backup, recorded } = setup({ repo, remote });
  const result = await backup(SITE);
  assert.equal(result.files, 3);
  assert.equal(result.changed, true);
  assert.equal(result.commit, repo.head);
  assert.equal(repo.content(repoPath('index.php')), 'new');
  assert.equal(repo.content(repoPath('img/logo.svg')), '<svg/>');
  assert.equal(repo.has(repoPath('gone.php')), false);
  assert.equal(repo.has(repoPath('cache/tmp.bin')), false);
  assert.equal(repo.has(repoPath('.htpasswd')), false);
  assert.equal(repo.content('sites/b/public/index.php'), 'other site');
  assert.equal(repo.content('sites/a2/public/index.php'), 'similar slug');
  assert.match(repo.content('sites/a/.siteops.json'), /"fileCount": 3/);
  assert.deepEqual(recorded, [{ site: SITE, commit: result.commit, files: 3, changed: true }]);
  assert.equal(remote.closed, 1);

  // Nothing changed since: no new commit, but the run is still recorded.
  const again = await backup(SITE);
  assert.equal(again.changed, false);
  assert.equal(repo.commits.length, 1);
  assert.equal(recorded.length, 2);
});

test('the backup lock is free while the website is being read', async () => {
  const repo = fakeRepo({ [repoPath('a.php')]: 'old' });
  const order = [];
  let release;
  const reading = new Promise(resolve => (release = resolve));
  let started;
  const readStarted = new Promise(resolve => (started = resolve));
  const remote = fakeRemote(
    { 'a.php': 'new' },
    {
      onRead: async () => {
        started();
        await reading;
      }
    }
  );
  const { backup, lock } = setup({ repo, remote });
  const running = backup(SITE).then(() => order.push('backup committed'));
  await readStarted;
  assert.equal(lock.active(), null, 'no lock holder during the download');
  // A change on another website gets the lock immediately instead of queueing behind the download.
  await lock(async () => order.push('other change applied'));
  release();
  await running;
  assert.deepEqual(order, ['other change applied', 'backup committed']);
});

test('a change snapshot taken during the read wins over the older copy the backup already read', async () => {
  const repo = fakeRepo({ [repoPath('index.php')]: 'v1', [repoPath('z-last.php')]: 'z1' });
  const remote = fakeRemote(
    { 'index.php': 'v1-edited-outside', 'z-last.php': 'z2' },
    {
      onRead: (rel, state) => {
        // After the backup has read index.php, change_apply writes v2 and snapshots it.
        if (rel !== 'z-last.php') return;
        state.files['index.php'] = 'v2';
        repo.snapshot({ [repoPath('index.php')]: 'v2' });
      }
    }
  );
  const { backup } = setup({ repo, remote });
  const result = await backup(SITE);
  assert.equal(repo.content(repoPath('index.php')), 'v2', 'the newer snapshot must not be rolled back');
  assert.equal(repo.content(repoPath('z-last.php')), 'z2', 'untouched paths are still backed up');
  assert.equal(result.keptNewer, 1);
  assert.deepEqual(repo.commits.at(-1).paths.includes(repoPath('index.php')), false);
});

test('files created or deleted by a change during the read keep the state of that change', async () => {
  const repo = fakeRepo({ [repoPath('a.php')]: 'a', [repoPath('removed.php')]: 'r', [repoPath('z.php')]: 'z' });
  const remote = fakeRemote(
    { 'a.php': 'a', 'removed.php': 'r', 'z.php': 'z' },
    {
      onRead: (rel, state) => {
        if (rel !== 'z.php') return;
        // The listing is already taken: the backup never sees created.php ...
        state.files['created.php'] = 'c';
        // ... and has already read removed.php, which the change now deletes.
        delete state.files['removed.php'];
        repo.snapshot({ [repoPath('created.php')]: 'c', [repoPath('removed.php')]: null });
      }
    }
  );
  const { backup } = setup({ repo, remote });
  await backup(SITE);
  assert.equal(repo.content(repoPath('created.php')), 'c', 'a file the listing missed is not deleted');
  assert.equal(repo.has(repoPath('removed.php')), false, 'a deleted file is not restored');
  assert.equal(repo.content(repoPath('a.php')), 'a');
});

test("another website's commit during the read is preserved and does not disturb this backup", async () => {
  const repo = fakeRepo({ [repoPath('a.php')]: 'old', 'sites/b/public/x.php': 'b1' });
  const remote = fakeRemote({ 'a.php': 'new' }, { onRead: () => repo.snapshot({ 'sites/b/public/x.php': 'b2' }) });
  const { backup } = setup({ repo, remote });
  const result = await backup(SITE);
  assert.equal(repo.content('sites/b/public/x.php'), 'b2');
  assert.equal(repo.content(repoPath('a.php')), 'new');
  assert.equal(result.keptNewer, undefined);
});

test('a read that exceeds its deadline is abandoned, closes the connection and never commits', async () => {
  const repo = fakeRepo({ [repoPath('a.php')]: 'old' });
  let release;
  const stuck = new Promise(resolve => (release = resolve));
  const remote = fakeRemote({ 'a.php': 'new', 'b.php': 'new' }, { onRead: () => stuck });
  const { backup, recorded, lock } = setup({ repo, remote, readDeadlineMs: 30 });
  await assert.rejects(
    () => backup(SITE),
    error => error.code === 'LOCK_HOLD_TIMEOUT' && /a\.example/.test(error.message)
  );
  assert.ok(remote.closed >= 1, 'the hung connection is closed');
  release();
  await new Promise(resolve => setTimeout(resolve, 20));
  await lock(async () => {});
  assert.equal(repo.commits.length, 0, 'a late read must not commit');
  assert.equal(recorded.length, 0);
  assert.equal(repo.content(repoPath('a.php')), 'old');
});

test('a failed read commits nothing and the file limit still applies', async () => {
  const repo = fakeRepo({});
  const remote = fakeRemote({ 'a.php': '1', 'b.php': '2', 'c.php': '3' });
  const { backup, recorded } = setup({ repo, remote });
  await assert.rejects(() => backup(SITE, 2), /Backup stopped after 2 files/);
  assert.equal(repo.commits.length, 0);
  assert.equal(recorded.length, 0);
  assert.equal(remote.closed, 1);
});

test('scheduled backups step aside for a website with a recent change', () => {
  const { backup } = setup({ repo: fakeRepo({}), remote: fakeRemote({}) });
  assert.equal(backup.changedRecently('site-a'), false);
  backup.noteChange('site-a');
  assert.equal(backup.changedRecently('site-a'), true);
  assert.equal(backup.changedRecently('site-b'), false);
  assert.equal(backup.changedRecently('site-a', 0), false);
});
