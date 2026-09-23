// Verifies the <main>/<article> vs full <body> fallback in seoExtractDocument():
// content analysis used to trust an empty <main> unconditionally (common with
// Next.js/React shells where the real content is a client-rendered child that
// hasn't hydrated into it), which produced false "thin content" findings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';

process.env.SITEOPS_MASTER_KEY ||= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
process.env.DASHBOARD_USER ||= 'test';
process.env.DASHBOARD_PASSWORD ||= 'test-password';
// app.mjs runs its CLI dispatch (and would try to boot a server) on import
// unless this is set - must be set before the dynamic import below.
process.env.SITEOPS_TEST_NO_AUTOSTART = '1';
const { seoExtractDocument } = await import('../app.mjs');

const longParagraph = (n, word = 'lorem') => Array.from({ length: n }, () => word).join(' ');

const ctx = {
  finalUrl: 'https://example.com/',
  rootHost: 'example.com',
  sourceUrl: 'https://example.com/',
  statusCode: 200
};

test('prefers <main> content when it has substantial text (normal SSR page)', () => {
  const html = `<html><body><nav>Home About</nav><main><h1>Title</h1><p>${longParagraph(300)}</p></main><footer>Copyright</footer></body></html>`;
  const doc = seoExtractDocument(cheerio.load(html), ctx);
  assert.ok(doc.wordCount >= 250, `expected >=250 words, got ${doc.wordCount}`);
  assert.ok(!doc.text.includes('Home About'), 'should exclude nav boilerplate when main has real content');
});

test('falls back to full <body> when <main> is an empty client-rendered shell', () => {
  const html = `<html><body><header>Nav Home About</header><main id="__next"></main><div class="hero"><h1>Welcome</h1><p>${longParagraph(300)}</p></div></body></html>`;
  const doc = seoExtractDocument(cheerio.load(html), ctx);
  assert.ok(doc.wordCount > 250, `expected content outside empty <main> to be picked up, got ${doc.wordCount} words`);
  assert.ok(doc.text.includes('Welcome'));
});

test('still reports thin content honestly when the whole page really is thin', () => {
  const html = `<html><body><main></main><p>Just a few words here.</p></body></html>`;
  const doc = seoExtractDocument(cheerio.load(html), ctx);
  assert.ok(doc.wordCount < 250);
});

test('a small but non-trivial <main> is still preferred over a much larger boilerplate-heavy body', () => {
  const nav = longParagraph(500, 'navlink');
  const html = `<html><body><nav>${nav}</nav><main><p>${longParagraph(60)}</p></main></body></html>`;
  const doc = seoExtractDocument(cheerio.load(html), ctx);
  assert.equal(doc.wordCount, 60);
  assert.ok(!doc.text.includes('navlink'));
});
