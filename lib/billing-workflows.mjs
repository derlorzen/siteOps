import crypto from 'node:crypto';
import * as z from 'zod/v4';

const id = z.uuid();
const text = max => z.string().trim().min(1).max(max);
const failure = (code, detail) => {
  const e = new Error(detail);
  e.statusCode = code;
  throw e;
};
const uid = () => crypto.randomUUID();
const rows = async (db, sql, values = []) => (await db.query(sql, values))[0];
const first = async (db, sql, values = []) => (await rows(db, sql, values))[0] || null;
const day = value => value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);
const escapeCsv = value => '"' + String(value ?? '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ') + '"';
const csv = values => values.map(row => row.map(escapeCsv).join(';')).join('\r\n') + '\r\n';
const templates = {
  website: {
    title: 'Neue Website',
    tasks: [
      'Briefing und Ziele abstimmen', 'Seitenstruktur planen', 'Design abstimmen',
      'Inhalte übernehmen', 'Technik und SEO prüfen', 'Abnahme und Go-live'
    ]
  },
  maintenance: {
    title: 'Website-Wartung',
    tasks: [
      'Backup prüfen', 'Updates und Sicherheit kontrollieren',
      'Performance und Erreichbarkeit prüfen', 'Wartungsbericht dokumentieren'
    ]
  }
};
const task = async (db, taskId) => {
  const found = await first(db, 'SELECT t.id,t.project_id,t.name,t.status FROM project_tasks t WHERE t.id=?', [taskId]);
  if (!found) failure(404, 'Task nicht gefunden.');
  return found;
};

export function createBillingWorkflows({ db, billing, sendMail, reminderEmail = () => '' }) {
  async function taskDetail(taskId) {
    const current = await task(db, taskId);
    const [checklist, comments, files] = await Promise.all([
      rows(db, 'SELECT id,text,completed,sort_position FROM billing_task_checklist WHERE task_id=? ORDER BY sort_position,created_at', [taskId]),
      rows(db, 'SELECT id,actor,text,created_at FROM billing_task_comments WHERE task_id=? ORDER BY created_at DESC LIMIT 200', [taskId]),
      rows(db, 'SELECT id,filename,mime_type,size_bytes,sha256,created_at FROM billing_task_files WHERE task_id=? ORDER BY created_at DESC', [taskId])
    ]);
    return { task: current, checklist, comments, files };
  }
  async function addChecklist(taskId, raw) {
    const input = z.object({ text: text(500) }).parse(raw);
    await task(db, taskId);
    const itemId = uid();
    await rows(db, 'INSERT INTO billing_task_checklist(id,task_id,text,sort_position) VALUES(?,?,?,(SELECT COALESCE(MAX(n),0)+1000 FROM (SELECT MAX(sort_position) n FROM billing_task_checklist WHERE task_id=?) x))', [
      itemId, taskId, input.text, taskId
    ]);
    return taskDetail(taskId);
  }
  async function checkItem(taskId, itemId, raw) {
    const input = z.object({ completed: z.boolean() }).parse(raw);
    const changed = await rows(db, 'UPDATE billing_task_checklist SET completed=? WHERE id=? AND task_id=?', [
      input.completed, itemId, taskId
    ]);
    if (!changed.affectedRows) failure(404, 'Checklistenpunkt fehlt.');
    return taskDetail(taskId);
  }
  async function removeItem(taskId, itemId) {
    const deleted = await rows(db, 'DELETE FROM billing_task_checklist WHERE id=? AND task_id=?', [itemId, taskId]);
    if (!deleted.affectedRows) failure(404, 'Checklistenpunkt fehlt.');
    return { ok: true };
  }
  async function comment(taskId, raw) {
    const input = z.object({ text: text(4000) }).parse(raw);
    await task(db, taskId);
    await rows(db, 'INSERT INTO billing_task_comments(id,task_id,actor,text) VALUES(?,?,?,?)', [
      uid(), taskId, 'Benutzer', input.text
    ]);
    return taskDetail(taskId);
  }
  async function upload(taskId, raw) {
    const input = z.object({
      filename: text(255),
      mime_type: z.string().max(120).default('application/octet-stream'),
      data_base64: z.string().max(2800000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
    }).parse(raw);
    await task(db, taskId);
    const data = Buffer.from(input.data_base64, 'base64');
    if (!data.length || data.byteLength > 2 * 1024 * 1024) failure(413, 'Maximal 2 MB pro Datei.');
    const filename = input.filename.replace(/[/\\\x00-\x1f]/g, '_').trim();
    const fileId = uid();
    await rows(db, 'INSERT INTO billing_task_files(id,task_id,filename,mime_type,size_bytes,sha256,content_base64) VALUES(?,?,?,?,?,?,?)', [
      fileId, taskId, filename, input.mime_type, data.length,
      crypto.createHash('sha256').update(data).digest('hex'), data.toString('base64')
    ]);
    return taskDetail(taskId);
  }
  async function download(taskId, fileId) {
    const file = await first(db, 'SELECT filename,mime_type,content_base64 FROM billing_task_files WHERE id=? AND task_id=?', [fileId, taskId]);
    if (!file) failure(404, 'Anhang fehlt.');
    return { filename: file.filename, mime: 'application/octet-stream', data: Buffer.from(file.content_base64, 'base64') };
  }
  async function deleteFile(taskId, fileId) {
    const result = await rows(db, 'DELETE FROM billing_task_files WHERE id=? AND task_id=?', [fileId, taskId]);
    if (!result.affectedRows) failure(404, 'Anhang fehlt.');
    return { ok: true };
  }
  async function dueTasks() {
    return rows(db,
      "SELECT t.id,t.name,t.status,t.due_date,t.priority,p.id project_id,p.name project_name,c.name customer_name " +
      "FROM project_tasks t JOIN customer_projects p ON p.id=t.project_id JOIN customers c ON c.id=p.customer_id " +
      "WHERE t.due_date IS NOT NULL AND t.status<>'done' AND t.due_date<=DATE_ADD(CURDATE(),INTERVAL 7 DAY) " +
      "ORDER BY t.due_date,FIELD(t.priority,'urgent','high','normal','low') LIMIT 150");
  }
  async function applyTemplate(projectId, raw) {
    const { key } = z.object({ key: z.enum(Object.keys(templates)) }).parse(raw);
    if (!await first(db,'SELECT id FROM customer_projects WHERE id=?',[projectId])) failure(404,'Projekt nicht gefunden.');
    const created = [];
    for (const name of templates[key].tasks)
      created.push(await billing.createTask({ project_id: projectId, name }));
    return { created: created.map(item => ({ id: item.id, name: item.name })) };
  }
  async function listRules(projectId) {
    if (!projectId) failure(400, 'Projekt erforderlich.');
    return rows(db, 'SELECT id,project_id,task_name,description,every_days,next_run_at,enabled,last_run_at FROM billing_recurring_rules WHERE project_id=? ORDER BY created_at DESC', [projectId]);
  }
  async function addRule(projectId, raw) {
    const input = z.object({
      task_name: text(255),
      description: z.string().max(3000).default(''),
      every_days: z.number().int().min(1).max(365),
      priority: z.enum(['low','normal','high','urgent']).default('normal')
    }).parse(raw);
    if (!await first(db,'SELECT id FROM customer_projects WHERE id=?',[projectId])) failure(404,'Projekt nicht gefunden.');
    await rows(db, 'INSERT INTO billing_recurring_rules(id,project_id,task_name,description,priority,every_days,next_run_at) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP())', [
      uid(),projectId,input.task_name,input.description,input.priority,input.every_days
    ]);
    return listRules(projectId);
  }
  async function setRule(ruleId, raw) {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(raw);
    const result = await rows(db, 'UPDATE billing_recurring_rules SET enabled=? WHERE id=?',[enabled,ruleId]);
    if (!result.affectedRows) failure(404,'Wiederholung nicht gefunden.');
    return { ok: true };
  }
  async function runRecurring(limit = 20) {
    const due = await rows(db,'SELECT id FROM billing_recurring_rules WHERE enabled=1 AND next_run_at<=UTC_TIMESTAMP() ORDER BY next_run_at LIMIT ?', [Math.max(1,Math.min(20,limit))]);
    let created = 0;
    for (const row of due) {
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        const rule = await first(conn,'SELECT * FROM billing_recurring_rules WHERE id=? FOR UPDATE',[row.id]);
        if (rule && rule.enabled && new Date(rule.next_run_at).getTime() <= Date.now()) {
          const project = await first(conn,'SELECT id FROM customer_projects WHERE id=? FOR UPDATE',[rule.project_id]);
          if (!project) failure(404,'Projekt fehlt.');
          const rank = await first(conn,'SELECT COALESCE(MAX(sort_position),0)+1000 rank FROM project_tasks WHERE project_id=? AND status=?',[rule.project_id,'open']);
          await rows(conn,'INSERT INTO project_tasks(id,project_id,name,status,description,priority,sort_position) VALUES(?,?,?, ?,?,?,?)',[
            uid(),rule.project_id,rule.task_name,'open',rule.description,rule.priority,Number(rank.rank)
          ]);
          await rows(conn,'UPDATE customer_projects SET board_revision=board_revision+1 WHERE id=?',[rule.project_id]);
          await rows(conn,'UPDATE billing_recurring_rules SET next_run_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? DAY),last_run_at=UTC_TIMESTAMP() WHERE id=?',[rule.every_days,rule.id]);
          created++;
        }
        await conn.commit();
      } catch(e) {
        await conn.rollback();
        console.error('billing recurring task',row.id,e);
      } finally {
        conn.release();
      }
    }
    return { created };
  }
  async function incidentOpened(incidentId, siteId, domain, result) {
    const projects = await rows(db,'SELECT id FROM customer_projects WHERE site_id=? ORDER BY created_at,id LIMIT 1',[siteId]);
    if (!projects.length) return { linked: false };
    const projectId=projects[0].id;
    const conn=await db.getConnection();
    try {
      await conn.beginTransaction();
      const existing=await first(conn,'SELECT task_id FROM monitor_billing_tasks WHERE incident_id=? FOR UPDATE',[incidentId]);
      if (existing) { await conn.commit(); return { linked: true, task_id: existing.task_id }; }
      await rows(conn,'SELECT id FROM customer_projects WHERE id=? FOR UPDATE',[projectId]);
      const rank=await first(conn,'SELECT COALESCE(MAX(sort_position),0)+1000 rank FROM project_tasks WHERE project_id=? AND status=?',[projectId,'open']);
      const taskId=uid();
      await rows(conn,'INSERT INTO project_tasks(id,project_id,name,status,description,priority,sort_position) VALUES(?,?,?,?,?,?,?)',[
        taskId,projectId,'Monitoring: '+String(domain).slice(0,230),'open',
        'Automatisch angelegt beim SiteOps-Monitoring-Vorfall. Technische Details: '+JSON.stringify(result).slice(0,2600),
        'urgent',Number(rank.rank)
      ]);
      await rows(conn,'INSERT INTO monitor_billing_tasks(incident_id,task_id) VALUES(?,?)',[incidentId,taskId]);
      await rows(conn,'UPDATE customer_projects SET board_revision=board_revision+1 WHERE id=?',[projectId]);
      await conn.commit();
      return { linked:true,task_id:taskId };
    } catch(e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  }
  async function incidentRecovered(incidentId) {
    const row=await first(db,'SELECT mb.task_id,t.project_id,t.status FROM monitor_billing_tasks mb JOIN project_tasks t ON t.id=mb.task_id WHERE mb.incident_id=?',[incidentId]);
    if (!row) return { linked:false };
    await rows(db,'INSERT INTO billing_task_comments(id,task_id,actor,text) VALUES(?,?,?,?)',[uid(),row.task_id,'SiteOps Monitoring','Website wieder erreichbar. Bitte Ursache und Arbeitszeit dokumentieren und Task prüfen.']);
    if (row.status !== 'done') {
      await rows(db,"UPDATE project_tasks SET status='review' WHERE id=?",[row.task_id]);
      await rows(db,'UPDATE customer_projects SET board_revision=board_revision+1 WHERE id=?',[row.project_id]);
    }
    return { linked:true,task_id:row.task_id };
  }
  async function mailHistory(invoiceId) {
    return rows(db, 'SELECT id,kind,recipient,status,sent_at,error_text,created_at FROM billing_invoice_mails WHERE invoice_id=? ORDER BY created_at DESC',[invoiceId]);
  }
  async function deliver(invoiceId, raw) {
    const { kind }=z.object({kind:z.enum(['invoice','reminder'])}).parse(raw);
    const conn=await db.getConnection();
    let invoice, recipient, logId;
    try {
      await conn.beginTransaction();
      invoice=await first(conn,'SELECT * FROM invoices WHERE id=? FOR UPDATE',[invoiceId]);
      if (!invoice || !['issued','paid'].includes(invoice.status)) failure(409,'Nur archivierte Rechnungen können versandt werden.');
      if (kind==='reminder' && (invoice.status!=='issued' || day(invoice.due_at)>=day(new Date())))
        failure(409,'Zahlungserinnerung nur für überfällige, unbezahlte Rechnungen.');
      const customer=await first(conn,'SELECT email,name FROM customers WHERE id=?',[invoice.customer_id]);
      recipient=customer?.email;
      if (!recipient || !z.email().safeParse(recipient).success) failure(400,'Gültige Kunden-E-Mail fehlt.');
      const past=await rows(conn,'SELECT kind,status,created_at FROM billing_invoice_mails WHERE invoice_id=? AND kind=? ORDER BY created_at DESC LIMIT 1 FOR UPDATE',[invoiceId,kind]);
      if (past.some(x=>x.status==='sending')) failure(409,'Der Versand läuft bereits.');
      if (kind==='invoice' && past.some(x=>x.status==='sent')) failure(409,'Rechnung wurde bereits versandt.');
      if (kind==='reminder' && past.some(x=> x.status==='sent' && new Date(x.created_at).getTime() > Date.now()-7*86400000))
        failure(409,'Es wurde bereits in den letzten 7 Tagen erinnert.');
      logId=uid();
      await rows(conn,'INSERT INTO billing_invoice_mails(id,invoice_id,kind,recipient) VALUES(?,?,?,?)',[logId,invoiceId,kind,recipient]);
      await conn.commit();
    } catch(e) { await conn.rollback(); throw e; }
    finally {conn.release();}
    const amount=(Number(invoice.gross_cents)/100).toLocaleString('de-DE',{style:'currency',currency:'EUR'});
    const subject=kind==='invoice' ? 'Rechnung '+invoice.invoice_number : 'Zahlungserinnerung '+invoice.invoice_number;
    const textBody=kind==='invoice'
      ? 'Guten Tag,\n\nanbei erhalten Sie Ihre Rechnung '+invoice.invoice_number+' über '+amount+'.\nZahlungsziel: '+day(invoice.due_at)+'.\n\nMit freundlichen Grüßen'
      : 'Guten Tag,\n\nwir konnten noch keinen Zahlungseingang für Rechnung '+invoice.invoice_number+' über '+amount+' (fällig am '+day(invoice.due_at)+') feststellen.\nBitte prüfen Sie den Vorgang. Sollte die Zahlung bereits erfolgt sein, betrachten Sie diese Erinnerung als gegenstandslos.\n\nMit freundlichen Grüßen';
    try {
      const result=await sendMail({
        to:recipient,subject,text:textBody,
        attachments: kind==='invoice'?[{filename:invoice.invoice_number+'.pdf',content:Buffer.from(invoice.pdf_base64,'base64'),contentType:'application/pdf'}]:[]
      });
      await rows(db,"UPDATE billing_invoice_mails SET status='sent',sent_at=UTC_TIMESTAMP(),message_id=? WHERE id=?",[String(result?.messageId||'').slice(0,255),logId]);
    } catch(e) {
      await rows(db,"UPDATE billing_invoice_mails SET status='failed',error_text=? WHERE id=?",[String(e.message||e).slice(0,1500),logId]);
      throw e;
    }
    return {ok:true,recipient,kind};
  }
  async function datevCsv(year) {
    const y=z.number().int().min(2000).max(2100).parse(year);
    const invoices=await rows(db,
      "SELECT i.invoice_number,i.issued_at,i.gross_cents,i.net_cents,i.tax_cents,c.name customer_name FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE YEAR(i.issued_at)=? AND i.status IN ('issued','paid','cancelled') ORDER BY i.issued_at,i.invoice_number",[y]);
    const cancellations=await rows(db,
      "SELECT ic.cancellation_number invoice_number,ic.created_at issued_at,i.gross_cents,i.net_cents,i.tax_cents,c.name customer_name FROM invoice_cancellations ic JOIN invoices i ON i.id=ic.invoice_id JOIN customers c ON c.id=i.customer_id WHERE YEAR(ic.created_at)=? AND ic.status='issued'",[y]);
    const records=[...invoices.map(x=>({...x,reverse:false})),...cancellations.map(x=>({...x,reverse:true}))];
    const header=['Umsatz (ohne Soll/Haben-Kz)','Soll/Haben-Kennzeichen','WKZ Umsatz','Konto','Gegenkonto (ohne BU-Schlüssel)','BU-Schlüssel','Belegdatum','Belegfeld 1','Buchungstext'];
    return '\uFEFF'+csv([header,...records.map(x=>[
      (Math.abs(Number(x.gross_cents))/100).toFixed(2).replace('.',','),
      x.reverse?'H':'S','EUR','1200','8400','',day(x.issued_at).slice(8,10)+day(x.issued_at).slice(5,7),
      x.invoice_number,(x.reverse?'Storno ':'Rechnung ')+x.customer_name
    ])]);
  }
  async function notifyDue() {
    const to = reminderEmail();
    if (!to || !z.email().safeParse(to).success) return { sent: false, reason: 'no_recipient' };
    const due = await rows(db,
      "SELECT t.name,t.due_date,p.name project_name,c.name customer_name FROM project_tasks t JOIN customer_projects p ON p.id=t.project_id JOIN customers c ON c.id=p.customer_id WHERE t.due_date<=DATE_ADD(CURDATE(),INTERVAL 1 DAY) AND t.status<>'done' ORDER BY t.due_date LIMIT 100");
    if (!due.length) return { sent: false, reason: 'none_due' };
    const today = new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Berlin'});
    const result = await rows(db,"INSERT IGNORE INTO billing_due_notifications(reminder_day,status) VALUES(?,'sending')",[today]);
    if (!result.affectedRows) {
      const retry = await rows(db,"UPDATE billing_due_notifications SET status='sending',error_text=NULL WHERE reminder_day=? AND status='failed'",[today]);
      if (!retry.affectedRows) return { sent: false, reason: 'already_processed' };
    }
    const content = due.map(t => day(t.due_date) + ' · ' + t.customer_name + ' / ' + t.project_name + ': ' + t.name).join('\n');
    try {
      await sendMail({
        to,
        subject: '[SiteOps] Fällige und überfällige Kunden-Tasks',
        text: 'Die folgenden Projektaufgaben sind fällig oder innerhalb eines Tages fällig:\n\n' + content + '\n\nDetails: SiteOps /billing'
      });
      await rows(db,"UPDATE billing_due_notifications SET status='sent',sent_at=UTC_TIMESTAMP() WHERE reminder_day=?",[today]);
      return { sent: true, count: due.length };
    } catch(e) {
      await rows(db,"UPDATE billing_due_notifications SET status='failed',error_text=? WHERE reminder_day=?",[String(e.message || e).slice(0,1500),today]);
      throw e;
    }
  }
  async function archiveManifest(year) {
    const y=z.number().int().min(2000).max(2100).parse(year);
    const originals=await rows(db,
      "SELECT invoice_number,status,archive_path,archive_sha256,archive_commit,issued_at FROM invoices WHERE YEAR(issued_at)=? AND status IN ('issued','paid','cancelled') ORDER BY invoice_number",[y]);
    const cancellations=await rows(db,
      "SELECT cancellation_number invoice_number,status,archive_path,archive_sha256,archive_commit,created_at issued_at FROM invoice_cancellations WHERE YEAR(created_at)=? AND status='issued' ORDER BY cancellation_number",[y]);
    return {year:y,created_at:new Date().toISOString(),note:'Exportmanifest zur Übergabe an ein separat betriebenes, unveränderliches Archiv (WORM). GitHub allein ist nicht revisionssicher.',records:[...originals,...cancellations]};
  }
  return {taskDetail,addChecklist,checkItem,removeItem,comment,upload,download,deleteFile,dueTasks,applyTemplate,
    templates:()=>Object.fromEntries(Object.entries(templates).map(([key,value])=>[key,{title:value.title,tasks:value.tasks}])),
    listRules,addRule,setRule,runRecurring,incidentOpened,incidentRecovered,deliver,mailHistory,datevCsv,archiveManifest,notifyDue};
}

export function registerBillingWorkflowRoutes(app, ctrl) {
  app.get('/api/billing/due', () => ctrl.dueTasks());
  app.get('/api/billing/templates', () => ctrl.templates());
  app.post('/api/billing/projects/:projectId/template', req=>ctrl.applyTemplate(id.parse(req.params.projectId),req.body));
  app.get('/api/billing/tasks/:id/detail',req=>ctrl.taskDetail(id.parse(req.params.id)));
  app.post('/api/billing/tasks/:id/checklist',req=>ctrl.addChecklist(id.parse(req.params.id),req.body));
  app.patch('/api/billing/tasks/:id/checklist/:itemId',req=>ctrl.checkItem(id.parse(req.params.id),id.parse(req.params.itemId),req.body));
  app.delete('/api/billing/tasks/:id/checklist/:itemId',req=>ctrl.removeItem(id.parse(req.params.id),id.parse(req.params.itemId)));
  app.post('/api/billing/tasks/:id/comments',req=>ctrl.comment(id.parse(req.params.id),req.body));
  app.post('/api/billing/tasks/:id/files',{ bodyLimit: 3000000 },req=>ctrl.upload(id.parse(req.params.id),req.body));
  app.get('/api/billing/tasks/:id/files/:fileId',async (req,reply)=>{
    const file=await ctrl.download(id.parse(req.params.id),id.parse(req.params.fileId));
    return reply.type(file.mime)
      .header('X-Content-Type-Options','nosniff')
      .header('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(file.filename)).send(file.data);
  });
  app.delete('/api/billing/tasks/:id/files/:fileId',req=>ctrl.deleteFile(id.parse(req.params.id),id.parse(req.params.fileId)));
  app.get('/api/billing/projects/:projectId/recurring',req=>ctrl.listRules(id.parse(req.params.projectId)));
  app.post('/api/billing/projects/:projectId/recurring',req=>ctrl.addRule(id.parse(req.params.projectId),req.body));
  app.patch('/api/billing/recurring/:id',req=>ctrl.setRule(id.parse(req.params.id),req.body));
  app.post('/api/billing/recurring/run',()=>ctrl.runRecurring());
  app.get('/api/billing/invoices/:id/mail-history',req=>ctrl.mailHistory(id.parse(req.params.id)));
  app.post('/api/billing/invoices/:id/send',req=>ctrl.deliver(id.parse(req.params.id),req.body));
  app.get('/api/billing/datev/:year.csv',async (req,reply)=>reply
    .type('text/csv; charset=utf-8')
    .header('Content-Disposition','attachment; filename="datev-vorbereitung-'+Number(req.params.year)+'.csv"')
    .send(await ctrl.datevCsv(Number(req.params.year))));
  app.get('/api/billing/archive-manifest/:year',async (req,reply)=>reply
    .header('Content-Disposition','attachment; filename="rechnungsarchiv-'+Number(req.params.year)+'.json"')
    .send(await ctrl.archiveManifest(Number(req.params.year))));
}
