import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { load } from 'cheerio';

async function browser() {
  const source = await readFile(new URL('../public/crm-app.js', import.meta.url), 'utf8');
  const listeners = {};
  const elements = new Map();
  const element = id => {
    if (!elements.has(id))
      elements.set(id, {
        innerHTML: '',
        classList: { toggle() {}, remove() {} },
        addEventListener(type, cb) {
          if (id === 'crmRoot') listeners[type] = cb;
        },
        showModal() {
          this.open = true;
        },
        querySelector() {
          return { innerHTML: '' };
        },
        querySelectorAll() {
          return [];
        }
      });
    return elements.get(id);
  };
  const context = {
    document: { getElementById: element, dispatchEvent() {} },
    window: {
      location: { pathname: '/billing/time', href: 'https://siteops.invalid/billing/time' },
      history: { replaceState() {} },
      addEventListener() {}
    },
    URL,
    URLSearchParams,
    Event: globalThis.Event,
    Intl,
    Date,
    setTimeout() {},
    clearTimeout() {}
  };
  const start = source.lastIndexOf('  const route=currentRoute();');
  vm.runInNewContext(source.slice(0, start) + 'globalThis.app = { state, timePage, invoicePage };})();', context);
  return { ...context.app, listeners };
}

test('time filters combine customer and project, constrain project choices and reset incompatible selections', async () => {
  const app = await browser();
  Object.assign(app.state, {
    customers: [
      { id: 'c1', name: 'Kunde A' },
      { id: 'c2', name: 'Kunde B' }
    ],
    projects: [
      { id: 'p1', name: 'Shop A', customer_id: 'c1' },
      { id: 'p2', name: 'Shop B', customer_id: 'c2' }
    ],
    entries: [
      { id: 'e1', customer_id: 'c1', project_id: 'p1', task_name: 'Leistung A', duration_seconds: 60 },
      { id: 'e2', customer_id: 'c2', project_id: 'p2', task_name: 'Leistung B', duration_seconds: 60 }
    ]
  });
  let $ = load(app.timePage());
  assert.equal($('#crmTimeCustomerFilter').length, 1);
  assert.equal($('#crmTimeProjectFilter').length, 1);
  app.listeners.change({ target: { id: 'crmTimeProjectFilter', value: 'p1', matches: () => false } });
  $ = load(app.timePage());
  assert.equal($('tbody tr').length, 1);
  assert.match($('tbody').text(), /Leistung A/);
  app.listeners.change({ target: { id: 'crmTimeCustomerFilter', value: 'c2', matches: () => false } });
  $ = load(app.timePage());
  assert.match($('tbody').text(), /Leistung B/);
  assert.equal($('#crmTimeProjectFilter option[value="p1"]').length, 0);
  app.state.entries = [];
  assert.match(load(app.timePage()).text(), /Keine Zeitbuchungen für diese Auswahl/);
});

test('only draft invoices offer editing and manual draft creation needs no time entries', async () => {
  const app = await browser();
  app.state.customers = [{ id: 'c1', name: 'Kunde' }];
  app.state.invoices = [
    { id: 'i1', status: 'draft', customer_id: 'c1' },
    { id: 'i2', status: 'issued', customer_id: 'c1' }
  ];
  const $ = load(app.invoicePage());
  assert.equal($('[data-action="edit-invoice"][data-id="i1"]').length, 1);
  assert.equal($('[data-action="edit-invoice"][data-id="i2"]').length, 0);
  assert.equal($('[data-action="draft-invoice"]').attr('disabled'), undefined);
});
