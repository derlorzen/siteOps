import { searchConsoleSetup } from '../lib/search-console-setup.mjs';
/* global document, innerWidth, getComputedStyle */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { renderWorkHome, renderWebsiteList, escapeHtml } from '../lib/product-ui.mjs';
import { monitoringState } from '../lib/workspace-overview.mjs';
import { renderCmsWorkspace } from '../lib/lorzcms-workspace.mjs';
import { renderAllInklWorkspace } from '../lib/allinkl-ui.mjs';
import { renderCoolifyWorkspace } from '../lib/coolify-ui.mjs';
import { renderVideoStudio } from '../lib/video-studio-ui.mjs';
import { renderYouTube } from '../lib/youtube-ui.mjs';
import { renderSearchConsole } from '../lib/search-console-ui.mjs';
import { billingDashboardBody } from '../lib/billing-ui.mjs';
import { renderToolsPage } from '../lib/tools.mjs';
import { renderWebsiteFiles } from '../lib/website-files-ui.mjs';
import { renderAiUsage } from '../lib/ai-usage-ui.mjs';
import { AxeBuilder } from '@axe-core/playwright';

test(
  'actual server renderers: five viewport widths, list filters, retry, keyboard menu and production stages',
  {
    skip: process.env.RUN_PRODUCT_BROWSER_TESTS !== '1' && process.env.RUN_SUITE_BROWSER_TESTS !== '1',
    timeout: 180000
  },
  async t => {
    process.env.SITEOPS_TEST_NO_AUTOSTART = '1';
    const {
      page: renderPage,
      settingsPage,
      mcpInfoPage,
      siteOperationsPage,
      seoDashboardPage,
      syntheticTestsPage,
      setupPage,
      db
    } = await import('../app.mjs');
    t.after(() => db.end());
    const playwright = await import(
      process.env.SITEOPS_PLAYWRIGHT_MODULE
        ? pathToFileURL(process.env.SITEOPS_PLAYWRIGHT_MODULE).href
        : '../runner/node_modules/playwright/index.mjs'
    );
    const browser = await playwright.chromium.launch({
      headless: true,
      executablePath: process.env.SUITE_CHROMIUM_EXECUTABLE || undefined
    });
    t.after(() => browser.close());
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [],
      accessibility = [];
    page.on('pageerror', e => errors.push(e.message));
    const id = '11111111-1111-4111-8111-111111111111',
      customer = { id, name: 'Nordlicht Studio' },
      project = { id, customer_id: id, name: 'Website erneuern', status: 'active', customer_name: customer.name };
    const sites = [
      {
        id,
        slug: 'nordlicht',
        name: 'Nordlicht Studio',
        domain: 'nordlicht.example.test',
        monitor_enabled: 1,
        last_check_ok: 0,
        last_checked_at: new Date().toISOString(),
        project_id: id,
        project_name: project.name,
        customer_name: customer.name
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        slug: 'atelier',
        name: 'Atelier am Kanal',
        domain: 'atelier.example.test',
        monitor_enabled: 1,
        last_check_ok: 1,
        last_checked_at: new Date().toISOString()
      }
    ].map(site => ({ ...site, status: monitoringState(site) }));
    const portfolio = {
      items: sites,
      total: 2,
      total_sites: 2,
      counts: { attention: 1, online: 1, unknown: 0, paused: 0 },
      filters: { query: '', status: 'all', sort: 'name', offset: 0, limit: 25 },
      next_offset: null
    };
    t.mock.method(db, 'query', async sql => [
      /select \* from sites/i.test(sql)
        ? [
            {
              ...sites[0],
              protocol: 'sftp',
              deployment_mode: 'webspace',
              remote_root: '/public',
              site_type: 'php',
              host: 'files.example.test',
              port: 22,
              exclude_patterns: []
            }
          ]
        : [],
      []
    ]);
    const overview = {
      websites: portfolio,
      tasks: [
        {
          id,
          project_id: id,
          name: 'Startseite prüfen',
          customer_name: customer.name,
          project_name: project.name,
          due_date: '2026-10-30'
        }
      ],
      activity: {
        entries: [
          {
            url: '/sites/nordlicht',
            title: 'Prüfung fehlgeschlagen: Nordlicht Studio',
            description: 'Die gespeicherte Erreichbarkeitsprüfung meldet einen Fehler.',
            occurred_at: new Date().toISOString()
          }
        ]
      },
      sources: { websites: { status: 'available' }, tasks: { status: 'available' }, activity: { status: 'available' } }
    };
    const task = {
      id: '33333333-3333-4333-8333-333333333333',
      project_id: id,
      name: 'Startseite prüfen',
      status: 'open',
      priority: 'high',
      description: 'Navigation prüfen',
      due_date: '2026-10-29'
    };
    const tasks = [task];
    let boardRevision = 1;
    const projectLinks = [
      { site_id: id, project_id: id, site_name: sites[0].name, slug: sites[0].slug, domain: sites[0].domain }
    ];
    const board = () => ({
      project,
      revision: boardRevision,
      columns: Object.fromEntries(
        ['backlog', 'open', 'in_progress', 'review', 'done'].map(status => [
          status,
          tasks.filter(task => task.status === status)
        ])
      )
    });
    const cms = {
      installations: [],
      existingSites: [],
      jobs: [],
      releases: [],
      projects: [project],
      hostingAccounts: []
    };
    const ai = {
      scope: 'Video Suite OpenAI',
      month_basis: 'UTC-Kalendermonat',
      cost_note: 'Anbieterrechnung nicht verfügbar.',
      summary: { calls: 0, measured_tokens: 0, accounted_tokens: 0, estimated_usd: null },
      limits: { monthly_calls: 200, monthly_tokens: 2000000, monthly_usd: null, prices: {} },
      entries: []
    };
    const report = [];
    let failList = false,
      fileContent = '<h1>Nordlicht Studio</h1>',
      plannedFile = '',
      executed = 0,
      approved = false,
      backupPolls = 0;
    await page.route('https://siteops.test/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/assets/'))
        return route.fulfill({
          contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript',
          body: await readFile(new URL('../public/' + url.pathname.slice(8), import.meta.url), 'utf8')
        });
      if (url.pathname.startsWith('/api/')) {
        if (url.pathname === '/api/workspace/websites') {
          if (failList) return route.fulfill({ status: 503, json: { message: 'Testausfall' } });
          const query = url.searchParams.get('query') || '',
            status = url.searchParams.get('status') || 'all';
          const items = sites.filter(
            site =>
              (!query || site.name.toLowerCase().includes(query.toLowerCase())) &&
              (status === 'all' || site.status.code === status)
          );
          return route.fulfill({
            json: { ...portfolio, items, total: items.length, filters: { ...portfolio.filters, query, status } }
          });
        }
        if (url.pathname === '/api/previews/' + id + '/apply') {
          if (route.request().headers()['x-siteops-approval'] !== id || !approved)
            return route.fulfill({
              status: 428,
              json: {
                error: 'APPROVAL_REQUIRED',
                message: 'Prüfe die Änderung.',
                approval: {
                  id,
                  tool: 'POST /api/previews/:id/apply',
                  arguments: { path: 'index.html' },
                  effect: 'index.html auf Nordlicht Studio ersetzen.'
                }
              }
            });
          executed++;
          approved = false;
          fileContent = plannedFile;
          return route.fulfill({ json: { ok: true } });
        }
        if (url.pathname === '/api/mcp/approvals/' + id + '/approve') {
          approved = true;
          return route.fulfill({ json: { status: 'approved' } });
        }
        if (url.pathname.endsWith('/file-preview')) {
          plannedFile = route.request().postDataJSON().content;
          return route.fulfill({ json: { previewId: id } });
        }
        if (url.pathname.endsWith('/backup-jobs'))
          return route.fulfill({ json: { id, status: 'waiting', phase: 'Sicherung wartet' } });
        if (url.pathname === '/api/backup-jobs/' + id) {
          backupPolls++;
          return route.fulfill({
            json: {
              id,
              status: backupPolls < 2 ? 'running' : 'completed',
              phase: backupPolls < 2 ? 'Dateien werden gesichert' : 'Sicherung abgeschlossen'
            }
          });
        }
        if (url.pathname === '/api/ai/limits') {
          Object.assign(ai.limits, route.request().postDataJSON());
          return route.fulfill({ json: ai });
        }
        if (url.pathname === '/api/billing/boards/' + id) {
          if (route.request().method() === 'PUT') {
            const input = route.request().postDataJSON();
            assert.equal(input.revision, boardRevision);
            for (const [status, ids] of Object.entries(input.columns))
              for (const taskId of ids) tasks.find(task => task.id === taskId).status = status;
            boardRevision++;
          }
          return route.fulfill({ json: board() });
        }
        const responses = {
          '/api/ui-theme': { accent: '#2465E8' },
          '/api/build-info': { version: '1.9.0', build: 'local-ui-fixture' },
          '/api/billing/customers': [customer],
          '/api/billing/projects': [project],
          '/api/billing/tasks': tasks,
          ['/api/workspace/projects/' + id + '/overview']: {
            project,
            sites: [sites[0]],
            task_counts: { total: 1, overdue: 1 },
            time: { total_seconds: 0, unbilled_seconds: 0, unbilled_cents: 0 },
            incidents: [],
            invoices: []
          },
          '/api/sites': sites,
          '/api/site-projects': projectLinks,
          '/api/billing/settings': {},
          '/api/workspace/activity': overview.activity,
          '/api/lorzcms/overview': cms,
          '/api/video-studio/projects': [],
          '/api/video-studio/jobs': [],
          '/api/video-studio/capabilities': { offlineModels: { kokoro: true } },
          '/api/video-studio/demo-policy': { supported: true, source: 'environment', environmentPolicy: { hosts: [] } },
          '/api/video-suite/settings': { configured: false, model: 'gpt-4.1', image_model: 'gpt-image-1' },
          '/api/video-suite/knowledge': { plugins: [] },
          '/api/youtube/status': {
            configured: false,
            accounts: [],
            redirect_uri: 'https://siteops.test/api/youtube/oauth/callback'
          },
          '/api/search-console/status': {
            configured: false,
            accounts: [],
            linkage: null,
            site_enabled: true,
            setup: searchConsoleSetup({ site_enabled: true })
          },
          '/api/search-console/overview': [],
          '/api/mcp/capabilities': {
            items: Array.from({ length: 80 }, (_, i) => ({
              name: i === 79 ? 'workspace_overview' : 'fixture_' + i,
              description: 'Arbeitszentrale und Handlungsbedarf abrufen',
              module: 'workspace',
              access: 'read',
              approval: false
            }))
          },
          '/api/mcp/approvals': [],
          '/api/oauth/connections': [],
          '/api/audit-log': [],
          '/api/mcp/self-test': {
            verification: 'Lokaler Test mit Fixtures',
            checks: [{ label: 'Discovery', ok: true }]
          }
        };
        if (url.pathname.endsWith('/files'))
          return route.fulfill({ json: { items: [{ name: 'index.html', type: 'file', size: 46 }] } });
        if (url.pathname.endsWith('/file'))
          return route.fulfill({ json: { path: 'index.html', content: fileContent } });
        return route.fulfill({ json: responses[url.pathname] ?? [] });
      }
      let html;
      if (url.pathname === '/settings') html = settingsPage();
      else if (url.pathname === '/mcp-info') html = mcpInfoPage();
      else if (url.pathname === '/setup') html = setupPage();
      else if (url.pathname === '/sites/nordlicht') html = await siteOperationsPage('nordlicht');
      else if (url.pathname === '/sites/nordlicht/seo') html = await seoDashboardPage('nordlicht');
      else if (url.pathname === '/sites/nordlicht/tests') html = await syntheticTestsPage('nordlicht');
      else {
        const renders = {
          '/': ['Arbeitszentrale', () => renderWorkHome(overview)],
          '/websites': ['Websites', () => renderWebsiteList(portfolio)],
          '/lorzcms': ['LorzCMS', () => renderCmsWorkspace(cms, escapeHtml)],
          '/hosting': [
            'Hosting & DNS',
            () => renderAllInklWorkspace([], [], escapeHtml) + '<script defer src="/assets/allinkl.js"></script>'
          ],
          '/coolify': [
            'Coolify & Supabase',
            () =>
              renderCoolifyWorkspace([], [], escapeHtml, [project]) + '<script defer src="/assets/coolify.js"></script>'
          ],
          '/video-suite': ['Video Suite', () => renderVideoStudio()],
          '/youtube': ['YouTube', () => renderYouTube()],
          '/sites/nordlicht/search-console': ['Search Console', () => renderSearchConsole(sites[0])],
          '/tools': ['Tools', () => renderToolsPage()]
        };
        renders['/lorzcms/installations/' + id] = [
          'LorzCMS',
          () =>
            renderCmsWorkspace(
              {
                ...cms,
                installations: [
                  {
                    id,
                    siteId: id,
                    name: 'Nordlicht CMS',
                    baseUrl: 'https://nordlicht.example.test',
                    state: 'ready',
                    version: '1.0.0'
                  }
                ]
              },
              escapeHtml,
              'installation',
              id
            )
        ];
        renders['/ai'] = ['KI & Kosten', () => renderAiUsage(ai)];
        renders['/sites/nordlicht/files'] = ['Dateien', () => renderWebsiteFiles(sites[0])];
        const [title, render] = url.pathname.startsWith('/billing')
          ? ['Kunden & Abrechnung', () => billingDashboardBody()]
          : renders[url.pathname] || ['Website', () => '<h1>Websitekontext</h1>'];
        html = renderPage(title, render());
      }
      return route.fulfill({ contentType: 'text/html;charset=utf-8', body: html });
    });
    const paths = [
      '/',
      '/websites',
      '/setup',
      '/sites/nordlicht',
      '/sites/nordlicht/files',
      '/sites/nordlicht/seo',
      '/sites/nordlicht/tests',
      '/billing',
      '/billing/projects/' + id,
      '/billing/customers',
      '/billing/time',
      '/billing/invoices',
      '/lorzcms',
      '/lorzcms/installations/' + id,
      '/hosting',
      '/coolify',
      '/video-suite',
      '/youtube',
      '/sites/nordlicht/search-console',
      '/tools',
      '/settings',
      '/mcp-info',
      '/ai'
    ];
    const output = process.env.SITEOPS_QA_SCREENSHOTS || '.test-runtime/product-ui';
    await mkdir(output, { recursive: true });
    for (const width of [360, 390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 960 });
      for (const path of paths) {
        await page.goto('https://siteops.test' + path);
        await page.waitForSelector('.siteops-sidebar', { state: 'attached' });
        await page.waitForTimeout(80);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        report.push({ path, width, overflow });
        assert.equal(overflow, false, width + ' ' + path);
        assert.equal(await page.locator('.siteops-shell').count(), 1);
        assert.equal(await page.locator('.siteops-topbar').evaluate(el => getComputedStyle(el).flexDirection), 'row');
        if (width === 1440 || width === 390) {
          const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
          accessibility.push({
            path,
            width,
            violations: a11y.violations.map(({ id, impact, nodes }) => ({
              id,
              impact,
              nodes: nodes.map(node => ({ target: node.target, summary: node.failureSummary }))
            }))
          });
        }
        if ([390, 1440].includes(width))
          await page.screenshot({
            path: output + '/' + width + '-' + (path.slice(1).replaceAll('/', '-') || 'home') + '.png',
            fullPage: true
          });
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('https://siteops.test/websites');
    await page.getByRole('searchbox', { name: 'Websites durchsuchen' }).fill('Atelier');
    await page.waitForFunction(() => document.querySelector('#websiteResultCount').textContent === '1 von 2 Websites');
    assert.equal(await page.locator('#websiteRows tr').count(), 1);
    assert.match(page.url(), /query=Atelier/);
    failList = true;
    await page.getByRole('searchbox', { name: 'Websites durchsuchen' }).fill('Nordlicht');
    await page.locator('#websiteRetry').waitFor();
    assert.equal(await page.locator('#websiteRows tr').count(), 1);
    failList = false;
    await page.locator('#websiteRetry').click();
    await page.waitForFunction(() => document.querySelector('#websiteRows').textContent.includes('Nordlicht'));
    await page.locator('.siteops-menu-toggle').click();
    assert.equal(await page.locator('#siteopsMain').evaluate(el => el.closest('.siteops-content').inert), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.siteops-menu-toggle').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Control+k');
    await page.locator('.workspace-search-dialog[open]').waitFor();
    await page.keyboard.press('Escape');
    await page.goto('https://siteops.test/video-suite');
    assert.equal(await page.locator('.suite-journey').count(), 1);
    assert.equal(await page.locator('.siteops-sidebar [data-suite-nav]').count(), 0);
    await page.locator('[data-journey=script]').click();
    await page.locator('[data-suite-pane=script]').waitFor({ state: 'visible' });
    assert.match(page.url(), /#script/);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 960 });
      for (const stage of [
        'ideas',
        'storyboard',
        'editing',
        'script',
        'production',
        'assets',
        'review',
        'publish',
        'repurpose'
      ]) {
        await page.locator('[data-journey=' + stage + ']').click();
        const pane = ['ideas', 'storyboard', 'editing'].includes(stage) ? 'agent' : stage;
        await page
          .locator('[data-suite-pane=' + pane + ']')
          .first()
          .waitFor({ state: 'visible' });
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
          false,
          'Video ' + stage + ' ' + width
        );
        const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        accessibility.push({
          path: '/video-suite#' + stage,
          width,
          violations: a11y.violations.map(({ id, impact, nodes }) => ({
            id,
            impact,
            nodes: nodes.map(node => ({ target: node.target, summary: node.failureSummary }))
          }))
        });
      }
    }
    await page.goto('https://siteops.test/billing');
    await page.locator('#crmProjectSearch').fill('Nicht vorhanden');
    assert.equal(await page.locator('#crmProjectTable tbody tr').count(), 0);
    await page.locator('#crmProjectSearch').fill('Nordlicht');
    assert.equal(await page.locator('#crmProjectTable tbody tr').count(), 1);
    await page.locator('#crmProjectTable a.ui-identity').click();
    await page.locator('.crm-task-card [data-status-select]').selectOption('in_progress');
    await page.getByText('Task verschoben.', { exact: true }).waitFor();
    assert.equal(task.status, 'in_progress');
    assert.equal(boardRevision, 2);
    await page.locator('[data-action=view-list]').click();
    await page.locator('.crm-list').waitFor({ state: 'visible' });
    await page.goto('https://siteops.test/sites/nordlicht/files');
    await page.getByRole('button', { name: 'index.html', exact: true }).click();
    await page.locator('#fileContent:not([disabled])').waitFor();
    await page.locator('#fileContent').fill('<h1>Neue Startseite</h1>');
    await page.locator('#filePreview').click();
    await page.locator('#fileChangePreview').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#fileBefore').textContent(), '<h1>Nordlicht Studio</h1>');
    assert.equal(executed, 0);
    await page.locator('#fileApply').click();
    await page.locator('.ui-action-dialog[open]').waitFor();
    const approvalA11y = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    accessibility.push({ path: '/files#approval', width: 1440, violations: approvalA11y.violations });
    await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#fileApply').disabled);
    assert.equal(executed, 0);
    assert.equal(fileContent, '<h1>Nordlicht Studio</h1>');
    await page.locator('#fileApply').click();
    await page.getByRole('button', { name: 'Diese Änderung ausführen', exact: true }).click();
    await page.getByText('Änderung ausgeführt und Dateiinhalt erneut geprüft.').waitFor();
    assert.equal(executed, 1);
    assert.equal(fileContent, '<h1>Neue Startseite</h1>');
    await page.goto('https://siteops.test/sites/nordlicht');
    await page.locator('#backupNow').click();
    await page.getByText('Sicherung erstellt und im Sicherungsverlauf gespeichert.', { exact: true }).waitFor();
    assert.equal(backupPolls, 2);
    await page.goto('https://siteops.test/ai');
    await page.locator('[name=monthly_calls]').fill('600');
    await page.getByRole('button', { name: 'Limits speichern', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#aiCallCount').textContent === '0 / 600');
    await page.goto('https://siteops.test/mcp-info');
    await page.locator('#mcpSelfTest').click();
    await page.getByText('Discovery · Bestanden').waitFor();
    assert.equal(await page.locator('#mcpTools tbody tr').count(), 25);
    await page.locator('#mcpToolsNext').click();
    assert.equal(await page.locator('#mcpToolsRange').textContent(), '26–50 von 80');
    await page.locator('#mcpToolSearch').fill('workspace_overview');
    assert.equal(await page.locator('#mcpTools tbody tr').count(), 1);
    // Custom pale accents must retain readable links and visible focus indicators.
    await page.goto('https://siteops.test/settings');
    await page.locator('[data-siteops-theme-open]').first().click();
    await page.locator('#siteopsThemeHex').fill('#FFFF00');
    const accentA11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    accessibility.push({ path: '/settings#yellow-accent', width: 1440, violations: accentA11y.violations });
    await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await writeFile(
      output + '/report.json',
      JSON.stringify(
        {
          fixture: 'Actual renderers with simulated read APIs; no external provider or real client verification',
          viewports: report,
          errors
        },
        null,
        2
      )
    );
    await writeFile(output + '/accessibility.json', JSON.stringify(accessibility, null, 2));
    const serious = accessibility.flatMap(page =>
      page.violations
        .filter(v => ['critical', 'serious'].includes(v.impact))
        .map(v => page.path + ' ' + page.width + ' ' + v.id + ' ' + v.nodes.map(n => n.target).join(', '))
    );
    assert.deepEqual(serious, []);
    assert.deepEqual(errors, []);
  }
);
