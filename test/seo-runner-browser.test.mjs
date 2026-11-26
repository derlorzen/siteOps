// Real Chromium: axe-core and Lighthouse through the Browser Runner's /seo/audit route.
// Opt-in (needs runner dependencies and Chromium): RUN_SEO_BROWSER_TESTS=1.
import { createServer } from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const enabled = process.env.RUN_SEO_BROWSER_TESTS === '1';

test('runner audits a page with axe-core and local Lighthouse', { skip: !enabled, timeout: 240000 }, async t => {
  const [{ default: Fastify }, { chromium }, { registerSeoAudit }] = await Promise.all([
    import('../runner/node_modules/fastify/fastify.js'),
    import('../runner/node_modules/playwright/index.mjs'),
    import('../runner/seo-audit.mjs')
  ]);
  const site = createServer((req, res) =>
    res
      .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      .end(
        '<!doctype html><html><head><title>Fixture</title></head><body><h1>Fixture</h1><p>Ein Absatz mit sichtbarem Text.</p><img src="/x.png"><input></body></html>'
      )
  );
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  const app = Fastify();
  const executablePath = process.env.SEO_TEST_CHROMIUM || undefined;
  registerSeoAudit(app, () => true, { launch: options => chromium.launch({ ...options, executablePath }) });
  t.after(async () => {
    site.close();
    await app.close();
  });

  const caps = (await app.inject({ method: 'GET', url: '/seo/capabilities' })).json();
  assert.deepEqual(caps, { seoAuditVersion: 1, lighthouse: true, axe: true });

  const response = await app.inject({
    method: 'POST',
    url: '/seo/audit',
    payload: { url: `http://127.0.0.1:${site.address().port}/`, axe: true, lighthouse: ['mobile'] }
  });
  const result = response.json();
  assert.equal(response.statusCode, 200);
  assert.deepEqual(result.errors, []);
  const ids = result.axe.violations.map(v => v.id);
  for (const id of ['image-alt', 'html-has-lang', 'label']) assert.ok(ids.includes(id), id);
  assert.equal(result.lighthouse.mobile.source, 'runner');
  assert.ok(result.lighthouse.mobile.scores.accessibility < 100);
  assert.equal(typeof result.lighthouse.mobile.scores.seo, 'number');
  // Performance needs a paint; Lighthouse reports a runtime error instead of a score otherwise.
  assert.ok(
    typeof result.lighthouse.mobile.scores.performance === 'number' || result.lighthouse.mobile.runtimeError,
    JSON.stringify(result.lighthouse.mobile)
  );
});
