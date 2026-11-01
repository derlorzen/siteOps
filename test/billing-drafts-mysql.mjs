import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createBillingController } from '../lib/billing.mjs';

export async function checkBillingDraftsMysql(db) {
  const customerId = randomUUID(),
    projectId = randomUUID(),
    taskId = randomUUID(),
    entryId = randomUUID();
  const api = createBillingController({ db, archive: async () => ({}) });
  const period = { service_from: '2026-09-01', service_to: '2026-09-30' };
  const drafts = [];
  try {
    await db.query('INSERT INTO customers(id,name) VALUES(?,?)', [customerId, 'Invoice draft CI']);
    await db.query('INSERT INTO customer_projects(id,customer_id,name) VALUES(?,?,?)', [
      projectId,
      customerId,
      'CI project'
    ]);
    await db.query('INSERT INTO project_tasks(id,project_id,name) VALUES(?,?,?)', [taskId, projectId, 'CI task']);
    await db.query('INSERT INTO time_entries(id,task_id,entry_date,duration_seconds,hourly_cents) VALUES(?,?,?,?,?)', [
      entryId,
      taskId,
      '2026-09-16',
      5400,
      7500
    ]);
    const draft = await api.createDraft({ customer_id: customerId, ...period, entry_ids: [entryId] });
    drafts.push(draft.id);
    assert.equal(Number(draft.net_cents), 11250);
    const updated = await api.updateDraft(draft.id, {
      ...period,
      items: [
        {
          id: draft.items[0].id,
          entry_date: '2026-09-17',
          description: 'Edited time position',
          quantity: 2,
          unit: 'Std.',
          hourly_cents: 8000,
          amount_cents: 15000
        },
        {
          entry_date: '2026-09-17',
          description: 'Manual position',
          quantity: 1,
          unit: 'Pauschale',
          hourly_cents: 5000,
          amount_cents: 5000
        },
        {
          entry_date: '2026-09-17',
          description: 'Second manual position',
          quantity: 2,
          unit: 'Stück',
          hourly_cents: 1000,
          amount_cents: 2000
        }
      ]
    });
    assert.equal(updated.items.length, 3);
    assert.equal(updated.items[0].entry_id, entryId);
    assert.equal(updated.items[1].entry_id, null);
    assert.equal(updated.items[2].entry_id, null);
    assert.equal(Number(updated.net_cents), 22000);
    assert.equal(Number(updated.gross_cents), 26180);
    const [[source]] = await db.query('SELECT duration_seconds,hourly_cents FROM time_entries WHERE id=?', [entryId]);
    assert.equal(source.duration_seconds, 5400);
    assert.equal(source.hourly_cents, 7500);
    await api.updateDraft(draft.id, { ...period, items: [] });
    const reused = await api.createDraft({ customer_id: customerId, ...period, entry_ids: [entryId] });
    drafts.push(reused.id);
    assert.equal(reused.items.length, 1);
    const manual = await api.createDraft({ customer_id: customerId, ...period, entry_ids: [] });
    drafts.push(manual.id);
    assert.equal(manual.items.length, 0);
    await db.query("UPDATE invoices SET status='issued' WHERE id=?", [manual.id]);
    await assert.rejects(api.updateDraft(manual.id, { ...period, items: [] }), error => error.statusCode === 409);
  } finally {
    for (const invoiceId of drafts) {
      await db.query('DELETE FROM invoice_items WHERE invoice_id=?', [invoiceId]);
      await db.query('DELETE FROM invoices WHERE id=?', [invoiceId]);
    }
    await db.query('DELETE FROM time_entries WHERE id=?', [entryId]);
    await db.query('DELETE FROM project_tasks WHERE id=?', [taskId]);
    await db.query('DELETE FROM customer_projects WHERE id=?', [projectId]);
    await db.query('DELETE FROM customers WHERE id=?', [customerId]);
  }
}
