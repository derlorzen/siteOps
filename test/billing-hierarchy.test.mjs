import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createBillingController } from '../lib/billing.mjs';

function fakeDatabase(lookup = {}) {
  const calls = [];
  const db = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.startsWith('SELECT id FROM customers WHERE id=')) return [lookup.customers ? [{ id: values[0] }] : []];
      if (sql.startsWith('SELECT id FROM customer_projects WHERE id='))
        return [lookup.projects ? [{ id: values[0] }] : []];
      if (sql.startsWith('SELECT * FROM customer_projects WHERE id='))
        return [[{ id: values[0], customer_id: lookup.customerId, name: 'Website' }]];
      if (sql.startsWith('SELECT * FROM project_tasks WHERE id='))
        return [[{ id: values[0], project_id: lookup.projectId, name: 'Layout' }]];
      return [[]];
    }
  };
  return { db, calls, api: createBillingController({ db, archive: async () => ({}) }) };
}

test('project creation requires an existing customer', async () => {
  const customerId = randomUUID();
  const { calls, api } = fakeDatabase();
  await assert.rejects(
    api.createProject({ name: 'Neue Website', customer_id: customerId }),
    error => error.statusCode === 404 && error.message === 'Kunde fehlt.'
  );
  assert.equal(calls.some(call => call.sql.startsWith('INSERT')), false);
});

test('task creation requires an existing project', async () => {
  const projectId = randomUUID();
  const { calls, api } = fakeDatabase();
  await assert.rejects(
    api.createTask({ name: 'Logo entwerfen', project_id: projectId }),
    error => error.statusCode === 404 && error.message === 'Projekt fehlt.'
  );
  assert.equal(calls.some(call => call.sql.startsWith('INSERT')), false);
});

test('project creation assigns exactly the selected parent customer', async () => {
  const customerId = randomUUID();
  const { calls, api } = fakeDatabase({ customers: true });
  await api.createProject({ name: 'Neue Website', customer_id: customerId });
  const insert = calls.find(call => call.sql.startsWith('INSERT INTO customer_projects'));
  assert.ok(insert);
  assert.equal(insert.values[1], customerId);
});

test('task creation assigns exactly the selected parent project', async () => {
  const projectId = randomUUID();
  const { calls, api } = fakeDatabase({ projects: true });
  await api.createTask({ name: 'Logo entwerfen', project_id: projectId });
  const insert = calls.find(call => call.sql.startsWith('INSERT INTO project_tasks'));
  assert.ok(insert);
  assert.equal(insert.values[1], projectId);
});

test('editing an existing project or task cannot silently change its parent', async () => {
  const customerId = randomUUID();
  const projectId = randomUUID();
  const otherId = randomUUID();
  const { calls, api } = fakeDatabase({ customerId, projectId });
  await api.editProject(projectId, { name: 'Neue Website', customer_id: otherId });
  await api.editTask(randomUUID(), { name: 'Logo', project_id: otherId });
  const updates = calls.filter(call => call.sql.startsWith('UPDATE'));
  assert.equal(updates.length, 2);
  assert.equal(updates[0].sql.includes('customer_id='), false);
  assert.equal(updates[1].sql.includes('project_id='), false);
});
