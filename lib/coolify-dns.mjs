import { isIP } from 'node:net';
import { kasDomainNames } from './allinkl.mjs';
import { publicAddresses, publicIp } from './coolify-public-http.mjs';

export function createCoolifyDns({ allInklService, addresses = publicAddresses }) {
  async function inspect({ domain, serverIp, accountId }) {
    if (!publicIp(serverIp))
      throw new Error(
        'Coolify meldet keine öffentliche Server-IP. NAT-Ziele müssen zuerst in Coolify korrekt konfiguriert werden.'
      );
    const candidates = [];
    for (const account of await allInklService.list()) {
      if (accountId && account.id !== accountId) continue;
      for (const zone of kasDomainNames(await allInklService.domains(account.id)))
        if (domain === zone || domain.endsWith('.' + zone)) candidates.push({ accountId: account.id, zone });
    }
    const longest = Math.max(...candidates.map(x => x.zone.length));
    const matches = candidates.filter(x => x.zone.length === longest);
    if (matches.length !== 1) throw new Error('DNS-Konto nicht eindeutig ermittelt; ALL-INKL-Konto auswählen.');
    const target = matches[0];
    const diagnostics = await allInklService.diagnostics(target.accountId, target.zone);
    if (diagnostics.publicDnsProvider !== 'allinkl')
      throw new Error('Öffentliche DNS-Zuständigkeit liegt nicht nachweislich bei ALL-INKL. Keine DNS-Änderung.');
    const relative = domain === target.zone ? '@' : domain.slice(0, -target.zone.length - 1);
    const records = await allInklService.records(target.accountId, target.zone);
    const name = value => {
      const v = String(value || '')
        .toLowerCase()
        .replace(/\.$/, '');
      return ['', '@', target.zone].includes(v)
        ? '@'
        : v.endsWith('.' + target.zone)
          ? v.slice(0, -target.zone.length - 1)
          : v;
    };
    const direct = records.filter(r => name(r.name) === relative);
    const routing = direct.filter(r => ['A', 'AAAA', 'CNAME'].includes(r.type));
    for (const record of routing) {
      if (record.type === 'CNAME') {
        const resolved = await addresses(String(record.value).replace(/\.$/, ''));
        if (!resolved.every(x => x.address === serverIp))
          throw new Error('Widersprüchlicher CNAME-Eintrag. Keine Änderung.');
      } else if (record.value !== serverIp) throw new Error('Widersprüchlicher A-/AAAA-Eintrag. Keine Änderung.');
    }
    const wildcard = records.filter(r => name(r.name) === '*' && ['A', 'AAAA', 'CNAME'].includes(r.type));
    if (!routing.length && wildcard.some(r => r.type === 'CNAME' || r.value !== serverIp))
      throw new Error('Widersprüchlicher Wildcard-DNS-Eintrag; explizite DNS-Klärung erforderlich.');
    return {
      ...target,
      domain,
      serverIp,
      name: relative,
      type: isIP(serverIp) === 6 ? 'AAAA' : 'A',
      action: routing.length ? 'reuse' : 'create'
    };
  }
  async function ensure(input) {
    // Re-read at execution time: plans are not permission to overwrite changes.
    const plan = await inspect(input);
    if (plan.action === 'create')
      await allInklService.addRecord(plan.accountId, {
        zone: plan.zone,
        name: plan.name,
        type: plan.type,
        value: plan.serverIp
      });
    return { ...plan, ensured: true };
  }
  return { inspect, ensure };
}
