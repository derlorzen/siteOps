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

test('page analysis records headers, headings, images, anchors and custom rules', async t => {
  const body =
    '<!doctype html><html lang="de"><head><title>Seite nicht gefunden</title><link rel="canonical" href="/a"><link rel="canonical" href="/b">' +
    '<meta name="author" content="Lorzen"></head><body><main><h2>Zuerst H2</h2><h1>Seite nicht gefunden</h1><h4>Sprung</h4>' +
    '<p>Lorem ipsum dolor sit amet.</p><a href="/x"><img src="/logo.png" alt="Logo"></a><a href="/y"></a><a href="/z">mehr</a>' +
    '<img src="/foto.jpg" alt="Foto" width="10" height="10"><img src="data:image/png;base64,AAAA"></main></body></html>';
  const server = createServer((req, res) =>
    res
      .writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'x-robots-tag': 'noindex',
        link: '</kanonisch>; rel="canonical", </style.css>; rel=preload'
      })
      .end(body)
  );
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const root = `http://127.0.0.1:${server.address().port}/`;
  const page = await crawlSeoPage(
    root + 'Seite_A',
    '127.0.0.1',
    0,
    { remaining: 0 },
    {
      customRules: [
        { name: 'Telefon', type: 'css_exists', value: 'a[href^="tel:"]' },
        { name: 'Autor', type: 'extract', value: 'meta[name="author"]', attr: 'content' }
      ]
    }
  );
  assert.equal(page.indexable, false);
  assert.equal(page.headerCanonical, root + 'kanonisch');
  assert.deepEqual(page.headings, [2, 1, 4]);
  assert.equal(page.viewport, false);
  assert.deepEqual(
    page.images.map(i => i.src),
    [root + 'logo.png', root + 'foto.jpg']
  );
  assert.equal(page.links.find(l => l.target === root + 'x').imageAlt, 'Logo');
  assert.ok(Number.isFinite(page.ttfbMs));
  const codes = new Set(page.issues.map(i => i.code));
  for (const code of [
    'x_robots_noindex',
    'canonical_multiple',
    'canonical_conflict',
    'viewport_missing',
    'heading_skipped',
    'heading_order',
    'h1_equals_title',
    'soft_404',
    'placeholder_text',
    'anchor_empty',
    'anchor_generic',
    'url_uppercase',
    'url_underscore',
    'custom_rule'
  ])
    assert.ok(codes.has(code), code);
  assert.equal(codes.has('canonical_missing'), false);
  assert.deepEqual(page.details.extracted, { Autor: ['Lorzen'] });
  assert.equal(page.details.snippet.titlePx > 0, true);
  assert.equal(page.details.xRobotsTag, 'noindex');
});
