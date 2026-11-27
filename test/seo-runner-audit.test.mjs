import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapLighthouseResult, summarizeAxe } from '../runner/seo-audit.mjs';

process.env.SITEOPS_TEST_NO_AUTOSTART = '1';
const { seoPublicLinkGuard } = await import('../app.mjs');

test('runner Lighthouse results use the PageSpeed report shape', () => {
  const mapped = mapLighthouseResult(
    {
      lighthouseVersion: '13.0.0',
      finalDisplayedUrl: 'https://example.com/',
      categories: { performance: { score: 0.91 }, seo: { score: 1 }, accessibility: { score: null } },
      audits: { 'largest-contentful-paint': { numericValue: 1234 } }
    },
    'mobile'
  );
  assert.equal(mapped.source, 'runner');
  assert.deepEqual(mapped.scores, { performance: 91, accessibility: null, bestPractices: null, seo: 100 });
  assert.equal(mapped.metrics.lcp, 1234);
  assert.equal(mapped.finalUrl, 'https://example.com/');
});

test('axe results are summarised by impact, most severe first', () => {
  const summary = summarizeAxe({
    testEngine: { version: '4.10.0' },
    violations: [
      { id: 'region', impact: 'moderate', help: 'Regions', nodes: [{ target: ['div'] }] },
      { id: 'image-alt', impact: 'critical', help: 'Alt text', nodes: [{ target: ['img'] }, { target: ['img.b'] }] }
    ],
    passes: [{}, {}]
  });
  assert.equal(summary.violations[0].id, 'image-alt');
  assert.equal(summary.byImpact.critical, 1);
  assert.equal(summary.nodeCount, 3);
  assert.deepEqual(summary.violations[0].targets, ['img', 'img.b']);
});

test('outgoing link checks refuse internal addresses', async () => {
  for (const url of [
    'http://127.0.0.1/',
    'http://10.1.2.3/',
    'http://[::1]/',
    'http://localhost/',
    'http://u:p@example.com/'
  ])
    await assert.rejects(seoPublicLinkGuard(new URL(url)), url);
  await seoPublicLinkGuard(new URL('http://93.184.215.14/'));
});
