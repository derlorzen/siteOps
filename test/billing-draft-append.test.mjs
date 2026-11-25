import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBillingController } from '../lib/billing.mjs';
import { redact } from '../lib/capability-registry.mjs';
import { needsHttpApproval } from '../lib/http-action-guard.mjs';

const invoiceId = '00000000-0000-4000-8000-000000000001';
const customerId = '00000000-0000-4000-8000-000000000002';
const entryId = '00000000-0000-4000-8000-000000000003';
const oldId = '00000000-0000-4000-8000-000000000004';

function fixture(overrides = {}, status = 'draft') {
  const invoice = {
    id: invoiceId,
    customer_id: customerId,
    status,
    service_from: '2026-10-01',
    service_to: '2026-10-08',
    net_cents: 0,
    tax_cents: 0,
    gross_cents: 0
  };
  const old = {
    id: oldId,
    entry_id: oldId,
    description: 'Manuell korrigiert',
    quantity: '1.500000',
    unit: 'Std.',
    duration_seconds: 5400,
    hourly_cents: 0,
    amount_cents: 0,
    sort_position: 7
  };
  const items = [globalThis.structuredClone(old)];
  const source = {
    id: entryId,
    entry_date: '2026-09-30',
    customer_id: customerId,
    duration_seconds: 1800,
    hourly_cents: 8900,
    billable: 1,
    started_at: null,
    description: 'Zusatzleistung',
    ...overrides
  };
  let snapshot;
  const conn = {
    async beginTransaction() {
      snapshot = globalThis.structuredClone({ invoice, items });
    },
    async commit() {},
    async rollback() {
      Object.assign(invoice, snapshot.invoice);
      items.splice(0, items.length, ...snapshot.items);
    },
    release() {},
    async query(sql, params) {
      if (sql.startsWith('SELECT * FROM invoices')) return [[invoice]];
      if (sql.startsWith('SELECT * FROM invoice_items')) return [items];
      if (sql.startsWith('SELECT e.id,e.entry_date')) {
        return [
          params.includes(source.id)
            ? [
                {
                  ...source,
                  invoice_id: source.invoice_id || (items.some(i => i.entry_id === source.id) ? invoiceId : null)
                }
              ]
            : []
        ];
      }
      if (sql.startsWith('INSERT INTO invoice_items')) {
        const keys = [
          'id',
          'invoice_id',
          'entry_id',
          'description',
          'entry_date',
          'duration_seconds',
          'hourly_cents',
          'amount_cents',
          'quantity',
          'unit',
          'sort_position'
        ];
        items.push(Object.fromEntries(keys.map((key, index) => [key, params[index]])));
        return [{}];
      }
      if (sql.startsWith('UPDATE invoices SET service_from')) {
        const keys = ['service_from', 'service_to', 'net_cents', 'tax_cents', 'gross_cents'];
        Object.assign(invoice, Object.fromEntries(keys.map((key, index) => [key, params[index]])));
        return [{}];
      }
      throw new Error('Unexpected SQL: ' + sql);
    }
  };
  const db = { query: conn.query, getConnection: async () => conn };
  return { billing: createBillingController({ db }), invoice, items, old };
}

test('append keeps zero amounts, original IDs, manual quantities and ordering; retries are idempotent', async () => {
  const { billing, items, old } = fixture();
  const result = await billing.appendDraftEntries(invoiceId, { entry_ids: [entryId] });
  assert.deepEqual(items[0], old);
  assert.equal(items[1].entry_id, entryId);
  assert.equal(items[1].sort_position, 8);
  assert.equal(items[1].quantity, '0.500000');
  assert.equal(result.net_cents, 4450);
  assert.equal(result.tax_cents, 846);
  assert.equal(result.gross_cents, 5296);
  assert.equal(result.service_from, '2026-09-30');
  assert.equal(result.service_to, '2026-10-08');
  await billing.appendDraftEntries(invoiceId, { entry_ids: [entryId] });
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], old);
});

test('append rejects other customers, assigned entries, running timers and nonbillable entries', async () => {
  for (const overrides of [
    { customer_id: 'another' },
    { invoice_id: 'another' },
    { started_at: new Date() },
    { billable: 0 },
    { duration_seconds: 0 }
  ]) {
    const { billing, items, old, invoice } = fixture(overrides);
    await assert.rejects(billing.appendDraftEntries(invoiceId, { entry_ids: [entryId] }), { statusCode: 409 });
    assert.deepEqual(items, [old]);
    assert.equal(invoice.net_cents, 0);
  }
});

test('append rejects issued invoices and duplicate request IDs', async () => {
  const { billing } = fixture({}, 'issued');
  await assert.rejects(billing.appendDraftEntries(invoiceId, { entry_ids: [entryId] }), { statusCode: 409 });
  await assert.rejects(billing.appendDraftEntries(invoiceId, { entry_ids: [entryId, entryId] }), {
    statusCode: 400
  });
});

test('MCP serializes dates and HTTP append uses the draft approval guard', () => {
  assert.deepEqual(redact({ entry_date: new Date('2026-10-01T00:00:00Z') }), {
    entry_date: '2026-10-01T00:00:00.000Z'
  });
  assert.equal(needsHttpApproval('POST', '/api/billing/invoices/' + invoiceId + '/append-entries'), true);
});
