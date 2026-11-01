import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateInvoiceNumber } from '../lib/billing-numbering.mjs';
import { createBillingController } from '../lib/billing.mjs';

test('number circles have independent starts, never rewind, skip existing numbers and reset annually', async () => {
  const counters = new Map(),
    used = new Set(['CUSTOM-2026-00042']);
  const conn = {
    query: async (sql, args) => {
      const key = args[0] + ':' + args[1];
      if (sql.startsWith('INSERT')) {
        if (!counters.has(key)) counters.set(key, 0);
        return [{}];
      }
      if (sql.startsWith('SELECT last_number')) return [[{ last_number: counters.get(key) }]];
      if (sql.startsWith('SELECT invoice_number')) return [used.has(args[0]) ? [{ invoice_number: args[0] }] : []];
      if (sql.startsWith('UPDATE')) {
        counters.set(args[1] + ':' + args[2], args[0]);
        return [{}];
      }
      throw Error(sql);
    }
  };
  assert.equal(
    await allocateInvoiceNumber(conn, { invoice_prefix: 'CUSTOM', invoice_start_number: '42' }, 2026),
    'CUSTOM-2026-00043'
  );
  assert.equal(
    await allocateInvoiceNumber(conn, { invoice_prefix: 'CUSTOM', invoice_start_number: '1' }, 2026),
    'CUSTOM-2026-00044'
  );
  assert.equal(
    await allocateInvoiceNumber(conn, { invoice_prefix: 'OTHER', invoice_start_number: '100' }, 2026),
    'OTHER-2026-00100'
  );
  assert.equal(
    await allocateInvoiceNumber(conn, { invoice_prefix: 'CUSTOM', invoice_start_number: '42' }, 2027),
    'CUSTOM-2027-00042'
  );
});
test('draft previews include unsaved edits and watermarks while executing no writes', async () => {
  const queries = [];
  const db = {
    query: async sql => {
      queries.push(sql);
      if (sql.includes('FROM invoices'))
        return [
          [
            {
              id: 'draft',
              customer_id: 'customer',
              status: 'draft',
              service_from: '2026-11-01',
              service_to: '2026-11-02'
            }
          ]
        ];
      if (sql.includes('FROM invoice_items'))
        return [
          [
            {
              description: 'Saved text',
              entry_date: '2026-11-01',
              quantity: 1,
              unit: 'Std.',
              hourly_cents: 100,
              amount_cents: 100
            }
          ]
        ];
      if (sql.includes('FROM customers')) return [[{ name: 'Customer' }]];
      return [[]];
    }
  };
  const api = createBillingController({ db, archive: () => assert.fail('preview must never archive') });
  const preview = await api.preview('draft', {
    service_from: '2026-11-01',
    service_to: '2026-11-02',
    items: [
      {
        description: 'Unsaved text',
        entry_date: '2026-11-01',
        quantity: 2,
        unit: 'Std.',
        hourly_cents: 100,
        amount_cents: 200
      }
    ]
  });
  const content = preview.data.toString('latin1');
  assert.match(content, /Vorschau/);
  assert.match(content, /Unsaved text/);
  assert.doesNotMatch(content, /Saved text/);
  assert.ok(queries.every(sql => sql.startsWith('SELECT')));
  assert.ok(queries.every(sql => !sql.includes('sequences')));
});
