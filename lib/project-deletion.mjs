import crypto from 'node:crypto';
import * as z from 'zod/v4';

export const projectDeletionPreviewSchema = z.object({ project_id: z.uuid() });
export const projectDeletionConfirmSchema = z.object({
  token: z.uuid(),
  confirmation: z.string().trim().min(1)
});
const fail = (statusCode, message) => {
  throw Object.assign(new Error(message), { statusCode });
};
const rows = async (db, sql, args) => (await db.query(sql, args))[0];

// SiteOps project deletion is intentionally local. Sites must be removed or
// unlinked first. Financial records (including zero-duration time entries) are
// never silently removed; an archived/closed project is the safe alternative.
export function createProjectDeletion({ db, now = Date.now }) {
  const pending = new Map();
  async function snapshot(conn, id, lock = false) {
    const suffix = lock ? ' FOR UPDATE' : '';
    const [project] = await rows(
      conn,
      'SELECT id,name,customer_id,site_id,board_revision FROM customer_projects WHERE id=?' + suffix,
      [id]
    );
    if (!project) fail(404, 'Projekt nicht gefunden.');
    const tasks = await rows(
      conn,
      'SELECT id,name,status FROM project_tasks WHERE project_id=? ORDER BY id' + suffix,
      [id]
    );
    const sites = await rows(
      conn,
      'SELECT site_id FROM project_sites WHERE project_id=? ORDER BY site_id' + suffix,
      [id]
    );
    const time = await rows(
      conn,
      'SELECT e.id FROM time_entries e JOIN project_tasks t ON t.id=e.task_id WHERE t.project_id=? ORDER BY e.id' + suffix,
      [id]
    );
    const rules = await rows(
      conn,
      'SELECT id FROM billing_recurring_rules WHERE project_id=? ORDER BY id' + suffix,
      [id]
    );
    const siteIds = [...new Set([project.site_id, ...sites.map(s => s.site_id)].filter(Boolean))].sort();
    return { project, tasks, siteIds, time, rules };
  }
  const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const blockers = s => [
    ...(s.siteIds.length ? ['Verknüpfte Websites zuerst lösen oder separat löschen.'] : []),
    ...(s.time.length
      ? ['Zeiteinträge vorhanden. Projekt abschließen oder Zeiteinträge separat prüfen; Rechnungen bleiben geschützt.']
      : [])
  ];
  return {
    async preview(raw) {
      const { project_id } = projectDeletionPreviewSchema.parse(raw);
      const s = await snapshot(db, project_id);
      const blocked = blockers(s);
      for (const [key, plan] of pending) if (plan.expires <= now()) pending.delete(key);
      if (pending.size >= 1000) fail(409, 'Zu viele offene Löschvorschauen.');
      const token = blocked.length ? null : crypto.randomUUID();
      if (token)
        pending.set(token, { id: project_id, name: s.project.name, digest: digest(s), expires: now() + 600000 });
      return {
        token,
        project_id,
        name: s.project.name,
        confirmation: s.project.name,
        tasks: s.tasks.length,
        recurring_rules: s.rules.length,
        websites: s.siteIds.length,
        time_entries: s.time.length,
        blockers: blocked,
        expiresInSeconds: 600,
        warning:
          'Projekt, Aufgaben, Kommentare, Anhänge und wiederkehrende Regeln werden endgültig entfernt. Kunde, Rechnungen, Websites und externe Dienste werden nicht gelöscht.'
      };
    },
    async confirm(raw) {
      const { token, confirmation } = projectDeletionConfirmSchema.parse(raw);
      const plan = pending.get(token);
      if (!plan || plan.expires <= now()) fail(409, 'Löschvorschau abgelaufen oder bereits verwendet.');
      if (confirmation !== plan.name && confirmation !== plan.id) fail(400, 'Projektname zur Bestätigung eingeben.');
      pending.delete(token);
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        const s = await snapshot(conn, plan.id, true);
        if (digest(s) !== plan.digest || blockers(s).length)
          fail(409, 'Projekt wurde geändert. Neue Vorschau erforderlich.');
        if (confirmation !== s.project.name && confirmation !== s.project.id)
          fail(400, 'Projektname zur Bestätigung eingeben.');
        // Unlink only local deployment references; never delete provider resources.
        await conn.query(
          'UPDATE coolify_deployments SET siteops_project_id=NULL WHERE siteops_project_id=?',
          [plan.id]
        );
        await conn.query(
          'UPDATE coolify_supabase_instances SET siteops_project_id=NULL WHERE siteops_project_id=?',
          [plan.id]
        );
        // Association rows must disappear before project_tasks; their incident parents survive.
        await conn.query(
          'DELETE mb FROM monitor_billing_tasks mb JOIN project_tasks t ON t.id=mb.task_id WHERE t.project_id=?',
          [plan.id]
        );
        await conn.query('DELETE FROM project_tasks WHERE project_id=?', [plan.id]);
        await conn.query('DELETE FROM customer_projects WHERE id=?', [plan.id]);
        await conn.commit();
        return {
          ok: true,
          project_id: plan.id,
          deleted_tasks: s.tasks.length,
          deleted_recurring_rules: s.rules.length
        };
      } catch (error) {
        await conn.rollback();
        throw error;
      } finally {
        conn.release();
      }
    }
  };
}
