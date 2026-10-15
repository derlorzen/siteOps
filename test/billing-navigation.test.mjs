import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { registerBillingRoutes } from '../lib/billing.mjs';
import { billingDashboardBody } from '../lib/billing-ui.mjs';

const routes = [
  '/billing',
  '/billing/projects',
  '/billing/projects/123e4567-e89b-12d3-a456-426614174000',
  '/billing/customers',
  '/billing/time',
  '/billing/invoices',
  '/billing/settings'
];

test('project overview and project detail have deep-linkable HTML routes', async () => {
  const map = new Map();
  const app = { addHook() {} };
  for (const method of ['get', 'post', 'patch', 'put', 'delete'])
    app[method] = (url, handler) => map.set(method.toUpperCase() + ' ' + url, handler);
  registerBillingRoutes(
    app,
    {},
    {
      baseUrl: () => 'https://siteops.invalid',
      page: (title, content) => '<html><title>' + title + '</title>' + content + '</html>',
      dashboardBody: billingDashboardBody
    }
  );
  for (const route of routes) {
    const key = route.includes('/projects/123e') ? 'GET /billing/projects/:id' : 'GET ' + route;
    const handler = map.get(key);
    assert.equal(typeof handler, 'function', key);
    let value = '';
    const reply = { type: () => reply, send: data => (value = data) };
    await handler({}, reply);
    assert.match(value, /crmRoot/);
    assert.match(value, /crm-app\.js/);
  }
});

test('CRM replaces all four fragile legacy browser scripts with a single entrypoint', () => {
  const body = billingDashboardBody();
  assert.match(body, /crm-app\.js/);
  assert.doesNotMatch(body, /billing-navigation\.js|billing-board\.js|billing-workflows\.js|\/assets\/billing\.js/);
});

test('new mobile CRM entrypoint has valid JavaScript and offers end-to-end navigation', async () => {
  const js = await readFile(new URL('../public/crm-app.js', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new vm.Script(js));
  for (const text of [
    'projectListPage',
    'projectPage',
    'boardView',
    'persistMove',
    'startOrStop',
    'taskModal',
    'loadTaskExtras',
    'manualTimeModal',
    'customerPage',
    'invoicePage',
    'settingsPage',
    'popstate',
    'crm-mobile-columns'
  ])
    assert.ok(js.includes(text), 'missing workflow ' + text);
  assert.match(js, /\/api\/billing\/boards\//);
  assert.match(js, /\/api\/billing\/timer\/start/);
  assert.match(js, /\/api\/billing\/entries/);
  assert.match(js, /data-status-select/);
  assert.match(js, /getBoundingClientRect/);
});

test('mobile board uses one selected column and visible large touch targets', async () => {
  const css = await readFile(new URL('../public/crm-app.css', import.meta.url), 'utf8');
  assert.match(css, /max-width:720px/);
  assert.match(css, /\.crm-kanban-lane\.mobile-active/);
  assert.match(css, /\.crm-mobile-columns/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /\.crm-nav-link\.is-active/);
});
