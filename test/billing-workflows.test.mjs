import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createBillingWorkflows } from '../lib/billing-workflows.mjs';

function setup(responder = () => []) {
  const calls = [];
  const db = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      return [responder(sql, values)];
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
  const api = createBillingWorkflows({
    db,
    billing: { createTask: async input => input },
    sendMail: async () => ({ messageId: 'ok' })
  });
  return { calls, api };
}
test('checklists require an existing task', async () => {
  const { api, calls } = setup();
  await assert.rejects(api.addChecklist(randomUUID(), { text: 'Prüfen' }), e => e.statusCode === 404);
  assert.equal(
    calls.some(x => x.sql.startsWith('INSERT')),
    false
  );
});
test('attachments reject oversized base64 input', async () => {
  const { api } = setup(sql => (sql.startsWith('SELECT t.id,t.project_id') ? [{ id: randomUUID() }] : []));
  const large = Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64');
  await assert.rejects(api.upload(randomUUID(), { filename: 'bild.png', data_base64: large }), e => Boolean(e));
});
test('task presets create tasks assigned to the requested project', async () => {
  const projectId = randomUUID();
  const { api } = setup(sql => (sql.includes('SELECT id FROM customer_projects') ? [{ id: projectId }] : []));
  const result = await api.applyTemplate(projectId, { key: 'maintenance' });
  assert.equal(result.created.length, 4);
});
test('unissued invoices cannot be emailed', async () => {
  const invoiceId = randomUUID();
  const { api } = setup(sql =>
    sql.startsWith('SELECT * FROM invoices WHERE id=') ? [{ id: invoiceId, status: 'draft' }] : []
  );
  await assert.rejects(api.deliver(invoiceId, { kind: 'invoice' }), e => e.statusCode === 409);
});
test('DATEV preparation uses documented decimal separator and escaped customer text', async () => {
  const { api } = setup(sql => {
    if (sql.includes('FROM invoices i JOIN customers'))
      return [
        {
          invoice_number: 'RE-2026-00001',
          issued_at: '2026-10-14',
          gross_cents: 11900,
          customer_name: 'Beispiel; Firma'
        }
      ];
    return [];
  });
  const content = await api.datevCsv(2026);
  assert.match(content, /119,00/);
  assert.match(content, /"Rechnung Beispiel; Firma"/);
  assert.match(content, /8400/);
});
test('public workflows JavaScript parses', async () => {
  const script = await readFile(new URL('../public/billing-workflows.js', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new vm.Script(script));
});
