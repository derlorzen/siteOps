import { request as httpsRequest } from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isPublicIpv4, withDeadline } from './tools.mjs';

export function publicIp(ip) {
  if (isIP(ip) === 4) return isPublicIpv4(ip);
  // Only global unicast. Exclude IPv4-mapped, documentation and transition space.
  if (isIP(ip) !== 6) return false;
  const normalized = new URL('http://[' + ip + ']/').hostname.slice(1, -1);
  return /^[23]/i.test(normalized) && !/^(?:2001:(?:db8|0:|2:|10:|20:)|2002:|3fff:)/i.test(normalized);
}

export async function publicAddresses(host, resolver = lookup) {
  const entries = await withDeadline(resolver(host, { all: true }), 5000, 'DNS-Zeitlimit erreicht.');
  if (!entries.length || entries.some(x => !publicIp(x.address)))
    throw new Error('Ziel verweist auf interne oder reservierte IP-Adressen.');
  return entries;
}

// Pin the resolved address in the TLS socket. Checking DNS before global fetch
// would leave a DNS-rebinding window. Redirects are validated independently.
export async function publicHttp(raw, { headers = {}, maxBytes = 1_000_000, redirects = 3 } = {}) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hostname.endsWith('.local'))
    throw new Error('Nur öffentliche HTTPS-URLs ohne Zugangsdaten oder Sonderport erlaubt.');
  const entries = await publicAddresses(url.hostname);
  const entry = entries[0];
  const result = await new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const req = httpsRequest(
      url,
      {
        agent: false,
        maxHeaderSize: 16384,
        lookup: (_host, opts, cb) => (opts?.all ? cb(null, [entry]) : cb(null, entry.address, entry.family)),
        headers: {
          'User-Agent': 'SiteOps-Coolify-Analyzer/1',
          Accept: '*/*',
          'Accept-Encoding': 'identity',
          ...headers
        }
      },
      res => {
        res.on('data', chunk => {
          size += chunk.length;
          if (size > maxBytes) req.destroy(new Error('Antwort überschreitet das Größenlimit.'));
          else chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
            url: url.href
          })
        );
      }
    );
    const timer = setTimeout(() => req.destroy(new Error('HTTPS-Zeitlimit erreicht.')), 15000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', () => reject(new Error('Öffentlicher HTTPS-Abruf fehlgeschlagen.')));
    req.end();
  });
  if ([301, 302, 303, 307, 308].includes(result.status)) {
    if (!redirects || !result.headers.location) throw new Error('Zu viele oder ungültige Weiterleitungen.');
    // Never forward Basic authentication to another origin.
    const next = new URL(result.headers.location, url);
    if (headers.Authorization && next.origin !== url.origin)
      throw new Error('Authentifizierte Weiterleitung zu fremdem Host abgelehnt.');
    return publicHttp(next.href, { headers, maxBytes, redirects: redirects - 1 });
  }
  return result;
}

export function maskSecrets(value, secrets = []) {
  let text = String(value ?? '');
  for (const secret of secrets.filter(x => typeof x === 'string' && x.length).sort((a, b) => b.length - a.length)) {
    for (const form of new Set([
      secret,
      JSON.stringify(secret).slice(1, -1),
      encodeURIComponent(secret),
      Buffer.from(secret).toString('base64')
    ]))
      text = text.split(form).join('[redacted]');
  }
  return text
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, 'Basic [redacted]')
    .replace(/((?:password|secret|token|api[_-]?key|authorization)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@');
}

export function redactValue(value, secrets = []) {
  if (typeof value === 'string') return maskSecrets(value, secrets);
  if (Array.isArray(value)) return value.map(v => redactValue(v, secrets));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactValue(v, secrets)]));
  return value;
}
