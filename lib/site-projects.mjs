import * as z from 'zod/v4';

const uuid = z.uuid();
const payload = z.object({ project_id: uuid.nullable() });
const reject = (code, message) => {
  const error = new Error(message);
  error.statusCode = code;
  throw error;
};
export function createSiteProjectService(db) {
  async function list() {
    const [items] = await db.query(
      'SELECT ps.site_id,ps.project_id,p.name project_name,p.customer_id,c.name customer_name,s.slug,s.domain,s.name site_name ' +
        'FROM project_sites ps JOIN sites s ON s.id=ps.site_id ' +
        'JOIN customer_projects p ON p.id=ps.project_id JOIN customers c ON c.id=p.customer_id ' +
        'ORDER BY c.name,p.name,s.name'
    );
    return items;
  }
  async function link(siteId, raw) {
    const { project_id: projectId } = payload.parse(raw);
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [sites] = await conn.query('SELECT id FROM sites WHERE id=? FOR UPDATE', [siteId]);
      if (!sites.length) reject(404, 'Website nicht gefunden.');
      if (projectId) {
        const [projects] = await conn.query('SELECT id FROM customer_projects WHERE id=? FOR UPDATE', [projectId]);
        if (!projects.length) reject(404, 'Kundenprojekt nicht gefunden.');
      }
      // The old one-to-one site_id column remains a compatibility mirror only.
      // Explicit linkage through project_sites is the source of truth.
      await conn.query('DELETE FROM project_sites WHERE site_id=?', [siteId]);
      await conn.query('UPDATE customer_projects SET site_id=NULL WHERE site_id=?', [siteId]);
      if (projectId) {
        await conn.query('INSERT INTO project_sites(site_id,project_id) VALUES(?,?)', [siteId, projectId]);
        await conn.query('UPDATE customer_projects SET site_id=? WHERE id=? AND site_id IS NULL', [siteId, projectId]);
      }
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
    return { site_id: siteId, project_id: projectId };
  }
  return { list, link };
}
export function registerSiteProjectRoutes(app, service) {
  app.get('/api/site-projects', () => service.list());
  app.put('/api/sites/:site/project', request =>
    service.link(uuid.parse(request.params.site), request.body)
  );
}
