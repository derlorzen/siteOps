import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const trackedDirectories = ['lib', 'public', 'migrations', 'packages/lorzcms-core'];
const trackedFiles = ['app.mjs', 'package.json', 'package-lock.json', 'schema.sql'];
const commitNames = [
  'SITEOPS_GIT_SHA',
  'HOSTINGER_GIT_COMMIT',
  'GITHUB_SHA',
  'RENDER_GIT_COMMIT',
  'RAILWAY_GIT_COMMIT_SHA',
  'VERCEL_GIT_COMMIT_SHA'
];

async function sourceFingerprint(root) {
  const hash = createHash('sha256');
  async function visit(path) {
    const entries = await readdir(join(root, path), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (entry.isDirectory()) await visit(join(path, entry.name));
      else if (entry.isFile()) await add(join(path, entry.name));
    }
  }
  async function add(path) {
    hash.update(path.replaceAll('\\', '/') + '\0');
    hash.update(await readFile(join(root, path)));
    hash.update('\0');
  }
  for (const path of trackedFiles) await add(path);
  for (const path of trackedDirectories) await visit(path);
  return hash.digest('hex');
}

async function gitRevision(root) {
  try {
    const head = (await readFile(join(root, '.git', 'HEAD'), 'utf8')).trim();
    if (/^[a-f0-9]{40}$/i.test(head)) return head.toLowerCase();
    const match = /^ref: (refs\/[a-zA-Z0-9/_-]+)$/.exec(head);
    if (!match) return null;
    const ref = (await readFile(join(root, '.git', match[1]), 'utf8')).trim();
    return /^[a-f0-9]{40}$/i.test(ref) ? ref.toLowerCase() : null;
  } catch {
    return null;
  }
}

// The fingerprint is based on the deployed files, not a hardcoded GitHub main SHA.
// On hosts without .git or injected revision variables it remains accurate.
export async function resolveBuildInfo({
  root = fileURLToPath(new URL('../', import.meta.url)),
  environ = process.env
} = {}) {
  const dir = resolve(root);
  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  const fingerprint = await sourceFingerprint(dir);
  const environmentCommit = commitNames.map(name => environ[name]).find(x => /^[a-f0-9]{40}$/i.test(x || ''));
  const commit = (environmentCommit || (await gitRevision(dir)))?.toLowerCase() || null;
  return Object.freeze({
    // SemVer build metadata changes for every deployed source change, even with protected main.
    version: pkg.version + '+build.' + fingerprint.slice(0, 8),
    build: fingerprint.slice(0, 12),
    fingerprint,
    commit,
    commitShort: commit?.slice(0, 12) || null
  });
}
