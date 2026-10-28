import { posix as path } from 'node:path';
import crypto from 'node:crypto';
import { hostingTargetSchema } from './site-provisioning.mjs';
import { normalizeHost, splitSubdomain } from './allinkl.mjs';

const TOKEN = /^[A-Za-z0-9_-]{12,200}$/;
const AUTHORIZATION = /^[A-Za-z0-9._-]{25,550}$/;

export function http01File(token, authorization) {
  if (
    typeof token !== 'string' ||
    !TOKEN.test(token) ||
    typeof authorization !== 'string' ||
    !AUTHORIZATION.test(authorization) ||
    !authorization.startsWith(token + '.')
  ) {
    throw new Error('Ungültige ACME HTTP-01-Challenge.');
  }
  return '.well-known/acme-challenge/' + token;
}

/**
 * The destination must be an already enrolled SiteOps webspace site whose
 * public/ directory is exactly the ALL-INKL KAS subdomain document root.
 * Never infer or create a public challenge folder outside that webroot.
 */
export function createAllInklHttpChallenge({
  db,
  allInklService,
  connectSite,
  fetcher = fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
}) {
  async function resolve(accountId, hostname) {
    const host = normalizeHost(hostname);
    const [rows] = await db.query("SELECT * FROM sites WHERE domain=? AND deployment_mode='webspace' LIMIT 1", [host]);
    const site = rows[0];
    if (!site) return null; // Legacy and non-SiteOps domains can still use DNS-01.
    const root = hostingTargetSchema.parse(site.remote_root);
    const publicRoot = path.join(root, 'public');
    const subdomains = await allInklService.subdomains(accountId);
    const match = subdomains.find(s =>
      [s.subdomain_name, s.hostname, s.name].some(
        value =>
          String(value || '')
            .replace(/\.$/, '')
            .toLowerCase() === host
      )
    );
    if (!match) throw new Error('Subdomain gehört nicht zum angegebenen ALL-INKL-Konto.');
    const kasPath = String(match.subdomain_path || match.path || '').replace(/\/+$/, '');
    let matches = Boolean(kasPath) && path.normalize(kasPath) === publicRoot;
    if (!matches && typeof allInklService.domains === 'function') {
      // Provisioning also supports FTP users jailed to the parent domain.
      // KAS sees the account-relative prefix; FTP sees the directory below it.
      // Accept that exact translation only with the same registered parent
      // connection, never by suffix matching an arbitrary KAS directory.
      const domains = await allInklService.domains(accountId);
      const { parent } = splitSubdomain(host, domains);
      const domain = domains.find(
        domain =>
          String(domain.domain_name || domain.domain || '')
            .replace(/\.$/, '')
            .toLowerCase() === parent
      );
      const parentPath = hostingTargetSchema.safeParse(String(domain?.domain_path || '').replace(/\/+$/, ''));
      if (parentPath.success && site.host && site.username && site.protocol) {
        const [parents] = await db.query(
          'SELECT id FROM sites WHERE domain=? AND remote_root=? AND host=? AND username=? AND protocol=? LIMIT 1',
          [parent, '/', site.host, site.username, site.protocol]
        );
        matches =
          parents.length > 0 && Boolean(kasPath) && path.normalize(kasPath) === path.join(parentPath.data, publicRoot);
      }
    }
    if (!matches) {
      throw new Error('HTTP-01 abgebrochen: ALL-INKL-Webroot weicht vom SiteOps-Projekt ab.');
    }
    return { site, publicRoot };
  }

  async function put(accountId, hostname, token, authorization) {
    const relative = http01File(token, authorization);
    const target = await resolve(accountId, hostname);
    if (!target) throw new Error('Für diese Domain ist kein SiteOps-Webspace hinterlegt.');
    const remote = await connectSite(target.site);
    const file = path.join(target.publicRoot, relative);
    try {
      await remote.ensureDirectory(path.dirname(file));
      if (await remote.exists(file)) {
        const existing = await remote.read(file);
        if (existing.toString('utf8') !== authorization)
          throw new Error('HTTP-01-Datei existiert bereits mit fremdem Inhalt.');
        return;
      }
      await remote.write(file, Buffer.from(authorization, 'utf8'));
    } finally {
      await remote.close();
    }
  }

  async function remove(accountId, hostname, token, authorization) {
    const relative = http01File(token, authorization);
    const target = await resolve(accountId, hostname);
    if (!target) return;
    const remote = await connectSite(target.site);
    try {
      const file = path.join(target.publicRoot, relative);
      if (!(await remote.exists(file))) return;
      // Never remove another issuer's challenge or a file modified meanwhile.
      const current = (await remote.read(file)).toString('utf8');
      if (current === authorization) await remote.remove(file);
    } finally {
      await remote.close();
    }
  }

  async function verify(hostname, token, authorization, { maxAttempts = 5 } = {}) {
    http01File(token, authorization);
    const host = normalizeHost(hostname);
    const url = 'http://' + host + '/.well-known/acme-challenge/' + token;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetcher(url, {
          redirect: 'manual',
          signal: AbortSignal.timeout(10000),
          headers: { accept: 'text/plain' }
        });
        if (
          response.status === 200 &&
          Number(response.headers.get('content-length') || 0) <= authorization.length + 4 &&
          (await response.text()) === authorization
        )
          return;
      } catch {
        // Apache may not have observed a freshly uploaded file yet.
      }
      if (i < maxAttempts - 1) await sleep(3000);
    }
    throw new Error(
      'HTTP-01-Datei ist über Port 80 nicht unverändert öffentlich abrufbar. Webroot/Weiterleitung prüfen.'
    );
  }
  // KAS shared nginx can reject /.well-known/ before Apache/.htaccess can
  // serve it (error_kas_44). Never start an ACME HTTP-01 order without a
  // successful public read of an actual file in this specific webroot.
  async function probe(accountId, hostname) {
    const token = crypto.randomBytes(24).toString('base64url');
    const authorization = token + '.' + crypto.randomBytes(24).toString('base64url');
    let created = false;
    try {
      await put(accountId, hostname, token, authorization);
      created = true;
      await verify(hostname, token, authorization, { maxAttempts: 2 });
      return true;
    } catch {
      return false; // Prefer DNS-01 for servers whose nginx denies the path.
    } finally {
      if (created) await remove(accountId, hostname, token, authorization);
    }
  }
  return { resolve, put, remove, verify, probe };
}
