import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createSiteProjectService, registerSiteProjectRoutes } from '../lib/site-projects.mjs';

function mockDatabase({ site = true, project = true } = {}) {
  const queries = [];
  let committed = 0;
  let rolledBack = 0;
  let released = 0;
  const database = {
    query: async (sql, params = []) => {
      queries.push({ sql, params });
      if (sql.startsWith('SELECT id FROM sites')) return [site ? [{ id: params[0] }] : []];
      if (sql.startsWith('SELECT id FROM customer_projects')) return [project ? [{ id: params[0] }] : []];
      return [[]];
    },
    async getConnection() {
      return {
        query: database.query,
        beginTransaction: async () => {},
        commit: async () => {
          committed++;
        },
        rollback: async () => {
          rolledBack++;
        },
        release: () => {
          released++;
        }
      };
    }
  };
  return {
    database,
    queries,
    get committed() {
      return committed;
    },
    get rolledBack() {
      return rolledBack;
    },
    get released() {
      return released;
    }
  };
}

test('standalone website can be linked to a project transactionally', async () => {
  const fake = mockDatabase();
  const service = createSiteProjectService(fake.database);
  const siteId = randomUUID();
  const projectId = randomUUID();
  assert.deepEqual(await service.link(siteId, { project_id: projectId }), { site_id: siteId, project_id: projectId });
  assert.equal(fake.committed, 1);
  assert.equal(fake.rolledBack, 0);
  assert.equal(fake.released, 1);
  const insert = fake.queries.find(q => q.sql.startsWith('INSERT INTO project_sites'));
  assert.deepEqual(insert.params, [siteId, projectId]);
});

test('unlinking leaves the site and its monitoring data intact', async () => {
  const fake = mockDatabase();
  const service = createSiteProjectService(fake.database);
  const siteId = randomUUID();
  await service.link(siteId, { project_id: null });
  assert.equal(fake.committed, 1);
  assert.equal(
    fake.queries.some(q => q.sql.startsWith('DELETE FROM sites')),
    false
  );
  assert.equal(
    fake.queries.some(q => q.sql.startsWith('DELETE FROM project_sites')),
    true
  );
  assert.equal(
    fake.queries.some(q => q.sql.startsWith('INSERT INTO project_sites')),
    false
  );
});

test('missing site or missing project causes rollback', async () => {
  const siteId = randomUUID();
  const projectId = randomUUID();
  for (const mode of [{ site: false }, { project: false }]) {
    const fake = mockDatabase(mode);
    await assert.rejects(
      createSiteProjectService(fake.database).link(siteId, { project_id: projectId }),
      error => error.statusCode === 404
    );
    assert.equal(fake.committed, 0);
    assert.equal(fake.rolledBack, 1);
    assert.equal(fake.released, 1);
  }
});

test('site assignment rejects invalid UUIDs and does not change database', async () => {
  const fake = mockDatabase();
  await assert.rejects(
    createSiteProjectService(fake.database).link(randomUUID(), {
      project_id: 'incorrect'
    })
  );
  assert.equal(fake.queries.length, 0);
});

test('site to project routes exist and use the same service', async () => {
  const paths = [];
  const app = { get: path => paths.push('GET ' + path), put: path => paths.push('PUT ' + path) };
  registerSiteProjectRoutes(app, { list() {}, link() {} });
  assert.deepEqual(paths, ['GET /api/site-projects', 'PUT /api/sites/:site/project']);
});

test('all shared workspace browser assets parse and the site assignment UI is present', async () => {
  const paths = ['../public/ops-workspace.js', '../public/crm-app.js'];
  for (const path of paths) {
    const content = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.doesNotThrow(() => new vm.Script(content));
  }
  const shell = await readFile(new URL(paths[0], import.meta.url), 'utf8');
  const crm = await readFile(new URL(paths[1], import.meta.url), 'utf8');
  assert.match(shell, /\/api\/sites\/.*\/project/);
  const list = await readFile(new URL('../lib/product-ui.mjs', import.meta.url), 'utf8');
  assert.match(list, /ui-data-table/);
  assert.doesNotMatch(shell, /dashboardFocus/);
  assert.match(crm, /crm-project-websites/);
  assert.match(crm, /crmProjectTable/);
  assert.match(crm, /Websites zuordnen/);
  assert.doesNotMatch(crm, /crm-standalone-site/);
});

test('schema allows multiple sites in one project but a site has only one project', async () => {
  const migration = await readFile(new URL('../migrations/0009_project_sites.sql', import.meta.url), 'utf8');
  assert.match(migration, /site_id CHAR\(36\) NOT NULL PRIMARY KEY/);
  assert.match(migration, /INDEX idx_project_sites_project \(project_id\)/);
  assert.match(migration, /HAVING COUNT\(\*\)=1/);
});
