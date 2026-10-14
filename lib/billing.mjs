import crypto from 'node:crypto';
import * as z from 'zod/v4';
import { renderInvoicePdf } from './billing-pdf.mjs';

const uuid = () => crypto.randomUUID();
const id = z.uuid();
const short = z.string().trim().min(1).max(255);
const date = z.iso.date();
const nonneg = z.coerce.number().int().min(0);
const dateValue = v => (typeof v === 'string' ? v.slice(0, 10) : new Date(v).toISOString().slice(0, 10));
const today = () =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
const message = e => e?.message || String(e);
const fail = (status, detail) => {
  const e = new Error(detail);
  e.statusCode = status;
  throw e;
};
const minutesToSeconds = x => Math.round(x * 60);
const price = (seconds, cents) => Math.round((Number(seconds) * Number(cents)) / 3600);
const senderKeys = [
  'name',
  'street',
  'postal_code',
  'city',
  'email',
  'tax_id',
  'vat_id',
  'iban',
  'bic',
  'payment_note'
];
const inputCustomer = z.object({
  name: short,
  contact_name: z.string().max(255).nullish(),
  email: z.union([z.email(), z.literal('')]).nullish(),
  street: z.string().max(255).nullish(),
  postal_code: z.string().max(24).nullish(),
  city: z.string().max(150).nullish(),
  country: z.string().length(2).default('DE'),
  vat_id: z.string().max(50).nullish(),
  notes: z.string().max(5000).nullish(),
  default_hourly_cents: nonneg.max(10000000).default(7500),
  active: z.boolean().default(true)
});
const inputProject = z.object({
  customer_id: id,
  name: short,
  description: z.string().max(5000).nullish(),
  site_id: id.nullish(),
  hourly_cents: nonneg.max(10000000).nullish()
});
const inputTask = z.object({
  project_id: id,
  name: short,
  hourly_cents: nonneg.max(10000000).nullish()
});
const inputEntry = z.object({
  task_id: id,
  entry_date: date,
  kind: z.enum(['work', 'call']).default('work'),
  description: z.string().max(1000).default(''),
  contact_name: z.string().max(255).nullish(),
  duration_minutes: z.coerce.number().min(0).max(10080).default(0),
  billable: z.boolean().default(true)
});
const inputDraft = z.object({
  customer_id: id,
  service_from: date,
  service_to: date,
  entry_ids: z.array(id).min(1).max(500)
});
const inputSender = z.object(Object.fromEntries(senderKeys.map(key => [key, z.string().trim().max(500).default('')])));
async function rows(db, sql, params = []) {
  return (await db.query(sql, params))[0];
}
async function one(db, sql, params) {
  return (await rows(db, sql, params))[0] || null;
}

export function createBillingController({ db, archive }) {
  async function settings() {
    const values = await rows(db, 'SELECT setting_key,setting_value FROM billing_settings');
    return Object.fromEntries(senderKeys.map(k => [k, values.find(v => v.setting_key === k)?.setting_value || '']));
  }
  async function saveSettings(raw) {
    const x = inputSender.parse(raw);
    for (const [key, val] of Object.entries(x))
      await rows(
        db,
        'INSERT INTO billing_settings(setting_key,setting_value) VALUES(?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)',
        [key, val]
      );
    return settings();
  }
  async function clients() {
    return rows(
      db,
      'SELECT c.*, (SELECT COUNT(*) FROM customer_projects p WHERE p.customer_id=c.id) projects FROM customers c ORDER BY c.name'
    );
  }
  async function createClient(raw) {
    const x = inputCustomer.parse(raw);
    const newId = uuid();
    await rows(
      db,
      'INSERT INTO customers(id,name,contact_name,email,street,postal_code,city,country,vat_id,notes,default_hourly_cents,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      [
        newId,
        x.name,
        x.contact_name || null,
        x.email || null,
        x.street || null,
        x.postal_code || null,
        x.city || null,
        x.country.toUpperCase(),
        x.vat_id || null,
        x.notes || null,
        x.default_hourly_cents,
        x.active
      ]
    );
    return one(db, 'SELECT * FROM customers WHERE id=?', [newId]);
  }
  async function editClient(clientId, raw) {
    const x = inputCustomer.partial().parse(raw);
    if (!Object.keys(x).length) fail(400, 'Keine Änderungen.');
    const fields = Object.keys(x);
    const values = fields.map(k => (x[k] === '' ? null : x[k]));
    await rows(db, 'UPDATE customers SET ' + fields.map(k => k + '=?').join(',') + ' WHERE id=?', [
      ...values,
      clientId
    ]);
    return one(db, 'SELECT * FROM customers WHERE id=?', [clientId]) || fail(404, 'Kunde fehlt.');
  }
  async function projects(customerId) {
    const where = customerId ? ' WHERE p.customer_id=?' : '';
    return rows(
      db,
      'SELECT p.*,c.name customer_name,s.domain site_domain FROM customer_projects p JOIN customers c ON c.id=p.customer_id LEFT JOIN sites s ON s.id=p.site_id' +
        where +
        ' ORDER BY p.created_at DESC',
      customerId ? [customerId] : []
    );
  }
  async function createProject(raw) {
    const x = inputProject.parse(raw),
      newId = uuid();
    if (!(await one(db, 'SELECT id FROM customers WHERE id=?', [x.customer_id]))) fail(404, 'Kunde fehlt.');
    await rows(
      db,
      'INSERT INTO customer_projects(id,customer_id,site_id,name,description,hourly_cents) VALUES(?,?,?,?,?,?)',
      [newId, x.customer_id, x.site_id || null, x.name, x.description || null, x.hourly_cents ?? null]
    );
    return one(db, 'SELECT * FROM customer_projects WHERE id=?', [newId]);
  }
  async function editProject(projectId, raw) {
    const x = inputProject
      .omit({ customer_id: true })
      .partial()
      .extend({ status: z.enum(['active', 'completed', 'paused']).optional() })
      .parse(raw);
    if (!Object.keys(x).length) fail(400, 'Keine Änderungen.');
    const keys = Object.keys(x);
    await rows(db, 'UPDATE customer_projects SET ' + keys.map(k => k + '=?').join(',') + ' WHERE id=?', [
      ...keys.map(k => x[k]),
      projectId
    ]);
    return one(db, 'SELECT * FROM customer_projects WHERE id=?', [projectId]) || fail(404, 'Projekt fehlt.');
  }
  async function tasks(projectId) {
    return rows(
      db,
      'SELECT t.*,p.name project_name,p.customer_id FROM project_tasks t JOIN customer_projects p ON p.id=t.project_id' +
        (projectId ? ' WHERE t.project_id=?' : '') +
        ' ORDER BY t.created_at DESC',
      projectId ? [projectId] : []
    );
  }
  async function createTask(raw) {
    const x = inputTask.parse(raw),
      newId = uuid();
    if (!(await one(db, 'SELECT id FROM customer_projects WHERE id=?', [x.project_id]))) fail(404, 'Projekt fehlt.');
    await rows(db, 'INSERT INTO project_tasks(id,project_id,name,hourly_cents) VALUES(?,?,?,?)', [
      newId,
      x.project_id,
      x.name,
      x.hourly_cents ?? null
    ]);
    return one(db, 'SELECT * FROM project_tasks WHERE id=?', [newId]);
  }
  async function editTask(taskId, raw) {
    const x = inputTask
      .omit({ project_id: true })
      .partial()
      .extend({ status: z.enum(['open', 'done']).optional() })
      .parse(raw);
    if (!Object.keys(x).length) fail(400, 'Keine Änderungen.');
    const keys = Object.keys(x);
    await rows(db, 'UPDATE project_tasks SET ' + keys.map(k => k + '=?').join(',') + ' WHERE id=?', [
      ...keys.map(k => x[k]),
      taskId
    ]);
    return one(db, 'SELECT * FROM project_tasks WHERE id=?', [taskId]) || fail(404, 'Task fehlt.');
  }
  async function entryRate(taskId) {
    const x = await one(
      db,
      'SELECT COALESCE(t.hourly_cents,p.hourly_cents,c.default_hourly_cents) rate FROM project_tasks t JOIN customer_projects p ON p.id=t.project_id JOIN customers c ON c.id=p.customer_id WHERE t.id=?',
      [taskId]
    );
    if (!x) fail(404, 'Task fehlt.');
    return x.rate;
  }
  async function entries(filter = {}) {
    const params = [],
      wheres = [];
    if (filter.customer_id) {
      wheres.push('p.customer_id=?');
      params.push(filter.customer_id);
    }
    if (filter.project_id) {
      wheres.push('p.id=?');
      params.push(filter.project_id);
    }
    if (filter.from) {
      wheres.push('e.entry_date>=?');
      params.push(date.parse(filter.from));
    }
    if (filter.to) {
      wheres.push('e.entry_date<=?');
      params.push(date.parse(filter.to));
    }
    return rows(
      db,
      'SELECT e.*,t.name task_name,p.name project_name,p.id project_id,p.customer_id,c.name customer_name,ii.invoice_id FROM time_entries e JOIN project_tasks t ON t.id=e.task_id JOIN customer_projects p ON p.id=t.project_id JOIN customers c ON c.id=p.customer_id LEFT JOIN invoice_items ii ON ii.entry_id=e.id' +
        (wheres.length ? ' WHERE ' + wheres.join(' AND ') : '') +
        ' ORDER BY e.entry_date DESC,e.created_at DESC LIMIT 1500',
      params
    );
  }
  async function createEntry(raw) {
    const x = inputEntry.parse(raw);
    if (x.duration_minutes <= 0) fail(400, 'Dauer muss größer als null sein.');
    const newId = uuid(),
      rate = await entryRate(x.task_id);
    await rows(
      db,
      'INSERT INTO time_entries(id,task_id,entry_date,kind,description,contact_name,duration_seconds,billable,hourly_cents) VALUES(?,?,?,?,?,?,?,?,?)',
      [
        newId,
        x.task_id,
        x.entry_date,
        x.kind,
        x.description,
        x.contact_name || null,
        minutesToSeconds(x.duration_minutes),
        x.billable,
        rate
      ]
    );
    return one(db, 'SELECT * FROM time_entries WHERE id=?', [newId]);
  }
  async function editEntry(entryId, raw) {
    const x = inputEntry.omit({ task_id: true }).partial().parse(raw);
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const entry = await one(
        conn,
        'SELECT e.*,ii.invoice_id FROM time_entries e LEFT JOIN invoice_items ii ON ii.entry_id=e.id WHERE e.id=? FOR UPDATE',
        [entryId]
      );
      if (!entry) fail(404, 'Eintrag fehlt.');
      if (entry.invoice_id) fail(409, 'Bereits einer Rechnung zugeordnet.');
      if (entry.started_at) fail(409, 'Timer zunächst stoppen.');
      const updates = Object.entries(x).map(([key, val]) => [
        key === 'duration_minutes' ? 'duration_seconds' : key,
        key === 'duration_minutes' ? minutesToSeconds(val) : val
      ]);
      if (updates.length)
        await rows(conn, 'UPDATE time_entries SET ' + updates.map(a => a[0] + '=?').join(',') + ' WHERE id=?', [
          ...updates.map(a => a[1]),
          entryId
        ]);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    return one(db, 'SELECT * FROM time_entries WHERE id=?', [entryId]);
  }
  async function deleteEntry(entryId) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const entry = await one(
        conn,
        'SELECT e.id,ii.invoice_id FROM time_entries e LEFT JOIN invoice_items ii ON ii.entry_id=e.id WHERE e.id=? FOR UPDATE',
        [entryId]
      );
      if (!entry) fail(404, 'Eintrag fehlt.');
      if (entry.invoice_id) fail(409, 'Abgerechnete Zeit kann nicht gelöscht werden.');
      await rows(conn, 'DELETE FROM time_entries WHERE id=?', [entryId]);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    return { ok: true };
  }
  async function startTimer(raw) {
    const x = z
      .object({
        task_id: id,
        kind: z.enum(['work', 'call']).default('work'),
        description: z.string().max(1000).default(''),
        contact_name: z.string().max(255).nullish(),
        billable: z.boolean().default(true)
      })
      .parse(raw);
    if (await one(db, 'SELECT id FROM time_entries WHERE started_at IS NOT NULL LIMIT 1'))
      fail(409, 'Es läuft bereits ein Timer.');
    const newId = uuid();
    try {
      await rows(
        db,
        'INSERT INTO time_entries(id,task_id,entry_date,kind,description,contact_name,started_at,billable,hourly_cents) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP(3),?,?)',
        [
          newId,
          x.task_id,
          today(),
          x.kind,
          x.description,
          x.contact_name || null,
          x.billable,
          await entryRate(x.task_id)
        ]
      );
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') fail(409, 'Es läuft bereits ein Timer.');
      throw e;
    }
    return one(db, 'SELECT * FROM time_entries WHERE id=?', [newId]);
  }
  async function stopTimer(entryId) {
    await rows(
      db,
      'UPDATE time_entries SET duration_seconds=GREATEST(1,TIMESTAMPDIFF(SECOND,started_at,UTC_TIMESTAMP(3))),started_at=NULL WHERE id=? AND started_at IS NOT NULL',
      [entryId]
    );
    return one(db, 'SELECT * FROM time_entries WHERE id=?', [entryId]) || fail(404, 'Timer fehlt.');
  }
  async function invoices(customerId) {
    return rows(
      db,
      'SELECT i.id,i.customer_id,i.invoice_number,i.status,i.service_from,i.service_to,i.net_cents,i.tax_cents,i.gross_cents,i.archive_commit,i.archive_path,i.error_message,i.created_at,i.issued_at,i.due_at,i.paid_at,c.name customer_name,ic.cancellation_number,ic.status cancellation_status FROM invoices i JOIN customers c ON c.id=i.customer_id LEFT JOIN invoice_cancellations ic ON ic.invoice_id=i.id' +
        (customerId ? ' WHERE i.customer_id=?' : '') +
        ' ORDER BY i.created_at DESC LIMIT 500',
      customerId ? [customerId] : []
    );
  }
  async function createDraft(raw) {
    const x = inputDraft.parse(raw);
    if (x.service_from > x.service_to) fail(400, 'Ungültiger Zeitraum.');
    if (new Set(x.entry_ids).size !== x.entry_ids.length) fail(400, 'Doppelte Zeiteinträge.');
    const conn = await db.getConnection(),
      invoiceId = uuid();
    try {
      await conn.beginTransaction();
      const marks = x.entry_ids.map(() => '?').join(',');
      const selected = await rows(
        conn,
        'SELECT e.id,e.entry_date,e.duration_seconds,e.description,e.kind,e.hourly_cents,e.billable,e.started_at,t.name task_name,p.customer_id,ii.invoice_id FROM time_entries e JOIN project_tasks t ON t.id=e.task_id JOIN customer_projects p ON p.id=t.project_id LEFT JOIN invoice_items ii ON ii.entry_id=e.id WHERE e.id IN (' +
          marks +
          ') ORDER BY e.entry_date,e.id FOR UPDATE',
        x.entry_ids
      );
      if (
        selected.length !== x.entry_ids.length ||
        selected.some(
          e =>
            e.customer_id !== x.customer_id ||
            !e.billable ||
            e.started_at ||
            e.invoice_id ||
            !e.duration_seconds ||
            dateValue(e.entry_date) < x.service_from ||
            dateValue(e.entry_date) > x.service_to
        )
      )
        fail(409, 'Ungültige, fremde, laufende oder bereits abgerechnete Einträge.');
      if (!(await one(conn, 'SELECT id FROM customers WHERE id=?', [x.customer_id]))) fail(404, 'Kunde fehlt.');
      await rows(conn, 'INSERT INTO invoices(id,customer_id,service_from,service_to) VALUES(?,?,?,?)', [
        invoiceId,
        x.customer_id,
        x.service_from,
        x.service_to
      ]);
      for (const e of selected)
        await rows(
          conn,
          'INSERT INTO invoice_items(id,invoice_id,entry_id,description,entry_date,duration_seconds,hourly_cents,amount_cents) VALUES(?,?,?,?,?,?,?,?)',
          [
            uuid(),
            invoiceId,
            e.id,
            e.description || e.task_name,
            dateValue(e.entry_date),
            e.duration_seconds,
            e.hourly_cents,
            price(e.duration_seconds, e.hourly_cents)
          ]
        );
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    return details(invoiceId);
  }
  async function details(invoiceId) {
    const invoice = await one(db, 'SELECT * FROM invoices WHERE id=?', [invoiceId]);
    if (!invoice) fail(404, 'Rechnung fehlt.');
    const items = await rows(db, 'SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY entry_date,id', [invoiceId]);
    return { ...invoice, items };
  }
  async function issue(invoiceId) {
    const conn = await db.getConnection();
    let snapshot, pdf, status;
    try {
      await conn.beginTransaction();
      const i = await one(conn, 'SELECT * FROM invoices WHERE id=? FOR UPDATE', [invoiceId]);
      if (!i) fail(404, 'Rechnung fehlt.');
      status = i.status;
      if (!['draft', 'archiving'].includes(status)) fail(409, 'Nur Entwürfe können ausgestellt werden.');
      if (status === 'archiving' && i.snapshot_json && i.pdf_base64) {
        snapshot = JSON.parse(i.snapshot_json);
        pdf = Buffer.from(i.pdf_base64, 'base64');
      } else {
        const customer = await one(conn, 'SELECT * FROM customers WHERE id=?', [i.customer_id]);
        const sender = await settings();
        for (const field of ['name', 'street', 'postal_code', 'city'])
          if (!sender[field]) fail(400, 'Rechnungsabsender unvollständig: ' + field);
        if (!sender.tax_id && !sender.vat_id) fail(400, 'Steuernummer oder USt-ID fehlt.');
        for (const field of ['name', 'street', 'postal_code', 'city'])
          if (!customer[field]) fail(400, 'Kunden-Rechnungsadresse unvollständig: ' + field);
        if (customer.country !== 'DE') fail(400, 'Diese Version unterstützt nur inländische Rechnungen.');
        const items = await rows(
          conn,
          'SELECT id,entry_id,description,entry_date,duration_seconds,hourly_cents,amount_cents FROM invoice_items WHERE invoice_id=? ORDER BY entry_date,id',
          [invoiceId]
        );
        if (!items.length) fail(400, 'Rechnung enthält keine Leistungen.');
        const now = new Date();
        const invoiceYear = Number(today().slice(0, 4));
        await rows(
          conn,
          'INSERT INTO billing_sequences(invoice_year,last_number) VALUES(?,0) ON DUPLICATE KEY UPDATE invoice_year=VALUES(invoice_year)',
          [invoiceYear]
        );
        const sequence = await one(conn, 'SELECT last_number FROM billing_sequences WHERE invoice_year=? FOR UPDATE', [
          invoiceYear
        ]);
        const nextNumber = Number(sequence.last_number) + 1;
        await rows(conn, 'UPDATE billing_sequences SET last_number=? WHERE invoice_year=?', [nextNumber, invoiceYear]);
        const number = 'RE-' + invoiceYear + '-' + String(nextNumber).padStart(5, '0');
        const net = items.reduce((sum, x) => sum + Number(x.amount_cents), 0);
        const tax = Math.round(net * 0.19);
        const issuedAt = now.toISOString();
        const due = new Date(now.getTime() + 14 * 86400000).toISOString().slice(0, 10);
        snapshot = {
          schema_version: 1,
          number,
          issued_at: issuedAt,
          due_at: due,
          service_from: dateValue(i.service_from),
          service_to: dateValue(i.service_to),
          sender,
          customer: Object.fromEntries(
            ['name', 'street', 'postal_code', 'city', 'country', 'vat_id'].map(k => [k, customer[k] || ''])
          ),
          items: items.map(x => ({ ...x, entry_date: dateValue(x.entry_date) })),
          vat_percent: 19,
          net_cents: net,
          tax_cents: tax,
          gross_cents: net + tax
        };
        pdf = renderInvoicePdf(snapshot);
        await rows(
          conn,
          'UPDATE invoices SET invoice_number=?,status=?,issued_at=?,due_at=?,net_cents=?,tax_cents=?,gross_cents=?,snapshot_json=?,pdf_base64=?,error_message=NULL WHERE id=?',
          [
            number,
            'archiving',
            issuedAt.slice(0, 19).replace('T', ' '),
            due,
            net,
            tax,
            net + tax,
            JSON.stringify(snapshot),
            pdf.toString('base64'),
            invoiceId
          ]
        );
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    // Never report a bill as issued before both original files are committed offsite.
    try {
      const target = await archive(snapshot, pdf);
      await rows(
        db,
        'UPDATE invoices SET status=?,archive_sha256=?,archive_commit=?,archive_path=?,error_message=NULL WHERE id=? AND status=?',
        [
          'issued',
          crypto.createHash('sha256').update(pdf).digest('hex'),
          target.commit,
          target.path,
          invoiceId,
          'archiving'
        ]
      );
      return details(invoiceId);
    } catch (e) {
      await rows(db, 'UPDATE invoices SET error_message=? WHERE id=? AND status=?', [
        message(e).slice(0, 1500),
        invoiceId,
        'archiving'
      ]);
      throw e;
    }
  }
  async function pdf(invoiceId) {
    const i = await one(db, 'SELECT invoice_number,status,pdf_base64 FROM invoices WHERE id=?', [invoiceId]);
    if (!i) fail(404, 'Rechnung fehlt.');
    if (!['issued', 'paid', 'cancelled'].includes(i.status) || !i.pdf_base64)
      fail(409, 'Rechnung noch nicht erfolgreich archiviert.');
    return { filename: i.invoice_number + '.pdf', data: Buffer.from(i.pdf_base64, 'base64') };
  }
  async function paid(invoiceId) {
    const result = await rows(
      db,
      "UPDATE invoices SET status='paid',paid_at=UTC_TIMESTAMP(3) WHERE id=? AND status='issued'",
      [invoiceId]
    );
    if (!result.affectedRows) fail(409, 'Nur ausgestellte Rechnungen können als bezahlt markiert werden.');
    return details(invoiceId);
  }
  async function cancel(invoiceId, raw) {
    const { reason } = z.object({ reason: z.string().trim().min(5).max(2000) }).parse(raw);
    const conn = await db.getConnection();
    let snapshot, pdf, cancellationId;
    try {
      await conn.beginTransaction();
      const original = await one(conn, 'SELECT * FROM invoices WHERE id=? FOR UPDATE', [invoiceId]);
      if (!original || !['issued', 'paid', 'cancelled'].includes(original.status))
        fail(409, 'Es können nur ausgestellte Rechnungen storniert werden.');
      const existing = await one(conn, 'SELECT * FROM invoice_cancellations WHERE invoice_id=? FOR UPDATE', [
        invoiceId
      ]);
      if (existing) {
        if (existing.reason !== reason)
          fail(409, 'Für diese Rechnung existiert bereits eine Stornierung mit anderem Grund.');
        if (existing.status === 'issued') fail(409, 'Rechnung wurde bereits storniert.');
        cancellationId = existing.id;
        snapshot = JSON.parse(existing.snapshot_json);
        pdf = Buffer.from(existing.pdf_base64, 'base64');
      } else {
        if (!original.snapshot_json) fail(409, 'Ausgestellte Originalrechnung fehlt.');
        const invoiceYear = Number(today().slice(0, 4));
        await rows(
          conn,
          'INSERT INTO billing_sequences(invoice_year,last_number) VALUES(?,0) ON DUPLICATE KEY UPDATE invoice_year=VALUES(invoice_year)',
          [invoiceYear]
        );
        const last = await one(conn, 'SELECT last_number FROM billing_sequences WHERE invoice_year=? FOR UPDATE', [
          invoiceYear
        ]);
        const next = Number(last.last_number) + 1;
        await rows(conn, 'UPDATE billing_sequences SET last_number=? WHERE invoice_year=?', [next, invoiceYear]);
        const originalSnapshot = JSON.parse(original.snapshot_json);
        snapshot = {
          ...originalSnapshot,
          number: 'RE-' + invoiceYear + '-' + String(next).padStart(5, '0'),
          issued_at: new Date().toISOString(),
          cancellation_of: originalSnapshot.number,
          reason,
          items: originalSnapshot.items.map(item => ({
            ...item,
            description: 'Storno: ' + item.description,
            amount_cents: -Math.abs(Number(item.amount_cents))
          })),
          net_cents: -Math.abs(Number(originalSnapshot.net_cents)),
          tax_cents: -Math.abs(Number(originalSnapshot.tax_cents)),
          gross_cents: -Math.abs(Number(originalSnapshot.gross_cents))
        };
        pdf = renderInvoicePdf(snapshot);
        cancellationId = uuid();
        await rows(
          conn,
          'INSERT INTO invoice_cancellations(id,invoice_id,cancellation_number,reason,status,snapshot_json,pdf_base64) VALUES(?,?,?,?,?,?,?)',
          [
            cancellationId,
            invoiceId,
            snapshot.number,
            reason,
            'archiving',
            JSON.stringify(snapshot),
            pdf.toString('base64')
          ]
        );
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    try {
      const target = await archive(snapshot, pdf);
      const hash = crypto.createHash('sha256').update(pdf).digest('hex');
      const conn2 = await db.getConnection();
      try {
        await conn2.beginTransaction();
        await rows(
          conn2,
          "UPDATE invoice_cancellations SET status='issued',archive_sha256=?,archive_commit=?,archive_path=?,archived_at=UTC_TIMESTAMP(3),error_message=NULL WHERE id=? AND status='archiving'",
          [hash, target.commit, target.path, cancellationId]
        );
        await rows(
          conn2,
          "UPDATE invoices SET status='cancelled',cancelled_at=UTC_TIMESTAMP(3),cancellation_reason=? WHERE id=? AND status IN ('issued','paid')",
          [reason, invoiceId]
        );
        await conn2.commit();
      } catch (e) {
        await conn2.rollback();
        throw e;
      } finally {
        conn2.release();
      }
      return details(invoiceId);
    } catch (e) {
      await rows(db, "UPDATE invoice_cancellations SET error_message=? WHERE id=? AND status='archiving'", [
        message(e).slice(0, 1500),
        cancellationId
      ]);
      throw e;
    }
  }
  async function cancellationPdf(invoiceId) {
    const row = await one(
      db,
      'SELECT cancellation_number,status,pdf_base64 FROM invoice_cancellations WHERE invoice_id=?',
      [invoiceId]
    );
    if (!row || row.status !== 'issued') fail(404, 'Archivierter Stornobeleg fehlt.');
    return { filename: row.cancellation_number + '.pdf', data: Buffer.from(row.pdf_base64, 'base64') };
  }
  async function discard(invoiceId) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const i = await one(conn, 'SELECT id,status FROM invoices WHERE id=? FOR UPDATE', [invoiceId]);
      if (!i || i.status !== 'draft') fail(409, 'Nur Entwürfe können gelöscht werden.');
      await rows(conn, 'DELETE FROM invoice_items WHERE invoice_id=?', [invoiceId]);
      await rows(conn, 'DELETE FROM invoices WHERE id=?', [invoiceId]);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    return { ok: true };
  }
  return {
    settings,
    saveSettings,
    clients,
    createClient,
    editClient,
    projects,
    createProject,
    editProject,
    tasks,
    createTask,
    editTask,
    entries,
    createEntry,
    editEntry,
    deleteEntry,
    startTimer,
    stopTimer,
    invoices,
    createDraft,
    details,
    issue,
    pdf,
    paid,
    cancel,
    cancellationPdf,
    discard
  };
}

export function registerBillingRoutes(app, ctrl, { baseUrl, page, dashboardBody }) {
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/billing/') || !['POST', 'PATCH', 'DELETE'].includes(req.method)) return;
    if (req.headers.origin && req.headers.origin !== new URL(baseUrl()).origin)
      return reply.code(403).send({ error: 'Fremde Herkunft.' });
    if (req.method !== 'DELETE' && !String(req.headers['content-type'] || '').startsWith('application/json'))
      return reply.code(415).send({ error: 'JSON erforderlich.' });
  });
  app.get('/billing', async (_req, reply) =>
    reply.type('text/html').send(page('Kunden & Abrechnung', dashboardBody()))
  );
  app.get('/api/billing/settings', ctrl.settings);
  app.post('/api/billing/settings', req => ctrl.saveSettings(req.body));
  app.get('/api/billing/customers', ctrl.clients);
  app.post('/api/billing/customers', (req, reply) => ctrl.createClient(req.body).then(x => reply.code(201).send(x)));
  app.patch('/api/billing/customers/:id', req => ctrl.editClient(id.parse(req.params.id), req.body));
  app.get('/api/billing/projects', req =>
    ctrl.projects(req.query?.customer_id ? id.parse(req.query.customer_id) : null)
  );
  app.post('/api/billing/projects', (req, reply) => ctrl.createProject(req.body).then(x => reply.code(201).send(x)));
  app.patch('/api/billing/projects/:id', req => ctrl.editProject(id.parse(req.params.id), req.body));
  app.get('/api/billing/tasks', req => ctrl.tasks(req.query?.project_id ? id.parse(req.query.project_id) : null));
  app.post('/api/billing/tasks', (req, reply) => ctrl.createTask(req.body).then(x => reply.code(201).send(x)));
  app.patch('/api/billing/tasks/:id', req => ctrl.editTask(id.parse(req.params.id), req.body));
  app.get('/api/billing/entries', req => ctrl.entries(req.query || {}));
  app.post('/api/billing/entries', (req, reply) => ctrl.createEntry(req.body).then(x => reply.code(201).send(x)));
  app.patch('/api/billing/entries/:id', req => ctrl.editEntry(id.parse(req.params.id), req.body));
  app.delete('/api/billing/entries/:id', req => ctrl.deleteEntry(id.parse(req.params.id)));
  app.post('/api/billing/timer/start', req => ctrl.startTimer(req.body));
  app.post('/api/billing/timer/:id/stop', req => ctrl.stopTimer(id.parse(req.params.id)));
  app.get('/api/billing/invoices', req =>
    ctrl.invoices(req.query?.customer_id ? id.parse(req.query.customer_id) : null)
  );
  app.post('/api/billing/invoices', req => ctrl.createDraft(req.body));
  app.get('/api/billing/invoices/:id', req => ctrl.details(id.parse(req.params.id)));
  app.post('/api/billing/invoices/:id/issue', req => ctrl.issue(id.parse(req.params.id)));
  app.post('/api/billing/invoices/:id/pay', req => ctrl.paid(id.parse(req.params.id)));
  app.post('/api/billing/invoices/:id/cancel', req => ctrl.cancel(id.parse(req.params.id), req.body));
  app.get('/api/billing/invoices/:id/cancellation-pdf', async (req, reply) => {
    const file = await ctrl.cancellationPdf(id.parse(req.params.id));
    return reply
      .type('application/pdf')
      .header('Content-Disposition', 'attachment; filename="' + file.filename + '"')
      .send(file.data);
  });
  app.delete('/api/billing/invoices/:id', req => ctrl.discard(id.parse(req.params.id)));
  app.get('/api/billing/invoices/:id/pdf', async (req, reply) => {
    const file = await ctrl.pdf(id.parse(req.params.id));
    return reply
      .type('application/pdf')
      .header('Content-Disposition', 'attachment; filename="' + file.filename + '"')
      .send(file.data);
  });
}
export { price, dateValue };
