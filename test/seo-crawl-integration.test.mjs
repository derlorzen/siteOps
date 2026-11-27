import { createServer } from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crawlSeoSite } from '../lib/seo-crawler.mjs';

process.env.SITEOPS_TEST_NO_AUTOSTART = '1';
const { crawlSeoPage, seoSiteUrlKey, seoCrawlableUrl } = await import('../app.mjs');

const html = (title, links) =>
  `<!doctype html><html lang="de"><head><title>${title}</title></head><body><main><h1>${title}</h1>` +
  links.map(href => `<a href="${href}">${href}</a>`).join(' ') +
  '</main></body></html>';

test('analyses a real site through Crawlee with the SiteOps page fetcher', async t => {
  const server = createServer((req, res) => {
    if (req.url === '/alt') return res.writeHead(301, { location: '/neu/' }).end();
    const pages = {
      '/': html('Start', ['/neu/', '/alt', '/fehlt', '/bild.png']),
      '/neu/': html('Neu', ['/']),
      '/sitemap-only/': html('Nur Sitemap', [])
    };
    if (!pages[req.url]) return res.writeHead(404, { 'content-type': 'text/html' }).end('nope');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(pages[req.url]);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const root = `http://127.0.0.1:${server.address().port}/`,
    rootHost = new URL(root).hostname;

  const pages = await crawlSeoSite({
    root,
    sitemapPages: [root + 'sitemap-only/'],
    maxPages: 10,
    keyOf: seoSiteUrlKey,
    isCrawlable: url => seoCrawlableUrl(url, rootHost),
    fetchPage: (url, depth) => crawlSeoPage(url, rootHost, depth, { remaining: 0 }),
    maxRequestsPerMinute: 6000,
    retries: 0
  });
  const byPath = new Map(pages.map(p => [p.path, p]));
  assert.equal(pages[0].title, 'Start');
  assert.equal(byPath.get('/neu/').title, 'Neu');
  assert.equal(byPath.get('/fehlt').statusCode, 404);
  assert.equal(byPath.get('/sitemap-only/').depth, null);
  assert.equal(byPath.has('/bild.png'), false, 'assets are not crawled as pages');
  // The redirect source is analysed once (it ends on /neu/, which was already crawled or follows).
  const redirected = pages.filter(p => p.redirectCount > 0);
  assert.ok(redirected.every(p => p.redirects[0].status === 301));
  assert.ok(pages.length <= 5);
});
