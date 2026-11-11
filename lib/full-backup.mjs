// Full backup of one website into the shared backup repository.
//
// The slow part of a full backup is reading every file over FTP/SFTP. That used to happen
// while holding the global backup lock, so a change_apply on any website waited until the
// whole download of some other website had finished - up to the 20 minute hold limit.
//
// Now the files are read WITHOUT the lock. The lock is only taken for the final commit, which
// is a handful of GitHub calls. Because other writers can commit while the files are being
// read, the commit step merges against the branch as it is at that moment:
//
//   - Paths of other websites are never touched (the commit is based on the current tree).
//   - A path of this website that changed in the repository since the read started was
//     written by a change snapshot that is newer than (or as new as) our copy. The repository
//     version wins; our possibly older copy is dropped.
//   - A path that appeared in the repository since the read started is not deleted just
//     because the directory listing was taken before the file existed.
//
// A read that exceeds its deadline is abandoned and can never commit afterwards.

export function createFullBackup({
  withLock,
  branchState,
  branchHeadMatches,
  connectSite,
  joinRemote,
  pathAllowed,
  gitBlobSha,
  treeChangeFor,
  commitTreeChanges,
  recordBackup,
  readDeadlineMs = 20 * 60 * 1000,
  commitLockMs = 3 * 60 * 1000
}) {
  // Per-site marker for recent change snapshots, so the scheduler can let interactive
  // changes go first instead of starting a download of the same website next to them.
  const lastChangeAt = new Map();

  async function readSite(site, base, maxFiles, control) {
    const remote = await connectSite(site);
    control.close = () => Promise.resolve(remote.close()).catch(() => {});
    const publicPrefix = 'sites/' + site.slug + '/public/';
    const patterns = Array.isArray(site.exclude_patterns) ? site.exclude_patterns : [];
    const excluded = path => patterns.some(pattern => path.includes(pattern));
    const seen = new Map();
    let count = 0;
    async function addFile(rel) {
      if (++count > maxFiles) throw new Error('Backup stopped after ' + maxFiles + ' files');
      const repoPath = publicPrefix + rel;
      const content = await remote.read(joinRemote(site.remote_root, rel));
      const sha = gitBlobSha(content);
      // Blobs are content-addressed; preparing them does not move the branch and needs no lock.
      const change = base.treeMap.get(repoPath)?.sha === sha ? null : await treeChangeFor(repoPath, content);
      seen.set(repoPath, { sha, change });
    }
    async function walk(rel = '') {
      for (const entry of await remote.list(joinRemote(site.remote_root, rel))) {
        if (control.abandoned) throw new Error('Backup read abandoned');
        const child = rel ? rel + '/' + entry.name : entry.name;
        if (excluded(child) || !pathAllowed(child)) continue;
        if (entry.type === 'directory') await walk(child);
        else if (entry.type === 'file') await addFile(child);
      }
    }
    try {
      await walk();
      return { seen, count };
    } finally {
      await control.close();
    }
  }

  function readWithDeadline(site, base, maxFiles) {
    const control = { abandoned: false, close: async () => {} };
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        control.abandoned = true;
        // Closing the connection also unblocks a read stuck on a dead data socket.
        control.close();
        reject(
          Object.assign(
            new Error('full backup ' + site.domain + ' did not finish reading within ' + readDeadlineMs + ' ms'),
            { code: 'LOCK_HOLD_TIMEOUT' }
          )
        );
      }, readDeadlineMs);
    });
    const read = readSite(site, base, maxFiles, control);
    read.catch(() => {}); // the deadline may already have rejected
    return Promise.race([read, deadline]).finally(() => clearTimeout(timer));
  }

  // Decide, against the branch as it is now, what this backup may still write.
  function mergeChanges(site, base, fresh, read) {
    const prefix = 'sites/' + site.slug + '/';
    const changes = [];
    let keptNewer = 0;
    const movedSinceRead = path => base.treeMap.get(path)?.sha !== fresh.treeMap.get(path)?.sha;
    for (const [path, file] of read.seen) {
      if (fresh.treeMap.get(path)?.sha === file.sha) continue;
      if (movedSinceRead(path)) {
        keptNewer++;
        continue;
      }
      // Reached only when the file differs from the tree the read started from, so its tree
      // entry was prepared during the read.
      changes.push(file.change);
    }
    const metaPath = prefix + '.siteops.json';
    const meta = Buffer.from(JSON.stringify({ domain: site.domain, fileCount: read.count }, null, 2) + '\n');
    const metaChanged = fresh.treeMap.get(metaPath)?.sha !== gitBlobSha(meta);
    for (const path of fresh.treeMap.keys()) {
      if (!path.startsWith(prefix) || path === metaPath || read.seen.has(path)) continue;
      if (movedSinceRead(path)) keptNewer++;
      else changes.push({ path, mode: '100644', type: 'blob', sha: null });
    }
    return { changes, keptNewer, meta: metaChanged ? { path: metaPath, content: meta } : null };
  }

  async function fullBackup(site, maxFiles = 10000) {
    const base = await branchState();
    const read = await readWithDeadline(site, base, maxFiles);
    return withLock(
      async () => {
        const fresh = (await branchHeadMatches(base.branch, base.headSha)) ? base : await branchState();
        const merged = mergeChanges(site, base, fresh, read);
        const changes = merged.changes;
        if (merged.meta) changes.push(await treeChangeFor(merged.meta.path, merged.meta.content));
        const { sha: commit } = await commitTreeChanges(fresh, changes, '[' + site.domain + '] Full backup');
        const changed = commit !== fresh.headSha;
        await recordBackup({ site, commit, files: read.count, changed });
        return { commit, files: read.count, changed, ...(merged.keptNewer ? { keptNewer: merged.keptNewer } : {}) };
      },
      { maxHoldMs: commitLockMs, label: 'full backup commit ' + site.domain }
    );
  }

  fullBackup.noteChange = siteId => lastChangeAt.set(siteId, Date.now());
  fullBackup.changedRecently = (siteId, windowMs = 2 * 60 * 1000) =>
    Date.now() - (lastChangeAt.get(siteId) ?? -Infinity) < windowMs;
  return fullBackup;
}
