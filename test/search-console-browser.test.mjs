import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Fastify from 'fastify';
import { searchConsoleFixture } from './search-console-fixture.mjs';
import { registerSearchConsoleRoutes } from '../lib/search-console-api.mjs';
import { renderSearchConsole } from '../lib/search-console-ui.mjs';

test(
  'real browser links a project, reviews exact live approval, syncs and renders safe Google data',
  { skip: process.env.RUN_GSC_BROWSER_TESTS !== '1' },
  async t => {
    const { chromium } = await import('../runner/node_modules/playwright/index.mjs');
    const f = searchConsoleFixture(),
      app = Fastify();
    await f.service.unlink('demo').catch(() => {});
    app.addHook('onRequest', async req => {
      req.siteopsSession = f.session;
    });
    registerSearchConsoleRoutes(app, f.service, {
      origin: () => app.listeningOrigin,
      page: (_title, html) =>
        '<!doctype html><html lang="de"><head><meta charset="utf-8"></head><body>' + html + '</body></html>',
      render: renderSearchConsole,
      getSite: async () => f.site
    });
    app.get('/api/hosting/allinkl/accounts', async () => []);
    app.get('/assets/:file', async (req, reply) =>
      reply
        .type(req.params.file.endsWith('.css') ? 'text/css' : 'text/javascript')
        .send(await readFile(new URL('../public/' + req.params.file, import.meta.url), 'utf8'))
    );
    await app.listen({ host: '127.0.0.1', port: 0 });
    t.after(() => app.close());
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.SUITE_CHROMIUM_EXECUTABLE || undefined
    });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(app.listeningOrigin + '/sites/demo/search-console');
    await page.getByText('Verbindung geladen.', { exact: true }).waitFor();
    await page.locator('[data-gsc-tab=settings]').click();
    await page.locator('#gsc-link-settings').evaluate(el => (el.open = true));
    await page.locator('#gsc-choice').selectOption('custom');
    await page.locator('#gsc-link input[name="property"]').fill('sc-domain:example.com');
    await page.getByRole('button', { name: 'Website zuordnen', exact: true }).click();
    await page.waitForTimeout(1200);
    assert.match(
      await page.locator('#gsc-states').textContent(),
      /sc-domain:example.com/,
      'Link did not save: ' + (await page.locator('#gsc-message').textContent()) + '; errors=' + JSON.stringify(errors)
    );
    assert.equal(f.linkage.live_approved_at, null);
    await page.locator('#gsc-next-step').getByRole('button', { name: 'Freigabe vorbereiten', exact: true }).click();
    await page.locator('#gsc-preview:not([hidden])').waitFor();
    const preview = JSON.parse(await page.locator('#gsc-preview-text').textContent());
    assert.equal(preview.domain, f.site.domain);
    assert.equal(preview.action, 'live');
    await page.locator('#gsc-approved').check();
    await page.locator('#gsc-confirmation').fill(preview.confirmation);
    await page.getByRole('button', { name: 'Freigegebene Aktion ausführen' }).click();
    await page.waitForFunction(() =>
      globalThis.document.getElementById('gsc-preview-text').textContent.includes('live_approved')
    );
    assert.ok(f.linkage.live_approved_at);
    await page.locator('#gsc-next-step').getByRole('button', { name: 'Suchdaten abrufen', exact: true }).click();
    await page.locator('#gsc-rows tr').first().waitFor();
    assert.match(await page.locator('#gsc-metrics').textContent(), /Impressionen/);
    assert.match(await page.locator('#gsc-range').textContent(), /Sync:/);
    await page.locator('[data-dimension=page]').click();
    await page.locator('#gsc-rows').getByRole('link', { name: '/', exact: true }).waitFor();
    await page.locator('[data-gsc-tab=inspection]').click();
    await page.locator('#gsc-inspect input[name="url"]').fill('https://example.com/page');
    await page.getByRole('button', { name: 'URL prüfen', exact: true }).click();
    await page.waitForFunction(() => globalThis.document.getElementById('gsc-inspection').textContent.includes('PASS'));
    assert.equal(f.dnsEvents.length, 0);
    assert.ok(!f.requests.some(x => x.init.method === 'PUT'));
    assert.deepEqual(errors, []);
    // The same view must remain usable on a narrow phone viewport.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-gsc-tab=performance]').click();
    assert.ok(await page.getByRole('heading', { name: 'Klicks im Zeitverlauf', exact: true }).isVisible());
  }
);
