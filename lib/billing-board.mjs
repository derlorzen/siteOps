import * as z from 'zod/v4';
import { randomUUID } from 'node:crypto';

export const KANBAN_STATUSES = ['backlog', 'open', 'in_progress', 'review', 'done'];
export const KANBAN_LABELS = {
  backlog: 'Ideen',
  open: 'Offen',
  in_progress: 'In Arbeit',
  review: 'Abnahme',
  done: 'Erledigt'
};
const uuid = z.uuid();
const schema = z.object({
  revision: z.number().int().min(0),
  columns: z.strictObject(Object.fromEntries(KANBAN_STATUSES.map(status => [status, z.array(uuid).max(1500)])))
});
const error = (code, text) => {
  const e = new Error(text);
  e.statusCode = code;
  throw e;
};
export function validateKanbanOrder(ids, columns) {
  const expected = new Set(ids);
  const ordered = KANBAN_STATUSES.flatMap(status => columns[status] || []);
  if (expected.size !== ids.length || ordered.length !== expected.size) return false;
  const unique = new Set(ordered);
  return unique.size === expected.size && ordered.every(taskId => expected.has(taskId));
}
async function rows(db, sql, params = []) {
  return (await db.query(sql, params))[0];
}
export function createBillingBoard({ db }) {
  async function getBoard(projectId) {
    const project = (
      await rows(
        db,
        'SELECT p.id,p.name,p.customer_id,p.board_revision,c.name customer_name FROM customer_projects p JOIN customers c ON c.id=p.customer_id WHERE p.id=?',
        [projectId]
      )
    )[0];
    if (!project) error(404, 'Projekt nicht gefunden.');
    const tasks = await rows(
      db,
      'SELECT t.*,COALESCE(te.seconds,0) tracked_seconds,COALESCE(te.entries,0) time_entry_count FROM project_tasks t ' +
        'LEFT JOIN (SELECT task_id,SUM(duration_seconds) seconds,COUNT(*) entries FROM time_entries GROUP BY task_id) te ON te.task_id=t.id ' +
        'WHERE t.project_id=? ORDER BY t.sort_position,t.created_at,t.id',
      [projectId]
    );
    return {
      project: {
        id: project.id,
        name: project.name,
        customer_id: project.customer_id,
        customer_name: project.customer_name
      },
      revision: Number(project.board_revision),
      columns: Object.fromEntries(KANBAN_STATUSES.map(status => [status, tasks.filter(task => task.status === status)]))
    };
  }
  async function saveBoard(projectId, raw) {
    const { columns, revision } = schema.parse(raw);
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      // Serializes reorders and guards against concurrent browser tabs.
      const [projects] = await conn.query('SELECT id,board_revision FROM customer_projects WHERE id=? FOR UPDATE', [
        projectId
      ]);
      if (!projects.length) error(404, 'Projekt nicht gefunden.');
      if (Number(projects[0].board_revision) !== revision)
        error(409, 'Das Board wurde zwischenzeitlich geändert. Bitte neu laden.');
      const [tasks] = await conn.query('SELECT id,status,sort_position FROM project_tasks WHERE project_id=? FOR UPDATE', [projectId]);
      if (
        !validateKanbanOrder(
          tasks.map(task => task.id),
          columns
        )
      )
        error(409, 'Die Verschiebung enthält ungültige oder projektfremde Tasks. Bitte Board neu laden.');
      for (const status of KANBAN_STATUSES) {
        for (const [index, taskId] of columns[status].entries()) {
          const position = (index + 1) * 1000;
          const previous = tasks.find(t => t.id === taskId);
          if (previous.status !== status || Number(previous.sort_position) !== position)
            await conn.query('INSERT INTO billing_task_events(id,task_id,event_type,details) VALUES(?,?,?,?)', [
              randomUUID(), taskId, 'kanban_moved', previous.status + ' → ' + status + ' (Position ' + position + ')'
            ]);
          await conn.query('UPDATE project_tasks SET status=?,sort_position=? WHERE id=? AND project_id=?', [
            status,
            position,
            taskId,
            projectId
          ]);
        }
      }
      await conn.query('UPDATE customer_projects SET board_revision=board_revision+1 WHERE id=?', [projectId]);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    return getBoard(projectId);
  }
  return { getBoard, saveBoard };
}
