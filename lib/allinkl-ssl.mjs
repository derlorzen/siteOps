import crypto, { X509Certificate } from 'node:crypto';
import tls from 'node:tls';
import { promises as dns } from 'node:dns';
import * as z from 'zod/v4';
import { normalizeHost, splitSubdomain, kasDomainNames } from './allinkl.mjs';

const RENEW_WINDOW_MS = 30 * 86400_000;
// ALL-INKL DNS changes can take longer than the former four-minute ACME
// timeout. Bound the wait and make it configurable, without infinite retries.
const MAX_DNS_WAIT_MS = Math.min(
  3_600_000,
  Math.max(240_000, Number(process.env.SITEOPS_ACME_DNS_WAIT_MS) || 1_800_000)
);

export const allinklSslRequestSchema = z.object({
  accountId: z.uuid(),
  hostname: z.string().trim().max(253),
  email: z.email(),
  autoRenew: z.boolean().default(true)
});

export function sslDnsName(hostname, domains) {
  const host = normalizeHost(hostname);
  const { parent, label } = splitSubdomain(host, domains);
  return { zone: parent, relative: '_acme-challenge.' + label, fqdn: '_acme-challenge.' + host };
}

export function inspectCertificate({ hostname, certificate, privateKey }) {
  const host = normalizeHost(hostname);
  const pem = String(certificate);
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
  if (!blocks.length || blocks.length > 10) throw new Error('Ungültiges X.509-Zertifikat.');
  const leaf = new X509Certificate(blocks[0]);
  if (!leaf.checkHost(host)) throw new Error('Zertifikat gilt nicht für die angefragte Subdomain.');
  if (new Date(leaf.validTo).getTime() <= Date.now()) throw new Error('Das Zertifikat ist abgelaufen.');
  const key = crypto.createPrivateKey(privateKey);
  const publicFromKey = crypto.createPublicKey(key).export({ type: 'spki', format: 'der' });
  const publicFromCert = leaf.publicKey.export({ type: 'spki', format: 'der' });
  if (!publicFromKey.equals(publicFromCert))
    throw new Error('SSL-Zertifikat und privater Schlüssel passen nicht zusammen.');
  const fingerprint = leaf.fingerprint256.toLowerCase().replaceAll(':', '');
  return {
    leaf: blocks[0] + '\n',
    chain: blocks
      .slice(1)
      .map(x => x + '\n')
      .join(''),
    expiresAt: new Date(leaf.validTo),
    fingerprint
  };
}

export async function checkHostTls(hostname, { connect = tls.connect, timeoutMs = 7000 } = {}) {
  const host = normalizeHost(hostname);
  return new Promise(resolve => {
    let done = false;
    const finish = value => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(value);
    };
    const socket = connect({ host, port: 443, servername: host, rejectUnauthorized: true, timeout: timeoutMs }, () => {
      try {
        if (!socket.authorized) return finish({ ok: false });
        const cert = socket.getPeerCertificate(true);
        if (!cert?.fingerprint256) return finish({ ok: false });
        finish({ ok: true, fingerprint: cert.fingerprint256.toLowerCase().replaceAll(':', '') });
      } catch {
        finish({ ok: false });
      }
    });
    socket.on('timeout', () => finish({ ok: false }));
    socket.on('error', () => finish({ ok: false }));
  });
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
/** Query ALL of a zone's authoritative nameservers directly, bypassing
 * recursive negative caching. Return null if direct UDP DNS is unavailable.
 */
export async function authoritativeTxtMatch(
  fqdn,
  zone,
  expected,
  { lookupNs = dns.resolveNs, lookupA = dns.resolve4, Resolver = dns.Resolver } = {}
) {
  let checked = 0;
  let allMatched = true;
  let nameservers;
  try {
    nameservers = await lookupNs(zone);
  } catch {
    return null;
  }
  if (!nameservers?.length) return null;
  for (const server of nameservers.slice(0, 10)) {
    try {
      const addresses = await lookupA(String(server).replace(/\\.$/, ''));
      if (!addresses.length) return null;
      const resolver = new Resolver({ timeout: 2500, tries: 2 });
      resolver.setServers(addresses);
      const txt = (await resolver.resolveTxt(fqdn)).map(chunks => chunks.join(''));
      checked++;
      if (!txt.includes(expected)) allMatched = false;
    } catch (error) {
      // NXDOMAIN/NODATA is evidence the zone has not propagated.
      if (['ENODATA', 'ENOTFOUND', 'ENONAME'].includes(error?.code)) {
        checked++;
        allMatched = false;
      } else return null;
    }
  }
  return checked === nameservers.length && allMatched;
}

export async function waitForDnsTxt(
  host,
  expected,
  {
    zone = null,
    resolveTxt = dns.resolveTxt,
    authoritativeCheck = authoritativeTxtMatch,
    sleep = delay,
    timeoutMs = MAX_DNS_WAIT_MS
  } = {}
) {
  const stop = Date.now() + timeoutMs;
  while (Date.now() < stop) {
    let recursiveMatched = false;
    try {
      const values = (await resolveTxt(host)).map(chunks => chunks.join(''));
      recursiveMatched = values.includes(expected);
    } catch {
      // DNS propagation may be incomplete or cached negative.
    }
    if (recursiveMatched) {
      if (!zone) return;
      const authoritative = await authoritativeCheck(host, zone, expected);
      if (authoritative !== false) return;
    }
    await sleep(Math.min(10000, Math.max(0, stop - Date.now())));
  }
  throw new Error('ACME DNS-TXT-Eintrag ist innerhalb des Wartefensters nicht bei allen öffentlichen Resolvern sichtbar.');
}

/** acme-client 5 returns the final DNS-01 TXT value, not the raw token.keythumbprint.
 * Hashing it again breaks both library-side verification and Let's Encrypt.
 */
export function acmeDns01TxtValue(keyAuthorization) {
  if (typeof keyAuthorization !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(keyAuthorization))
    throw new Error('Ungültiger DNS-01-Prüfwert des ACME-Clients.');
  return keyAuthorization;
}

async function defaultIssuer({ hostname, email, accountKey, addTxt, removeTxt, checkTxt, staging }) {
  const acme = (await import('acme-client')).default;
  const key = accountKey || (await acme.crypto.createPrivateKey());
  const [privateKey, csr] = await acme.crypto.createCsr({ commonName: hostname, altNames: [hostname] });
  const client = new acme.Client({
    directoryUrl: staging ? acme.directory.letsencrypt.staging : acme.directory.letsencrypt.production,
    accountKey: key
  });
  const created = [];
  let certificate;
  try {
    certificate = await client.auto({
      csr,
      email,
      termsOfServiceAgreed: true,
      challengePriority: ['dns-01'],
      challengeCreateFn: async (authz, challenge, keyAuthorization) => {
        if (challenge.type !== 'dns-01' || authz.identifier?.value !== hostname)
          throw new Error('Unerwartete ACME-Identität oder Challenge.');
        const value = acmeDns01TxtValue(keyAuthorization);
        await addTxt(value);
        created.push(value);
        await checkTxt(value);
      },
      challengeRemoveFn: async (_authz, challenge, keyAuthorization) => {
        if (challenge.type !== 'dns-01') return;
        const value = acmeDns01TxtValue(keyAuthorization);
        await removeTxt(value);
        const index = created.indexOf(value);
        if (index >= 0) created.splice(index, 1);
      }
    });
  } finally {
    // Even failed orders must not strand temporary DNS records.
    for (const value of created) {
      try {
        await removeTxt(value);
      } catch {
        // Retain the error from ACME; the next run cleans up only its own records.
      }
    }
  }
  return { accountKey: key, privateKey, certificate };
}

function safeError(error) {
  return String(error?.message || 'Unbekannter SSL-Fehler')
    .replace(/-----BEGIN [\s\S]*?-----END [^-]+-----/g, '[redacted]')
    .slice(0, 420);
}

function publicRow(row) {
  if (!row) return null;
  return {
    hostname: row.hostname,
    accountId: row.account_id,
    state: row.state,
    autoRenew: Boolean(row.auto_renew),
    expiresAt: row.expires_at,
    lastAttemptAt: row.last_attempt_at,
    lastError: row.last_error,
    updatedAt: row.updated_at
  };
}

/**
 * Diagnose live authoritative delegation and DNS-01 publication without
 * making DNS changes or exposing ACME values to the caller.
 */
export async function inspectAcmeDns({
  hostname,
  domains,
  records,
  lookupNs = dns.resolveNs,
  lookupTxt = dns.resolveTxt,
  lookupSoa = dns.resolveSoa
}) {
  const details = sslDnsName(hostname, domains);
  const reported = {
    hostname: normalizeHost(hostname),
    zone: details.zone,
    recordName: details.fqdn,
    relativeName: details.relative,
    authoritativeNameservers: [],
    nameserverProvider: 'unknown',
    soaPrimary: null,
    kasTxtCount: 0,
    publicTxtCount: 0,
    publishedMatchesKas: false,
    dnsError: null
  };
  try {
    reported.authoritativeNameservers = (await lookupNs(details.zone)).map(x =>
      String(x).replace(/\.$/, '').toLowerCase()
    );
    reported.nameserverProvider =
      reported.authoritativeNameservers.length &&
      reported.authoritativeNameservers.every(n => n.endsWith('.kasserver.com'))
        ? 'allinkl'
        : 'external_or_unknown';
  } catch (error) {
    reported.dnsError = 'NS: ' + String(error.code || error.message || 'unknown').slice(0, 80);
  }
  try {
    reported.soaPrimary = String((await lookupSoa(details.zone)).nsname || '')
      .replace(/\.$/, '')
      .toLowerCase();
  } catch {}
  const kasValues = new Set(
    records
      .filter(
        r =>
          r.type === 'TXT' &&
          String(r.name || '')
            .replace(/\.$/, '')
            .toLowerCase() === details.relative
      )
      .map(r => String(r.value || '').replace(/^"|"$/g, ''))
  );
  reported.kasTxtCount = kasValues.size;
  try {
    const values = (await lookupTxt(details.fqdn)).map(chunks => chunks.join(''));
    reported.publicTxtCount = values.length;
    reported.publishedMatchesKas = values.some(value => kasValues.has(value));
  } catch (error) {
    reported.dnsError = [reported.dnsError, 'TXT: ' + String(error.code || error.message || 'unknown').slice(0, 80)]
      .filter(Boolean)
      .join('; ');
  }
  reported.finding =
    reported.nameserverProvider === 'external_or_unknown'
      ? 'Die autoritativen Nameserver sind nicht ausschließlich ALL-INKL. TXT-Einträge in KAS sind möglicherweise nicht öffentlich wirksam.'
      : reported.kasTxtCount && !reported.publishedMatchesKas
        ? 'KAS hat TXT-Einträge, aber das öffentliche DNS liefert sie nicht. Autoritative Zone/TTL prüfen.'
        : reported.kasTxtCount && reported.publishedMatchesKas
          ? 'KAS- und öffentliche DNS-TXT-Einträge stimmen überein.'
          : 'Es gibt aktuell keinen ACME-TXT-Prüfeintrag. Autoritative Nameserver wurden unabhängig davon geprüft.';
  return reported;
}

export function createAllInklSslService({
  db,
  allInklService,
  encrypt,
  decrypt,
  issuer = defaultIssuer,
  tlsCheck = checkHostTls,
  dnsCheck = waitForDnsTxt,
  staging = process.env.SITEOPS_ACME_STAGING === 'true'
}) {
  let ticking = false;
  const get = async hostname => {
    const [rows] = await db.query('select * from allinkl_ssl_certificates where hostname=? limit 1', [
      normalizeHost(hostname)
    ]);
    return rows[0] || null;
  };
  async function ensureAccountHost(accountId, hostname) {
    const names = kasDomainNames(await allInklService.domains(accountId));
    const dnsName = sslDnsName(hostname, names);
    // Never create certificates for unrelated or non-existent subdomains.
    const subdomains = await allInklService.subdomains(accountId);
    const found = subdomains.some(s =>
      [s.subdomain_name, s.hostname, s.name].some(
        v =>
          String(v || '')
            .replace(/\.$/, '')
            .toLowerCase() === hostname
      )
    );
    if (!found) throw new Error('Die Subdomain existiert nicht im gewählten ALL-INKL-Konto.');
    return dnsName;
  }
  async function diagnose(accountId, hostname) {
    const host = normalizeHost(hostname);
    const details = await ensureAccountHost(accountId, host);
    const records = await allInklService.records(accountId, details.zone);
    return inspectAcmeDns({
      hostname: host,
      domains: await allInklService.domains(accountId),
      records
    });
  }
  async function list() {
    const [rows] = await db.query(
      'select hostname,account_id,state,auto_renew,expires_at,last_attempt_at,last_error,updated_at from allinkl_ssl_certificates order by hostname'
    );
    return rows.map(publicRow);
  }
  async function status(hostname) {
    const row = await get(hostname);
    if (!row) return { hostname: normalizeHost(hostname), state: 'unmanaged', autoRenew: false };
    return publicRow(row);
  }
  async function enqueue(input) {
    const x = allinklSslRequestSchema.parse(input),
      hostname = normalizeHost(x.hostname);
    await ensureAccountHost(x.accountId, hostname);
    const previous = await get(hostname);
    if (previous && previous.account_id !== x.accountId)
      throw new Error('SSL-Verwaltung gehört bereits zu einem anderen ALL-INKL-Konto.');
    await db.query(
      `insert into allinkl_ssl_certificates (id,account_id,hostname,email,state,auto_renew)
       values (?,?,?,?,?,?) on duplicate key update
       email=values(email),auto_renew=values(auto_renew),
       state=if(state='active' and expires_at > UTC_TIMESTAMP() + interval 30 day,'active','queued'),
       last_error=null`,
      [crypto.randomUUID(), x.accountId, hostname, x.email, 'queued', x.autoRenew ? 1 : 0]
    );
    return status(hostname);
  }
  async function removeTxt(accountId, details, value) {
    const rows = await allInklService.records(accountId, details.zone);
    const matching = rows.filter(
      r =>
        r.type === 'TXT' &&
        String(r.name).replace(/\.$/, '').toLowerCase() === details.relative &&
        String(r.value).replace(/^"|"$/g, '') === value
    );
    for (const entry of matching)
      if (entry.id != null) await allInklService.removeRecord(accountId, details.zone, entry.id);
  }
  async function issue(hostname, { forceRenew = false } = {}) {
    const name = normalizeHost(hostname);
    const lockName = 'siteops:ssl:' + crypto.createHash('sha256').update(name).digest('hex').slice(0, 40);
    const lock = await db.getConnection();
    let acquired = false;
    try {
      const [[result]] = await lock.query('select GET_LOCK(?,0) as acquired', [lockName]);
      acquired = Boolean(result.acquired);
      if (!acquired) return { ...(await status(name)), busy: true };
      const row = await get(name);
      if (!row) throw new Error('SSL muss zunächst für ein ALL-INKL-Konto eingerichtet werden.');
      const https = await tlsCheck(name);
      // Preserve HTTPS already served by a separate certificate manager. ACME
      // should never silently replace a valid, externally managed certificate.
      if (!forceRenew && !row.certificate_pem && https.ok) {
        await db.query(
          "update allinkl_ssl_certificates set state='external',auto_renew=0,last_error=null where hostname=?",
          [name]
        );
        return { ...(await status(name)), https: true, managedBySiteOps: false };
      }
      if (!forceRenew && row.certificate_pem && row.fingerprint_sha256 === https.fingerprint && https.ok) {
        if (row.state !== 'active')
          await db.query("update allinkl_ssl_certificates set state='active',last_error=null where hostname=?", [name]);
        if (new Date(row.expires_at).getTime() - Date.now() > RENEW_WINDOW_MS)
          return { ...(await status(name)), https: true };
      }
      if (
        !forceRenew &&
        row.certificate_pem &&
        row.state === 'pending' &&
        new Date(row.expires_at).getTime() > Date.now() + 7 * 86400_000
      )
        return { ...(await status(name)), https: false, waitingForActivation: true };
      const details = await ensureAccountHost(row.account_id, name);
      await db.query(
        "update allinkl_ssl_certificates set state='issuing',last_error=null,last_attempt_at=UTC_TIMESTAMP() where hostname=?",
        [name]
      );
      try {
        const previousKey = row.account_key_encrypted ? decrypt(row.account_key_encrypted) : null;
        const generated = await issuer({
          hostname: name,
          email: row.email,
          accountKey: previousKey,
          staging,
          addTxt: value =>
            allInklService.addRecord(row.account_id, {
              zone: details.zone,
              name: details.relative,
              type: 'TXT',
              value
            }),
          removeTxt: value => removeTxt(row.account_id, details, value),
          checkTxt: value => dnsCheck(details.fqdn, value, { zone: details.zone })
        });
        const validated = inspectCertificate({
          hostname: name,
          certificate: generated.certificate,
          privateKey: generated.privateKey
        });
        // Persist secret key and cert BEFORE calling KAS, so an interrupted
        // remote install can be reconciled without issuing a second certificate.
        await db.query(
          `update allinkl_ssl_certificates set account_key_encrypted=?,private_key_encrypted=?,
            certificate_pem=?,chain_pem=?,fingerprint_sha256=?,expires_at=?,
            state='installing',last_error=null where hostname=?`,
          [
            encrypt(generated.accountKey),
            encrypt(generated.privateKey),
            validated.leaf,
            validated.chain,
            validated.fingerprint,
            validated.expiresAt,
            name
          ]
        );
        await allInklService.installCertificate(row.account_id, name, {
          certificate: validated.leaf,
          chain: validated.chain,
          privateKey: generated.privateKey
        });
        await db.query("update allinkl_ssl_certificates set state='pending' where hostname=?", [name]);
        return { ...(await status(name)), https: false, waitingForActivation: true };
      } catch (error) {
        // Never log, save or expose private keys or raw ACME credentials.
        await db.query("update allinkl_ssl_certificates set state='failed',last_error=? where hostname=?", [
          safeError(error),
          name
        ]);
        throw new Error('SSL-Ausstellung oder KAS-Einbindung fehlgeschlagen: ' + safeError(error));
      }
    } finally {
      if (acquired) await lock.query('select RELEASE_LOCK(?)', [lockName]);
      lock.release();
    }
  }
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const [rows] = await db.query(
        `select hostname,state from allinkl_ssl_certificates
         where state in ('queued','pending','installing') or
           (state='active' and auto_renew=1 and expires_at < UTC_TIMESTAMP() + interval 30 day)
         order by case when state='pending' then 0 else 1 end,updated_at limit 8`
      );
      await Promise.allSettled(rows.map(async row => {
        try {
          if (row.state === 'pending' || row.state === 'installing') {
            const stored = await get(row.hostname);
            const tlsStatus = await tlsCheck(row.hostname);
            if (stored.fingerprint_sha256 !== tlsStatus.fingerprint || !tlsStatus.ok) {
              if (row.state === 'installing' && stored.private_key_encrypted && stored.certificate_pem) {
                await allInklService.installCertificate(stored.account_id, stored.hostname, {
                  certificate: stored.certificate_pem,
                  chain: stored.chain_pem || '',
                  privateKey: decrypt(stored.private_key_encrypted)
                });
                await db.query("update allinkl_ssl_certificates set state='pending' where hostname=?", [row.hostname]);
              }
              return;
            }
            await db.query("update allinkl_ssl_certificates set state='active',last_error=null where hostname=?", [
              row.hostname
            ]);
            // Resume only interrupted first-install CMS jobs on this precise host.
            // Failures with other causes are left to operators.
            const [cms] = await db.query(
              `select j.id from cms_jobs j
               join cms_installations i on i.id=j.installation_id
               where i.base_url in (?,?) and j.kind='install' and j.state='needs_attention' and j.phase='preflight'
               order by j.created_at desc limit 1`,
              ['https://' + row.hostname, 'https://' + row.hostname + '/']
            );
            if (cms.length)
              await db.query(
                "update cms_jobs set state='queued',phase='queued',error=null,run_at=UTC_TIMESTAMP(),finished_at=null where id=? and state='needs_attention'",
                [cms[0].id]
              );
          } else await issue(row.hostname);
        } catch (error) {
          // Only controlled summary; background failures remain visible via status.
          console.warn('ALL-INKL SSL worker:', row.hostname, safeError(error));
        }
      }));
    } finally {
      ticking = false;
    }
  }
  function startWorker() {
    tick().catch(e => console.warn('ALL-INKL SSL startup', safeError(e)));
    setInterval(() => tick().catch(e => console.warn('ALL-INKL SSL worker', safeError(e))), 60_000).unref();
  }
  return { list, status, diagnose, enqueue, issue, tick, startWorker };
}
