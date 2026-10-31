/* global document,innerWidth */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import { renderSearchConsole } from '../lib/search-console-ui.mjs';
import { renderYouTube } from '../lib/youtube-ui.mjs';
import { analyticsSite, createAnalyticsFixture } from './analytics-fixture.mjs';

test(
  'connected Search Console and YouTube analytics use actual renderers and data-driven interactions',
  { skip: process.env.RUN_ANALYTICS_BROWSER_TESTS !== '1', timeout: 180000 },
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
    let delaySevenDays = false;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://siteops.test/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/assets/'))
        return route.fulfill({
          contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript',
          body: await readFile(new URL('../public/' + url.pathname.slice(8), import.meta.url), 'utf8')
        });
      if (url.pathname.startsWith('/api/')) {
        const response = fixture.respond(url, route.request());
        if (delaySevenDays && url.pathname === '/api/youtube/analytics' && route.request().postDataJSON().days === 7)
          await new Promise(resolve => setTimeout(resolve, 180));
        return route.fulfill({ status: response.http || 200, json: response });
      }
      return route.fulfill({
        contentType: 'text/html;charset=utf-8',
        body: renderPage(
          url.pathname === '/youtube' ? 'YouTube' : 'Google Search Console',
          url.pathname === '/youtube' ? renderYouTube() : renderSearchConsole(analyticsSite)
        )
      });
    });
    const output = '.test-runtime/analytics-after';
    await mkdir(output, { recursive: true });
    for (const width of [360, 390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const kind of ['gsc', 'youtube']) {
        await page.goto('https://siteops.test' + (kind === 'gsc' ? '/sites/nordlicht/search-console' : '/youtube'));
        if (kind === 'youtube') {
          await page.waitForFunction(() => document.querySelector('#yt-account').value);
          await page.locator('[data-tab=analytics]').click();
        }
        await page
          .locator(kind === 'gsc' ? '#gsc-rows tr' : '#yt-analytics-rows tr')
          .first()
          .waitFor();
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
          false,
          kind + ' ' + width
        );
        if (width === 390 || width === 1440) {
          await page.screenshot({ path: output + '/' + width + '-' + kind + '.png', fullPage: true });
        }
        if (width === 390 || width === 1440)
          findings.push({
            kind,
            width,
            ...(await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze())
          });
      }
    }
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto('https://siteops.test/sites/nordlicht/search-console');
    await page.locator('#gsc-rows tr').first().waitFor();
    await page.locator('#gsc-search').fill('134');
    await page.waitForFunction(() =>
      document.querySelector('#gsc-row-count').textContent.includes('von 1 Suchanfragen')
    );
    assert.match(await page.locator('#gsc-rows').textContent(), /134/, 'search reaches rows beyond the first API page');
    await page.locator('#gsc-search').fill('');
    await page.waitForFunction(() => document.querySelector('#gsc-row-count').textContent.startsWith('1–10 von 135'));
    await page.locator('#gsc-next').click();
    await page.waitForFunction(() => document.querySelector('#gsc-row-count').textContent.startsWith('11–20'));
    await page.locator('[data-sort=position]').click();
    await page.locator('[data-sort=position]').click();
    await page.waitForFunction(() => document.querySelector('#gsc-rows tr td:last-child').textContent === '6,8');
    await page.locator('#gsc-metrics [data-metric=ctr]').click();
    assert.equal(await page.locator('#gsc-chart-title').textContent(), 'Klickrate im Zeitverlauf');
    await page.locator('#gsc-chart').focus();
    await page.keyboard.press('Home');
    assert.match(await page.locator('#gsc-chart .ui-sr-only').textContent(), /29.09.2026.*%/);
    await page.locator('[data-gsc-tab=inspection]').click();
    await page.locator('#gsc-inspect input').fill('https://nordlicht.example.test/leistungen');
    await page.getByRole('button', { name: 'URL prüfen', exact: true }).click();
    await page.getByRole('heading', { name: 'Die URL ist bei Google indexiert', exact: true }).waitFor();
    await page.locator('[data-gsc-tab=settings]').click();
    assert.equal(
      await page.locator('#gsc-account-settings').getAttribute('open'),
      null,
      'completed configuration stays closed'
    );
    await page.locator('[data-gsc-tab=performance]').click();
    fixture.failures.gsc = true;
    await page.locator('#gsc-sync').click();
    await page.locator('#gsc-data-error').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#gsc-report').isVisible(), true, 'cached results survive transient failures');
    fixture.failures.gsc = false;
    await page.locator('#gsc-retry').click();
    await page.locator('#gsc-data-error').waitFor({ state: 'hidden' });
    fixture.failures.unlinked = true;
    await page.reload();
    await page.locator('#gsc-empty').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#gsc-report').isVisible(), false);
    await page.locator('[data-gsc-go=settings]').click();
    assert.equal(await page.locator('#gsc-panel-settings').isVisible(), true);
    fixture.failures.unlinked = false;
    await page.goto('https://siteops.test/youtube#analytics');
    await page.locator('#yt-analytics-rows .yt-analytics-video').first().waitFor();
    assert.equal(await page.locator('#yt-tab-analytics').getAttribute('aria-selected'), 'true');
    await page.locator('#yt-analytics-metrics [data-metric=estimatedMinutesWatched]').click();
    assert.equal(await page.locator('#yt-analytics-chart-title').textContent(), 'Wiedergabezeit im Zeitverlauf');
    await page.locator('#yt-analytics-chart').focus();
    await page.keyboard.press('End');
    assert.match(await page.locator('#yt-analytics-chart .ui-sr-only').textContent(), /26.10.2026.*Std./);
    await page.locator('#yt-analytics-search').fill('Produktseite');
    assert.equal(await page.locator('#yt-analytics-rows tr').count(), 1);
    await page.locator('#yt-analytics-rows .yt-analytics-video').click();
    await page.locator('#yt-video-editor').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#yt-video-title').inputValue(), 'Was eine gute Produktseite wirklich braucht');
    await page.locator('#yt-tab-analytics').click();
    await page.locator('#yt-analytics-search').fill('');
    delaySevenDays = true;
    await page.locator('#yt-analytics-days').selectOption('7');
    await page.locator('#yt-analytics-days').selectOption('90');
    await page.waitForFunction(() =>
      document.querySelector('#yt-analytics-chart').getAttribute('aria-label').includes('90 gemeldete')
    );
    await page.waitForTimeout(220);
    assert.match(
      await page.locator('#yt-analytics-chart').getAttribute('aria-label'),
      /90 gemeldete/,
      'late responses cannot replace the chosen period'
    );
    fixture.failures.day = true;
    await page.locator('#yt-analytics-load').click();
    await page.locator('#yt-analytics-error').waitFor({ state: 'visible' });
    assert.match(await page.locator('#yt-analytics-chart').textContent(), /Tagesverlauf konnte nicht/);
    assert.notEqual(await page.locator('#yt-analytics-metrics [data-metric=views] [data-value]').textContent(), '–');
    fixture.failures.day = false;
    fixture.failures.youtube = true;
    await page.locator('#yt-analytics-retry').click();
    await page.waitForFunction(() =>
      document.querySelector('#yt-analytics-error-text').textContent.includes('zuletzt geladene')
    );
    assert.equal(await page.locator('#yt-analytics-report').isVisible(), true);
    fixture.failures.youtube = false;
    fixture.failures.empty = true;
    await page.locator('#yt-analytics-retry').click();
    await page.waitForFunction(() => document.querySelector('#yt-analytics-metrics [data-value]').textContent === '–');
    assert.match(await page.locator('#yt-analytics-chart').textContent(), /keine Tageswerte/);
    assert.match(await page.locator('#yt-analytics-rows').textContent(), /keine Videowerte/);
    fixture.failures.empty = false;
    fixture.failures.permission = true;
    await page.locator('#yt-analytics-load').click();
    await page.locator('#yt-analytics-empty').waitFor({ state: 'visible' });
    assert.match(await page.locator('#yt-analytics-empty').textContent(), /Lesezugriff/);
    assert.equal(await page.locator('#yt-analytics-report').isVisible(), false);
    fixture.failures.permission = false;
    fixture.failures.noAccount = true;
    await page.reload();
    await page.locator('#yt-analytics-empty').waitFor({ state: 'visible' });
    assert.match(await page.locator('#yt-analytics-empty').textContent(), /Verbinde deinen/);
    await page.locator('#yt-analytics-connect').click();
    assert.equal(await page.locator('#yt-connection-settings').getAttribute('open'), '');
    assert.equal(
      fixture.requests.filter(request => /previews|execute|oauth\/start/.test(request.path)).length,
      0,
      'analytics interactions never authorize or mutate provider data'
    );
    await writeFile(
      output + '/accessibility.json',
      JSON.stringify(
        findings.map(({ kind, width, violations }) => ({ kind, width, violations })),
        null,
        2
      )
    );
    assert.deepEqual(
      findings.flatMap(result =>
        result.violations
          .filter(v => ['serious', 'critical'].includes(v.impact))
          .map(v => ({
            kind: result.kind,
            width: result.width,
            id: v.id,
            nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary }))
          }))
      ),
      []
    );
    assert.deepEqual(errors, []);
  }
);
