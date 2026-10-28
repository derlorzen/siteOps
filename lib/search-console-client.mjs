// Shared Google Search Console transport for the dashboard and MCP.
// OAuth token acquisition, project permission checks and DNS writes are deliberately
// injected by callers. Never accept arbitrary Google API hosts from an MCP argument.
const SEARCH = 'https://searchconsole.googleapis.com';
const WEBMASTERS = 'https://www.googleapis.com/webmasters/v3';
const VERIFY = 'https://www.googleapis.com/siteVerification/v1';

export async function searchConsoleJson(response, limit = 4_000_000) {
  const reader = response.body?.getReader();
  if (!reader) return {};
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw Object.assign(new Error('Google response too large'), { statusCode: 502 });
      }
      chunks.push(Buffer.from(value));
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    if (error.statusCode) throw error;
    throw Object.assign(new Error('Invalid Google API response'), { statusCode: 502 });
  } finally {
    reader.releaseLock();
  }
}

export const searchConsoleScopes = Object.freeze([
  'https://www.googleapis.com/auth/webmasters',
  'https://www.googleapis.com/auth/siteverification'
]);

function requireProperty(property) {
  if (typeof property !== 'string' || property.length > 500) throw new TypeError('Invalid property');
  if (property.startsWith('sc-domain:')) {
    const domain = property.slice(10);
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain))
      throw new TypeError('Invalid domain property');
    return property;
  }
  let parsed;
  try {
    parsed = new URL(property);
  } catch {
    throw new TypeError('Invalid URL-prefix property');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    parsed.port
  )
    throw new TypeError('Only canonical HTTPS URL-prefix properties are supported');
  return parsed.href;
}

function propertyPath(property) {
  return encodeURIComponent(requireProperty(property));
}

export function createSearchConsoleClient({ accessToken, fetcher = fetch, timeout = 20000 }) {
  if (typeof accessToken !== 'string' || !accessToken) throw new TypeError('Access token required');
  async function request(url, { method = 'GET', body } = {}) {
    const u = new URL(url);
    if (!['searchconsole.googleapis.com', 'www.googleapis.com'].includes(u.hostname) || u.protocol !== 'https:')
      throw new TypeError('Untrusted API endpoint');
    let response;
    try {
      response = await fetcher(u.href, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(timeout),
        headers: {
          Authorization: 'Bearer ' + accessToken,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    } catch {
      throw Object.assign(new Error('Google API connection failed'), { statusCode: 503 });
    }
    const result = await searchConsoleJson(response);
    if (!response.ok) {
      const statusCode = response.status === 429 ? 429 : response.status >= 500 ? 502 : response.status;
      const err = new Error('Google API rejected the request (HTTP ' + response.status + ')');
      err.statusCode = statusCode;
      err.googleReason = String(result.error?.status || '').slice(0, 60);
      throw err;
    }
    return result;
  }
  return Object.freeze({
    listProperties: () => request(WEBMASTERS + '/sites'),
    getProperty: property => request(WEBMASTERS + '/sites/' + propertyPath(property)),
    addProperty: property => request(WEBMASTERS + '/sites/' + propertyPath(property), { method: 'PUT' }),
    // In Google Site Verification, verification type INET_DOMAIN + method DNS_TXT
    // yields token in response.token. Domain property must NOT use a URL-prefix token.
    getDnsToken: property => {
      const p = requireProperty(property);
      if (!p.startsWith('sc-domain:')) throw new TypeError('DNS verification requires a domain property');
      return request(VERIFY + '/token', {
        method: 'POST',
        body: { site: { type: 'INET_DOMAIN', identifier: p.slice(10) }, verificationMethod: 'DNS_TXT' }
      });
    },
    confirmDnsVerification: property => {
      const p = requireProperty(property);
      if (!p.startsWith('sc-domain:')) throw new TypeError('DNS verification requires a domain property');
      return request(VERIFY + '/webResource?verificationMethod=DNS_TXT', {
        method: 'POST',
        body: { site: { type: 'INET_DOMAIN', identifier: p.slice(10) } }
      });
    },
    listSitemaps: property => request(WEBMASTERS + '/sites/' + propertyPath(property) + '/sitemaps'),
    submitSitemap: (property, sitemapUrl) => {
      const p = requireProperty(property);
      const sitemap = new URL(sitemapUrl);
      if (
        sitemap.protocol !== 'https:' ||
        sitemap.username ||
        sitemap.password ||
        sitemap.hash ||
        (p.startsWith('sc-domain:')
          ? !(sitemap.hostname === p.slice(10) || sitemap.hostname.endsWith('.' + p.slice(10)))
          : !sitemap.href.startsWith(p))
      )
        throw new TypeError('Sitemap is outside the verified property');
      return request(WEBMASTERS + '/sites/' + propertyPath(p) + '/sitemaps/' + encodeURIComponent(sitemap.href), {
        method: 'PUT'
      });
    },
    searchAnalytics: (property, { startDate, endDate, dimensions = ['date'], rowLimit = 1000, startRow = 0 } = {}) => {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(startDate || '') ||
        !/^\d{4}-\d{2}-\d{2}$/.test(endDate || '') ||
        startDate > endDate ||
        !Number.isInteger(rowLimit) ||
        rowLimit < 1 ||
        rowLimit > 25000 ||
        !Number.isInteger(startRow) ||
        startRow < 0 ||
        !Array.isArray(dimensions) ||
        dimensions.length > 5 ||
        dimensions.some(x => !['date', 'query', 'page', 'country', 'device', 'searchAppearance'].includes(x))
      )
        throw new TypeError('Invalid Search Analytics range or dimensions');
      return request(SEARCH + '/webmasters/v3/sites/' + propertyPath(property) + '/searchAnalytics/query', {
        method: 'POST',
        body: { startDate, endDate, dimensions, rowLimit, startRow, dataState: 'final' }
      });
    },
    inspectUrl: (property, inspectionUrl) => {
      const p = requireProperty(property);
      const u = new URL(inspectionUrl);
      if (
        u.protocol !== 'https:' ||
        u.username ||
        u.password ||
        u.port ||
        u.hash ||
        (p.startsWith('sc-domain:')
          ? !(u.hostname === p.slice(10) || u.hostname.endsWith('.' + p.slice(10)))
          : !u.href.startsWith(p))
      )
        throw new TypeError('URL is outside property');
      return request(SEARCH + '/v1/urlInspection/index:inspect', {
        method: 'POST',
        body: { siteUrl: p, inspectionUrl: u.href }
      });
    }
  });
}
