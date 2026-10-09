// GEO (generative engine optimization) and trust-signal checks, inspired by patterns from
// third-party SEO audit tooling: AI-crawler access was already computed but never used beyond
// robots.txt parsing; entity structured data (Organization/LocalBusiness/WebSite) and an
// Impressum link are classic local-SEO / E-E-A-T signals that were not checked at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SITEOPS_MASTER_KEY ||= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
process.env.DASHBOARD_USER ||= 'test';
process.env.DASHBOARD_PASSWORD ||= 'test-password';
process.env.SITEOPS_TEST_NO_AUTOSTART = '1';
const { seoHasEntitySchema, seoHasImpressumLink, seoAiBotAccess } = await import('../app.mjs');

test('seoHasEntitySchema detects Organization JSON-LD', () => {
  assert.equal(seoHasEntitySchema([{ '@type': 'Organization', name: 'Test GmbH' }]), true);
});

test('seoHasEntitySchema detects LocalBusiness subtypes (e.g. Restaurant)', () => {
  assert.equal(seoHasEntitySchema([{ '@type': 'Restaurant', name: 'Gasthof' }]), true);
});

test('seoHasEntitySchema handles multi-type arrays', () => {
  assert.equal(seoHasEntitySchema([{ '@type': ['Thing', 'LocalBusiness'] }]), true);
});

test('seoHasEntitySchema returns false when only navigational schema is present', () => {
  assert.equal(seoHasEntitySchema([{ '@type': 'BreadcrumbList' }]), false);
});

test('seoHasEntitySchema finds an entity nested inside an @graph array (regression: Codex review on #13)', () => {
  assert.equal(
    seoHasEntitySchema([
      {
        '@context': 'https://schema.org',
        '@graph': [{ '@type': 'BreadcrumbList' }, { '@type': 'Organization', name: 'Test GmbH' }]
      }
    ]),
    true
  );
});

test('seoHasEntitySchema finds an entity inside a bare top-level array', () => {
  assert.equal(seoHasEntitySchema([[{ '@type': 'BreadcrumbList' }, { '@type': 'LocalBusiness' }]]), true);
});

test('seoHasEntitySchema returns false for empty/missing structured data', () => {
  assert.equal(seoHasEntitySchema([]), false);
  assert.equal(seoHasEntitySchema(undefined), false);
  assert.equal(seoHasEntitySchema([{ invalid: true }]), false);
});

test('seoHasImpressumLink finds an Impressum link by anchor text', () => {
  const pages = [{ links: [{ anchor: 'Impressum', target: 'https://example.de/legal' }] }];
  assert.equal(seoHasImpressumLink(pages), true);
});

test('seoHasImpressumLink finds an Impressum link by URL when anchor text differs', () => {
  const pages = [{ links: [{ anchor: 'Rechtliches', target: 'https://example.de/impressum' }] }];
  assert.equal(seoHasImpressumLink(pages), true);
});

test('seoHasImpressumLink returns false when no page links to one', () => {
  const pages = [{ links: [{ anchor: 'Kontakt', target: 'https://example.de/kontakt' }] }];
  assert.equal(seoHasImpressumLink(pages), false);
});

test('seoAiBotAccess reports a bot blocked by a specific disallow-all rule', () => {
  const robotsTxt = 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /';
  const result = seoAiBotAccess(robotsTxt);
  assert.equal(result.find(b => b.bot === 'GPTBot').blocked, true);
});

test('seoAiBotAccess falls back to the wildcard group for unlisted bots', () => {
  const robotsTxt = 'User-agent: *\nDisallow: /';
  const result = seoAiBotAccess(robotsTxt);
  assert.ok(result.every(b => b.blocked === true));
});
