import { resolveNs, Resolver } from 'node:dns/promises';
import { publicAddresses } from './coolify-public-http.mjs';
import { searchConsoleJson } from './search-console-client.mjs';

const fail = message => {
  throw Object.assign(new Error(message), { statusCode: 409 });
};
export const googleTxt = value => /^google-site-verification=[A-Za-z0-9_-]{10,200}$/.test(value);
const clean = value =>
  String(value || '')
    .toLowerCase()
    .replace(/\.$/, '');
export const txtValue = value => String(value || '').replace(/^"|"$/g, '');
export function recordName(name, zone) {
  const n = clean(name);
  return ['', '@', zone].includes(n) ? '@' : n.endsWith('.' + zone) ? n.slice(0, -zone.length - 1) : n;
}
export async function dnsAuthority(domain, ns = resolveNs) {
  const parts = domain.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const zone = parts.slice(i).join('.');
    let servers;
    try {
      servers = (await ns(zone)).map(clean).sort();
    } catch (error) {
      if (['ENODATA', 'ENOTFOUND'].includes(error.code)) continue;
      throw error;
    }
    if (!servers.length) continue;
    const provider = servers.every(x => x.endsWith('.kasserver.com'))
      ? 'allinkl'
      : servers.every(x => /\.(dns-parking\.com|hostinger\.com|hostinger-dns\.com)$/.test(x))
        ? 'hostinger'
        : null;
    if (!provider) fail('Autoritativer DNS-Anbieter wird nicht unterstützt. TXT-Eintrag manuell setzen.');
    return { zone, servers, provider };
  }
  fail('Autoritative DNS-Zone konnte nicht ermittelt werden.');
}

export function createSearchConsoleDns({
  allInklService,
  hostingerToken,
  fetcher = fetch,
  authority = dnsAuthority,
  addresses = publicAddresses,
  resolver = () => new Resolver({ timeout: 3000, tries: 1 })
}) {
  async function hostinger(zone, method = 'GET', body) {
    const token = await hostingerToken();
    if (!token) fail('Hostinger-API-Token zuerst in SiteOps konfigurieren.');
    let response;
    try {
      response = await fetcher('https://developers.hostinger.com/api/dns/v1/zones/' + encodeURIComponent(zone), {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
    } catch {
      fail('Hostinger-DNS-Anfrage unbestätigt. Vor erneutem Versuch DNS-Status prüfen.');
    }
    if (!response.ok) fail('Hostinger verweigert DNS-Zugriff (HTTP ' + response.status + ').');
    const result = await searchConsoleJson(response);
    if (method !== 'GET') return result;
    if (!Array.isArray(result) || result.some(x => !Array.isArray(x.records) || !x.type || typeof x.name !== 'string'))
      fail('Hostinger liefert keine gültige DNS-Zone.');
    return result.flatMap(x =>
      x.records.filter(r => !r.is_disabled).map(r => ({ name: x.name, type: x.type, value: r.content, ttl: x.ttl }))
    );
  }
  async function inspect(domain, value, accountId) {
    if (!googleTxt(value)) fail('Ungültiger Google-Verifizierungseintrag.');
    const target = await authority(domain);
    if (target.provider === 'allinkl' && !accountId) fail('ALL-INKL-Konto auswählen.');
    const records =
      target.provider === 'allinkl'
        ? await allInklService.records(accountId, target.zone)
        : await hostinger(target.zone);
    const name = domain === target.zone ? '@' : domain.slice(0, -target.zone.length - 1);
    const direct = records.filter(r => recordName(r.name, target.zone) === name);
    if (direct.some(r => r.type === 'CNAME')) fail('CNAME-Konflikt am Verifizierungsnamen.');
    return {
      ...target,
      accountId: target.provider === 'allinkl' ? accountId : null,
      name,
      type: 'TXT',
      value,
      ttl: direct.find(r => r.type === 'TXT')?.ttl || 300,
      action: direct.some(r => r.type === 'TXT' && txtValue(r.value) === value) ? 'reuse' : 'append'
    };
  }
  async function apply(plan) {
    const domain = plan.name === '@' ? plan.zone : plan.name + '.' + plan.zone;
    const current = await inspect(domain, plan.value, plan.accountId);
    for (const key of ['zone', 'provider', 'name'])
      if (plan[key] !== current[key]) fail('DNS-Zuständigkeit hat sich geändert. Neue Vorschau erforderlich.');
    if (JSON.stringify(plan.servers) !== JSON.stringify(current.servers)) fail('Nameserver haben sich geändert.');
    if (current.action === 'reuse') return { dns_status: 'already_present', record: current };
    if (current.provider === 'allinkl')
      await allInklService.addGoogleVerificationTxt(current.accountId, domain, current.value);
    else
      await hostinger(current.zone, 'PUT', {
        overwrite: false,
        zone: [{ name: current.name, type: 'TXT', ttl: current.ttl, records: [{ content: current.value }] }]
      });
    return { dns_status: 'submitted', record: current, google_verified: false };
  }
  async function present(domain, value) {
    const target = await authority(domain);
    // Query every authoritative nameserver directly, using only public addresses.
    for (const server of target.servers) {
      const entries = await addresses(server),
        client = resolver();
      client.setServers(entries.map(x => x.address));
      let values;
      try {
        values = await client.resolveTxt(domain);
      } catch {
        return false;
      }
      if (!values.some(parts => parts.join('') === value)) return false;
    }
    return true;
  }
  return { inspect, apply, present };
}
