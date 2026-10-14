import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { registerBillingRoutes } from '../lib/billing.mjs';
import { billingDashboardBody } from '../lib/billing-ui.mjs';

const viewPaths = [
  '/billing', '/billing/customers', '/billing/board',
  '/billing/time', '/billing/invoices', '/billing/settings'
];

test('every billing subpage has a direct GET route that renders the existing dashboard', async () => {
  const routes = new Map();
  const app = { addHook() {} };
  for (const method of ['get', 'post', 'patch', 'put', 'delete'])
    app[method] = (path, callback) => { routes.set(method.toUpperCase() + ' ' + path, callback); };
  registerBillingRoutes(app, {}, {
    baseUrl: () => 'https://example.invalid',
    page: (title, body) => '<html><title>' + title + '</title>' + body + '</html>',
    dashboardBody: billingDashboardBody
  });
  for (const path of viewPaths) {
    const handler = routes.get('GET ' + path);
    assert.equal(typeof handler, 'function', 'missing route ' + path);
    let output = '';
    const reply = { type: () => reply, send: value => { output = value; return value; } };
    await handler({}, reply);
    assert.match(output, /billingRoot/);
    assert.match(output, /billing-navigation\.js/);
  }
  assert.equal(routes.has('GET /billing/wrong-section'), false);
});

test('browser scripts parse and are loaded in the correct dependency order', async () => {
  for (const name of ['billing.js', 'billing-navigation.js', 'billing-board.js', 'billing-workflows.js']) {
    const code = await readFile(new URL('../public/' + name, import.meta.url), 'utf8');
    assert.doesNotThrow(() => new vm.Script(code), name + ' must parse');
  }
  const template = billingDashboardBody();
  const scripts = ['billing.js','billing-navigation.js','billing-board.js','billing-workflows.js'];
  const order = scripts.map(name => template.indexOf('/assets/' + name));
  assert.ok(order.every(position => position >= 0));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('workspace has focused pages, contextual selectors and a shared modal host', async () => {
  const navigation = await readFile(new URL('../public/billing-navigation.js', import.meta.url), 'utf8');
  for (const view of ['overview','customers','board','time','invoices','settings'])
    assert.match(navigation, new RegExp('data-billing-page="' + view + '"'));
  assert.match(navigation, /billingModalHost/);
  assert.match(navigation, /billingContextSlot/);
  assert.match(navigation, /data-billing-link/);
  assert.match(navigation, /aria-current/);
  assert.match(navigation, /popstate/);
  const billing = await readFile(new URL('../public/billing.js', import.meta.url), 'utf8');
  assert.match(billing, /siteopsBillingSelection/);
  assert.match(billing, /siteops:billing-data/);
  const workflows = await readFile(new URL('../public/billing-workflows.js', import.meta.url), 'utf8');
  assert.match(workflows, /billingModalHost/);
  assert.equal(workflows.includes('<div id="billingDueList"'), false, 'duplicate due task list outside overview');
});
