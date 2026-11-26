// monitor_billing_tasks is only the incident/task association. Neither parent
// owns the other. Removing either parent must remove the association, not the
// surviving task or incident. Inspect the live schema to make retries safe.
export default async function ({ db }) {
  for (const [name, column, parent] of [
    ['fk_monitor_billing_incident', 'incident_id', 'incidents'],
    ['fk_monitor_billing_task', 'task_id', 'project_tasks']
  ]) {
    const [rows] = await db.query(
      'SELECT DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_NAME=?',
      ['monitor_billing_tasks', name]
    );
    if (rows[0]?.DELETE_RULE === 'CASCADE') continue;
    const drop = rows.length ? 'DROP FOREIGN KEY ' + name + ', ' : '';
    await db.query('ALTER TABLE monitor_billing_tasks ' + drop + 'ADD CONSTRAINT ' + name +
      ' FOREIGN KEY (' + column + ') REFERENCES ' + parent + '(id) ON DELETE CASCADE');
  }
}
