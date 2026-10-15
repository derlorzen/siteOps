import * as z from 'zod/v4';

const uuid = z.uuid();
const missing = message => { const e = new Error(message); e.statusCode = 404; throw e; };
const first = async (db, sql, params) => (await db.query(sql,params))[0][0] || null;
const rows = async (db, sql, params=[]) => (await db.query(sql,params))[0];

export function createProjectOverview(db) {
  async function get(projectId) {
    const id = uuid.parse(projectId);
    const project = await first(db,
      'SELECT p.id,p.name,p.description,p.status,p.customer_id,p.hourly_cents,c.name customer_name,c.email customer_email,c.contact_name,c.default_hourly_cents ' +
      'FROM customer_projects p JOIN customers c ON c.id=p.customer_id WHERE p.id=?', [id]);
    if (!project) missing('Projekt nicht gefunden.');
    const [sites,taskCounts,timeSummary,incidents,invoices] = await Promise.all([
      rows(db,
        'SELECT s.id,s.name,s.domain,s.slug,s.monitor_enabled,s.backup_enabled,' +
        'mc.ok last_check_ok,mc.http_status last_http_status,mc.response_ms last_response_ms,mc.created_at last_checked_at,' +
        'b.created_at last_backup_at, b.git_commit last_backup_commit ' +
        'FROM project_sites ps JOIN sites s ON s.id=ps.site_id ' +
        'LEFT JOIN monitor_checks mc ON mc.id=(SELECT MAX(m2.id) FROM monitor_checks m2 WHERE m2.site_id=s.id) ' +
        'LEFT JOIN backups b ON b.id=(SELECT b2.id FROM backups b2 WHERE b2.site_id=s.id ORDER BY b2.created_at DESC LIMIT 1) ' +
        'WHERE ps.project_id=? ORDER BY s.name', [id]),
      first(db,
        "SELECT COUNT(*) total,SUM(t.status='done') done,SUM(t.status='in_progress') doing," +
        "SUM(t.status<>'done' AND t.due_date<CURDATE()) overdue " +
        'FROM project_tasks t WHERE t.project_id=?', [id]),
      first(db,
        'SELECT COALESCE(SUM(e.duration_seconds),0) total_seconds,' +
        'COALESCE(SUM(IF(e.billable=1 AND ii.entry_id IS NULL AND e.started_at IS NULL,e.duration_seconds,0)),0) unbilled_seconds,' +
        'COALESCE(SUM(IF(e.billable=1 AND ii.entry_id IS NULL AND e.started_at IS NULL,' +
        'ROUND(e.duration_seconds*e.hourly_cents/3600),0)),0) unbilled_cents ' +
        'FROM time_entries e JOIN project_tasks t ON t.id=e.task_id ' +
        'LEFT JOIN invoice_items ii ON ii.entry_id=e.id WHERE t.project_id=?',[id]),
      rows(db,
        "SELECT i.id,i.title,i.status,i.created_at,s.slug,s.name site_name " +
        'FROM incidents i JOIN sites s ON s.id=i.site_id JOIN project_sites ps ON ps.site_id=s.id ' +
        "WHERE ps.project_id=? AND i.status='open' ORDER BY i.created_at DESC LIMIT 15",[id]),
      rows(db,
        'SELECT i.id,i.invoice_number,i.status,i.issued_at,i.created_at,i.gross_cents,' +
        'SUM(ii.amount_cents) project_net_cents FROM invoice_items ii ' +
        'JOIN time_entries e ON e.id=ii.entry_id JOIN project_tasks t ON t.id=e.task_id ' +
        'JOIN invoices i ON i.id=ii.invoice_id WHERE t.project_id=? ' +
        'GROUP BY i.id,i.invoice_number,i.status,i.issued_at,i.created_at,i.gross_cents ' +
        'ORDER BY i.created_at DESC LIMIT 12',[id])
    ]);
    return {
      project, sites, task_counts: taskCounts || { total: 0,done: 0,doing: 0,overdue: 0 },
      time: timeSummary || {total_seconds:0,unbilled_seconds:0,unbilled_cents:0},
      incidents, invoices
    };
  }
  return { get };
}

export function registerProjectOverviewRoutes(app, overview) {
  app.get('/api/workspace/projects/:id/overview', req => overview.get(uuid.parse(req.params.id)));
}
