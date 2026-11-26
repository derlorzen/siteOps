import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createProjectDeletion } from '../lib/project-deletion.mjs';
import { createSiteDeletion } from '../lib/site-deletion.mjs';

export async function checkProjectDeletionMysql(db) {
  const [customer, project, task, site, incident, entry, extra] = Array.from({ length: 7 }, () => randomUUID());
  const name = 'CI lifecycle project';
  const slug = 'ci-delete-' + site;
  const count = async (table, id) => {
    const [rows] = await db.query('SELECT COUNT(*) n FROM ' + table + ' WHERE id=?', [id]);
    return Number(rows[0].n);
  };
  try {
    await db.query('INSERT INTO customers(id,name) VALUES(?,?)', [customer, name]);
    await db.query('INSERT INTO customer_projects(id,customer_id,name) VALUES(?,?,?)', [project, customer, name]);
    await db.query('INSERT INTO project_tasks(id,project_id,name,status) VALUES(?,?,?,?)', [task, project, 'CI task', 'open']);
    await db.query(
      'INSERT INTO sites(id,slug,name,domain,protocol,host,port,username,encrypted_credentials,remote_root) VALUES(?,?,?,?,?,?,?,?,?,?)',
      [site, slug, name, site + '.example.invalid', 'sftp', 'example.invalid', 22, 'ci', 'dummy', '/ci']
    );
    await db.query('INSERT INTO project_sites(site_id,project_id) VALUES(?,?)', [site, project]);
    await db.query('INSERT INTO incidents(id,site_id,title) VALUES(?,?,?)', [incident, site, 'CI outage']);
    await db.query('INSERT INTO monitor_billing_tasks(incident_id,task_id) VALUES(?,?)', [incident, task]);
    const deletion = createProjectDeletion({ db });
    const blocked = await deletion.preview({ project_id: project });
    assert.equal(blocked.token, null);
    assert.equal(blocked.websites, 1);
    const getSite = async () => (await db.query('SELECT * FROM sites WHERE id=?', [site]))[0][0];
    const siteDeletion = createSiteDeletion({ db, getSite, listSites: async () => [await getSite()] });
    const preview = await siteDeletion.preview({ site: slug, deleteFolder: false, deleteDomain: false });
    assert.equal((await siteDeletion.confirm({ token: preview.token, confirmation: slug })).ok, true);
    assert.equal(await count('sites', site), 0);
    assert.equal(await count('incidents', incident), 0);
    assert.equal(await count('project_tasks', task), 1);
    const [links] = await db.query('SELECT * FROM monitor_billing_tasks WHERE incident_id=?', [incident]);
    assert.equal(links.length, 0);
    await db.query('INSERT INTO time_entries(id,task_id,entry_date,duration_seconds,hourly_cents) VALUES(?,?,?,?,?)', [
      entry, task, '2026-11-26', 0, 0
    ]);
    const financial = await deletion.preview({ project_id: project });
    assert.equal(financial.token, null);
    assert.equal(financial.time_entries, 1);
    await db.query('DELETE FROM time_entries WHERE id=?', [entry]);
    const stale = await deletion.preview({ project_id: project });
    await db.query('INSERT INTO project_tasks(id,project_id,name,status) VALUES(?,?,?,?)', [extra, project, 'New task', 'open']);
    await assert.rejects(deletion.confirm({ token: stale.token, confirmation: name }), { statusCode: 409 });
    const valid = await deletion.preview({ project_id: project });
    await assert.rejects(deletion.confirm({ token: valid.token, confirmation: 'wrong' }), { statusCode: 400 });
    const result = await deletion.confirm({ token: valid.token, confirmation: name });
    assert.equal(result.deleted_tasks, 2);
    assert.equal(await count('customer_projects', project), 0);
    assert.equal(await count('customers', customer), 1);
    assert.equal(await count('project_tasks', task), 0);
    await assert.rejects(deletion.confirm({ token: valid.token, confirmation: name }), { statusCode: 409 });
  } finally {
    await db.query('DELETE FROM monitor_billing_tasks WHERE incident_id=?', [incident]);
    await db.query('DELETE FROM sites WHERE id=?', [site]);
    await db.query('DELETE FROM time_entries WHERE id=?', [entry]);
    await db.query('DELETE FROM project_tasks WHERE project_id=?', [project]);
    await db.query('DELETE FROM customer_projects WHERE id=?', [project]);
    await db.query('DELETE FROM customers WHERE id=?', [customer]);
  }
}
