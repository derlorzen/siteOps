// Integration test: applies the real migrations/ files against a real MySQL
// database. Skips instead of failing when no test database is configured
// (local dev without MySQL running); CI provides one via a service container.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const hasDb = Boolean(process.env.DATABASE_URL || (process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME));

test('migrate() applies every migration file and is idempotent on re-run', { skip: !hasDb }, async t => {
  process.env.SITEOPS_MASTER_KEY ||= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  process.env.DASHBOARD_USER ||= 'test';
  process.env.DASHBOARD_PASSWORD ||= 'test-password';
  process.env.SITEOPS_TEST_NO_AUTOSTART = '1';
  const { migrate, q, db } = await import('../app.mjs');
  t.after(() => db.end());

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

  // Regression: load and move tasks using real MySQL, not only mocked queries.
  const { randomUUID } = await import('node:crypto');
  const { createBillingBoard } = await import('../lib/billing-board.mjs');
  const customerId = randomUUID();
  const projectId = randomUUID();
  const taskId = randomUUID();
  try {
    await db.query('INSERT INTO customers(id,name) VALUES(?,?)', [customerId, 'Board Regression Kunde']);
    await db.query('INSERT INTO customer_projects(id,customer_id,name) VALUES(?,?,?)', [
      projectId,
      customerId,
      'Regressionsprojekt'
    ]);
    await db.query('INSERT INTO project_tasks(id,project_id,name,status) VALUES(?,?,?,?)', [
      taskId,
      projectId,
      'Testtask',
      'open'
    ]);
    const board = createBillingBoard({ db });
    const before = await board.getBoard(projectId);
    assert.equal(before.project.customer_id, customerId);
    assert.equal(before.columns.open.length, 1);
    assert.equal(before.columns.open[0].id, taskId);
    const columns = Object.fromEntries(['backlog', 'open', 'in_progress', 'review', 'done'].map(key => [key, []]));
    columns.in_progress.push(taskId);
    const after = await board.saveBoard(projectId, { revision: before.revision, columns });
    assert.equal(after.revision, before.revision + 1);
    assert.equal(after.columns.open.length, 0);
    assert.equal(after.columns.in_progress[0].id, taskId);
    const [events] = await db.query('SELECT event_type FROM billing_task_events WHERE task_id=?', [taskId]);
    assert.ok(events.some(event => event.event_type === 'kanban_moved'));
    await assert.rejects(
      board.saveBoard(projectId, { revision: before.revision, columns }),
      error => error.statusCode === 409
    );
    // Execute the new search, project 360 and activity queries against real MySQL.
    // Unit tests with mocks cannot catch incorrect table/column names.
    const { createWorkspaceSearch } = await import('../lib/workspace-search.mjs');
    const { createProjectOverview } = await import('../lib/project-overview.mjs');
    const { createWorkspaceActivity } = await import('../lib/workspace-activity.mjs');
    const search = await createWorkspaceSearch({ db }).search('Regressionsprojekt');
    assert.ok(search.results.some(result => result.type === 'project' && result.id === projectId));
    const overview = await createProjectOverview(db).get(projectId);
    assert.equal(overview.project.id, projectId);
    assert.equal(Number(overview.task_counts.total), 1);
    assert.deepEqual(overview.sites, []);
    const activity = await createWorkspaceActivity(db).list({ projectId, limit: 20 });
    assert.ok(activity.entries.some(entry => entry.kind === 'task'));

    // A stored server profile can be created, listed, resolved and removed
    // without exposing credentials in the public response.
    const { createConnectionProfiles } = await import('../lib/connection-profiles.mjs');
    const profiles = createConnectionProfiles({
      db,
      encrypt: input => JSON.stringify(input),
      decrypt: JSON.parse
    });
    const profile = await profiles.create({
      name: 'CI Server ' + projectId,
      protocol: 'sftp',
      host: 'ci.example.invalid',
      port: 22,
      username: 'test',
      password: 'test-only-secret'
    });
    try {
      const listed = await profiles.list();
      assert.ok(listed.some(item => item.id === profile.id));
      assert.equal(listed.find(item => item.id === profile.id).password, undefined);
      const resolved = await profiles.resolve(profile.id, '/test-website');
      assert.equal(resolved.password, 'test-only-secret');
      assert.equal(resolved.remoteRoot, '/test-website');
    } finally {
      await profiles.remove(profile.id);
    }
  } finally {
    await db.query('DELETE FROM project_tasks WHERE id=?', [taskId]);
    await db.query('DELETE FROM customer_projects WHERE id=?', [projectId]);
    await db.query('DELETE FROM customers WHERE id=?', [customerId]);
  }
});
