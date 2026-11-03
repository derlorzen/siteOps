// change_apply runs as a durable background job on the preview row (see
// lib/change-apply-jobs.mjs): heartbeat, stage, stored pre-change snapshot and last error
// let an interrupted apply be resumed instead of being left half done.
export default async function run({ ensureColumn }) {
  await ensureColumn('change_previews', 'apply_started_at', 'DATETIME NULL');
  await ensureColumn('change_previews', 'apply_heartbeat_at', 'DATETIME NULL');
  await ensureColumn('change_previews', 'apply_stage', 'VARCHAR(40) NULL');
  await ensureColumn('change_previews', 'apply_attempts', 'INT NOT NULL DEFAULT 0');
  await ensureColumn('change_previews', 'apply_pre_commit', 'VARCHAR(64) NULL');
  await ensureColumn('change_previews', 'apply_error', 'TEXT NULL');
  await ensureColumn('change_previews', 'change_id', 'CHAR(36) NULL');
}
