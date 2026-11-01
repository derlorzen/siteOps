import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createBillingController } from '../lib/billing.mjs';

function fixture(status = 'draft') {
  const invoiceId = randomUUID(),
    itemId = randomUUID(),
    entryId = randomUUID();
  const invoice = {
    id: invoiceId,
    status,
    customer_id: randomUUID(),
    service_from: '2026-09-01',
    service_to: '2026-09-30'
  };
  let items = [{ id: itemId, invoice_id: invoiceId, entry_id: entryId }];
  const calls = [];
  const db = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.startsWith('SELECT * FROM invoices')) return [[{ ...invoice }]];
      if (sql.startsWith('SELECT') && sql.includes('FROM invoice_items')) return [items.map(x => ({ ...x }))];
      if (sql.startsWith('DELETE FROM invoice_items')) items = [];
      if (sql.startsWith('INSERT INTO invoice_items')) {
        const columns = sql.match(/invoice_items\(([^)]+)\)/)[1].split(',');
        items.push(Object.fromEntries(columns.map((c, i) => [c, values[i]])));
      }
      return [[]];
    },
    async getConnection() {
      return {
        query: db.query,
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release() {}
      };
    }
  };
  return { api: createBillingController({ db, archive: async () => ({}) }), invoiceId, itemId, entryId, calls };
}
const payload = items => ({ service_from: '2026-09-01', service_to: '2026-09-30', items });
const item = overrides => ({
  entry_date: '2026-09-16',
  description: 'Angepasste Leistung',
  quantity: 1.5,
  unit: 'Std.',
  hourly_cents: 8000,
  amount_cents: 12000,
  ...overrides
});

test('draft positions can be edited, added and removed without changing source time entries', async () => {
  const f = fixture();
  const result = await f.api.updateDraft(
    f.invoiceId,
    payload([
      item({ id: f.itemId, description: 'Korrigierter Text', amount_cents: 11000 }),
      item({ description: 'Eigene Position', quantity: 2, unit: 'Stück', hourly_cents: 2500, amount_cents: 5000 })
    ])
  );
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].entry_id, f.entryId);
  assert.equal(result.items[0].description, 'Korrigierter Text');
  assert.equal(result.items[0].amount_cents, 11000);
  assert.equal(result.items[1].entry_id, null);
  assert.equal(result.items[1].unit, 'Stück');
  assert.equal(
    f.calls.some(x => /(?:UPDATE|DELETE FROM) time_entries/.test(x.sql)),
    false
  );
  const totals = f.calls.find(x => x.sql.startsWith('UPDATE invoices SET service_from='));
  assert.deepEqual(totals.values.slice(2, 5), [16000, 3040, 19040]);
  await f.api.updateDraft(f.invoiceId, payload([item({ description: 'Nur eigene Position' })]));
  assert.equal((await f.api.details(f.invoiceId)).items.length, 1);
});

test('positions on issued, paid, cancelled and archiving invoices cannot be edited', async () => {
  for (const status of ['issued', 'paid', 'cancelled', 'archiving']) {
    const f = fixture(status);
    await assert.rejects(f.api.updateDraft(f.invoiceId, payload([item()])), e => e.statusCode === 409);
    assert.equal(
      f.calls.some(x => /^(INSERT|UPDATE|DELETE)/.test(x.sql)),
      false
    );
  }
});

test('draft updates reject foreign or duplicate item IDs and invalid amounts before writing', async () => {
  for (const items of [[item({ id: randomUUID() })], [item({ amount_cents: -1 })], [item({ quantity: Infinity })]]) {
    const f = fixture();
    await assert.rejects(f.api.updateDraft(f.invoiceId, payload(items)));
    assert.equal(
      f.calls.some(x => /^(INSERT|UPDATE|DELETE)/.test(x.sql)),
      false
    );
  }
  const f = fixture();
  await assert.rejects(f.api.updateDraft(f.invoiceId, payload([item({ id: f.itemId }), item({ id: f.itemId })])));
});
