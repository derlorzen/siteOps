export default async function run({ ensureColumn }) {
  await ensureColumn('billing_due_notifications', 'attempt_count', 'INT UNSIGNED NOT NULL DEFAULT 1');
  await ensureColumn('billing_due_notifications', 'last_attempt_at', 'DATETIME NULL');
}
