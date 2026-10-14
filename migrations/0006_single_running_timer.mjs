// At most one running timer per SiteOps installation.
// Unique indexes allow any number of NULLs, but only one active_slot=1.
export default async function run({ q, ensureColumn, db }) {
  await ensureColumn(
    'time_entries',
    'active_slot',
    'TINYINT GENERATED ALWAYS AS (CASE WHEN started_at IS NULL THEN NULL ELSE 1 END) STORED'
  );
  const indexes = (await q("SHOW INDEX FROM time_entries WHERE Key_name='idx_time_entries_single_timer'")).rows;
  if (!indexes.length) await db.query('CREATE UNIQUE INDEX idx_time_entries_single_timer ON time_entries(active_slot)');
}
