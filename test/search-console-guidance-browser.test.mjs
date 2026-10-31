import { searchConsoleSetup } from '../lib/search-console-setup.mjs';
/* global document,innerWidth */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import { renderSearchConsole, renderSearchConsoleOverview } from '../lib/search-console-ui.mjs';
import { analyticsSite, createAnalyticsFixture } from './analytics-fixture.mjs';

test(
  'Search Console keeps connected UI quiet and guides missing steps from actual status',
  { skip: process.env.RUN_ANALYTICS_BROWSER_TESTS !== '1', timeout: 120000 },
  async t => {
    process.env.SITEOPS_TEST_NO_AUTOSTART = '1';
    const { page: renderPage, db } = await import('../app.mjs');
    t.after(() => db.end());
    const { chromium } = await import(
      process.env.SITEOPS_PLAYWRIGHT_MODULE
        ? pathToFileURL(process.env.SITEOPS_PLAYWRIGHT_MODULE).href
        : '../runner/node_modules/playwright/index.mjs'
    );
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.SUITE_CHROMIUM_EXECUTABLE || undefined
    });
    t.after(() => browser.close());
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage(),
      fixture = createAnalyticsFixture(),
      errors = [],
      findings = [];
    page.on('pageerror', error => errors.push(error.message));
    const status = () => fixture.respond(new URL('https://siteops.test/api/search-console/status'), {});
    await page.route('https://siteops.test/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/assets/'))
        return route.fulfill({
          contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript',
          body: await readFile(new URL('../public/' + url.pathname.slice(8), import.meta.url), 'utf8')
        });
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: fixture.respond(url, route.request()) });
      const connection = status(),
        globalStatus = {
          ...connection,
          site_enabled: undefined,
          linkage: null,
          setup: searchConsoleSetup({ ...connection, site_enabled: undefined, linkage: null })
        };
      return route.fulfill({
        contentType: 'text/html;charset=utf-8',
        body: renderPage(
          'Search Console',
          url.pathname === '/search-console'
            ? renderSearchConsoleOverview([analyticsSite], globalStatus, [
                { site_id: analyticsSite.id, setup: connection.setup, invalidated: connection.linkage?.invalidated }
              ])
            : renderSearchConsole(analyticsSite)
        )
      });
    });
    const output = '.test-runtime/gsc-guidance';
    await mkdir(output, { recursive: true });
    const scenarios = [
      ['connected', {}],
      ['no-access', { configured: false, accounts: [], linkage: null }],
      ['account-missing', { accounts: [], linkage: null }],
      ['website-missing', { linkage: null }],
      [
        'domain-verification',
        {
          linkage: {
            property: 'sc-domain:nordlicht.example.test',
            live_approved_at: '2026-10-01',
            permission_level: null,
            dns_applied: true
          }
        }
      ]
    ];
    Object.assign(fixture.searchStatus, { configured: false, accounts: [], linkage: null });
    await page.goto('https://siteops.test/sites/nordlicht/search-console');
    await page.locator('#gsc-next-step').getByRole('button', { name: 'Google-Zugang einrichten', exact: true }).click();
    assert.equal(await page.locator('#gsc-account-settings').getAttribute('open'), '');
    assert.equal(await page.locator('#gsc-technical').getAttribute('open'), '');
    assert.equal(
      await page.locator('#gsc-config input[name=client_id]').evaluate(input => input === document.activeElement),
      true
    );
    for (const key of Object.keys(fixture.searchStatus)) delete fixture.searchStatus[key];
    for (const width of [360, 390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const [scenario, overrides] of scenarios) {
        for (const key of Object.keys(fixture.searchStatus)) delete fixture.searchStatus[key];
        Object.assign(fixture.searchStatus, overrides);
        await page.goto('https://siteops.test/sites/nordlicht/search-console');
        if (scenario === 'connected') {
          await page.locator('#gsc-rows tr').first().waitFor();
          assert.equal(await page.locator('#gsc-tab-settings').isVisible(), false);
          assert.equal(await page.locator('#gsc-progress').isVisible(), false);
          assert.equal(await page.locator('#gsc-manage').isVisible(), true);
          await page.locator('#gsc-tab-performance').focus();
          await page.keyboard.press('End');
          assert.equal(
            await page.locator('#gsc-tab-inspection').getAttribute('aria-selected'),
            'true',
            'hidden connection tab is skipped by keyboard navigation'
          );
          await page.locator('#gsc-tab-performance').click();
        } else {
          await page.locator('#gsc-progress-list li').first().waitFor();
          assert.equal(await page.locator('#gsc-panel-settings').isVisible(), true);
          assert.equal(
            await page.locator('#gsc-progress-list li[aria-current=step]').getAttribute('data-step'),
            scenario === 'no-access'
              ? 'client'
              : scenario === 'account-missing'
                ? 'account'
                : scenario === 'website-missing'
                  ? 'link'
                  : 'verify'
          );
          if (scenario === 'domain-verification') {
            assert.equal(await page.locator('#gsc-progress-list [data-step=dns]').count(), 0);
            assert.match(await page.locator('#gsc-completed-steps [data-step=dns]').textContent(), /Erledigt/);
            assert.equal(await page.locator('#gsc-progress-list [data-step=sitemap]').count(), 0);
          }
        }
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
          false,
          scenario + ' ' + width
        );
        if ([390, 1440].includes(width) && ['connected', 'no-access', 'domain-verification'].includes(scenario)) {
          await page.screenshot({ path: output + '/' + width + '-' + scenario + '.png', fullPage: true });
          findings.push({
            scenario,
            width,
            violations: (
              await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
            ).violations
          });
        }
      }
    }
    for (const width of [360, 390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const connected of [true, false]) {
        for (const key of Object.keys(fixture.searchStatus)) delete fixture.searchStatus[key];
        if (!connected) Object.assign(fixture.searchStatus, { configured: true, accounts: [], linkage: null });
        await page.goto('https://siteops.test/search-console');
        if (connected) {
          assert.equal(await page.locator('.gsc-overview-onboarding').count(), 0);
          await page.getByRole('link', { name: 'Suchleistung öffnen', exact: true }).waitFor();
        } else {
          await page.getByRole('heading', { name: 'Google-Konto noch nicht verbunden' }).waitFor();
          assert.match(
            await page.locator('.gsc-overview-steps').textContent(),
            /Client-ID allein verbindet noch kein Konto/
          );
        }
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
          false,
          'overview ' + connected + ' ' + width
        );
        if ([390, 1440].includes(width)) {
          const scenario = 'overview-' + (connected ? 'connected' : 'account-missing');
          await page.screenshot({ path: output + '/' + width + '-' + scenario + '.png', fullPage: true });
          findings.push({
            scenario,
            width,
            violations: (
              await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
            ).violations
          });
        }
      }
    }
    await page.getByRole('link', { name: 'Google-Konto verbinden', exact: true }).click();
    await page.locator('#gsc-progress-list [data-step=account]').waitFor();
    assert.equal(
      fixture.requests.filter(request => /previews|execute|oauth\/start/.test(request.path)).length,
      0,
      'viewing missing steps never starts OAuth or prepares/executes external changes'
    );
    await writeFile(output + '/accessibility.json', JSON.stringify(findings, null, 2));
    assert.deepEqual(
      findings.flatMap(result =>
        result.violations.map(v => ({
          scenario: result.scenario,
          width: result.width,
          id: v.id,
          nodes: v.nodes.map(n => n.target)
        }))
      ),
      []
    );
    assert.deepEqual(errors, []);
  }
);
