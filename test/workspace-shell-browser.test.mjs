/* global document, getComputedStyle, innerWidth, location */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { billingDashboardBody } from '../lib/billing-ui.mjs';
import { renderCmsWorkspace } from '../lib/lorzcms-workspace.mjs';
import { renderVideoStudio } from '../lib/video-studio-ui.mjs';
import { renderYouTube } from '../lib/youtube-ui.mjs';

test(
  'one SiteOps shell across operations, CRM, CMS and video; mobile menu and history stay accessible',
  { skip: process.env.RUN_SUITE_BROWSER_TESTS !== '1', timeout: 60000 },
  async t => {
    const { chromium } = await import('../runner/node_modules/playwright/index.mjs');
    const browser = await chromium.launch({
      executablePath: process.env.SUITE_CHROMIUM_EXECUTABLE || undefined,
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-zygote',
        '--single-process',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader'
      ],
      headless: true
    });
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } }),
      errors = [];
    page.on('pageerror', e => errors.push(e.stack));
    const root = fileURLToPath(new URL('../', import.meta.url));
    const id = '11111111-1111-4111-8111-111111111111';
    const customer = { id, name: 'Lorzen Digital' };
    const project = {
      id,
      customer_id: id,
      name: 'SiteOps Relaunch',
      description: 'Ein gemeinsamer Workspace für alle Projekte.',
      status: 'active'
    };
    const site = {
      id,
      slug: 'demo',
      name: 'Lorzen Demo',
      domain: 'demo.example.com',
      site_type: 'static',
      monitor_enabled: true
    };
    const cms = {
      installations: [],
      existingSites: [],
      jobs: [],
      releases: [],
      projects: [project],
      hostingAccounts: []
    };
    const esc = x =>
      String(x ?? '').replace(
        /[&<>"']/g,
        c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
      );
    await page.route('https://workspace.test/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/assets/'))
        return route.fulfill({
          contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript',
          body: await readFile(root + 'public/' + url.pathname.slice(8), 'utf8')
        });
      if (url.pathname.startsWith('/api/')) {
        let json = [];
        if (url.pathname === '/api/ui-theme') json = { accent: '#2465E8' };
        else if (url.pathname === '/api/build-info') json = { build: '123456789abc', version: '1.4.0' };
        else if (url.pathname === '/api/billing/customers') json = [customer];
        else if (url.pathname === '/api/billing/projects') json = [project];
        else if (url.pathname === '/api/sites') json = [site];
        else if (url.pathname === '/api/billing/settings') json = {};
        else if (url.pathname.startsWith('/api/billing/boards/'))
          json = { project, columns: { backlog: [], open: [], in_progress: [], review: [], done: [] } };
        else if (url.pathname === '/api/workspace/search') json = { results: [] };
        else if (url.pathname === '/api/lorzcms/overview') json = cms;
        else if (url.pathname === '/api/video-studio/projects')
          json = [
            {
              id,
              name: 'Bagisto Tutorials',
              channel: 'Lorzen',
              language: 'en',
              voice_provider: 'kokoro',
              voice: 'am_adam'
            }
          ];
        else if (url.pathname.endsWith('/capabilities')) json = { offlineModels: { kokoro: true } };
        else if (url.pathname.endsWith('/demo-policy'))
          json = { supported: true, source: 'environment', environmentPolicy: { hosts: [] } };
        else if (url.pathname === '/api/video-suite/settings')
          json = { configured: false, model: 'gpt-4.1', image_model: 'gpt-image-1' };
        else if (url.pathname.startsWith('/api/video-suite/drafts/')) json = null;
        else if (url.pathname === '/api/youtube/status')
          json = { configured: false, accounts: [], redirect_uri: 'https://workspace.test/api/youtube/oauth/callback' };
        else if (url.pathname.startsWith('/api/workspace/activity')) json = { entries: [] };
        else if (url.pathname.startsWith('/api/workspace/projects/'))
          json = { sites: [], time: {}, invoices: [], incidents: [] };
        return route.fulfill({ json });
      }
      let body;
      const crm = url.pathname.startsWith('/billing');
      if (crm) body = billingDashboardBody();
      else if (url.pathname === '/video-suite') body = renderVideoStudio();
      else if (url.pathname === '/youtube') body = renderYouTube();
      else if (url.pathname.startsWith('/lorzcms')) body = renderCmsWorkspace(cms, esc);
      else
        body =
          '<header><div><span class="eyebrow">SITEOPS / WORKSPACE</span><h1>' +
          esc(
            url.pathname === '/settings'
              ? 'Einstellungen'
              : url.pathname === '/hosting'
                ? 'Hosting & DNS'
                : 'Dein Workspace'
          ) +
          '</h1><p>Websites, Projekte und Produktionen an einem Ort.</p></div><a class="btn" href="/setup">+ Website</a></header><div class="twocol"><section><h2>Verbindung verwalten</h2><form><label>Projektname<input value="SiteOps"></label><label>Beschreibung<textarea>Ein gemeinsamer Arbeitsbereich.</textarea></label><button type="button">Änderungen speichern</button></form></section><section><h2>Letzter Stand</h2><p>Alle Informationen auf einen Blick.</p><div class="metrics"><span>12<em>Websites</em></span><span>4<em>Projekte</em></span></div></section></div>';
      return route.fulfill({
        contentType: 'text/html;charset=utf-8',
        body:
          '<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/app.css"><link rel="stylesheet" href="/assets/ops-workspace.css">' +
          (crm ? '<link rel="stylesheet" href="/assets/crm-app.css">' : '') +
          '<link rel="stylesheet" href="/assets/siteops-theme.css"><link rel="stylesheet" href="/assets/workspace-search.css"><link rel="stylesheet" href="/assets/build-footer.css"><link rel="stylesheet" href="/assets/lorzcms-workspace.css"><link rel="stylesheet" href="/assets/workspace-shell.css"><body class="' +
          (crm ? 'crm-mode' : 'ops-mode') +
          '"><nav class="topnav">Legacy</nav><main>' +
          body +
          '</main><script defer src="/assets/ops-workspace.js"></script><script defer src="/assets/siteops-theme.js"></script><script defer src="/assets/workspace-search.js"></script><script defer src="/assets/build-footer.js"></script></body></html>'
      });
    });
    const screenshot = async name => {
      if (process.env.SITEOPS_QA_SCREENSHOTS) {
        await mkdir(process.env.SITEOPS_QA_SCREENSHOTS, { recursive: true });
        await page.screenshot({ path: process.env.SITEOPS_QA_SCREENSHOTS + '/' + name + '.png', fullPage: true });
      }
    };
    for (const route of [
      '/',
      '/settings',
      '/hosting',
      '/coolify',
      '/lorzcms',
      '/billing',
      '/billing/customers',
      '/billing/time',
      '/billing/invoices',
      '/video-suite',
      '/youtube'
    ]) {
      await page.goto('https://workspace.test' + route);
      await page.waitForSelector('.siteops-topbar .workspace-search-trigger');
      if (route.startsWith('/billing')) await page.waitForSelector('#crmMain h1');
      assert.equal(await page.locator('.siteops-topbar').count(), 1);
      assert.equal(await page.locator('.siteops-sidebar').count(), 1);
      assert.equal(await page.locator('.suite-rail').count(), 0);
      assert.equal(await page.locator('.siteops-sidebar [aria-current=page]').count(), 1, route);
      assert.equal(await page.locator('.siteops-brand').innerText(), 'S\nSiteOps\nYOUR DIGITAL WORKSPACE');
      assert.equal(await page.locator('.siteops-sidebar').evaluate(el => getComputedStyle(el).display), 'flex');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, route);
      if (['/', '/billing', '/video-suite'].includes(route))
        await screenshot('desktop-' + (route.slice(1) || 'overview'));
    }
    await page.goto('https://workspace.test/video-suite#agent');
    await page.waitForSelector('[data-workspace-href="/video-suite#agent"][aria-current=page]');
    assert.equal(await page.locator('[data-nav-group="Video Suite"]').getAttribute('open'), '');
    await page.locator('[data-suite-nav=script]').click();
    assert.equal(await page.locator('#siteopsCurrentPage').textContent(), 'Video Suite / Skript & Szenen');
    await page.goto('https://workspace.test/billing');
    await page.waitForSelector('.crm-project-card');
    await page.locator('.crm-project-card').first().click();
    await page.waitForFunction(() => location.pathname.includes('/billing/projects/'));
    assert.equal(await page.locator('[data-workspace-href="/billing"]').getAttribute('aria-current'), 'page');
    await page.goBack();
    await page.waitForSelector('.crm-project-card');
    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of [
      '/settings',
      '/hosting',
      '/lorzcms',
      '/billing',
      '/billing/customers',
      '/billing/invoices',
      '/video-suite',
      '/youtube'
    ]) {
      await page.goto('https://workspace.test' + route);
      await page.waitForSelector('.siteops-menu-toggle');
      await page.waitForTimeout(100);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
        false,
        'mobile ' + route
      );
      assert.equal(await page.locator('#siteopsSidebar').evaluate(el => el.inert), true);
      await page.locator('.siteops-menu-toggle').click();
      assert.equal(
        await page.locator('[data-workspace-href="/websites"]').evaluate(el => getComputedStyle(el).flexDirection),
        'row'
      );
      await page.locator('.siteops-logout').waitFor({ state: 'visible', timeout: 2000 });
      assert.equal(await page.locator('.siteops-logout').isVisible(), true);
      assert.equal(await page.locator('.siteops-menu-toggle').getAttribute('aria-expanded'), 'true');
      assert.equal(await page.locator('#siteopsSidebar').getAttribute('aria-modal'), 'true');
      assert.equal(await page.locator('.siteops-content').evaluate(el => el.inert), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.siteops-menu-toggle').getAttribute('aria-expanded'), 'false');
      assert.equal(await page.locator('.siteops-content').evaluate(el => el.inert), false);
      assert.equal(await page.locator('.siteops-menu-toggle').evaluate(el => el === document.activeElement), true);
      await page.locator('.workspace-search-trigger').click();
      assert.equal(await page.locator('.workspace-search-dialog').evaluate(el => el.open), true);
      await page.keyboard.press('Escape');
      if (route === '/billing') await screenshot('mobile-projects');
    }
    await page.goto('https://workspace.test/video-suite#agent');
    await page.locator('.siteops-menu-toggle').click();
    await page.waitForTimeout(250);
    await screenshot('mobile-menu');
    await page.locator('[data-suite-nav=script]').click();
    assert.equal(await page.locator('.siteops-menu-toggle').getAttribute('aria-expanded'), 'false');
    await page.locator('[data-suite-pane=script]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-suite-pane=script]').isVisible(), true);
    assert.deepEqual(errors, []);
  }
);
