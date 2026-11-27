// Link and resource checker for the SEO suite. Technique adapted from linkinator (MIT) and
// lychee (Apache-2.0/MIT): HEAD first, GET with a one-byte range when a server rejects HEAD,
// one retry on 429/503 honouring Retry-After, per-host concurrency limits and separate
// classification of responses that only block automated clients.
//
// Runs in-process. Every URL is checked once per run; callers map results back to pages.

const HEAD_FALLBACK = new Set([400, 403, 404, 405, 406, 410, 429, 500, 501, 503]);
// Typical bot walls (LinkedIn uses 999). These are reported separately, not as broken links.
const BLOCKED = new Set([401, 403, 999]);
const RETRY = new Set([429, 503]);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function retryAfterMs(value, maxMs = 10000) {
  if (!value) return 1000;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(maxMs, Math.max(0, seconds * 1000));
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.min(maxMs, Math.max(0, at - Date.now())) : 1000;
}

export function classifyStatus(status) {
  if (!status) return 'broken';
  if (status >= 200 && status < 400) return 'ok';
  if (BLOCKED.has(status)) return 'blocked';
  if (status === 429) return 'unchecked';
  return 'broken';
}

/**
 * @param {string[]} urls
 * @param {object} options
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} options.userAgent
 * @param {(url: URL) => Promise<void>} [options.guard] throws for URLs that must not be requested
 * @param {number} [options.concurrency=8]
 * @param {number} [options.perHost=2]
 * @param {number} [options.timeoutMs=10000]
 * @returns {Promise<Map<string, {url:string,status:number,kind:string,error?:string,method:string}>>}
 */
export async function checkUrls(
  urls,
  { fetchImpl = fetch, userAgent, guard, concurrency = 8, perHost = 2, timeoutMs = 10000 } = {}
) {
  const unique = [...new Set(urls)],
    results = new Map(),
    activeByHost = new Map();

  async function request(url, method) {
    const headers = { 'User-Agent': userAgent || 'SiteOps-SEO', accept: '*/*' };
    if (method === 'GET') headers.Range = 'bytes=0-0';
    const res = await fetchImpl(url, {
      method,
      redirect: 'follow',
      headers,
      signal: AbortSignal.timeout(timeoutMs)
    });
    // Do not download bodies.
    res.body?.cancel?.().catch?.(() => {});
    return res;
  }

  async function checkOne(url) {
    let parsed;
    try {
      parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Kein HTTP-Link');
      if (guard) await guard(parsed);
    } catch (e) {
      return { url, status: 0, kind: 'skipped', error: String(e.message || e), method: 'none' };
    }
    let method = 'HEAD';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        let res = await request(url, 'HEAD');
        method = 'HEAD';
        if (HEAD_FALLBACK.has(res.status)) {
          res = await request(url, 'GET');
          method = 'GET';
        }
        if (RETRY.has(res.status) && attempt === 0) {
          await sleep(retryAfterMs(res.headers.get('retry-after')));
          continue;
        }
        return { url, status: res.status, kind: classifyStatus(res.status), method };
      } catch (e) {
        if (attempt === 0) continue;
        return { url, status: 0, kind: 'broken', error: String(e.cause?.code || e.message || e), method };
      }
    }
    return { url, status: 0, kind: 'broken', method };
  }

  async function worker() {
    for (;;) {
      let picked = -1;
      for (let i = 0; i < unique.length; i++) {
        let host = '';
        try {
          host = new URL(unique[i]).host;
        } catch {
          // invalid URLs are checked (and skipped) like any other
        }
        if ((activeByHost.get(host) || 0) < perHost) {
          picked = i;
          break;
        }
      }
      if (picked < 0) {
        if (!unique.length) return;
        await sleep(25);
        continue;
      }
      const [url] = unique.splice(picked, 1);
      let host = '';
      try {
        host = new URL(url).host;
      } catch {
        // see above
      }
      activeByHost.set(host, (activeByHost.get(host) || 0) + 1);
      try {
        results.set(url, await checkOne(url));
      } finally {
        activeByHost.set(host, activeByHost.get(host) - 1);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(32, concurrency)) }, worker));
  return results;
}
