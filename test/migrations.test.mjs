// Integration test: applies the real migrations/ files against a real MySQL
// database. Skips instead of failing when no test database is configured
// (local dev without MySQL running); CI provides one via a service container.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const hasDb = Boolean(process.env.DATABASE_URL || (process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME));

test('migrate() applies every migration file and is idempotent on re-run', { skip: !hasDb }, async () => {
  process.env.SITEOPS_MASTER_KEY ||= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  process.env.DASHBOARD_USER ||= 'test';
  process.env.DASHBOARD_PASSWORD ||= 'test-password';
  process.env.SITEOPS_TEST_NO_AUTOSTART = '1';
  const { migrate, q, db } = await import('../app.mjs');

  await migrate();
  const files = (
    await import('node:fs/promises').then(fs => fs.readdir(new URL('../migrations/', import.meta.url)))
  ).filter(f => /\.(sql|mjs)$/.test(f));
  const applied = (await q('select id from schema_migrations')).rows.map(r => r.id).sort();
  assert.deepEqual(applied, [...files].sort());

  const sitesColumns = (await q("show columns from sites like 'deployment_mode'")).rows;
  assert.equal(sitesColumns.length, 1);

  // Re-running must be a no-op, not an error (columns/tables already exist).
  await migrate();
  const appliedAgain = (await q('select id from schema_migrations')).rows.map(r => r.id).sort();
  assert.deepEqual(appliedAgain, applied);

  await db.end();
});
