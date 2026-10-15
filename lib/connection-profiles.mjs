import crypto from 'node:crypto';
import * as z from 'zod/v4';

const id = z.uuid();
const base = z.object({
  name: z.string().trim().min(1).max(120),
  protocol: z.enum(['sftp', 'ftps', 'ftp']),
  host: z.string().trim().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535),
  username: z.string().trim().min(1).max(255),
  password: z.string().max(2000).optional(),
  privateKey: z.string().max(20000).optional(),
  passphrase: z.string().max(2000).optional()
});
const missing = () => {
  const e = new Error('Serverprofil nicht gefunden.');
  e.statusCode = 404;
  throw e;
};
export function createConnectionProfiles({ db, encrypt, decrypt }) {
  async function list() {
    const [rows] = await db.query(
      'SELECT id,name,protocol,host,port,username,created_at FROM server_connection_profiles ORDER BY name'
    );
    return rows;
  }
  async function get(profileId) {
    const [rows] = await db.query(
      'SELECT * FROM server_connection_profiles WHERE id=? LIMIT 1', [id.parse(profileId)]
    );
    return rows[0] || missing();
  }
  async function resolve(profileId, remoteRoot) {
    const profile = await get(profileId);
    return {
      protocol: profile.protocol,
      host: profile.host,
      port: profile.port,
      username: profile.username,
      remoteRoot: remoteRoot || '/',
      ...decrypt(profile.encrypted_credentials)
    };
  }
  async function create(raw) {
    const x = base.parse(raw);
    if (!x.password && !x.privateKey) {
      const e = new Error('Passwort oder privater SSH-Schlüssel erforderlich.');
      e.statusCode = 400;
      throw e;
    }
    const profileId = crypto.randomUUID();
    await db.query(
      'INSERT INTO server_connection_profiles(id,name,protocol,host,port,username,encrypted_credentials) VALUES(?,?,?,?,?,?,?)',
      [profileId,x.name,x.protocol,x.host,x.port,x.username,
        encrypt({ password: x.password || '', privateKey: x.privateKey || '', passphrase: x.passphrase || '' })]
    );
    return { id: profileId, name: x.name, protocol: x.protocol, host: x.host, port: x.port, username: x.username };
  }
  async function fromSite(raw) {
    const input = z.object({ site_id: id, name: z.string().trim().min(1).max(120) }).parse(raw);
    const [sites] = await db.query(
      'SELECT protocol,host,port,username,encrypted_credentials FROM sites WHERE id=? AND deployment_mode=? LIMIT 1',
      [input.site_id, 'webspace']
    );
    if (!sites.length) {
      const e = new Error('Die Website hat keine Webspace-Verbindung.');
      e.statusCode = 404;
      throw e;
    }
    const site = sites[0];
    // Re-encrypt using the same master-key policy; credentials never leave the server.
    return create({ name: input.name, protocol: site.protocol, host: site.host,
      port: site.port, username: site.username, ...decrypt(site.encrypted_credentials) });
  }
  async function remove(profileId) {
    const [result] = await db.query('DELETE FROM server_connection_profiles WHERE id=?', [id.parse(profileId)]);
    if (!result.affectedRows) missing();
    return { ok: true, note: 'Bestehende Websites behalten ihre gespeicherten Verbindungen.' };
  }
  return { list,resolve,create,fromSite,remove };
}
export function registerConnectionProfileRoutes(app, service, getOrigin) {
  app.get('/api/server-profiles', () => service.list());
  app.addHook('preHandler', async (req, reply) => {
    if (!['POST','DELETE'].includes(req.method) || !req.url.startsWith('/api/server-profiles')) return;
    if (req.headers.origin && req.headers.origin !== getOrigin())
      return reply.code(403).send({ error: 'Fremde Herkunft.' });
    if (req.method === 'POST' && !String(req.headers['content-type']||'').startsWith('application/json'))
      return reply.code(415).send({ error: 'JSON erforderlich.' });
  });
  app.post('/api/server-profiles', req => service.create(req.body));
  app.post('/api/server-profiles/from-site', req => service.fromSite(req.body));
  app.delete('/api/server-profiles/:id', req => service.remove(id.parse(req.params.id)));
}
