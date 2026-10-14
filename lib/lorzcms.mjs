import crypto from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import * as z from 'zod/v4';
import { joinRemote } from './crypto.mjs';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const versionPattern = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;
const pathPattern =
  /^(?:src\/[a-zA-Z0-9_/-]+\.php|runtime\/(?:bootstrap|index)\.php|assets\/(?:[a-zA-Z0-9._-]+\.(?:css|js|svg|txt)|fonts\/[a-zA-Z0-9._-]+\.(?:woff2?|ttf|txt)))$/;
const requiredPaths = [
  'src/Store.php',
  'src/Access.php',
  'src/Admin.php',
  'src/Content.php',
  'runtime/bootstrap.php',
  'runtime/index.php'
];
const agentDir = new URL('./lorzcms/', import.meta.url);
const coreDir = new URL('../packages/lorzcms-core/', import.meta.url);
const uuid = () => crypto.randomUUID();

export function cmsOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Eine HTTPS-Domain ohne Unterpfad ist erforderlich.');
  }
  return url.origin;
}

export function validateRelease(input, { legacy = false } = {}) {
  if (
    !input ||
    input.format !== 'lorzcms-release-v1' ||
    (!versionPattern.test(input.version) && !(legacy && /^legacy-[a-f0-9]{12}$/.test(input.version)))
  ) {
    throw new Error('Ungültige LorzCMS-Version.');
  }
  if (
    input.schemaVersion !== 1 ||
    !Array.isArray(input.compatibleSchemas) ||
    !input.compatibleSchemas.includes(1) ||
    input.compatibleSchemas.some(x => x !== 1)
  ) {
    throw new Error('Diese Datenbankversion wird noch nicht unterstützt.');
  }
  if (
    !/^8\.[3-9](?:\.\d+)?$/.test(input.minPhp) ||
    typeof input.notes !== 'string' ||
    input.notes.length > 10000 ||
    !Array.isArray(input.files) ||
    input.files.length > 500
  ) {
    throw new Error('Ungültiges Release-Manifest.');
  }
  let size = 0;
  const seen = new Set();
  const files = input.files
    .map(file => {
      if (
        !pathPattern.test(file.path) ||
        file.path.includes('..') ||
        seen.has(file.path) ||
        typeof file.content !== 'string' ||
        file.content.length > 7 * 1024 * 1024
      ) {
        throw new Error('Unzulässige oder doppelte Paketdatei.');
      }
      seen.add(file.path);
      const bytes = Buffer.from(file.content, 'base64');
      size += bytes.length;
      if (
        bytes.toString('base64') !== file.content ||
        bytes.length > 5 * 1024 * 1024 ||
        size > 12 * 1024 * 1024 ||
        digest(bytes) !== file.sha256
      ) {
        throw new Error('Paket-Prüfsumme oder Dateigröße ungültig.');
      }
      return { path: file.path, sha256: file.sha256, content: file.content };
    })
    .sort((a, b) => a.path.localeCompare(b.path, 'en'));
  if (requiredPaths.some(path => !seen.has(path))) throw new Error('Das CMS-Paket ist unvollständig.');
  const manifest = {
    format: 'lorzcms-release-v1',
    version: input.version,
    schemaVersion: input.schemaVersion,
    compatibleSchemas: input.compatibleSchemas,
    minPhp: input.minPhp,
    notes: input.notes,
    files: files.map(({ path, sha256 }) => ({ path, sha256 }))
  };
  const manifestText = JSON.stringify(manifest);
  return { ...manifest, files, digest: digest(manifestText), manifestText };
}

export async function bundledRelease() {
  const metadata = JSON.parse(await readFile(new URL('version.json', coreDir), 'utf8'));
  const files = [];
  async function walk(path) {
    for (const entry of await readdir(new URL(path + '/', coreDir), { withFileTypes: true })) {
      const name = path + '/' + entry.name;
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile()) {
        const bytes = await readFile(new URL(name, coreDir));
        files.push({ path: name, sha256: digest(bytes), content: bytes.toString('base64') });
      }
    }
  }
  for (const path of ['src', 'assets', 'runtime']) await walk(path);
  return validateRelease({ format: 'lorzcms-release-v1', ...metadata, files });
}

export const cmsInstallSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9-]{1,100}$/),
    name: z.string().trim().min(1).max(190),
    baseUrl: z
      .string()
      .url()
      .refine(value => {
        try {
          cmsOrigin(value);
          return true;
        } catch {
          return false;
        }
      }, 'Eine HTTPS-Domain ohne Unterpfad ist erforderlich.'),
    version: z.string().regex(versionPattern),
    protocol: z.enum(['sftp', 'ftps', 'ftp']),
    host: z.string().min(1).max(255),
    port: z.coerce.number().int().min(1).max(65535),
    username: z.string().min(1).max(255),
    password: z.string().max(4096).optional(),
    privateKey: z.string().max(16384).optional(),
    passphrase: z.string().max(4096).optional(),
    remoteRoot: z
      .string()
      .min(2)
      .max(500)
      .refine(
        x => x.startsWith('/') && !x.split(/[\\/]/).includes('..') && !x.includes('\\'),
        'Absolutes Zielverzeichnis erforderlich.'
      ),
    adminName: z.string().trim().min(1).max(190),
    adminEmail: z.email().max(190),
    adminPassword: z
      .string()
      .refine(x => Buffer.byteLength(x) >= 12 && Buffer.byteLength(x) <= 72, 'Passwort muss 12–72 Bytes lang sein.'),
    database: z.discriminatedUnion('engine', [
      z.object({ engine: z.literal('sqlite') }),
      z.object({
        engine: z.literal('mysql'),
        host: z.string().regex(/^[a-zA-Z0-9_.-]+$/),
        name: z.string().regex(/^[a-zA-Z0-9_-]+$/),
        user: z.string().min(1).max(190),
        password: z.string().max(4096)
      })
    ]),
    publicRootReady: z.literal(true),
    runAt: z.iso.datetime({ offset: true }).optional()
  })
  .refine(x => Boolean(x.password || x.privateKey), 'Hosting-Zugang erforderlich.');

export const cmsScheduleSchema = z.object({
  installations: z.array(z.uuid()).min(1).max(100),
  version: z.string().regex(versionPattern),
  runAt: z.iso.datetime({ offset: true }).optional()
});

export function cmsRunAt(value, now = new Date()) {
  const date = value ? new Date(value) : now;
  if (!Number.isFinite(date.getTime())) throw new Error('Ungültiger Zeitpunkt.');
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

function publicInstallation(row) {
  return {
    id: row.id,
    siteId: row.site_id,
    slug: row.slug,
    name: row.name,
    baseUrl: row.base_url,
    version: row.version,
    state: row.state,
    lastCheckedAt: row.last_checked_at
  };
}
function parse(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}
function publicJob(row) {
  return {
    id: row.id,
    installationId: row.installation_id,
    name: row.name,
    version: row.release_version,
    previousVersion: row.previous_version,
    kind: row.kind,
    state: row.state,
    runAt: row.run_at,
    phase: row.phase,
    result: row.result ? parse(row.result) : null,
    error: row.error,
    finishedAt: row.finished_at
  };
}
function phpString(value) {
  return "'" + String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'") + "'";
}

export function createCmsController({
  q,
  db,
  getSite,
  createSite,
  listSites,
  connectSite,
  encrypt,
  decrypt,
  request = fetch
}) {
  let ticking = false;
  async function installation(id) {
    const row = (await q('select * from cms_installations where id=?', [id])).rows[0];
    if (!row) throw new Error('CMS-Installation nicht gefunden.');
    return row;
  }
  async function release(version) {
    const row = (await q('select * from cms_releases where version=?', [version])).rows[0];
    if (!row) throw new Error('CMS-Version nicht freigegeben.');
    const pkg = validateRelease(parse(row.package));
    if (pkg.digest !== row.digest) throw new Error('Gespeicherte Version wurde verändert.');
    return pkg;
  }
  async function importRelease(input) {
    const pkg = validateRelease(input);
    // Duplicate imports with the same digest are harmless; versions cannot be changed.
    const existing = (await q('select digest from cms_releases where version=?', [pkg.version])).rows[0];
    if (existing && existing.digest !== pkg.digest)
      throw new Error('Diese Version existiert bereits mit anderem Inhalt. Neue Versionsnummer verwenden.');
    if (!existing)
      await q('insert into cms_releases(version,digest,package,notes) values(?,?,?,?)', [
        pkg.version,
        pkg.digest,
        JSON.stringify(pkg),
        pkg.notes
      ]);
    return { version: pkg.version, digest: pkg.digest, notes: pkg.notes };
  }
  async function overview() {
    const [releases, installations, jobs, sites] = await Promise.all([
      q('select version,digest,notes,created_at from cms_releases order by created_at desc'),
      q('select c.*,s.name,s.slug from cms_installations c join sites s on s.id=c.site_id order by s.name'),
      q(
        "select j.*,DATE_FORMAT(j.run_at,'%Y-%m-%dT%H:%i:%s.%fZ') run_at,s.name from cms_jobs j join cms_installations c on c.id=j.installation_id join sites s on s.id=c.site_id order by j.created_at desc limit 100"
      ),
      listSites()
    ]);
    return {
      releases: releases.rows,
      installations: installations.rows.map(publicInstallation),
      jobs: jobs.rows.map(publicJob),
      existingSites: sites.map(s => ({
        id: s.id,
        slug: s.slug,
        name: s.name,
        domain: s.domain,
        deploymentMode: s.deployment_mode,
        protocol: s.protocol,
        host: s.host,
        port: s.port,
        username: s.username,
        remoteRoot: s.remote_root
      }))
    };
  }
  async function agentCall(inst, body = null) {
    const response = await request(cmsOrigin(inst.base_url) + '/siteops.php', {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(120000),
      headers: {
        authorization: 'Bearer ' + decrypt(inst.agent_credentials).key,
        ...(body ? { 'content-type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    // Remote errors may contain hosting details. Keep them out of logs and job records.
    if (!response.ok)
      throw new Error('CMS-Anschluss meldet HTTP ' + response.status + '. Domain-Ziel, PHP und Konfiguration prüfen.');
    const data = await response.json();
    if (data.instanceId !== inst.id) throw new Error('Domain zeigt auf eine andere CMS-Installation.');
    return data;
  }
  async function emptyTarget(remote, root) {
    let entries;
    try {
      entries = await remote.list(root);
    } catch {
      const parent = root.slice(0, root.lastIndexOf('/')) || '/';
      const siblings = await remote.list(parent);
      if (siblings.some(x => x.name === root.slice(root.lastIndexOf('/') + 1)))
        throw new Error('Ziel ist kein leeres Verzeichnis.');
      return;
    }
    if (entries.some(x => !['.', '..'].includes(x.name)))
      throw new Error('Erstinstallation benötigt ein leeres Zielverzeichnis. Bestehendes CMS stattdessen anschließen.');
  }
  async function insertJob(inst, kind, version, payload = null, runAt = null) {
    const id = uuid();
    await q(
      'insert into cms_jobs(id,installation_id,release_version,previous_version,kind,run_at,encrypted_payload) values(?,?,?,?,?,?,?)',
      [id, inst.id, version, inst.version || null, kind, cmsRunAt(runAt), payload ? encrypt(payload) : null]
    );
    return { jobId: id, installationId: inst.id, state: 'queued' };
  }
  async function cancelledEnrollment(inst, kind) {
    if (inst.version) throw new Error('Dieses CMS ist bereits angeschlossen.');
    const open = (
      await q("select id from cms_jobs where installation_id=? and state in ('queued','running','needs_attention')", [
        inst.id
      ])
    ).rows;
    if (open.length) throw new Error('Für diese Installation ist noch ein Auftrag offen.');
    const job = (
      await q(
        "select * from cms_jobs where installation_id=? and kind=? and state='cancelled' order by created_at desc limit 1",
        [inst.id, kind]
      )
    ).rows[0];
    if (!job) throw new Error('Für diese Website gibt es keine abgebrochene Einrichtung.');
    return job;
  }
  async function resumeEnrollment(inst, job, version, payload = null, runAt = null) {
    const changed = await q(
      "update cms_jobs set state='queued',phase='queued',release_version=?,encrypted_payload=?,error=null,finished_at=null,run_at=? where id=? and state='cancelled'",
      [version, payload ? encrypt(payload) : null, cmsRunAt(runAt), job.id]
    );
    if (!changed.meta.affectedRows) throw new Error('Der Auftrag wurde bereits erneut gestartet.');
    await q("update cms_installations set state='pending' where id=?", [inst.id]);
    return { jobId: job.id, installationId: inst.id, state: 'queued' };
  }
  async function create(input) {
    const x = cmsInstallSchema.parse(input);
    x.baseUrl = cmsOrigin(x.baseUrl);
    await release(x.version);
    const existingSite = (await listSites()).find(site => site.slug === x.slug);
    let existingInstallation = null,
      cancelledJob = null;
    if (existingSite) {
      existingInstallation = (await q('select * from cms_installations where site_id=?', [existingSite.id])).rows[0];
      if (!existingInstallation) throw new Error('Dieser Kurzname gehört bereits zu einer anderen Website.');
      cancelledJob = await cancelledEnrollment(existingInstallation, 'install');
      if (x.baseUrl !== existingInstallation.base_url || x.remoteRoot !== existingSite.remote_root)
        throw new Error('Für den Neustart dieselbe Website-Adresse und dasselbe CMS-Verzeichnis verwenden.');
    }
    const candidate = {
      deployment_mode: 'webspace',
      protocol: x.protocol,
      host: x.host,
      port: x.port,
      username: x.username,
      remote_root: x.remoteRoot,
      encrypted_credentials: encrypt({ password: x.password, privateKey: x.privateKey, passphrase: x.passphrase })
    };
    const remote = await connectSite(candidate);
    try {
      const ownerPath = joinRemote(x.remoteRoot, '.lorzcms/owner.json');
      if (existingInstallation && (await remote.exists(ownerPath))) {
        const owner = JSON.parse((await remote.read(ownerPath)).toString());
        if (owner.instanceId !== existingInstallation.id)
          throw new Error('Das Ziel gehört zu einer anderen Installation.');
      } else await emptyTarget(remote, x.remoteRoot);
    } finally {
      await remote.close();
    }
    const payload = {
      siteName: x.name,
      adminName: x.adminName,
      adminEmail: x.adminEmail,
      adminPassword: x.adminPassword,
      database: x.database
    };
    if (existingInstallation) {
      await q('update sites set name=?,protocol=?,host=?,port=?,username=?,encrypted_credentials=? where id=?', [
        x.name,
        x.protocol,
        x.host,
        x.port,
        x.username,
        candidate.encrypted_credentials,
        existingSite.id
      ]);
      const job = await resumeEnrollment(existingInstallation, cancelledJob, x.version, payload, x.runAt);
      return { ...job, siteId: existingSite.id };
    }
    const site = await createSite({
      ...x,
      deploymentMode: 'webspace',
      domain: new URL(x.baseUrl).hostname,
      siteType: 'php',
      monitorUrl: x.baseUrl,
      monitorEnabled: false,
      backupEnabled: false
    });
    const inst = {
      id: uuid(),
      site_id: site.id,
      base_url: x.baseUrl,
      agent_credentials: encrypt({ key: crypto.randomBytes(32).toString('hex') }),
      version: null
    };
    await q('insert into cms_installations(id,site_id,base_url,agent_credentials) values(?,?,?,?)', [
      inst.id,
      site.id,
      inst.base_url,
      inst.agent_credentials
    ]);
    await q('update sites set exclude_patterns=? where id=?', [
      JSON.stringify(['.git', '.lorzcms', 'config', 'var', 'node_modules']),
      site.id
    ]);
    const job = await insertJob(inst, 'install', x.version, payload, x.runAt);
    return { ...job, siteId: site.id };
  }
  async function attach(input) {
    const x = z
      .object({ site: z.string(), baseUrl: z.string().transform(cmsOrigin), publicRootReady: z.literal(true) })
      .parse(input);
    const site = await getSite(x.site);
    if (site.deployment_mode === 'hostinger_git')
      throw new Error('Der CMS-Anschluss benötigt derzeit einen direkten FTP-/SFTP-Zugang.');
    const existing = (await q('select * from cms_installations where site_id=?', [site.id])).rows[0];
    if (existing) {
      const cancelled = await cancelledEnrollment(existing, 'adopt');
      if (x.baseUrl !== existing.base_url) throw new Error('Für den Neustart dieselbe Website-Adresse verwenden.');
      return resumeEnrollment(existing, cancelled, null);
    }
    await q('update sites set exclude_patterns=? where id=?', [
      JSON.stringify([
        ...new Set([
          ...(Array.isArray(site.exclude_patterns) ? site.exclude_patterns : []),
          '.lorzcms',
          'config',
          'var'
        ])
      ]),
      site.id
    ]);
    const inst = {
      id: uuid(),
      site_id: site.id,
      base_url: x.baseUrl,
      agent_credentials: encrypt({ key: crypto.randomBytes(32).toString('hex') }),
      version: null
    };
    await q('insert into cms_installations(id,site_id,base_url,agent_credentials) values(?,?,?,?)', [
      inst.id,
      site.id,
      inst.base_url,
      inst.agent_credentials
    ]);
    return insertJob(inst, 'adopt', null);
  }
  async function schedule(input) {
    const x = cmsScheduleSchema.parse(input);
    await release(x.version);
    const ids = [...new Set(x.installations)];
    const installations = await Promise.all(ids.map(installation));
    for (const inst of installations)
      if (inst.state !== 'ready' || !inst.version)
        throw new Error('Alle ausgewählten Installationen müssen bereit sein.');
    if (installations.some(inst => inst.version === x.version))
      throw new Error('Die ausgewählte Version ist bereits auf einer Website aktiv.');
    const jobs = installations.map(inst => ({ jobId: uuid(), installationId: inst.id, state: 'queued' }));
    const values = jobs.flatMap((job, index) => [
      job.jobId,
      job.installationId,
      x.version,
      installations[index].version,
      'update',
      cmsRunAt(x.runAt)
    ]);
    await q(
      'insert into cms_jobs(id,installation_id,release_version,previous_version,kind,run_at) values ' +
        jobs.map(() => '(?,?,?,?,?,?)').join(','),
      values
    );
    return { jobs };
  }
  async function rollback(jobId, runAt = null) {
    const job = (await q('select * from cms_jobs where id=?', [jobId])).rows[0];
    if (!job || job.state !== 'succeeded' || !job.previous_version)
      throw new Error('Dieser Auftrag hat keinen verfügbaren Rückfallstand.');
    const inst = await installation(job.installation_id);
    if (inst.version !== job.release_version)
      throw new Error('Die Website wurde seit diesem Auftrag weiter aktualisiert.');
    return insertJob(inst, 'rollback', job.previous_version, null, runAt);
  }
  async function cancel(id) {
    const changed = await q(
      "update cms_jobs set state='cancelled',encrypted_payload=null,finished_at=UTC_TIMESTAMP(3) where id=? and state in ('queued','needs_attention')",
      [id]
    );
    if (!changed.meta.affectedRows)
      throw new Error('Nur wartende oder unterbrochene Aufträge können abgebrochen werden.');
    return { ok: true };
  }
  async function retry(id) {
    const changed = await q(
      "update cms_jobs set state='queued',phase='queued',error=null,run_at=UTC_TIMESTAMP(3) where id=? and state='needs_attention'",
      [id]
    );
    if (!changed.meta.affectedRows) throw new Error('Nur unterbrochene Aufträge können erneut gestartet werden.');
    return { ok: true };
  }
  async function inspect(id) {
    const inst = await installation(id);
    const running = (await q("select id from cms_jobs where installation_id=? and state='running'", [id])).rows;
    if (running.length) throw new Error('Ein CMS-Auftrag läuft noch.');
    const live = await agentCall(inst);
    if (!live.version) throw new Error('CMS noch nicht eingerichtet.');
    if (!/^legacy-[a-f0-9]{12}$/.test(live.version)) await release(live.version);
    const health = await check(inst, live.version);
    await q("update cms_installations set version=?,state='ready',last_checked_at=UTC_TIMESTAMP(3) where id=?", [
      live.version,
      id
    ]);
    return health;
  }
  async function stage(remote, site, pkg) {
    const prefix = '.lorzcms/releases/' + pkg.version + '/';
    const manifestPath = joinRemote(site.remote_root, prefix + 'manifest.json');
    if (await remote.exists(manifestPath)) {
      if (digest(await remote.read(manifestPath)) !== pkg.digest)
        throw new Error('Zielversion existiert mit anderem Inhalt.');
      return;
    }
    for (const file of pkg.files)
      await remote.write(joinRemote(site.remote_root, prefix + file.path), Buffer.from(file.content, 'base64'));
    // Completion marker is uploaded last; the agent rechecks every file.
    await remote.write(manifestPath, Buffer.from(pkg.manifestText));
  }
  async function uploadConnector(remote, site, inst) {
    const key = decrypt(inst.agent_credentials).key;
    const config = `<?php\nreturn ['instance_id'=>${phpString(inst.id)},'key_hash'=>${phpString(digest(key))}];\n`;
    const marker = '.lorzcms/owner.json';
    if (await remote.exists(joinRemote(site.remote_root, marker))) {
      const owner = JSON.parse((await remote.read(joinRemote(site.remote_root, marker))).toString());
      if (owner.instanceId !== inst.id) throw new Error('Das Ziel gehört zu einer anderen Installation.');
    } else
      await remote.write(joinRemote(site.remote_root, marker), Buffer.from(JSON.stringify({ instanceId: inst.id })));
    await remote.write(joinRemote(site.remote_root, 'config/siteops.php'), Buffer.from(config));
    for (const [source, target] of [
      ['agent.php', '.lorzcms/agent.php'],
      ['siteops.php', 'public/siteops.php']
    ])
      await remote.write(joinRemote(site.remote_root, target), await readFile(new URL(source, agentDir)));
  }
  async function uploadEntries(remote, site) {
    for (const [source, target] of [
      ['bootstrap.php', 'bootstrap.php'],
      ['index.php', 'public/index.php'],
      ['router.php', 'public/router.php'],
      ['htaccess.txt', 'public/.htaccess']
    ])
      await remote.write(joinRemote(site.remote_root, target), await readFile(new URL(source, agentDir)));
  }
  async function enroll(remote, site, inst) {
    const shim = await readFile(new URL('index.php', agentDir));
    const indexPath = joinRemote(site.remote_root, 'public/index.php');
    const current = await remote.read(indexPath);
    if (current.equals(shim)) {
      const live = await agentCall(inst);
      if (!live.version) throw new Error('CMS-Anschluss ist unvollständig.');
      return live;
    }
    const supported = JSON.parse(await readFile(new URL('supported-legacy.json', agentDir), 'utf8'));
    const originals = {};
    for (const path of ['bootstrap.php', 'public/index.php', 'public/.htaccess', 'public/router.php']) {
      originals[path] = await remote.read(joinRemote(site.remote_root, path));
      if (!supported[path]?.includes(digest(originals[path])))
        throw new Error('Individuell veränderte Startdateien: Anschluss muss zuerst geprüft werden.');
    }
    const files = [];
    async function collect(path, dest) {
      for (const entry of await remote.list(joinRemote(site.remote_root, path))) {
        if (entry.type === 'link') throw new Error('Symlinks im bisherigen Core werden nicht übernommen.');
        if (entry.type === 'directory') await collect(path + '/' + entry.name, dest + '/' + entry.name);
        else if (entry.type === 'file') {
          const bytes = await remote.read(joinRemote(site.remote_root, path + '/' + entry.name));
          files.push({ path: dest + '/' + entry.name, sha256: digest(bytes), content: bytes.toString('base64') });
        }
      }
    }
    await collect('packages/cms/src', 'src');
    const base = await bundledRelease();
    for (const file of base.files.filter(f => f.path.startsWith('assets/'))) {
      const path = joinRemote(site.remote_root, 'public/' + file.path);
      if (await remote.exists(path)) {
        const bytes = await remote.read(path);
        files.push({ path: file.path, sha256: digest(bytes), content: bytes.toString('base64') });
      }
    }
    const runtimeIndex = Buffer.from(
      originals['public/index.php'].toString().replace("require dirname(__DIR__).'/bootstrap.php';", '')
    );
    const runtimeBootstrap = await readFile(new URL('runtime/bootstrap.php', coreDir));
    for (const [path, bytes] of [
      ['runtime/index.php', runtimeIndex],
      ['runtime/bootstrap.php', runtimeBootstrap]
    ])
      files.push({ path, sha256: digest(bytes), content: bytes.toString('base64') });
    const version = 'legacy-' + digest(JSON.stringify(files)).slice(0, 12);
    const pkg = validateRelease(
      {
        format: 'lorzcms-release-v1',
        version,
        schemaVersion: 1,
        compatibleSchemas: [1],
        minPhp: '8.3',
        notes: 'Gesicherter Core vor dem SiteOps-Anschluss.',
        files
      },
      { legacy: true }
    );
    await stage(remote, site, pkg);
    for (const [path, bytes] of Object.entries(originals))
      await remote.write(joinRemote(site.remote_root, '.lorzcms/original/' + path), bytes);
    await uploadConnector(remote, site, inst);
    await agentCall(inst, { action: 'preflight', version, digest: pkg.digest });
    const active = { version, digest: pkg.digest, schemaVersion: 1, activatedAt: new Date().toISOString() };
    await remote.write(joinRemote(site.remote_root, '.lorzcms/active.json'), Buffer.from(JSON.stringify(active)));
    try {
      await uploadEntries(remote, site);
    } catch (error) {
      for (const [path, bytes] of Object.entries(originals))
        await remote.write(joinRemote(site.remote_root, path), bytes);
      throw error;
    }
    return agentCall(inst);
  }
  async function check(inst, version) {
    const status = await agentCall(inst);
    if (status.version !== version || status.maintenance) throw new Error('Die erwartete CMS-Version ist nicht aktiv.');
    for (const path of ['/', '/admin/login/']) {
      const response = await request(cmsOrigin(inst.base_url) + path, {
        redirect: 'error',
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error('Website-Prüfung fehlgeschlagen: HTTP ' + response.status);
      await response.body?.cancel();
    }
    return { ok: true, version, checks: ['CMS-Version', 'Startseite', 'Admin-Anmeldung'] };
  }
  async function execute(job) {
    const inst = await installation(job.installation_id),
      site = await getSite(inst.site_id);
    let remote,
      activated = false,
      phase = 'connection';
    const setPhase = async value => {
      phase = value;
      await q('update cms_jobs set phase=?,heartbeat_at=UTC_TIMESTAMP(3) where id=?', [value, job.id]);
    };
    try {
      remote = await connectSite(site);
      await setPhase('preparing');
      if (job.kind === 'adopt') {
        const live = await enroll(remote, site, inst);
        await check(inst, live.version);
        await q("update cms_installations set version=?,state='ready',last_checked_at=UTC_TIMESTAMP(3) where id=?", [
          live.version,
          inst.id
        ]);
        await q(
          "update cms_jobs set state='succeeded',release_version=?,phase='done',finished_at=UTC_TIMESTAMP(3),encrypted_payload=null,result=? where id=?",
          [live.version, JSON.stringify({ ok: true, version: live.version }), job.id]
        );
        return;
      }
      const pkg = job.release_version.startsWith('legacy-') ? null : await release(job.release_version);
      if (job.kind === 'install') {
        const ownerPath = joinRemote(site.remote_root, '.lorzcms/owner.json');
        if (!(await remote.exists(ownerPath))) await emptyTarget(remote, site.remote_root);
        await uploadConnector(remote, site, inst);
        await remote.write(
          joinRemote(site.remote_root, 'projects/base/project.php'),
          await readFile(new URL('projects/base/project.php', coreDir))
        );
        await uploadEntries(remote, site);
      }
      if (pkg) await stage(remote, site, pkg);
      const manifestRaw = await remote.read(
        joinRemote(site.remote_root, '.lorzcms/releases/' + job.release_version + '/manifest.json')
      );
      const manifestDigest = digest(manifestRaw);
      await setPhase('preflight');
      await agentCall(inst, { action: 'preflight', version: job.release_version, digest: manifestDigest });
      const live = await agentCall(inst);
      const completed = live.version === job.release_version;
      if (completed && live.jobId && live.jobId !== job.id)
        throw new Error('Die Version wurde durch einen anderen Auftrag aktiviert.');
      if (!completed && job.kind !== 'install' && live.version !== job.previous_version)
        throw new Error('Installierter Stand hat sich seit der Planung geändert.');
      await setPhase('activating');
      const payload = job.encrypted_payload ? decrypt(job.encrypted_payload) : {};
      let activation = null;
      if (!completed)
        activation = await agentCall(inst, {
          ...payload,
          action: job.kind === 'install' ? 'provision' : 'activate',
          version: job.release_version,
          digest: manifestDigest,
          expectedVersion: job.previous_version,
          baseUrl: inst.base_url,
          jobId: job.id
        });
      activated = true;
      await setPhase('checking');
      const health = await check(inst, job.release_version);
      await q("update cms_installations set version=?,state='ready',last_checked_at=UTC_TIMESTAMP(3) where id=?", [
        job.release_version,
        inst.id
      ]);
      await q('update sites set monitor_enabled=1 where id=?', [site.id]);
      await q(
        "update cms_jobs set state='succeeded',phase='done',encrypted_payload=null,finished_at=UTC_TIMESTAMP(3),result=? where id=?",
        [JSON.stringify({ ...health, backupId: activation?.backupId || null }), job.id]
      );
    } catch (error) {
      const failurePhase = phase;
      let state = 'needs_attention',
        result = null;
      if (!activated && phase === 'activating') {
        try {
          const live = await agentCall(inst);
          activated = live.version === job.release_version && live.jobId === job.id;
        } catch {}
      }
      if (activated && job.previous_version) {
        await setPhase('rolling_back');
        try {
          const manifest = await remote.read(
            joinRemote(site.remote_root, '.lorzcms/releases/' + job.previous_version + '/manifest.json')
          );
          await agentCall(inst, {
            action: 'activate',
            version: job.previous_version,
            digest: digest(manifest),
            expectedVersion: job.release_version,
            jobId: job.id + '-rollback'
          });
          result = await check(inst, job.previous_version);
          state = 'rolled_back';
          await q("update cms_installations set version=?,state='ready',last_checked_at=UTC_TIMESTAMP(3) where id=?", [
            job.previous_version,
            inst.id
          ]);
        } catch {
          state = 'needs_attention';
        }
      }
      if (state === 'needs_attention')
        await q("update cms_installations set state='needs_attention' where id=?", [inst.id]);
      await q(
        "update cms_jobs set state=?,phase=?,error=?,result=?,finished_at=UTC_TIMESTAMP(3),encrypted_payload=IF(?='rolled_back',NULL,encrypted_payload) where id=?",
        [
          state,
          phase,
          state === 'rolled_back'
            ? 'Website-Prüfung fehlgeschlagen; vorheriger Core wieder aktiv.'
            : 'Auftrag in Phase ' +
              failurePhase +
              ' unterbrochen. ' +
              (/^(CMS-Anschluss meldet HTTP|Domain zeigt auf|Installierter Stand|Die Version wurde|Individuell veränderte|Zielversion existiert|Erstinstallation benötigt|Das Ziel gehört)/.test(
                error?.message || ''
              )
                ? error.message
                : 'Hosting-Zugang, Domain-Ziel und CMS-Anschluss prüfen.'),
          result ? JSON.stringify(result) : null,
          state,
          job.id
        ]
      );
    } finally {
      if (remote) await remote.close();
    }
  }
  async function tick() {
    if (ticking) return;
    ticking = true;
    let lockConnection;
    try {
      // A database session lock survives event-loop stalls and prevents two SiteOps instances deploying concurrently.
      lockConnection = await db.getConnection();
      const [[lock]] = await lockConnection.query("select GET_LOCK('siteops:lorzcms-worker',0) acquired");
      if (!lock.acquired) return;
      await q(
        "update cms_jobs set state='needs_attention',error='SiteOps wurde während des Auftrags neu gestartet. Auftrag prüfen und erneut starten.' where state='running'"
      );
      const job = (
        await q(
          "select * from cms_jobs where state='queued' and run_at<=UTC_TIMESTAMP(3) order by run_at,created_at limit 1"
        )
      ).rows[0];
      if (!job) return;
      const claim = await q(
        "update cms_jobs set state='running',heartbeat_at=UTC_TIMESTAMP(3) where id=? and state='queued'",
        [job.id]
      );
      if (claim.meta.affectedRows) await execute(job);
    } finally {
      if (lockConnection) {
        try {
          await lockConnection.query("select RELEASE_LOCK('siteops:lorzcms-worker')");
        } finally {
          lockConnection.release();
        }
      }
      ticking = false;
    }
  }
  function startWorker() {
    const timer = setInterval(
      () => tick().catch(() => console.error('LorzCMS worker could not complete a job; inspect its persisted state.')),
      10000
    );
    timer.unref();
    tick().catch(() => console.error('LorzCMS worker startup failed.'));
    return timer;
  }
  return {
    overview,
    importRelease,
    publishBundled: async () => importRelease(await bundledRelease()),
    create,
    attach,
    schedule,
    rollback,
    cancel,
    retry,
    inspect,
    tick,
    startWorker
  };
}
