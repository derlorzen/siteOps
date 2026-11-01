import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Fastify from 'fastify';
import { registerHttpActionGuard } from '../lib/http-action-guard.mjs';

test(
  'CRM filters and editable invoice drafts work on desktop and mobile',
  { skip: process.env.RUN_CRM_BROWSER_TESTS !== '1' },
  async t => {
    const { chromium } = await import(
      process.env.CRM_PLAYWRIGHT_MODULE || '../runner/node_modules/playwright/index.mjs'
    );
    const customers = [
      { id: 'c1', name: 'Kunde A' },
      { id: 'c2', name: 'Kunde B' }
    ];
    const projects = [
      { id: 'p1', customer_id: 'c1', name: 'Shop A' },
      { id: 'p2', customer_id: 'c2', name: 'Shop B' }
    ];
    const entries = [
      {
        id: 'e1',
        task_id: 't1',
        project_id: 'p1',
        customer_id: 'c1',
        customer_name: 'Kunde A',
        project_name: 'Shop A',
        task_name: 'Layout A',
        entry_date: '2026-09-16',
        duration_seconds: 5400,
        hourly_cents: 7500,
        billable: true
      },
      {
        id: 'e2',
        task_id: 't2',
        project_id: 'p2',
        customer_id: 'c2',
        customer_name: 'Kunde B',
        project_name: 'Shop B',
        task_name: 'Layout B',
        entry_date: '2026-09-17',
        duration_seconds: 3600,
        hourly_cents: 7500,
        billable: true
      }
    ];
    const originalEntries = globalThis.structuredClone(entries);
    let draft = {
      id: 'i1',
      status: 'draft',
      customer_id: 'c1',
      service_from: '2026-09-01',
      service_to: '2026-09-30',
      items: [
        {
          id: 'ii1',
          entry_id: 'e1',
          entry_date: '2026-09-16',
          description: 'Übernommene Leistung',
          duration_seconds: 5400,
          hourly_cents: 7500,
          amount_cents: 11250
        }
      ]
    };
    const saves = [];
    let settings = {};
    let resets = 0;
    const issued = { id: 'i2', customer_id: 'c1', invoice_number: 'RE-2026-00002', status: 'issued', paid_at: null };
    const app = Fastify();
    app.addHook('onRequest', async req => {
      req.siteopsAuth = { type: 'dashboard_session', subject: 'owner' };
    });
    registerHttpActionGuard(app, {
      approvalMode: 'direct',
      state: async () => ({ status: issued.status }),
      approvals: {
        prepare: async input => ({
          id: 'approval-reset',
          tool: input.tool,
          arguments: input.args,
          effect: 'Originalrechnung stornieren und Folgeentwurf anlegen.'
        }),
        consume: async ({ id }) => {
          assert.equal(id, 'approval-reset');
        }
      }
    });
    app.get('/billing/:section', async (_req, reply) =>
      reply
        .type('text/html')
        .send(
          '<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/crm.css"><div id="crmRoot"></div><script src="/approval.js"></script><script src="/crm.js"></script></html>'
        )
    );
    app.get('/crm.js', async (_req, reply) =>
      reply.type('text/javascript').send(await readFile(new URL('../public/crm-app.js', import.meta.url), 'utf8'))
    );
    app.get('/app.css', async (_req, reply) =>
      reply.type('text/css').send(await readFile(new URL('../public/app.css', import.meta.url), 'utf8'))
    );
    app.get('/crm.css', async (_req, reply) =>
      reply.type('text/css').send(await readFile(new URL('../public/crm-app.css', import.meta.url), 'utf8'))
    );
    app.get('/approval.js', async (_req, reply) =>
      reply
        .type('text/javascript')
        .send(await readFile(new URL('../public/action-approval.js', import.meta.url), 'utf8'))
    );
    app.post('/api/mcp/approvals/approval-reset/approve', async () => ({ ok: true }));
    app.post('/api/billing/invoices/i2/reset-draft', async req => {
      assert.equal(req.body.reason, 'Leistungsumfang korrigieren');
      resets++;
      issued.status = 'cancelled';
      return draft;
    });
    app.get('/api/billing/invoices/i1', async () => draft);
    app.post('/api/billing/settings', async req => {
      settings = req.body;
      return settings;
    });
    app.patch('/api/billing/invoices/i1', async req => {
      saves.push(req.body);
      draft = { ...draft, ...req.body };
      return draft;
    });
    app.get('/api/*', async req => {
      if (req.url.endsWith('/customers')) return customers;
      if (req.url.endsWith('/projects')) return projects;
      if (req.url.endsWith('/entries')) return entries;
      if (req.url.endsWith('/invoices')) return [draft, issued];
      if (req.url.endsWith('/settings')) return settings;
      return [];
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    t.after(() => app.close());
    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    page.setDefaultTimeout(7000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    t.after(async () => {
      if (errors.length) console.error(errors);
    });
    await page.goto(app.listeningOrigin + '/billing/time');
    await page.getByLabel('Projekt', { exact: true }).selectOption('p1');
    assert.equal(await page.locator('tbody tr').count(), 1);
    assert.match(await page.locator('tbody').textContent(), /Layout A/);
    assert.match(page.url(), /project_id=p1/);
    await page.reload();
    await page.getByText('Layout A', { exact: true }).waitFor();
    assert.equal(await page.locator('tbody tr').count(), 1);
    await page.getByLabel('Kunde', { exact: true }).selectOption('c2');
    assert.match(await page.locator('tbody').textContent(), /Layout B/);
    assert.equal(await page.getByLabel('Projekt', { exact: true }).inputValue(), '');
    await page.getByRole('button', { name: 'Filter zurücksetzen' }).click();
    assert.equal(await page.locator('tbody tr').count(), 2);
    await page.goto(app.listeningOrigin + '/billing/invoices');
    await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
    const rows = page.locator('[data-invoice-row]');
    await rows.first().waitFor();
    const editor = await page.getByRole('dialog').boundingBox();
    assert.ok(editor.width >= 1100, 'Desktop invoice editor provides a wide working area');
    if (process.env.CRM_DESKTOP_SCREENSHOT)
      await page.screenshot({ path: process.env.CRM_DESKTOP_SCREENSHOT, fullPage: false });
    await rows.nth(0).getByLabel('Beschreibung', { exact: true }).fill('Geänderter Text');
    await rows.nth(0).getByLabel('Leistungsdatum', { exact: true }).fill('2026-09-18');
    await rows.nth(0).getByLabel('Menge', { exact: true }).fill('2');
    await rows.nth(0).getByLabel('Einzelpreis netto €', { exact: true }).fill('80');
    assert.equal(await rows.nth(0).getByLabel('Betrag netto €', { exact: true }).inputValue(), '160.00');
    await rows.nth(0).getByLabel('Betrag netto €', { exact: true }).fill('150');
    await page.getByRole('button', { name: '+ Eigene Position', exact: true }).click();
    await rows.nth(1).getByLabel('Beschreibung', { exact: true }).fill('Eigene Pauschale');
    await rows.nth(1).getByLabel('Menge', { exact: true }).fill('1');
    await rows.nth(1).getByLabel('Einheit', { exact: true }).fill('Pauschale');
    await rows.nth(1).getByLabel('Einzelpreis netto €', { exact: true }).fill('50');
    assert.match(await page.locator('#crmDraftTotals').textContent(), /238,00/);
    await rows.nth(1).getByRole('button', { name: 'Position nach oben', exact: true }).click();
    assert.equal(await rows.nth(0).getByLabel('Beschreibung', { exact: true }).inputValue(), 'Eigene Pauschale');
    await page.getByRole('button', { name: 'Entwurf speichern', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(saves.length, 1);
    assert.equal(saves[0].items[0].unit, 'Pauschale');
    assert.equal(saves[0].items[1].id, 'ii1');
    assert.equal(saves[0].items[1].amount_cents, 15000);
    assert.deepEqual(entries, originalEntries);
    await page.reload();
    await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
    assert.equal(await rows.nth(1).getByLabel('Beschreibung', { exact: true }).inputValue(), 'Geänderter Text');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(Math.round((await page.getByRole('dialog').boundingBox()).width), 390);
    assert.ok(await rows.nth(0).getByLabel('Beschreibung', { exact: true }).isVisible());
    assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth));
    page.once('dialog', dialog => dialog.accept());
    await rows.nth(0).getByRole('button', { name: 'Entfernen', exact: true }).click();
    assert.equal(await rows.count(), 1);
    if (process.env.CRM_SCREENSHOT) await page.screenshot({ path: process.env.CRM_SCREENSHOT, fullPage: false });
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Schließen', exact: true }).click();
    await page.getByRole('button', { name: 'Auf Entwurf zurücksetzen', exact: true }).click();
    await page.getByLabel('Grund für die Korrektur', { exact: true }).fill('Leistungsumfang korrigieren');
    await page.getByRole('button', { name: 'Rücksetzen zur Freigabe vorbereiten', exact: true }).click();
    await page.getByRole('heading', { name: 'Änderung prüfen und freigeben' }).waitFor();
    assert.equal(resets, 0);
    await page.getByRole('button', { name: 'Diese Änderung ausführen', exact: true }).click();
    await page.getByRole('heading', { name: 'Rechnungsentwurf bearbeiten', exact: true }).waitFor();
    assert.equal(resets, 1);
    await page.goto(app.listeningOrigin + '/billing/settings');
    await page.getByLabel('Name der Bank', { exact: true }).fill('Meine Bank');
    assert.equal(await page.getByLabel('Zahlungsziel', { exact: true }).inputValue(), '14');
    await page.getByLabel('Zahlungsziel', { exact: true }).selectOption('7');
    await page.getByRole('button', { name: 'Einstellungen speichern', exact: true }).click();
    await page.getByText('Einstellungen gespeichert.', { exact: true }).waitFor();
    await page.reload();
    assert.equal(await page.getByLabel('Zahlungsziel', { exact: true }).inputValue(), '7');
    assert.equal(await page.getByLabel('Name der Bank', { exact: true }).inputValue(), 'Meine Bank');
    assert.deepEqual(errors, []);
  }
);
