// Crawl scheduling for the SEO / Quality Suite, built on Crawlee's BasicCrawler.
//
// Crawlee (Apache-2.0, https://github.com/apify/crawlee) provides the request queue,
// deduplication, autoscaled concurrency, per-minute rate limiting and retries. SiteOps keeps
// its own page fetcher (manual redirect capture, Browser Runner render fallback) and the
// complete page analysis; this module only decides which URL is crawled when.
//
// Everything runs in-process with in-memory storage: no files under ./storage, no extra
// service. Each audit gets its own isolated storage client, so concurrent audits never share
// a queue.
import { BasicCrawler, Configuration, log } from '@crawlee/basic';
import { MemoryStorage } from '@crawlee/memory-storage';

log.setLevel(log.LEVELS.WARNING);

// Responses that are worth one more try before they are reported as a page result.
const TRANSIENT_STATUS = new Set([0, 408, 425, 429, 500, 502, 503, 504]);

export function seoTransientPage(page) {
  return Boolean(page) && TRANSIENT_STATUS.has(Number(page.statusCode || 0));
}

/**
 * Crawl a site breadth-first from `root`, then continue with sitemap URLs that the link crawl
 * did not reach, until `maxPages` pages were analysed.
 *
 * @param {object} options
 * @param {string} options.root            normalised start URL (crawled first, depth 0)
 * @param {string[]} [options.sitemapPages] URLs from the sitemap (crawled after the link queue, depth null)
 * @param {number} options.maxPages
 * @param {(url: string) => string} options.keyOf        dedupe key (ignores www, trailing slash)
 * @param {(url: string) => boolean} options.isCrawlable  internal HTML candidate?
 * @param {(url: string, depth: number|null) => Promise<object>} options.fetchPage  never throws; returns a page
 * @param {number} [options.concurrency=4]
 * @param {number} [options.maxRequestsPerMinute=120]
 * @param {number} [options.retries=2]     extra attempts for network errors / 429 / 5xx
 * @returns {Promise<object[]>} analysed pages, root first
 */
export async function crawlSeoSite({
  root,
  sitemapPages = [],
  maxPages,
  keyOf,
  isCrawlable,
  fetchPage,
  concurrency = 4,
  maxRequestsPerMinute = 120,
  retries = 2
}) {
  const pages = [],
    crawled = new Set(),
    scheduled = new Set(),
    queued = new Set(),
    depthByKey = new Map(),
    limit = Math.max(1, Number(maxPages) || 1),
    maxConcurrency = Math.max(1, Math.min(16, Number(concurrency) || 1)),
    retryCount = Math.max(0, Math.min(5, Number(retries) || 0));

  const config = new Configuration({
    persistStorage: false,
    purgeOnStart: false,
    storageClient: new MemoryStorage({ persistStorage: false, writeMetadata: false })
  });

  const request = (url, depth) => {
    const key = keyOf(url);
    scheduled.add(key);
    queued.add(key);
    if (depth != null) depthByKey.set(key, depth);
    return { url, uniqueKey: key, userData: { depth } };
  };

  const record = (page, key) => {
    if (pages.length >= limit || crawled.has(key)) return false;
    crawled.add(key);
    if (page.finalUrl) crawled.add(keyOf(page.finalUrl));
    pages.push(page);
    return true;
  };

  const crawler = new BasicCrawler(
    {
      maxConcurrency,
      minConcurrency: 1,
      maxRequestsPerMinute: Math.max(1, Number(maxRequestsPerMinute) || 60),
      maxRequestRetries: retryCount,
      // A page can take up to 10 redirect hops plus a Browser Runner render.
      requestHandlerTimeoutSecs: 300,
      // Crawlee would otherwise keep sessions/cookies per "browser identity"; SiteOps audits
      // the plain public response.
      useSessionPool: false,
      async requestHandler({ request: req }) {
        const key = req.uniqueKey;
        if (pages.length >= limit || crawled.has(key)) return queued.delete(key);
        const depth = depthByKey.has(key) ? depthByKey.get(key) : (req.userData?.depth ?? null);
        const page = await fetchPage(req.url, depth);
        if (seoTransientPage(page) && req.retryCount < retryCount)
          throw new Error('Vorübergehender Fehler (' + (page.statusCode || page.error || 'Netzwerk') + ')');
        queued.delete(key);
        if (req.retryCount > 0) page.crawlAttempts = req.retryCount + 1;
        if (!record(page, key)) return;
        const add = [];
        for (const link of page.links || []) {
          if (!link.internal || !isCrawlable(link.target)) continue;
          const targetKey = keyOf(link.target);
          if (crawled.has(targetKey)) continue;
          const linkedDepth = depth == null ? 1 : depth + 1;
          if (scheduled.has(targetKey)) {
            // Already queued (from a link or the sitemap): keep the shortest click depth.
            const known = depthByKey.get(targetKey);
            if (known == null || linkedDepth < known) depthByKey.set(targetKey, linkedDepth);
            continue;
          }
          if (pages.length + crawlerPending() + add.length >= limit) continue;
          add.push(request(link.target, linkedDepth));
        }
        if (add.length) await crawler.addRequests(add);
      },
      async failedRequestHandler({ request: req }, error) {
        // Only reached when fetchPage itself threw (it is not supposed to) or a timeout hit.
        const key = req.uniqueKey;
        queued.delete(key);
        if (pages.length >= limit || crawled.has(key)) return;
        const page = await fetchPage(req.url, req.userData?.depth ?? null).catch(() => null);
        if (page) {
          page.crawlAttempts = req.retryCount + 1;
          if (!page.error && error) page.crawlError = String(error.message || error).slice(0, 500);
          record(page, key);
        }
      }
    },
    config
  );

  // Requests queued but not yet handled, so the queue never grows past the page budget.
  const crawlerPending = () => queued.size;

  await crawler.run([request(root, 0)]);

  // Sitemap URLs the link crawl did not reach (for orphan detection), in sitemap order.
  const rootKey = keyOf(root);
  let pending = sitemapPages.filter(url => keyOf(url) !== rootKey);
  while (pages.length < limit && pending.length) {
    const batch = [];
    while (pending.length && batch.length < limit - pages.length) {
      const url = pending.shift(),
        key = keyOf(url);
      if (!crawled.has(key) && !scheduled.has(key)) batch.push(request(url, null));
    }
    if (!batch.length) break;
    await crawler.run(batch);
  }
  await crawler.teardown?.();
  return pages;
}
