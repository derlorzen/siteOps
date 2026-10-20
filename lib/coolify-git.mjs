import { createHash } from 'node:crypto';
import * as z from 'zod/v4';

const uuid = z.uuid();
const resourceId = z.string().regex(/^[a-zA-Z0-9_-]{4,191}$/);
const key = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/);
const shortName = z.string().trim().min(2).max(190);
const environment = z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/);
const buildPack = z.enum(['nixpacks', 'railpack', 'static', 'dockerfile', 'dockercompose']);
const sourceType = z.enum(['public', 'private-deploy-key', 'private-github-app']);

function safeRepository(value) {
  if (/^git@[a-z0-9.-]+:[a-zA-Z0-9_.\/-]+(?:\.git)?$/i.test(value)) return true;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' &&
      !url.username && !url.password && !url.search && !url.hash &&
      !url.port && url.pathname.length > 2 &&
      host.includes('.') && !host.endsWith('.local') && !host.endsWith('.localhost') &&
      !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(host);
  } catch {
    return false;
  }
}

function safeDomain(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      !url.search && !url.hash && !url.port && url.pathname === '/' &&
      url.hostname.includes('.') && !url.hostname.endsWith('.local');
  } catch {
    return false;
  }
}

export const coolifyProjectCreateSchema = z.object({
  connectionId: uuid,
  projectKey: key,
  name: shortName
});

export const coolifyGitApplicationSchema = z.object({
  connectionId: uuid,
  projectUuid: resourceId,
  appKey: key,
  name: shortName,
  gitRepository: z.string().trim().min(8).max(512).refine(safeRepository, 'Git-Repository muss eine saubere HTTPS-URL oder eine gültige Git-SSH-Adresse sein.'),
  gitBranch: z.string().trim().min(1).max(190).regex(/^[^\s~^:?*[\]\\]+$/).default('main'),
  buildPack: buildPack.default('nixpacks'),
  portsExposes: z.string().trim().regex(/^\d{2,5}(?:,\d{2,5})*$/).default('3000'),
  environmentName: environment.default('production'),
  serverUuid: resourceId.optional(),
  destinationUuid: resourceId.optional(),
  sourceType: sourceType.default('public'),
  sourceUuid: resourceId.optional(),
  domain: z.string().trim().refine(safeDomain, 'Domain muss eine HTTPS-Origin ohne Pfad oder Parameter sein.').optional(),
  baseDirectory: z.string().trim().max(190).regex(/^\/(?:[a-zA-Z0-9_.-]+\/?)*$/).optional(),
  publishDirectory: z.string().trim().max(190).regex(/^[a-zA-Z0-9_.\/-]+$/).optional(),
  dockerfileLocation: z.string().trim().max(190).regex(/^\/[a-zA-Z0-9_.\/-]+$/).optional(),
  autoDeploy: z.boolean().default(true),
  deployNow: z.boolean().default(false)
}).superRefine((value, ctx) => {
  if (value.sourceType === 'public' && value.sourceUuid) {
    ctx.addIssue({ code: 'custom', path: ['sourceUuid'], message: 'Für ein öffentliches Repository keine private Quellen-UUID angeben.' });
  }
  if (value.sourceType !== 'public' && !value.sourceUuid) {
    ctx.addIssue({ code: 'custom', path: ['sourceUuid'], message: 'Private Git-Repositories benötigen eine in Coolify vorhandene Deploy-Key- oder GitHub-App-UUID.' });
  }
  if (value.sourceType === 'public' && value.gitRepository.startsWith('git@')) {
    ctx.addIssue({ code: 'custom', path: ['gitRepository'], message: 'Für öffentliche Repositories eine HTTPS-URL verwenden.' });
  }
});

const digest = value => createHash('sha256').update(value).digest('hex');
const safeList = (value, name) => {
  if (!Array.isArray(value)) throw new Error('Coolify ' + name + ': ungültige API-Antwort.');
  return value;
};
const validResource = record => resourceId.safeParse(record?.uuid).success;
const short = value => String(value || '').slice(0, 190);
const conflict = () => {
  const error = new Error('Coolify-Ressource existiert bereits mit abweichender Kennung oder Konfiguration. Keine Änderung vorgenommen.');
  error.statusCode = 409;
  return error;
};
const publicApp = app => ({
  uuid: app.uuid,
  name: short(app.name),
  gitRepository: short(app.git_repository),
  gitBranch: short(app.git_branch),
  buildPack: short(app.build_pack),
  status: short(app.status),
  domain: short(app.fqdn),
  environmentId: Number.isInteger(app.environment_id) ? app.environment_id : null
});

export function createCoolifyGitService({ db, loadConnection, makeClient }) {
  async function withLock(identity, work) {
    const lock = await db.getConnection();
    const lockName = 'siteops:cg:' + digest(identity).slice(0, 38);
    let acquired = false;
    try {
      const [[result]] = await lock.query('SELECT GET_LOCK(?, 10) AS acquired', [lockName]);
      if (!result?.acquired) throw Object.assign(new Error('Coolify-Auftrag läuft bereits. Bitte später erneut prüfen.'), { statusCode: 409 });
      acquired = true;
      return await work();
    } finally {
      try {
        if (acquired) await lock.query('SELECT RELEASE_LOCK(?)', [lockName]);
      } finally {
        lock.release();
      }
    }
  }

  async function getClient(connectionId) {
    return makeClient(await loadConnection(uuid.parse(connectionId)));
  }

  async function projects(connectionId) {
    const api = await getClient(connectionId);
    return safeList(await api.projects(), 'Projekte')
      .filter(validResource)
      .map(item => ({ uuid: item.uuid, name: short(item.name), description: String(item.description || '').slice(0, 500) }));
  }

  async function applications(connectionId) {
    const api = await getClient(connectionId);
    return safeList(await api.applications(), 'Anwendungen').filter(validResource).map(publicApp);
  }

  async function applicationInfo(connectionId, applicationUuid) {
    const api = await getClient(connectionId);
    // Never return the raw application API response, which can include secrets.
    const app = await api.application(resourceId.parse(applicationUuid));
    return publicApp({ ...app, uuid: applicationUuid });
  }

  async function createProject(raw) {
    const x = coolifyProjectCreateSchema.parse(raw);
    return withLock('project:' + x.connectionId + ':' + x.projectKey, async () => {
      const api = await getClient(x.connectionId);
      const marker = 'SiteOps/project/' + digest(x.connectionId + ':' + x.projectKey).slice(0, 24);
      const existing = safeList(await api.projects(), 'Projekte');
      const owned = existing.filter(item => item.description === marker);
      if (owned.length > 1 || owned.some(item => item.name !== x.name || !validResource(item))) throw conflict();
      if (owned.length === 1) return { uuid: owned[0].uuid, name: x.name, projectKey: x.projectKey, created: false };
      if (existing.some(item => item.name === x.name)) throw conflict();
      const created = await api.createProject(x.name, marker);
      return { uuid: resourceId.parse(created?.uuid), name: x.name, projectKey: x.projectKey, created: true };
    });
  }

  async function createApplication(raw) {
    const x = coolifyGitApplicationSchema.parse(raw);
    return withLock('app:' + x.connectionId + ':' + x.projectUuid + ':' + x.appKey, async () => {
      const connection = await loadConnection(x.connectionId);
      const api = makeClient(connection);
      const projects = safeList(await api.projects(), 'Projekte');
      if (!projects.some(item => item.uuid === x.projectUuid)) throw new Error('Coolify-Projekt gehört nicht zur gespeicherten Verbindung.');
      const servers = safeList(await api.servers(), 'Server').filter(validResource);
      const serverUuid = x.serverUuid || connection.default_server_uuid ||
        (servers.length === 1 ? servers[0].uuid : null);
      if (!serverUuid || !servers.some(item => item.uuid === serverUuid)) {
        throw new Error('Bitte einen gültigen Coolify-Server auswählen.');
      }
      const config = {
        name: x.name, projectUuid: x.projectUuid, gitRepository: x.gitRepository,
        gitBranch: x.gitBranch, buildPack: x.buildPack, portsExposes: x.portsExposes,
        environmentName: x.environmentName, serverUuid,
        destinationUuid: x.destinationUuid || null, sourceType: x.sourceType,
        sourceUuid: x.sourceUuid || null, domain: x.domain || null,
        baseDirectory: x.baseDirectory || null, publishDirectory: x.publishDirectory || null,
        dockerfileLocation: x.dockerfileLocation || null, autoDeploy: x.autoDeploy
      };
      const marker = 'SiteOps/git/' + digest(x.connectionId + ':' + x.projectUuid + ':' + x.appKey).slice(0, 24) + '/';
      const description = marker + digest(JSON.stringify(config)).slice(0, 24);
      const apps = safeList(await api.applications(), 'Anwendungen');
      const owned = apps.filter(app => String(app.description || '').startsWith(marker));
      if (owned.length > 1 || owned.some(app => app.description !== description || !validResource(app))) throw conflict();
      if (owned.length === 1) {
        return { ...publicApp(owned[0]), created: false, deploymentRequested: false, appKey: x.appKey };
      }
      if (apps.some(app => app.name === x.name)) throw conflict();
      const payload = {
        project_uuid: x.projectUuid,
        server_uuid: serverUuid,
        environment_name: x.environmentName,
        git_repository: x.gitRepository,
        git_branch: x.gitBranch,
        build_pack: x.buildPack,
        ports_exposes: x.portsExposes,
        name: x.name,
        description,
        is_auto_deploy_enabled: x.autoDeploy,
        instant_deploy: x.deployNow,
        force_domain_override: false,
        ...(x.destinationUuid ? { destination_uuid: x.destinationUuid } : {}),
        ...(x.domain ? { domains: x.domain, autogenerate_domain: false } : {}),
        ...(x.baseDirectory ? { base_directory: x.baseDirectory } : {}),
        ...(x.publishDirectory ? { publish_directory: x.publishDirectory } : {}),
        ...(x.dockerfileLocation ? { dockerfile_location: x.dockerfileLocation } : {}),
        ...(x.sourceType === 'private-deploy-key' ? { private_key_uuid: x.sourceUuid } : {}),
        ...(x.sourceType === 'private-github-app' ? { github_app_uuid: x.sourceUuid } : {})
      };
      const created = await api.createApplication(x.sourceType, payload);
      return {
        uuid: resourceId.parse(created?.uuid), name: x.name, appKey: x.appKey,
        projectUuid: x.projectUuid, gitRepository: x.gitRepository, gitBranch: x.gitBranch,
        buildPack: x.buildPack, created: true, deploymentRequested: x.deployNow
      };
    });
  }

  async function deployApplication({ connectionId, applicationUuid }) {
    const id = resourceId.parse(applicationUuid);
    const api = await getClient(connectionId);
    const apps = safeList(await api.applications(), 'Anwendungen');
    if (!apps.some(item => item.uuid === id)) throw new Error('Anwendung nicht in dieser Coolify-Verbindung gefunden.');
    const result = await api.startApplication(id);
    return { uuid: id, state: 'deployment_requested', deploymentUuid: result.deployment_uuid || null };
  }

  return { projects, applications, applicationInfo, createProject, createApplication, deployApplication };
}
