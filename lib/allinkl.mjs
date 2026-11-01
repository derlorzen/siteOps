import crypto from 'node:crypto';
import { promises as dns } from 'node:dns';
import { posix as path } from 'node:path';
import * as cheerio from 'cheerio';
import * as z from 'zod/v4';
import { hostingTargetSchema } from './site-provisioning.mjs';
import { inspectCmsDomainMove, moveCmsDomain } from './allinkl-cms-move.mjs';

const ENDPOINT = 'https://kasapi.kasserver.com/soap/KasApi.php';
// KAS usernames start with w and may contain letters as well as digits (e.g. w0137d60).
const KAS_LOGIN_PATTERN = /^w[a-z0-9]{5,10}$/i;
const UUID = z.uuid();
const HOST = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/)
  .max(253);
const FOLDER = z
  .string()
  .min(2)
  .max(450)
  .refine(
    value => value.startsWith('/') && !value.includes('\\') && !value.split('/').includes('..'),
    'Absolutes Verzeichnis ohne .. erforderlich.'
  );
const ACTIONS = new Set([
  'get_domains',
  'delete_domain',
  'delete_subdomain',
  'get_subdomains',
  'add_subdomain',
  'update_subdomain',
  'get_dns_settings',
  'add_dns_settings',
  'update_dns_settings',
  'delete_dns_settings',
  'update_ssl'
]);
const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'TXT'];

export const allinklAccountSchema = z.object({
  name: z.string().trim().min(1).max(120),
  login: z.string().trim().regex(KAS_LOGIN_PATTERN, 'KAS-Login erwartet (z. B. w0123456 oder w0137d60).'),
  password: z.string().min(1).max(4096),
  profileId: UUID
});
export const allinklProvisionSchema = z.object({
  accountId: UUID,
  baseUrl: z.url(),
  remoteRoot: hostingTargetSchema
});
export const allinklDnsRecordSchema = z.object({
  zone: HOST,
  type: z.enum(RECORD_TYPES),
  name: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^(?:@|[a-z0-9_*.-]{1,190})$/),
  value: z.string().trim().min(1).max(2000),
  priority: z.coerce.number().int().min(0).max(65535).default(0)
});

function xmlEscape(value) {
  return String(value).replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]
  );
}
function nameOf(node) {
  return String(node?.name || '')
    .split(':')
    .pop()
    .toLowerCase();
}
export function parseKasSoap(xml, { onFloodDelay } = {}) {
  const $ = cheerio.load(xml, { xmlMode: true, decodeEntities: true });
  const elements = $('*').toArray();
  const fault = elements.find(n => nameOf(n) === 'fault');
  if (fault) {
    const message = $(fault)
      .find('*')
      .toArray()
      .find(n => nameOf(n) === 'faultstring');
    // Never return raw XML; it may echo credentials.
    throw new Error('ALL-INKL KAS-API: ' + String(message ? $(message).text() : 'SOAP-Fehler').slice(0, 180));
  }
  const ret = elements.find(n => nameOf(n) === 'return');
  if (!ret) throw new Error('KAS-API hat keine gültige SOAP-Antwort geliefert.');
  const read = node => {
    const children = $(node).children().toArray();
    if (!children.length) return $(node).text();
    if (children.every(n => nameOf(n) === 'item')) {
      const pairs = children.map(child => {
        const c = $(child).children().toArray();
        const key = c.find(n => nameOf(n) === 'key');
        const value = c.find(n => nameOf(n) === 'value');
        return key && value ? [$(key).text(), read(value)] : null;
      });
      if (pairs.every(Boolean) && new Set(pairs.map(v => v[0])).size === pairs.length) {
        return Object.fromEntries(pairs);
      }
      return children.map(n => read(n));
    }
    if (children.length === 1) return read(children[0]);
    const out = {};
    for (const child of children) {
      const key = nameOf(child),
        value = read(child);
      if (key in out) out[key] = Array.isArray(out[key]) ? [...out[key], value] : [out[key], value];
      else out[key] = value;
    }
    return out;
  };
  const raw = read(ret);
  const floodDelay = raw && typeof raw === 'object' ? Number(raw.KasFloodDelay ?? raw.kasflooddelay) : NaN;
  if (Number.isFinite(floodDelay) && floodDelay >= 0 && floodDelay <= 120) onFloodDelay?.(floodDelay * 1000);
  // Real KAS responses wrap ReturnInfo in a Response map alongside KasFloodDelay.
  const value = raw && typeof raw === 'object' ? (raw.Response ?? raw.response ?? raw) : raw;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const ok = value.ReturnString ?? value.returnstring;
    if (ok != null && !['TRUE', '1'].includes(String(ok).toUpperCase()))
      throw new Error('KAS-API hat den Auftrag abgelehnt: ' + String(ok).slice(0, 120));
    const result = value.ReturnInfo ?? value.returninfo;
    return result == null || result === '' ? (ok != null ? { ok: true } : value) : result;
  }
  if (['FALSE', '0'].includes(String(value).toUpperCase())) throw new Error('KAS-API hat den Auftrag abgelehnt.');
  return value;
}

// ALL-INKL applies a flood-protection delay across requests, not just repeated actions.
const kasCallQueue = new Map();
const kasNextRequestAt = new Map();
async function serializedKasRequest(login, delayMs, callback) {
  const previous = kasCallQueue.get(login) || Promise.resolve();
  const job = previous
    .catch(() => {})
    .then(async () => {
      const wait = Math.max(0, (kasNextRequestAt.get(login) || 0) - Date.now());
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      kasNextRequestAt.set(login, Date.now() + delayMs);
      return callback();
    });
  kasCallQueue.set(
    login,
    job.catch(() => {})
  );
  return job;
}
export function createKasClient({ login, password, request = fetch, delayMs = 5000 }) {
  if (!KAS_LOGIN_PATTERN.test(login) || !password) throw new Error('KAS-Zugang ungültig.');
  return {
    async call(action, params = {}) {
      if (!ACTIONS.has(action)) throw new Error('Nicht freigegebene KAS-Aktion.');
      const json = JSON.stringify({
        kas_login: login,
        kas_auth_type: 'plain',
        kas_auth_data: password,
        kas_action: action,
        KasRequestParams: params
      });
      const body =
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" ' +
        'xmlns:ns1="urn:xmethodsKasApi" xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        '<SOAP-ENV:Body><ns1:KasApi><Params xsi:type="xsd:string">' +
        xmlEscape(json) +
        '</Params></ns1:KasApi></SOAP-ENV:Body></SOAP-ENV:Envelope>';
      return serializedKasRequest(login, delayMs, async () => {
        let response;
        try {
          response = await request(ENDPOINT, {
            method: 'POST',
            redirect: 'error',
            headers: { 'content-type': 'text/xml; charset=utf-8', SOAPAction: 'urn:xmethodsKasApi#KasApi' },
            body,
            signal: AbortSignal.timeout(30000)
          });
        } catch {
          throw new Error('KAS-API nicht erreichbar. Zugang und Verbindung prüfen.');
        }
        // Limit memory and never surface HTML / request echoes.
        if (!response.ok) throw new Error('KAS-API HTTP ' + response.status);
        const xml = await response.text();
        if (xml.length > 3_000_000) throw new Error('KAS-API-Antwort zu groß.');
        return parseKasSoap(xml, {
          onFloodDelay: ms => {
            if (delayMs === 0) return; // explicitly disabled for isolated tests
            const next = Date.now() + ms;
            kasNextRequestAt.set(login, Math.max(kasNextRequestAt.get(login) || 0, next));
          }
        });
      });
    }
  };
}
export function kasRows(value) {
  if (value == null || value === '' || value === true) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') {
    if (value.ok === true) return [];
    const keys = Object.keys(value);
    if (keys.length === 0) return [];
    if (keys.every(k => /^\d+$/.test(k))) return Object.values(value);
    if (value.ReturnInfo || value.returninfo) return kasRows(value.ReturnInfo ?? value.returninfo);
    if (value.Response || value.response) return kasRows(value.Response ?? value.response);
    return [value];
  }
  return [];
}
export function normalizeHost(value) {
  return HOST.parse(
    String(value || '')
      .replace(/\.$/, '')
      .toLowerCase()
  );
}
export function kasDomainNames(domains) {
  if (!Array.isArray(domains)) throw new Error('KAS-API hat eine ungültige Domainliste geliefert.');
  return [
    ...new Set(
      domains
        .map(row => {
          const name = typeof row === 'string' ? row : (row?.domain_name ?? row?.domain ?? row?.hostname);
          if (typeof name !== 'string' || !name.trim()) return null;
          try {
            return normalizeHost(name.trim());
          } catch {
            return null;
          }
        })
        .filter(Boolean)
    )
  ].sort();
}

export function splitSubdomain(host, domains) {
  const name = normalizeHost(host);
  const parents = domains
    .map(d => {
      const str = typeof d === 'string' ? d : d.domain_name || d.domain || d.hostname || d.name;
      return str ? String(str).replace(/\.$/, '').toLowerCase() : '';
    })
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const parent = parents.find(d => name.endsWith('.' + d) && name !== d);
  if (!parent) throw new Error('Subdomain gehört zu keiner Domain dieses KAS-Kontos.');
  const label = name.slice(0, -parent.length - 1);
  if (!/^(?!-)[a-z0-9-]+(?:\.(?!-)[a-z0-9-]+)*$/.test(label)) throw new Error('Ungültiges Subdomain-Label.');
  return { parent, label };
}
function validateRecord(record) {
  const x = allinklDnsRecordSchema.parse(record);
  if (x.name === '*' || x.name === '@') throw new Error('Wildcard und Zonenwurzel sind geschützt.');
  if (x.name.endsWith('.' + x.zone) || x.name === x.zone) throw new Error('Nur relative DNS-Namen verwenden.');
  if (x.type === 'A' && !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(x.value)) throw new Error('A-Record: IPv4-Adresse erwartet.');
  if (x.type === 'AAAA' && !/^[0-9a-f:]+$/i.test(x.value)) throw new Error('AAAA-Record: IPv6-Adresse erwartet.');
  if (x.type === 'CNAME') x.value = normalizeHost(x.value) + '.';
  if (x.type === 'TXT' && x.name.startsWith('_dmarc')) throw new Error('DMARC-Einträge sind geschützt.');
  return x;
}
function publicRecord(row) {
  return {
    id: row.record_id ?? row.id,
    name: row.record_name ?? row.name ?? '',
    type: row.record_type ?? row.type,
    value: row.record_data ?? row.data ?? '',
    priority: row.record_aux ?? row.aux ?? 0,
    changeable: row.record_changeable !== 'N',
    deleteable: row.record_deleteable !== 'N'
  };
}

export function createAllInklService({
  db,
  encrypt,
  decrypt,
  profiles,
  connectSite,
  request = fetch,
  kasDelayMs = 5000,
  nameservers = domain => dns.resolveNs(domain)
}) {
  const notFound = () => {
    const e = new Error('Hosting-Konto nicht gefunden.');
    e.statusCode = 404;
    throw e;
  };
  const get = async id => {
    const [rows] = await db.query('SELECT * FROM hosting_accounts WHERE id=? AND provider=? LIMIT 1', [
      UUID.parse(id),
      'allinkl'
    ]);
    return rows[0] || notFound();
  };
  const client = row =>
    createKasClient({
      login: row.login,
      password: decrypt(row.encrypted_credentials).password,
      request,
      delayMs: kasDelayMs
    });
  async function list() {
    const [rows] = await db.query(
      'SELECT id,name,login,server_profile_id,created_at FROM hosting_accounts WHERE provider=? ORDER BY name',
      ['allinkl']
    );
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      login: r.login,
      profileId: r.server_profile_id,
      createdAt: r.created_at
    }));
  }
  async function add(input) {
    const x = allinklAccountSchema.parse(input);
    const ftp = await profiles.resolve(x.profileId, '/');
    const remote = await connectSite({
      deployment_mode: 'webspace',
      protocol: ftp.protocol,
      host: ftp.host,
      port: ftp.port,
      username: ftp.username,
      encrypted_credentials: encrypt({
        password: ftp.password,
        privateKey: ftp.privateKey,
        passphrase: ftp.passphrase
      })
    });
    try {
      await remote.list('/');
    } finally {
      await remote.close();
    }
    await createKasClient({ login: x.login, password: x.password, request }).call('get_domains');
    const id = crypto.randomUUID();
    await db.query(
      'INSERT INTO hosting_accounts(id,provider,name,login,server_profile_id,encrypted_credentials) VALUES(?,?,?,?,?,?)',
      [id, 'allinkl', x.name, x.login, x.profileId, encrypt({ password: x.password })]
    );
    return { id, name: x.name, login: x.login, profileId: x.profileId };
  }
  async function remove(id) {
    await get(id);
    await db.query('DELETE FROM hosting_accounts WHERE id=? AND provider=?', [id, 'allinkl']);
    return { ok: true, note: 'Website und Subdomains bleiben unverändert.' };
  }
  async function profileFor(id) {
    return (await get(id)).server_profile_id;
  }
  async function domains(id) {
    const result = kasRows(await client(await get(id)).call('get_domains'));
    if (result.length && !kasDomainNames(result).length)
      throw new Error('KAS-API hat keine auswertbaren Domainnamen geliefert.');
    return result;
  }
  async function subdomains(id) {
    return kasRows(await client(await get(id)).call('get_subdomains'));
  }
  async function records(id, zone) {
    const normalized = normalizeHost(zone);
    const owned = kasDomainNames(await domains(id));
    if (!owned.includes(normalized)) throw new Error('Domain ist in diesem ALL-INKL-Konto nicht vorhanden.');
    const rows = kasRows(await client(await get(id)).call('get_dns_settings', { zone_host: normalized + '.' }));
    if (rows.some(row => !row || typeof row !== 'object' || !(row.record_type ?? row.type)))
      throw new Error('KAS-API hat keine gültigen DNS-Einträge geliefert.');
    return rows.map(publicRecord);
  }
  async function diagnostics(id, zone = null) {
    const available = kasDomainNames(await domains(id));
    const report = { ok: true, domains: available, domainCount: available.length };
    // All checks use read-only KAS methods; a DNS failure must not hide
    // successful domain enumeration or reveal access credentials.
    try {
      report.subdomainCount = (await subdomains(id)).length;
      report.subdomainsOk = true;
    } catch (error) {
      report.subdomainsOk = false;
      report.subdomainsError = String(error.message || error).slice(0, 180);
    }
    if (zone != null && zone !== '') {
      const normalized = normalizeHost(zone);
      if (!available.includes(normalized)) throw new Error('Domain gehört nicht zu diesem KAS-Konto.');
      report.zone = normalized;
      try {
        report.publicNameservers = (await dns.resolveNs(normalized)).map(host =>
          String(host).replace(/\.$/, '').toLowerCase()
        );
        report.publicDnsProvider =
          report.publicNameservers.length && report.publicNameservers.every(host => host.endsWith('.kasserver.com'))
            ? 'allinkl'
            : 'external_or_unknown';
      } catch (error) {
        report.publicNameserversError = String(error.code || error.message || 'DNS lookup failed').slice(0, 120);
      }
      try {
        report.publicSoaPrimary = String((await dns.resolveSoa(normalized)).nsname || '')
          .replace(/\.$/, '')
          .toLowerCase();
      } catch {}
      try {
        report.dnsRecordCount = (await records(id, normalized)).length;
        report.dnsOk = true;
      } catch (error) {
        report.dnsOk = false;
        report.dnsError = String(error.message || error).slice(0, 180);
      }
    }
    return report;
  }
  async function addRecord(id, raw) {
    const x = validateRecord(raw);
    const existing = await records(id, x.zone);
    if (existing.some(r => String(r.name).replace(/\.$/, '') === x.name && r.type === x.type && r.value === x.value))
      return { ok: true, alreadyExists: true };
    if (existing.some(r => String(r.name).replace(/\.$/, '') === x.name && (r.type === 'CNAME' || x.type === 'CNAME')))
      throw new Error('Konflikt mit vorhandenem CNAME-Eintrag. Keine Änderung vorgenommen.');
    await client(await get(id)).call('add_dns_settings', {
      zone_host: x.zone + '.',
      record_type: x.type,
      record_name: x.name,
      record_data: x.value,
      record_aux: x.priority
    });
    return { ok: true };
  }
  async function updateRecord(id, recordId, raw) {
    const x = validateRecord(raw);
    const original = (await records(id, x.zone)).find(r => String(r.id) === String(recordId));
    if (!original || !RECORD_TYPES.includes(original.type) || original.name === '@' || !original.changeable)
      throw new Error('DNS-Eintrag nicht gefunden oder geschützt.');
    if (String(original.name).replace(/\.$/, '') !== x.name || original.type !== x.type)
      throw new Error('DNS-Eintragsname und Typ dürfen nicht verändert werden.');
    await client(await get(id)).call('update_dns_settings', {
      record_id: recordId,
      record_name: x.name,
      record_data: x.value,
      record_aux: x.priority
    });
    return { ok: true };
  }
  async function removeRecord(id, zone, recordId) {
    const original = (await records(id, zone)).find(r => String(r.id) === String(recordId));
    if (!original || !RECORD_TYPES.includes(original.type) || original.name === '@' || !original.deleteable)
      throw new Error('DNS-Eintrag nicht gefunden oder geschützt.');
    await client(await get(id)).call('delete_dns_settings', { record_id: recordId });
    return { ok: true };
  }
  async function installCertificate(accountId, hostname, { certificate, chain = '', privateKey }) {
    const host = normalizeHost(hostname);
    const domainsOwned = kasDomainNames(await domains(accountId));
    splitSubdomain(host, domainsOwned);
    const known = await subdomains(accountId);
    const matched = known.some(s =>
      [s.subdomain_name, s.hostname, s.name].some(
        value =>
          String(value || '')
            .replace(/\.$/, '')
            .toLowerCase() === host
      )
    );
    if (!matched) throw new Error('SSL kann nur auf eine vorhandene ALL-INKL-Subdomain angewandt werden.');
    const pemKey = String(privateKey);
    const pemCert = String(certificate);
    if (!/-----BEGIN (EC |RSA )?PRIVATE KEY-----/.test(pemKey) || !pemCert.includes('-----BEGIN CERTIFICATE-----'))
      throw new Error('SSL-Zertifikat oder privater Schlüssel fehlt.');
    await client(await get(accountId)).call('update_ssl', {
      hostname: host,
      ssl_certificate_sni_key: pemKey,
      ssl_certificate_sni_crt: pemCert,
      ssl_certificate_sni_bundle: String(chain),
      ssl_certificate_is_active: 'Y',
      ssl_certificate_force_https: 'Y'
    });
    return { ok: true, hostname: host, state: 'pending_activation' };
  }
  async function provision(input) {
    const x = allinklProvisionSchema.parse(input);
    const url = new URL(x.baseUrl);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      !['', '/'].includes(url.pathname)
    )
      throw new Error('Eine HTTPS-Adresse ohne Port und Unterpfad ist erforderlich.');

    const host = normalizeHost(url.hostname);
    const account = await get(x.accountId);
    const ownedDomains = await domains(account.id);
    const sub = splitSubdomain(host, ownedDomains);
    const publicPath = path.join(x.remoteRoot, 'public');
    if (publicPath === '/public' || publicPath === '/' || !publicPath.startsWith(x.remoteRoot.replace(/\/$/, '') + '/'))
      throw new Error('Unsicheres Zielverzeichnis.');

    const connection = await profiles.resolve(account.server_profile_id, x.remoteRoot);
    const [parentFtpSites] = await db.query(
      'SELECT id FROM sites WHERE domain=? AND remote_root=? AND host=? AND username=? AND protocol=? LIMIT 1',
      [sub.parent, '/', connection.host, connection.username, connection.protocol]
    );
    const parentDomain = ownedDomains.find(
      domain =>
        String(domain.domain_name || domain.domain || '')
          .replace(/\.$/, '')
          .toLowerCase() === sub.parent
    );
    const parentWebRoot = String(parentDomain?.domain_path || '');
    // ALL-INKL subdomain_path is relative to the KAS account, whereas an FTP
    // profile can be jailed to the parent domain's document root.
    const ftpJailedToParent =
      parentFtpSites.length > 0 &&
      parentWebRoot.startsWith('/') &&
      parentWebRoot !== '/' &&
      !parentWebRoot.includes('..') &&
      !parentWebRoot.includes('\\');
    const kasPublicPath = ftpJailedToParent ? path.join(parentWebRoot, publicPath) : publicPath;

    const [managedSites] = await db.query(
      'SELECT id FROM sites WHERE domain=? AND remote_root=? AND host=? AND username=? AND protocol=? LIMIT 1',
      [host, x.remoteRoot, connection.host, connection.username, connection.protocol]
    );

    const site = {
      deployment_mode: 'webspace',
      protocol: connection.protocol,
      host: connection.host,
      port: connection.port,
      username: connection.username,
      encrypted_credentials: encrypt({
        password: connection.password,
        privateKey: connection.privateKey,
        passphrase: connection.passphrase
      })
    };
    const remote = await connectSite(site);
    let installedScaffold = false;
    let cmsDomainMove = null;
    try {
      let files = [];
      try {
        files = await remote.list(x.remoteRoot);
      } catch {
        await remote.ensureDirectory(x.remoteRoot);
      }
      const unexpected = files.filter(f => f.name !== 'public' && f.name !== '.' && f.name !== '..');
      await remote.ensureDirectory(publicPath);
      const publicFiles = await remote.list(publicPath);
      const publicPopulated = publicFiles.some(f => !['.', '..'].includes(f.name));
      if (unexpected.length || publicPopulated) {
        // Only a registered SiteOps installation with its own deployment
        // scaffold may be rechecked. Never overwrite any existing file.
        const agent = publicFiles.some(f => f.name === 'siteops.php');
        const index = publicFiles.some(f => f.name === 'index.php');
        let owner = false;
        try {
          owner = (await remote.list(path.join(x.remoteRoot, '.lorzcms'))).some(f => f.name === 'owner.json');
        } catch {
          owner = false;
        }
        installedScaffold = managedSites.length > 0 && agent && index && owner;
        if (!installedScaffold && agent && index && owner) {
          cmsDomainMove = await inspectCmsDomainMove({ db, remote, root: x.remoteRoot, connection, hostname: host });
          installedScaffold = Boolean(cmsDomainMove);
        }
        if (!installedScaffold)
          throw new Error('Zielverzeichnis ist nicht leer. Vorhandene Dateien bleiben unberührt.');
      }
    } finally {
      await remote.close();
    }

    const kas = client(account);
    const existing = kasRows(await kas.call('get_subdomains', { subdomain_name: host }));
    const match = existing.find(d =>
      [d.subdomain_name, d.hostname, d.name].some(
        v =>
          String(v || '')
            .replace(/\.$/, '')
            .toLowerCase() === host
      )
    );
    if (match) {
      const current = String(match.subdomain_path || match.path || '');
      const samePath = (first, second) =>
        path.normalize(first).replace(/\/+$/, '') === path.normalize(second).replace(/\/+$/, '');
      if (!current) throw new Error('Subdomain-Webverzeichnis nicht prüfbar. Keine Änderung.');
      if (cmsDomainMove) {
        const migrationRemote = await connectSite(site);
        try {
          return await moveCmsDomain({
            db,
            remote: migrationRemote,
            root: x.remoteRoot,
            hostname: host,
            kasPublicPath,
            currentPath: current,
            candidate: cmsDomainMove,
            kas,
            decrypt,
            request
          });
        } finally {
          await migrationRemote.close();
        }
      }
      if (samePath(current, kasPublicPath))
        return {
          ok: true,
          created: false,
          hostname: host,
          publicPath,
          kasPublicPath,
          profileId: account.server_profile_id,
          message: 'Subdomain ist korrekt eingerichtet.'
        };
      // Repair only the legacy incorrect, unprefixed mapping of a verified
      // SiteOps-owned LorzCMS scaffold. Never alter unrelated mappings.
      if (!ftpJailedToParent || !installedScaffold || !samePath(current, publicPath))
        throw new Error('Subdomain existiert bereits mit anderem Webverzeichnis. Keine Änderung.');
      await kas.call('update_subdomain', {
        subdomain_name: host,
        subdomain_path: kasPublicPath + '/'
      });
      return {
        ok: true,
        created: false,
        repaired: true,
        hostname: host,
        previousPath: current,
        kasPublicPath,
        profileId: account.server_profile_id,
        message: 'ALL-INKL-Webverzeichnis für bestehende SiteOps-Installation korrigiert.'
      };
    }
    if (installedScaffold) throw new Error('Bestehendes SiteOps-Projekt ohne zugeordnete Subdomain. Keine Änderung.');
    await kas.call('add_subdomain', {
      subdomain_name: sub.label,
      domain_name: sub.parent,
      subdomain_path: kasPublicPath + '/',
      redirect_status: '0',
      php_version: '8.3'
    });
    return {
      ok: true,
      created: true,
      hostname: host,
      publicPath,
      kasPublicPath,
      profileId: account.server_profile_id,
      message: 'Verzeichnis und Subdomain angelegt. DNS-Verteilung und HTTPS/SSL können verzögert verfügbar sein.'
    };
  }
  return {
    async deletionTarget(accountId, hostname, site) {
      const account = await get(accountId);
      const profile = await profiles.resolve(account.server_profile_id, '/');
      if (
        site.host !== profile.host ||
        site.username !== profile.username ||
        site.protocol !== profile.protocol ||
        Number(site.port) !== Number(profile.port)
      )
        throw Object.assign(new Error('ALL-INKL-Konto passt nicht zur Website-Verbindung.'), { statusCode: 409 });
      const host = HOST.parse(hostname);
      const roots = await domains(accountId);
      const subs = await subdomains(accountId);
      const root = roots.find(r => String(r.domain_name || r.domain || '').toLowerCase() === host);
      const sub = subs.find(r => String(r.subdomain_name || r.hostname || r.name || '').toLowerCase() === host);
      if (!root && !sub)
        throw Object.assign(new Error('Hostname im ALL-INKL-Konto nicht gefunden.'), { statusCode: 409 });
      if (root && subs.some(r => String(r.subdomain_name || r.hostname || r.name || '').endsWith('.' + host)))
        throw Object.assign(new Error('Domain hat noch Subdomains. Diese zuerst einzeln entfernen.'), {
          statusCode: 409
        });
      return { accountId, hostname: host, kind: root ? 'domain' : 'subdomain' };
    },
    async deleteTarget(target) {
      const key = target.kind === 'domain' ? 'domain_name' : 'subdomain_name';
      await client(await get(target.accountId)).call('delete_' + target.kind, { [key]: target.hostname });
    },
    list,
    add,
    remove,
    profileFor,
    domains,
    subdomains,
    records,
    // Narrow exception for Google TXT records, including the protected zone apex.
    // General DNS editing keeps its existing apex protection.
    async addGoogleVerificationTxt(id, domain, value) {
      if (!/^google-site-verification=[A-Za-z0-9_-]{10,200}$/.test(value))
        throw new Error('Ungültiger Google-TXT-Eintrag.');
      const host = normalizeHost(domain);
      const zones = kasDomainNames(await domains(id)).filter(z => host === z || host.endsWith('.' + z));
      const zone = zones.sort((a, b) => b.length - a.length)[0];
      if (!zone) throw new Error('Domain gehört nicht zu diesem ALL-INKL-Konto.');
      const ns = await nameservers(zone);
      if (!ns.length || !ns.every(n => n.toLowerCase().replace(/\.$/, '').endsWith('.kasserver.com')))
        throw new Error('ALL-INKL ist nicht der autoritative DNS-Anbieter.');
      const name = host === zone ? '' : host.slice(0, -zone.length - 1);
      const direct = (await records(id, zone)).filter(r => {
        const n = String(r.name || '')
          .toLowerCase()
          .replace(/\.$/, '');
        return ['', '@', zone].includes(n) ? !name : n === name || n === host;
      });
      if (direct.some(r => r.type === 'CNAME')) throw new Error('CNAME-Konflikt.');
      if (direct.some(r => r.type === 'TXT' && String(r.value).replace(/^"|"$/g, '') === value))
        return { ok: true, alreadyExists: true };
      await client(await get(id)).call('add_dns_settings', {
        zone_host: zone + '.',
        record_type: 'TXT',
        record_name: name,
        record_data: value,
        record_aux: 0
      });
      return { ok: true };
    },
    diagnostics,
    addRecord,
    updateRecord,
    removeRecord,
    installCertificate,
    provision
  };
}
