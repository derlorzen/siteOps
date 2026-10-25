import { isIP } from 'node:net';

export const DEMO_POLICY_VERSION = 1;
const invalid = () => {
  throw Object.assign(
    new Error('Demo-Domain ungültig: nur vollständige DNS-Namen oder *.domain.tld, ohne URL, Port oder Allow-all.'),
    { statusCode: 422, code: 'INVALID_DEMO_POLICY' }
  );
};

export function normalizeDemoHosts(input) {
  if (!Array.isArray(input) || input.length > 100) return invalid();
  const rules = input.map(value => {
    if (typeof value !== 'string' || value.length > 255) return invalid();
    const rule = value.trim().toLowerCase();
    const host = rule.startsWith('*.') ? rule.slice(2) : rule;
    if (
      !host ||
      host.length > 253 ||
      isIP(host) ||
      !host.includes('.') ||
      !/^[a-z0-9.-]+$/.test(host) ||
      !/[a-z]/.test(host.split('.').at(-1)) ||
      host.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
      new URL('https://' + host).hostname !== host
    )
      return invalid();
    return rule;
  });
  return [...new Set(rules)].sort();
}

export function demoHostMatches(hostname, rules) {
  const host = hostname.toLowerCase();
  return normalizeDemoHosts(rules).some(rule =>
    rule.startsWith('*.') ? host.endsWith('.' + rule.slice(2)) && host !== rule.slice(2) : host === rule
  );
}

export function demoPolicy(input) {
  if (
    !input ||
    input.version !== DEMO_POLICY_VERSION ||
    Object.keys(input).some(key => !['version', 'hosts'].includes(key))
  )
    return invalid();
  return { version: DEMO_POLICY_VERSION, hosts: normalizeDemoHosts(input.hosts) };
}

export function environmentDemoPolicy(value = process.env.VIDEO_ALLOWED_HOSTS || '') {
  return demoPolicy({ version: DEMO_POLICY_VERSION, hosts: value.trim() ? value.split(',') : [] });
}
