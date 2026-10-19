import crypto from 'node:crypto';
import * as z from 'zod/v4';

const uuid = z.uuid();
const resourceId = z.string().regex(/^[a-zA-Z0-9_-]{4,191}$/);
const projectKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/);
const emailSafeError = error => String(error?.message || error || 'Fehler').slice(0, 380);

export const coolifyConnectionSchema = z.object({
  name: z.string().trim().min(2).max(120),
  baseUrl: z.url().max(512),
  token: z.string().trim().min(12).max(4096),
  defaultServerUuid: resourceId.optional()
});
export const coolifyConnectionUpdateSchema = coolifyConnectionSchema
  .omit({ token: true, defaultServerUuid: true })
  .extend({
    token: z.string().trim().min(12).max(4096).optional(),
    defaultServerUuid: resourceId.nullable().optional()
  });

export const coolifySupabaseSchema = z.object({
  connectionId: uuid,
  projectKey: projectKeySchema,
  name: z.string().trim().min(2).max(190),
  siteopsProjectId: uuid.optional(),
  coolifyProjectUuid: resourceId.optional(),
  serverUuid: resourceId.optional(),
  destinationUuid: resourceId.optional(),
  environmentName: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/)
    .default('production')
});

export function coolifyBaseUrl(raw) {
  const url = new URL(String(raw));
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['', '/'].includes(url.pathname)
  )
    throw new Error('Coolify benötigt eine reine HTTPS-URL ohne Pfad, Benutzername oder Parameter.');
  if (!url.hostname || url.hostname === 'localhost' || url.hostname.endsWith('.localhost'))
    throw new Error('Coolify benötigt einen erreichbaren HTTPS-Host.');
  return url.origin;
}

function checkCoolifyPath(path) {
  if (
    !/^\/(?:projects|servers|services)(?:\/[a-zA-Z0-9_-]+)?(?:\/start)?$/.test(path) &&
    !/^\/services\/[a-zA-Z0-9_-]+\/(?:applications|databases)$/.test(path)
  )
    throw new Error('Nicht freigegebener Coolify-API-Pfad.');
  return path;
}

export function createCoolifyClient({ baseUrl, token, request = fetch }) {
  const url = coolifyBaseUrl(baseUrl);
  if (typeof token !== 'string' || token.length < 12) throw new Error('Coolify API-Token fehlt.');
  async function api(method, path, body) {
    const endpoint = url + '/api/v1' + checkCoolifyPath(path);
    let response;
    try {
      response = await request(endpoint, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(25000),
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
      });
    } catch {
      throw new Error('Coolify API nicht erreichbar. HTTPS und API-Zugriffsliste prüfen.');
    }
    if (!response.ok) {
      const error = new Error(
        'Coolify API HTTP ' +
          response.status +
          (response.status === 401 || response.status === 403 ? ': Token-Berechtigung oder Zugriffsliste prüfen.' : '')
      );
      error.statusCode = response.status;
      throw error;
    }
    const length = Number(response.headers?.get?.('content-length') || 0);
    if (length > 2_000_000) throw new Error('Coolify API-Antwort zu groß.');
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error('Coolify API-Antwort zu groß.');
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Coolify API: ungültige JSON-Antwort.');
    }
  }
  return {
    projects: () => api('GET', '/projects'),
    servers: () => api('GET', '/servers'),
    services: () => api('GET', '/services'),
    service: serviceUuid => api('GET', '/services/' + resourceId.parse(serviceUuid)),
    serviceApplications: serviceUuid => api('GET', '/services/' + resourceId.parse(serviceUuid) + '/applications'),
    serviceDatabases: serviceUuid => api('GET', '/services/' + resourceId.parse(serviceUuid) + '/databases'),
    createProject: (name, description) => api('POST', '/projects', { name, description }),
    createService: body => api('POST', '/services', body),
    startService: serviceUuid => api('POST', '/services/' + resourceId.parse(serviceUuid) + '/start')
  };
}

function publicConnection(row) {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    defaultServerUuid: row.default_server_uuid || null,
    createdAt: row.created_at
  };
}
function publicInstance(row) {
  return {
    id: row.id,
    connectionId: row.connection_id,
    projectKey: row.project_key,
    name: row.name,
    siteopsProjectId: row.siteops_project_id,
    coolifyProjectUuid: row.coolify_project_uuid,
    serviceUuid: row.service_uuid,
    environmentName: row.environment_name,
    serverUuid: row.server_uuid,
    destinationUuid: row.destination_uuid || null,
    state: row.state,
    lastError: row.last_error,
    updatedAt: row.updated_at
  };
}
function marker(key) {
  return 'Managed by SiteOps / supabase / ' + key;
}
function remoteName(key) {
  return 'siteops-supabase-' + key;
}
function projectName(key) {
  return 'SiteOps ' + key;
}
function ensureArray(value, resource) {
  if (!Array.isArray(value)) throw new Error('Coolify API: ' + resource + ' ist keine Liste.');
  return value;
}
function remoteFound(items, name, description, resource) {
  const matches = ensureArray(items, resource).filter(x => x?.name === name);
  if (matches.length > 1 || matches.some(x => x.description !== description))
    throw new Error('Coolify: Namenskonflikt mit vorhandener Ressource. Keine Änderung vorgenommen.');
  return matches[0] || null;
}
function needUuid(result, resource) {
  return resourceId.parse(result?.uuid);
}

export function createCoolifyService({ db, encrypt, decrypt, request = fetch }) {
  let ticking = false;
  async function storedConnection(id) {
    const [rows] = await db.query('SELECT * FROM coolify_connections WHERE id=? LIMIT 1', [uuid.parse(id)]);
    if (!rows.length) throw Object.assign(new Error('Coolify-Verbindung nicht gefunden.'), { statusCode: 404 });
    return rows[0];
  }
  function client(row) {
    return createCoolifyClient({ baseUrl: row.base_url, token: decrypt(row.encrypted_token), request });
  }
  async function listConnections() {
    const [rows] = await db.query(
      'SELECT id,name,base_url,default_server_uuid,created_at FROM coolify_connections ORDER BY name'
    );
    return rows.map(publicConnection);
  }
  async function addConnection(raw) {
    const x = coolifyConnectionSchema.parse(raw);
    const baseUrl = coolifyBaseUrl(x.baseUrl);
    // Save encrypted credentials even if Coolify is temporarily offline or API access is restricted.
    // Connection validation is a separate, explicit operation via connectionInfo().
    const id = crypto.randomUUID();
    await db.query(
      'INSERT INTO coolify_connections(id,name,base_url,encrypted_token,default_server_uuid) VALUES(?,?,?,?,?)',
      [id, x.name, baseUrl, encrypt(x.token), x.defaultServerUuid || null]
    );
    return { id, name: x.name, baseUrl, defaultServerUuid: x.defaultServerUuid || null };
  }
  async function updateConnection(id, raw) {
    const current = await storedConnection(id);
    const x = coolifyConnectionUpdateSchema.parse(raw);
    const baseUrl = coolifyBaseUrl(x.baseUrl);
    // Editing local settings must not depend on the remote server being reachable.
    const encryptedToken = x.token ? encrypt(x.token) : current.encrypted_token;
    const serverUuid = x.defaultServerUuid === undefined ? current.default_server_uuid : x.defaultServerUuid;
    await db.query(
      'UPDATE coolify_connections SET name=?,base_url=?,encrypted_token=?,default_server_uuid=? WHERE id=?',
      [x.name, baseUrl, encryptedToken, serverUuid || null, current.id]
    );
    return { id: current.id, name: x.name, baseUrl, defaultServerUuid: serverUuid || null };
  }
  async function connectionInfo(id) {
    const stored = await storedConnection(id);
    const api = client(stored);
    const [projects, servers, existingServices] = await Promise.all([
      api.projects(),
      api.servers(),
      remoteServices(id).catch(() => null)
    ]);
    return {
      ...publicConnection(stored),
      projects: ensureArray(projects, 'Projekte').map(p => ({
        uuid: p.uuid,
        name: p.name,
        description: p.description || ''
      })),
      servers: ensureArray(servers, 'Server').map(s => ({
        uuid: s.uuid,
        name: s.name
      })),
      services: existingServices || [],
      servicesAvailable: existingServices !== null
    };
  }
  // Read-only inventory of existing Coolify services, including those created outside SiteOps.
  // The API can return docker_compose and environment secrets: expose only allowlisted metadata.
  async function remoteServices(connectionId) {
    const saved = await storedConnection(connectionId);
    const services = ensureArray(await client(saved).services(), 'Services');
    return services
      .filter(s => resourceId.safeParse(s?.uuid).success)
      .map(s => ({
        uuid: s.uuid,
        name: String(s.name || '').slice(0, 190),
        serviceType: s.service_type || null,
        environmentId: Number.isInteger(s.environment_id) ? s.environment_id : null,
        serverId: Number.isInteger(s.server_id) ? s.server_id : null,
        updatedAt: s.updated_at || null
      }));
  }
  async function remoteServiceInfo(connectionId, serviceUuid) {
    const saved = await storedConnection(connectionId);
    const service = await client(saved).service(resourceId.parse(serviceUuid));
    return {
      uuid: serviceUuid,
      name: String(service.name || '').slice(0, 190),
      serviceType: service.service_type || null,
      environmentId: Number.isInteger(service.environment_id) ? service.environment_id : null,
      serverId: Number.isInteger(service.server_id) ? service.server_id : null,
      updatedAt: service.updated_at || null
    };
  }
  async function instances() {
    const [rows] = await db.query('SELECT * FROM coolify_supabase_instances ORDER BY created_at DESC');
    return rows.map(publicInstance);
  }
  async function instance(id) {
    const [rows] = await db.query('SELECT * FROM coolify_supabase_instances WHERE id=? LIMIT 1', [uuid.parse(id)]);
    if (!rows.length) throw Object.assign(new Error('Supabase-Auftrag nicht gefunden.'), { statusCode: 404 });
    return rows[0];
  }
  async function status(id) {
    const row = await instance(id);
    const result = publicInstance(row);
    if (row.service_uuid) {
      try {
        const api = client(await storedConnection(row.connection_id));
        const service = await api.service(row.service_uuid);
        result.remote = {
          uuid: row.service_uuid,
          name: service.name,
          serviceType: service.service_type,
          updatedAt: service.updated_at
        };
        const [apps, databases] = await Promise.allSettled([
          api.serviceApplications(row.service_uuid),
          api.serviceDatabases(row.service_uuid)
        ]);
        const summarize = data =>
          data.map(component => ({
            name: String(component?.name || component?.human_name || '').slice(0, 140),
            status: String(component?.status || 'unknown').slice(0, 80),
            url:
              typeof component?.fqdn === 'string' && /^https:\/\/[^/@?#]+(?:\/|$)/.test(component.fqdn)
                ? component.fqdn.slice(0, 300)
                : null
          }));
        result.remote.components = {
          applications: apps.status === 'fulfilled' && Array.isArray(apps.value) ? summarize(apps.value) : null,
          databases:
            databases.status === 'fulfilled' && Array.isArray(databases.value) ? summarize(databases.value) : null
        };
      } catch {
        result.remote = { uuid: row.service_uuid, reachable: false };
      }
    }
    return result; // Never retrieve/expose Coolify secrets (Supabase anon, service role, database password).
  }
  async function enqueue(raw) {
    const x = coolifySupabaseSchema.parse(raw);
    const connection = await storedConnection(x.connectionId);
    if (x.siteopsProjectId) {
      const [existing] = await db.query('SELECT id FROM customer_projects WHERE id=? LIMIT 1', [x.siteopsProjectId]);
      if (!existing.length) throw new Error('SiteOps-Kundenprojekt nicht gefunden.');
    }
    const serverUuid = x.serverUuid || connection.default_server_uuid;
    const id = crypto.randomUUID();
    await db.query(
      `INSERT IGNORE INTO coolify_supabase_instances
       (id,connection_id,project_key,name,siteops_project_id,coolify_project_uuid,environment_name,server_uuid,destination_uuid,state)
       VALUES(?,?,?,?,?,?,?,?,?,'queued')`,
      [
        id,
        x.connectionId,
        x.projectKey,
        x.name,
        x.siteopsProjectId || null,
        x.coolifyProjectUuid || null,
        x.environmentName,
        serverUuid || null,
        x.destinationUuid || null
      ]
    );
    const [rows] = await db.query(
      'SELECT * FROM coolify_supabase_instances WHERE connection_id=? AND project_key=? LIMIT 1',
      [x.connectionId, x.projectKey]
    );
    const row = rows[0];
    if (
      row.siteops_project_id !== (x.siteopsProjectId || null) ||
      (x.coolifyProjectUuid && row.coolify_project_uuid !== x.coolifyProjectUuid) ||
      (serverUuid && row.server_uuid && row.server_uuid !== serverUuid) ||
      (x.destinationUuid && row.destination_uuid !== x.destinationUuid)
    )
      throw new Error('Supabase-Auftrag existiert mit anderer Projekt- oder Serverzuordnung.');
    return publicInstance(row);
  }
  async function provision(row) {
    const connection = await storedConnection(row.connection_id);
    const api = client(connection);
    const safeName = remoteName(row.project_key);
    const identity = marker(row.project_key);
    let serverUuid = row.server_uuid;
    if (!serverUuid) {
      const servers = ensureArray(await api.servers(), 'Server');
      if (servers.length !== 1 || !servers[0]?.uuid)
        throw new Error('Bitte einmalig den Coolify-Server auswählen. Mehrere/keine Server verfügbar.');
      serverUuid = resourceId.parse(servers[0].uuid);
      await db.query('UPDATE coolify_supabase_instances SET server_uuid=? WHERE id=?', [serverUuid, row.id]);
    }
    let projectUuid = row.coolify_project_uuid;
    if (!projectUuid) {
      const projects = await api.projects();
      const found = remoteFound(projects, projectName(row.project_key), identity, 'Projekte');
      if (found) projectUuid = needUuid(found, 'Coolify-Projekt');
      else projectUuid = needUuid(await api.createProject(projectName(row.project_key), identity), 'Coolify-Projekt');
      await db.query('UPDATE coolify_supabase_instances SET coolify_project_uuid=? WHERE id=?', [projectUuid, row.id]);
    }
    let serviceUuid = row.service_uuid;
    if (!serviceUuid) {
      const services = await api.services();
      const found = remoteFound(services, safeName, identity, 'Services');
      if (found) serviceUuid = needUuid(found, 'Supabase-Service');
      else {
        serviceUuid = needUuid(
          await api.createService({
            type: 'supabase',
            name: safeName,
            description: identity,
            project_uuid: projectUuid,
            environment_name: row.environment_name,
            server_uuid: serverUuid,
            ...(row.destination_uuid ? { destination_uuid: row.destination_uuid } : {}),
            instant_deploy: false,
            force_domain_override: false,
            tags: ['siteops', 'supabase']
          }),
          'Supabase-Service'
        );
      }
      await db.query('UPDATE coolify_supabase_instances SET service_uuid=? WHERE id=?', [serviceUuid, row.id]);
    }
    await api.startService(serviceUuid);
    await db.query("UPDATE coolify_supabase_instances SET state='deployment_requested',last_error=NULL WHERE id=?", [
      row.id
    ]);
  }
  async function retry(id) {
    const [r] = await db.query(
      "UPDATE coolify_supabase_instances SET state='queued',last_error=NULL WHERE id=? AND state='needs_attention'",
      [uuid.parse(id)]
    );
    if (!r.affectedRows) throw new Error('Nur unterbrochene Supabase-Aufträge können erneut gestartet werden.');
    return status(id);
  }
  async function tick() {
    if (ticking) return;
    ticking = true;
    let lock;
    try {
      lock = await db.getConnection();
      const [[l]] = await lock.query("SELECT GET_LOCK('siteops:coolify-worker',0) AS acquired");
      if (!l.acquired) return;
      // An interrupted remote API write may have succeeded: never blindly re-run
      // it. Retry performs deterministic remote discovery before any new POST.
      await db.query(
        "UPDATE coolify_supabase_instances SET state='needs_attention',last_error='SiteOps-Neustart während Coolify-Bereitstellung. Auftrag prüfen und erneut starten.' WHERE state='provisioning'"
      );
      const [rows] = await db.query(
        "SELECT * FROM coolify_supabase_instances WHERE state='queued' ORDER BY created_at LIMIT 1"
      );
      if (!rows.length) return;
      const row = rows[0];
      const [claimed] = await db.query(
        "UPDATE coolify_supabase_instances SET state='provisioning' WHERE id=? AND state='queued'",
        [row.id]
      );
      if (!claimed.affectedRows) return;
      try {
        await provision(row);
      } catch (error) {
        await db.query("UPDATE coolify_supabase_instances SET state='needs_attention',last_error=? WHERE id=?", [
          emailSafeError(error).replace(/Bearer\s+\S+/gi, 'Bearer [redacted]'),
          row.id
        ]);
      }
    } finally {
      if (lock) {
        try {
          await lock.query("SELECT RELEASE_LOCK('siteops:coolify-worker')");
        } finally {
          lock.release();
        }
      }
      ticking = false;
    }
  }
  function startWorker() {
    tick().catch(error => console.error('Coolify worker', emailSafeError(error)));
    setInterval(() => tick().catch(error => console.error('Coolify worker', emailSafeError(error))), 30_000).unref();
  }
  return {
    listConnections,
    addConnection,
    updateConnection,
    connectionInfo,
    remoteServices,
    remoteServiceInfo,
    instances,
    status,
    enqueue,
    retry,
    tick,
    startWorker
  };
}
