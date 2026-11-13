/* global document, innerWidth */
// Drives the real YouTube workspace in a browser: both Google connections are expired, the
// user reconnects one after the other and ends on a confirmation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';
import { renderYouTube } from '../lib/youtube-ui.mjs';

test(
  'expired Google connections are reconnected with one click each and confirmed afterwards',
  { skip: process.env.RUN_VIDEO_BROWSER_TESTS !== '1', timeout: 90000 },
  async t => {
    process.env.SITEOPS_TEST_NO_AUTOSTART = '1';
    const { page: renderPage, db } = await import('../app.mjs');
    const { chromium } = await import('../runner/node_modules/playwright/index.mjs');
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.SUITE_CHROMIUM_EXECUTABLE || undefined
    });
    t.after(async () => {
      await browser.close();
      await db.end();
    });
    const account = '11111111-1111-4111-8111-111111111111';
    for (const width of [390, 1440]) {
      const expired = new Set(['youtube', 'search_console']),
        starts = [];
      let failStart = true;
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await context.route('https://siteops.test/**', async route => {
        const request = route.request(),
          url = new URL(request.url());
        if (url.pathname.startsWith('/assets/'))
          return route.fulfill({
            contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript',
            body: await fs.readFile(new URL('../public/' + url.pathname.slice(8), import.meta.url), 'utf8')
          });
        if (url.pathname === '/youtube')
          return route.fulfill({
            contentType: 'text/html; charset=utf-8',
            body: renderPage('YouTube', renderYouTube())
          });
        if (url.pathname === '/api/google-connections')
          return route.fulfill({
            json: {
              connections: [
                ['youtube', 'YouTube', 'Mein Kanal'],
                ['search_console', 'Search Console', 'ich@example.org']
              ].map(([service, label, name]) => ({
                service,
                label,
                accounts: [{ id: account, name, reconnect_required: expired.has(service) }],
                reconnect_required: expired.has(service)
              }))
            }
          });
        if (/^\/api\/(youtube|search-console)\/oauth\/start$/.test(url.pathname)) {
          const body = request.postDataJSON();
          starts.push([url.pathname, body]);
          if (failStart) return route.fulfill({ status: 503, json: { message: 'Google OAuth-Client fehlt.' } });
          // Stands in for Google's consent screen followed by the SiteOps callback redirect.
          expired.delete(url.pathname.includes('youtube') ? 'youtube' : 'search_console');
          return route.fulfill({ json: { url: 'https://siteops.test' + body.return_to } });
        }
        if (url.pathname === '/api/youtube/status')
          return route.fulfill({
            json: {
              configured: true,
              client_id: 'id',
              redirect_uri: 'https://siteops.test/api/youtube/oauth/callback',
              accounts: [{ id: account, channel_id: 'UC1', title: 'Mein Kanal' }]
            }
          });
        if (url.pathname === '/api/youtube/read')
          return route.fulfill({ status: 401, json: { message: 'Google-Zugriff abgelaufen oder widerrufen.' } });
        return route.fulfill({ json: [] });
      });
      const scan = async label => {
        const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        assert.deepEqual(
          result.violations.map(violation => [violation.id, violation.nodes.map(node => node.target.join(' '))]),
          [],
          label + ' ' + width
        );
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, label);
      };
      await page.goto('https://siteops.test/youtube');
      const notice = page.locator('#google-reconnect');
      await notice.waitFor({ state: 'visible' });
      assert.match(await notice.locator('h2').textContent(), /YouTube und Search Console sind abgelaufen/);
      const buttons = notice.locator('button');
      assert.deepEqual(await buttons.allTextContents(), [
        'YouTube neu verbinden (Mein Kanal)',
        'Search Console neu verbinden (ich@example.org)'
      ]);
      assert.match(await notice.locator('details').textContent(), /In Produktion/);
      await scan('both expired');

      // A failed start keeps the user on the page with a reason and a working button.
      await buttons.first().click();
      await notice.locator('.google-reconnect-error').waitFor();
      assert.match(await notice.locator('.google-reconnect-error').textContent(), /OAuth-Client fehlt/);
      assert.equal(await buttons.first().isDisabled(), false);

      failStart = false;
      await Promise.all([page.waitForURL('**/youtube'), buttons.first().click()]);
      await page.locator('#google-reconnect h2').waitFor();
      assert.match(await notice.locator('h2').textContent(), /Search Console ist abgelaufen/);
      assert.match(await notice.textContent(), /Ein Dienst ist wieder verbunden, es fehlt noch einer/);
      assert.deepEqual(await notice.locator('button').allTextContents(), [
        'Search Console neu verbinden (ich@example.org)'
      ]);

      await Promise.all([page.waitForURL('**/youtube'), notice.locator('button').click()]);
      await page.locator('#google-reconnect[data-state="done"]').waitFor();
      assert.match(await notice.textContent(), /Google ist wieder verbunden/);
      assert.equal(await notice.locator('button').count(), 0);
      assert.equal(new URL(page.url()).search, '', 'the return marker is removed from the address');
      await scan('reconnected');

      assert.deepEqual(starts.slice(1), [
        ['/api/youtube/oauth/start', { account_id: account, return_to: '/youtube?google_reconnected=1' }],
        ['/api/search-console/oauth/start', { return_to: '/youtube?google_reconnected=1' }]
      ]);
      // Reloading without the marker shows nothing at all.
      await page.reload();
      await page.locator('#yt-status').waitFor();
      await page.waitForTimeout(300);
      assert.equal(await notice.isVisible(), false);
      assert.deepEqual(errors, []);
      if (width === 1440 && process.env.GOOGLE_RECONNECT_SHOT) {
        expired.add('youtube').add('search_console');
        await page.reload();
        await notice.waitFor({ state: 'visible' });
        await page.screenshot({ path: process.env.GOOGLE_RECONNECT_SHOT });
      }
      await context.close();
    }
  }
);
