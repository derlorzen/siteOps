import { createServer } from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crawlSeoSite, seoTransientPage } from '../lib/seo-crawler.mjs';

const site = {
  '/': ['/a', '/b'],
  '/a': ['/b', '/c'],
  '/b': ['/flaky'],
  '/c': [],
  '/flaky': [],
  '/orphan': []
};

async function serve(t) {
  const hits = new Map();
  const server = createServer((req, res) => {
    hits.set(req.url, (hits.get(req.url) || 0) + 1);
    if (req.url === '/flaky' && hits.get(req.url) === 1) return res.writeHead(503).end();
    if (!site[req.url]) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'text/html' }).end('ok');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { base: `http://127.0.0.1:${server.address().port}`, hits };
}

function crawlerFor(base, options = {}) {
  return crawlSeoSite({
    root: base + '/',
    keyOf: url => new URL(url).pathname.replace(/\/+$/, '') || '/',
    isCrawlable: url => url.startsWith(base),
    async fetchPage(url, depth) {
      const res = await fetch(url).catch(() => null),
        path = new URL(url).pathname;
      return {
        url,
        finalUrl: url,
        depth,
        statusCode: res?.status ?? 0,
        links: res?.ok ? (site[path] || []).map(p => ({ internal: true, target: base + p })) : []
      };
    },
    maxRequestsPerMinute: 6000,
    retries: 1,
    ...options
  });
}

test('crawls links breadth-first with shortest depth, then unreached sitemap pages', async t => {
  const { base, hits } = await serve(t);
  const pages = await crawlerFor(base, { sitemapPages: [base + '/', base + '/c', base + '/orphan'], maxPages: 20 });
  const byPath = new Map(pages.map(p => [new URL(p.url).pathname, p]));
  assert.equal(new URL(pages[0].url).pathname, '/');
  assert.deepEqual([...byPath.keys()].sort(), ['/', '/a', '/b', '/c', '/flaky', '/orphan']);
  assert.equal(byPath.get('/b').depth, 1);
  assert.equal(byPath.get('/c').depth, 2);
  assert.equal(byPath.get('/orphan').depth, null);
  assert.equal(byPath.get('/flaky').statusCode, 200, 'transient 503 is retried');
  assert.equal(byPath.get('/flaky').crawlAttempts, 2);
  assert.equal(hits.get('/b'), 1, 'each URL is fetched once');
});

test('never analyses more than maxPages', async t => {
  const { base } = await serve(t);
  const pages = await crawlerFor(base, { sitemapPages: [base + '/orphan'], maxPages: 3, concurrency: 4 });
  assert.equal(pages.length, 3);
});

test('reports a persistent transient failure after the retries', async () => {
  const pages = await crawlSeoSite({
    root: 'http://127.0.0.1:9/',
    keyOf: url => url,
    isCrawlable: () => true,
    fetchPage: async url => ({ url, finalUrl: url, statusCode: 0, error: 'ECONNREFUSED', links: [] }),
    maxPages: 5,
    retries: 1,
    maxRequestsPerMinute: 6000
  });
  assert.equal(pages.length, 1);
  assert.equal(pages[0].error, 'ECONNREFUSED');
  assert.equal(pages[0].crawlAttempts, 2);
});

test('classifies transient responses', () => {
  assert.equal(seoTransientPage({ statusCode: 503 }), true);
  assert.equal(seoTransientPage({ statusCode: 0 }), true);
  assert.equal(seoTransientPage({ statusCode: 404 }), false);
  assert.equal(seoTransientPage({ statusCode: 200 }), false);
});
