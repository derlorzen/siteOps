import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createBillingController } from '../lib/billing.mjs';

export async function checkBillingDraftsMysql(db) {
  const customerId = randomUUID(),
    projectId = randomUUID(),
    taskId = randomUUID(),
    entryId = randomUUID();
  let archived = 0;
  const api = createBillingController({
    db,
    archive: async () => {
      archived++;
      return { commit: 'a'.repeat(40), path: 'test/invoice.pdf' };
    }
  });
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
    const snapshot = {
      sender: { name: 'CI sender', street: 'Testweg 1', postal_code: '12345', city: 'Berlin', tax_id: '12345' },
      customer: { name: 'CI customer' },
      number: 'CI-RESET-' + reused.id,
      issued_at: '2026-11-01',
      due_at: '2026-11-15',
      ...period,
      items: reused.items,
      net_cents: 11250,
      tax_cents: 2138,
      gross_cents: 13388,
      vat_percent: 19
    };
    await db.query("UPDATE invoices SET status='issued',invoice_number=?,snapshot_json=?,pdf_base64=? WHERE id=?", [
      snapshot.number,
      JSON.stringify(snapshot),
      Buffer.from('original archived PDF').toString('base64'),
      reused.id
    ]);
    const correction = await api.resetDraft(reused.id, { reason: 'Leistung korrigieren' });
    drafts.push(correction.id);
    assert.equal(correction.status, 'draft');
    assert.equal(correction.invoice_number, null);
    assert.equal(correction.items.length, 1);
    assert.equal(correction.items[0].entry_id, null);
    const preserved = await api.details(reused.id);
    assert.equal(preserved.status, 'cancelled');
    assert.equal(preserved.pdf_base64, Buffer.from('original archived PDF').toString('base64'));
    assert.equal(preserved.items[0].entry_id, entryId);
    assert.equal((await api.resetDraft(reused.id, { reason: 'Leistung korrigieren' })).id, correction.id);
    assert.equal(archived, 1, 'retry must not create another cancellation');
    await assert.rejects(api.paid(reused.id), error => error.statusCode === 409);
    await api.updateDraft(correction.id, { ...period, items: [] });
    const manual = await api.createDraft({ customer_id: customerId, ...period, entry_ids: [] });
    drafts.push(manual.id);
    assert.equal(manual.items.length, 0);
    await db.query("UPDATE invoices SET status='issued' WHERE id=?", [manual.id]);
    await assert.rejects(api.updateDraft(manual.id, { ...period, items: [] }), error => error.statusCode === 409);
  } finally {
    await db.query(
      'DELETE FROM invoice_draft_resets WHERE original_invoice_id IN (SELECT id FROM invoices WHERE customer_id=?)',
      [customerId]
    );
    await db.query(
      'DELETE FROM invoice_cancellations WHERE invoice_id IN (SELECT id FROM invoices WHERE customer_id=?)',
      [customerId]
    );
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
