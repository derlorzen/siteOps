import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';

process.env.SITEOPS_MASTER_KEY ||= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
process.env.DASHBOARD_USER ||= 'test';
process.env.DASHBOARD_PASSWORD ||= 'test-password';
process.env.SITEOPS_TEST_NO_AUTOSTART = '1';

const { seoExtractDocument, seoHostKey, seoSameSiteHost, seoSiteUrlKey, seoCrawlableUrl } = await import('../app.mjs');

test('www and non-www hosts are treated as the same managed site', () => {
  assert.equal(seoHostKey('www.Example.com.'), 'example.com');
  assert.equal(seoSameSiteHost('example.com', 'www.example.com'), true);
  assert.equal(seoSameSiteHost('shop.example.com', 'www.example.com'), false);
});

test('equivalent www/non-www URLs share one crawl key', () => {
  assert.equal(
    seoSiteUrlKey('https://example.com/path/to/page?x=1'),
    seoSiteUrlKey('https://www.example.com/path/to/page?x=1')
  );
  assert.notEqual(
    seoSiteUrlKey('https://example.com/path/to/page?x=1'),
    seoSiteUrlKey('https://example.com/path/to/other?x=1')
  );
});

test('crawler accepts www target when configured root is non-www', () => {
  assert.equal(seoCrawlableUrl('https://www.example.com/products', 'example.com'), true);
  assert.equal(seoCrawlableUrl('https://example.com/products', 'www.example.com'), true);
  assert.equal(seoCrawlableUrl('https://cdn.example.com/products', 'example.com'), false);
});

test('links extracted after apex-to-www redirect remain internal', () => {
  const $ = cheerio.load('<html><body><main><a href="/kontakt">Kontakt</a></main></body></html>');
  const doc = seoExtractDocument($, {
    finalUrl: 'https://www.example.com/',
    rootHost: 'example.com',
    sourceUrl: 'https://www.example.com/',
    statusCode: 200
  });
  assert.equal(doc.links.length, 1);
  assert.equal(doc.links[0].internal, true);
  assert.equal(doc.links[0].source, 'https://www.example.com/');
  assert.equal(doc.links[0].target, 'https://www.example.com/kontakt');
});
