// Kanban is an additional view on the existing client -> project -> task hierarchy.
// This migration retains all existing tasks, tracked time, and invoice associations.
export default async function run({ ensureColumn, q }) {
  await ensureColumn('customer_projects', 'board_revision', 'BIGINT UNSIGNED NOT NULL DEFAULT 0');
  await ensureColumn('project_tasks', 'sort_position', 'INT NOT NULL DEFAULT 0');
  await ensureColumn('project_tasks', 'description', 'TEXT NULL');
  await ensureColumn('project_tasks', 'due_date', 'DATE NULL');
  await ensureColumn('project_tasks', 'priority', "VARCHAR(16) NOT NULL DEFAULT 'normal'");
  // Existing "open"/"done" statuses remain valid Kanban columns.
  // No destructive backfill: older positions of 0 are sorted by created_at/id.
}
