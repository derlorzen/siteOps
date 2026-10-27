import crypto from 'node:crypto';
import * as z from 'zod/v4';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const MAX_FILE = 5 * 1024 * 1024;
const MAX_TOTAL = 64 * 1024 * 1024;
const fileSchema = z
  .object({
    path: z.string().min(1).max(240),
    bytes: z.number().int().min(1).max(MAX_FILE),
    sha256: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict();
export const cmsProjectBeginSchema = z
  .object({
    project: z.string().regex(/^[a-z][a-z0-9-]{0,59}$/),
    name: z.string().trim().min(1).max(190),
    seedPath: z.string().max(240),
    files: z.array(fileSchema).min(2).max(1000)
  })
  .strict();
export const cmsProjectFileSchema = z
  .object({
    packageId: z.uuid(),
    path: z.string().min(1).max(240),
    content: z
      .string()
      .min(4)
      .max(Math.ceil(MAX_FILE / 3) * 4)
  })
  .strict();
export const cmsProjectIdSchema = z.object({ packageId: z.uuid() }).strict();

export function projectFileAllowed(path, project, seedPath) {
  if (!/^[A-Za-z0-9_./-]+$/.test(path) || path.includes('..') || path.includes('//')) return false;
  if (path === seedPath || path === 'audit/asset-verification.json') return true;
  if (path.startsWith('projects/' + project + '/'))
    return new RegExp('^projects/' + project + '/[A-Za-z0-9_/-]+\\.(?:php|json)$').test(path);
  return /^public\/(?:assets\/[A-Za-z0-9_./-]+\.(?:css|js|svg|txt|woff2?|ttf|png|jpe?g|webp|gif|ico)|wp-content\/uploads\/[A-Za-z0-9_./-]+\.(?:svg|png|jpe?g|webp|gif|pdf))$/.test(
    path
  );
}

export function validateProjectManifest(input) {
  const value = cmsProjectBeginSchema.parse(input);
  if (value.project === 'base' || !new RegExp('^migration/' + value.project + '-content\\.json$').test(value.seedPath))
    throw new Error('Eigenständiger Projektname und zugehöriger Inhaltsexport erforderlich.');
  const seen = new Set();
  let bytes = 0;
  for (const file of value.files) {
    const folded = file.path.toLowerCase();
    if (seen.has(folded) || !projectFileAllowed(file.path, value.project, value.seedPath))
      throw new Error(
        'Unzulässiger oder doppelter Projektpfad: ' +
          file.path +
          '. Core, Konfiguration und Zugangsdaten sind ausgeschlossen.'
      );
    seen.add(folded);
    bytes += file.bytes;
  }
  if (bytes > MAX_TOTAL) throw new Error('Projekt ist größer als 64 MiB.');
  for (const required of ['projects/' + value.project + '/project.php', value.seedPath])
    if (!value.files.some(file => file.path === required)) throw new Error('Projektdatei oder Inhaltsexport fehlt.');
  value.files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return { manifest: value, digest: hash(JSON.stringify(value)), bytes };
}

export function projectSeedSummary(bytes, project) {
  const seed = JSON.parse(bytes.toString('utf8'));
  if (
    seed.format !== 'sitecms-content-v1' ||
    seed.project !== project ||
    !Array.isArray(seed.contents) ||
    seed.contents.length > 10000 ||
    !seed.contents.length ||
    (seed.site_configuration != null &&
      (typeof seed.site_configuration !== 'object' || Array.isArray(seed.site_configuration)))
  )
    throw new Error('Ungültiger oder nicht zum Projekt gehörender Inhaltsexport.');
  const ids = new Set(),
    paths = new Set(),
    routes = [];
  for (const item of seed.contents) {
    if (
      !item ||
      typeof item.id !== 'string' ||
      !item.id ||
      ids.has(item.id) ||
      typeof item.type !== 'string' ||
      !['published', 'draft', 'trash'].includes(item.status)
    )
      throw new Error('Ungültige oder doppelte Inhalte im Export.');
    ids.add(item.id);
    if (item.path != null) {
      if (
        typeof item.path !== 'string' ||
        !/^\/[A-Za-z0-9_/%.-]*$/.test(item.path) ||
        item.path.includes('..') ||
        item.path.includes('//') ||
        paths.has(item.path)
      )
        throw new Error('Ungültiger oder doppelter Seitenpfad im Export.');
      paths.add(item.path);
      if (item.status === 'published') routes.push(item.path);
    }
  }
  if (!routes.includes('/')) throw new Error('Der Inhaltsexport enthält keine veröffentlichte Startseite.');
  return { contents: seed.contents.length, routes: routes.sort() };
}

// Packages contain deployable project code and public media, never accounts,
// database files or local configuration. Each declared file is immutable by hash.
export function createCmsProjects({ q }) {
  async function record(id) {
    z.uuid().parse(id);
    const row = (await q('SELECT * FROM cms_project_packages WHERE id=?', [id])).rows[0];
    if (!row) throw new Error('Projektpaket nicht gefunden.');
    const parsed = validateProjectManifest(typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest);
    if (parsed.digest !== row.digest) throw new Error('Projektmanifest wurde verändert.');
    return { ...row, ...parsed };
  }
  async function begin(input) {
    const { manifest, digest, bytes } = validateProjectManifest(input);
    const id = crypto.randomUUID();
    await q('INSERT IGNORE INTO cms_project_packages(id,digest,manifest) VALUES(?,?,?)', [
      id,
      digest,
      JSON.stringify(manifest)
    ]);
    const stored = (await q('SELECT id FROM cms_project_packages WHERE digest=?', [digest])).rows[0];
    return {
      packageId: stored.id,
      digest,
      files: manifest.files.length,
      bytes,
      next: 'cms_project_file → cms_project_finish → cms_install with projectPackageId'
    };
  }
  async function put(input) {
    const { packageId, path, content } = cmsProjectFileSchema.parse(input);
    const pkg = await record(packageId);
    const declared = pkg.manifest.files.find(file => file.path === path);
    if (!declared) throw new Error('Datei gehört nicht zum Projektmanifest.');
    const bytes = Buffer.from(content, 'base64');
    if (bytes.toString('base64') !== content || bytes.length !== declared.bytes || hash(bytes) !== declared.sha256)
      throw new Error('Projektdatei: Größe, Base64 oder SHA-256 stimmt nicht.');
    await q(
      'INSERT INTO cms_project_files(package_id,path_hash,path,sha256,bytes,content) VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE content=VALUES(content)',
      [packageId, hash(path), path, declared.sha256, declared.bytes, bytes]
    );
    return { packageId, path, bytes: bytes.length, verified: true };
  }
  async function status(id) {
    const pkg = await record(id);
    const files = (await q('SELECT path,sha256,bytes FROM cms_project_files WHERE package_id=?', [id])).rows;
    const missing = pkg.manifest.files.filter(
      file =>
        !files.some(
          actual => actual.path === file.path && actual.sha256 === file.sha256 && Number(actual.bytes) === file.bytes
        )
    );
    return {
      packageId: id,
      project: pkg.manifest.project,
      digest: pkg.digest,
      ready: pkg.state === 'ready',
      files: pkg.manifest.files.length,
      uploaded: pkg.manifest.files.length - missing.length,
      missing: missing.map(file => file.path)
    };
  }
  async function load(id, { requireReady = true } = {}) {
    const pkg = await record(id);
    if (requireReady && pkg.state !== 'ready')
      throw new Error('Projektpaket zuerst mit cms_project_finish abschließen.');
    const rows = (await q('SELECT path,sha256,bytes,content FROM cms_project_files WHERE package_id=?', [id])).rows;
    const files = pkg.manifest.files.map(file => {
      const row = rows.find(row => row.path === file.path);
      const bytes = row && Buffer.from(row.content);
      if (!bytes || bytes.length !== file.bytes || hash(bytes) !== file.sha256)
        throw new Error('Projektdatei fehlt oder wurde verändert: ' + file.path);
      return { ...file, content: bytes };
    });
    const summary = projectSeedSummary(
      files.find(file => file.path === pkg.manifest.seedPath).content,
      pkg.manifest.project
    );
    return { id, ...pkg, files, summary };
  }
  async function finish(id) {
    const pkg = await load(id, { requireReady: false });
    await q("UPDATE cms_project_packages SET state='ready' WHERE id=?", [id]);
    return { packageId: id, digest: pkg.digest, ready: true, files: pkg.files.length, ...pkg.summary };
  }
  return { begin, put, status, finish, load };
}
