import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createBillingController } from './billing.mjs';
import { createSiteProjectService } from './site-projects.mjs';
import {
  createApplicationAnalyzer,
  inspectCompose,
  limitCompose,
  composeEnvironmentValues
} from './coolify-analyze.mjs';
import { createCoolifyDns } from './coolify-dns.mjs';
import { publicHttp, publicAddresses, maskSecrets, publicIp, redactValue } from './coolify-public-http.mjs';
import {
  planSchema,
  adoptSchema,
  executeSchema,
  resourceId,
  siteopsProjectEnsureSchema,
  projectEnsureSchema
} from './coolify-deployer-schema.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value =>
  JSON.stringify(value, (_key, item) =>
    item && !Array.isArray(item) && typeof item === 'object'
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item
  );
const parse = value => (typeof value === 'string' ? JSON.parse(value) : value);
const fail = (message, statusCode = 409) => {
  throw Object.assign(new Error(message), { statusCode });
};
const steps = ['analyze', 'plan', 'provision', 'configure', 'dns', 'deploy', 'verify', 'register'];
const secrets = x =>
  [
    ...(x.environment || []).map(e => e.value),
    ...composeEnvironmentValues(x.compose),
    x.authPassword,
    x.authPassword ? x.authUsername + ':' + x.authPassword : null
  ].filter(Boolean);
const list = (value, label) => (Array.isArray(value) ? value : fail('Ungültige Coolify-Liste: ' + label, 502));
const summary = row => ({
  id: row.id,
  connectionId: row.connection_id,
  domain: row.domain,
  state: row.state,
  resourceUuid: row.resource_uuid,
  resourceKind: row.resource_kind,
  projectUuid: row.project_uuid,
  siteopsProjectId: row.siteops_project_id,
  siteId: row.site_id,
  deploymentUuid: row.deployment_uuid,
  plan: parse(row.plan),
  progress: parse(row.progress),
  lastError: row.last_error,
  approvedAt: row.approved_at,
  expiresAt: row.expires_at,
  lastSuccessAt: row.last_success_at,
  updatedAt: row.updated_at
});

export function capabilitiesFor(version) {
  const match = /^v?(4)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(String(version));
  const modern = Boolean(match && !match[4] && Number(match[2]) >= 4);
  return {
    version,
    knownContract: Boolean(match),
    buildPacks: match ? ['dockerfile', 'dockercompose', 'nixpacks', 'static', ...(modern ? ['railpack'] : [])] : [],
    dockerImage: Boolean(match),
    inlineDockerfile: Boolean(match),
    inlineCompose: modern,
    persistentStorage: modern,
    basicAuth: modern,
    contract: modern ? 'Coolify 4.4 API' : 'Conservative legacy API; advanced features require 4.4 or later'
  };
}

export function createCoolifyDeployer({
  db,
  encrypt,
  decrypt,
  loadConnection,
  makeClient,
  allInklService,
  billingController,
  siteProjectService,
  registerWebsite,
  analyzer = createApplicationAnalyzer(),
  http = publicHttp,
  addresses = publicAddresses,
  now = () => new Date(),
  dnsService
}) {
  const dns = dnsService || createCoolifyDns({ allInklService, addresses });
  // Run DB work on the advisory-lock connection. Reserving a connection only
  // for locks while querying the pool can deadlock a small pool under load.
  const scope = new AsyncLocalStorage();
  const query = (sql, params = []) => (scope.getStore() || db).query(sql, params);
  const scopedDb = {
    query,
    getConnection: async () => {
      const active = scope.getStore();
      if (!active) return db.getConnection();
      return new Proxy(active, {
        get: (target, key) =>
          key === 'release' ? () => {} : typeof target[key] === 'function' ? target[key].bind(target) : target[key]
      });
    }
  };
  billingController ||= createBillingController({ db: scopedDb });
  siteProjectService ||= createSiteProjectService(scopedDb);
  const rows = async (sql, params = []) => (await query(sql, params))[0];
  async function row(id) {
    return (
      (await rows('SELECT * FROM coolify_deployments WHERE id=?', [zid(id)]))[0] ||
      fail('Deployment nicht gefunden.', 404)
    );
  }
  function zid(id) {
    if (!/^[a-f0-9-]{36}$/i.test(id || '')) fail('Ungültige Auftrags-ID.', 400);
    return id;
  }
  async function apiFor(id) {
    return makeClient(await loadConnection(id, scopedDb));
  }
  async function lock(key, work) {
    const inherited = scope.getStore();
    const conn = inherited || (await db.getConnection());
    const name = 'siteops:cd:' + sha(key).slice(0, 40);
    let acquired = false;
    try {
      const [[r]] = await conn.query('SELECT GET_LOCK(?, 1) AS acquired', [name]);
      if (!r?.acquired) return fail('Auftrag wird bereits bearbeitet. Später erneut prüfen.');
      acquired = true;
      return await scope.run(conn, work);
    } finally {
      try {
        if (acquired) await conn.query('SELECT RELEASE_LOCK(?)', [name]);
      } finally {
        if (!inherited) conn.release();
      }
    }
  }
  async function save(id, fields) {
    const keys = Object.keys(fields);
    await query('UPDATE coolify_deployments SET ' + keys.map(k => k + '=?').join(',') + ' WHERE id=?', [
      ...Object.values(fields),
      id
    ]);
  }
  async function siteopsProjectEnsure(raw) {
    const x = siteopsProjectEnsureSchema.parse(raw);
    return lock('siteops-project:' + x.name.toLowerCase(), async () => {
      const projects = await rows('SELECT id,name,customer_id FROM customer_projects WHERE name=?', [x.name]);
      const matches = projects.filter(p => !x.customerId || p.customer_id === x.customerId);
      if (matches.length > 1) fail('Mehrere gleichnamige SiteOps-Projekte. Kunden- oder Projekt-ID angeben.');
      if (matches.length) return { ...matches[0], created: false };
      let customerId = x.customerId;
      if (!customerId) {
        customerId = await lock('siteops-internal-customer', async () => {
          const customers = (await billingController.clients()).filter(c => c.name === 'SiteOps');
          if (customers.length > 1) fail('Interner Kunde SiteOps ist nicht eindeutig. customerId angeben.');
          return (
            customers[0]?.id ||
            (
              await billingController.createClient({
                name: 'SiteOps',
                notes: 'Interne Projekte der Coolify-Anwendungsverwaltung'
              })
            ).id
          );
        });
      }
      return { ...(await billingController.createProject({ customer_id: customerId, name: x.name })), created: true };
    });
  }
  async function projectEnsure(raw) {
    const x = projectEnsureSchema.parse(raw);
    return lock('remote-project:' + x.connectionId + ':' + x.name.toLowerCase(), async () => {
      const api = await apiFor(x.connectionId);
      const found = list(await api.projects(), 'projects').filter(
        p => String(p.name).toLowerCase() === x.name.toLowerCase()
      );
      if (found.length > 1) fail('Mehrere gleichnamige Coolify-Projekte. UUID auswählen.');
      if (found.length) return { uuid: resourceId.parse(found[0].uuid), name: found[0].name, created: false };
      const result = await api.createProject(
        x.name,
        'SiteOps/deployer/project/' + sha(x.connectionId + ':' + x.name.toLowerCase()).slice(0, 24)
      );
      return { uuid: resourceId.parse(result.uuid), name: x.name, created: true };
    });
  }
  async function capabilities(connectionId) {
    return capabilitiesFor(await (await apiFor(connectionId)).version());
  }
  async function targets(connectionId) {
    const api = await apiFor(connectionId);
    const [version, servers, projects] = await Promise.all([api.version(), api.servers(), api.projects()]);
    return {
      capabilities: capabilitiesFor(version),
      servers: list(servers, 'servers').map(s => ({
        uuid: s.uuid,
        name: String(s.name || '').slice(0, 190),
        ip: publicIp(s.ip) ? s.ip : null
      })),
      projects: list(projects, 'projects').map(p => ({ uuid: p.uuid, name: String(p.name || '').slice(0, 190) }))
    };
  }
  async function environments(connectionId, projectUuid) {
    return list(await (await apiFor(connectionId)).environments(projectUuid), 'environments').map(e => ({
      uuid: e.uuid,
      name: e.name
    }));
  }
  async function plan(raw) {
    const x = planSchema.parse(raw);
    const requestHash = sha(canonical(x));
    const prior = (await rows('SELECT * FROM coolify_deployments WHERE domain=?', [x.domain]))[0];
    if (prior && prior.state !== 'planned') {
      if (prior.connection_id !== x.connectionId || prior.config_hash !== requestHash)
        fail('Für diese Domain existiert ein anderer unveränderlicher Auftrag. Bestehenden Auftrag prüfen.');
      return summary(prior);
    }
    if (new Set(x.environment.map(e => e.key)).size !== x.environment.length)
      fail('Umgebungsvariablen sind doppelt.', 400);
    for (const path of [x.baseDirectory, x.dockerfileLocation, x.dockerComposeLocation, x.publishDirectory].filter(
      Boolean
    ))
      if (path.split('/').some(p => p === '..' || p === '.')) fail('Unsicherer Repository-Pfad.', 400);
    const connection = await loadConnection(x.connectionId),
      api = makeClient(connection);
    const inventory = await targets(x.connectionId),
      caps = inventory.capabilities;
    if (!caps.knownContract) fail('Unbekannte Coolify-Version. API-Vertrag vor Schreibzugriff prüfen.');
    const server =
      inventory.servers.find(s => s.uuid === (x.serverUuid || connection.default_server_uuid)) ||
      (!x.serverUuid && !connection.default_server_uuid && inventory.servers.length === 1
        ? inventory.servers[0]
        : null);
    if (!server?.ip) fail('Eindeutigen Zielserver mit öffentlicher IP auswählen.');
    x.serverUuid = server.uuid;
    x.serverIp = server.ip;
    x.connectionOrigin = connection.base_url;
    const risks = [],
      blocked = [];
    let analysis = null;
    if (x.sourceKind === 'git') {
      if (x.sourceType === 'public') {
        if (x.gitRepository && !x.gitRepository.startsWith('https://github.com/') && x.gitCommit && x.reviewEvidence) {
          analysis = {
            repository: x.gitRepository,
            branch: x.gitBranch || 'main',
            commit: x.gitCommit,
            risks: [
              'Öffentliche Git-Quelle außerhalb GitHub: manuell geprüfte Runtime, Lizenz, Ports, Persistenz und Schutzmaßnahmen erforderlich.'
            ],
            blocked: [],
            suitability: 'review_required',
            evidence: [{ url: x.gitRepository, kind: 'explicit-reviewed-repository', commit: x.gitCommit }]
          };
        } else
          analysis = await analyzer.analyze({
            url: x.url || x.gitRepository,
            branch: x.gitBranch,
            baseDirectory: x.baseDirectory,
            dockerfileLocation: x.dockerfileLocation,
            dockerComposeLocation: x.dockerComposeLocation
          });
        if (!analysis.repository)
          fail(
            'Quellenzuordnung ist unsicher. Repository-Kandidaten über coolify_app_analyze prüfen und nach ausdrücklicher Freigabe eine konkrete Repository-URL planen.'
          );
        if (analysis.suitability === 'unsupported') blocked.push(...analysis.blocked);
        risks.push(...analysis.risks);
        x.gitRepository = analysis.repository;
        x.gitBranch ||= analysis.branch;
        x.gitCommit = analysis.commit;
        if (x.buildPack === 'auto') x.buildPack = analysis.buildPack || 'auto';
        x.containerPort ||= analysis.ports?.[0];
        if (x.buildPack === 'static') {
          x.containerPort ||= 80;
          x.publishDirectory ||= '/';
        }
        if (!x.composeService && analysis.composeServices?.length === 1) x.composeService = analysis.composeServices[0];
        if (!x.containerPort && x.composeService) {
          const candidate = analysis.composePorts?.find(p => p.service === x.composeService);
          if (candidate && /^\d+$/.test(candidate.port)) x.containerPort = Number(candidate.port);
        }
        x.dockerfileLocation ||= analysis.dockerfileLocation || undefined;
        x.dockerComposeLocation ||= analysis.dockerComposeLocation || undefined;
        const missing = (analysis.environmentKeys || []).filter(key => !x.environment.some(e => e.key === key));
        if (missing.length) risks.push('Erkannte Variablen prüfen/ergänzen: ' + missing.join(', '));
      } else {
        if (!x.sourceUuid || !x.gitRepository || !x.gitCommit)
          fail('Private Quellen benötigen Integrations-UUID, Repository und geprüften Commit-SHA.');
        const sources = x.sourceType === 'private-github-app' ? await api.githubApps() : await api.privateKeys();
        if (!list(sources, 'sources').some(s => s.uuid === x.sourceUuid))
          fail('Git-Integration gehört nicht zu dieser Coolify-Verbindung.');
        risks.push('Private Quelle: README, Lizenz und Build-Dateien anhand des angegebenen Commits explizit prüfen.');
      }
      if (
        !/^https:\/\/[a-zA-Z0-9.-]+\/[\w./-]+$/.test(x.gitRepository || '') &&
        !/^git@[a-zA-Z0-9.-]+:[\w./-]+$/.test(x.gitRepository || '')
      )
        fail('Repository-Adresse enthält ungültige oder sensible Bestandteile.');
      if (!caps.buildPacks.includes(x.buildPack))
        fail(
          'Build-Methode konnte nicht sicher erkannt werden oder wird von dieser Coolify-Version nicht unterstützt.'
        );
    } else if (x.sourceKind === 'image') {
      if (!x.image) fail('Docker-Image fehlt.', 400);
      if (x.image.includes('@')) {
        if (!/^[\w./:-]+@sha256:[a-f0-9]{64}$/.test(x.image))
          fail('Docker-Image-Digest muss ein vollständiger sha256-Digest sein.');
        x.imageTag = null;
      } else {
        const lastColon = x.image.lastIndexOf(':');
        if (lastColon > x.image.lastIndexOf('/')) {
          const tag = x.image.slice(lastColon + 1);
          if (x.imageTag !== 'latest' && x.imageTag !== tag)
            fail('Image-Referenz und separates Tag widersprechen sich.');
          x.imageTag = tag;
          x.image = x.image.slice(0, lastColon);
        }
      }
      x.buildPack = 'dockerimage';
      risks.push('Image-Herkunft und Version prüfen; möglichst unveränderlichen Digest verwenden.');
    } else if (x.sourceKind === 'dockerfile') {
      if (!x.dockerfile) fail('Dockerfile fehlt.', 400);
      x.buildPack = 'dockerfile';
      risks.push('Experimentelles Dockerfile ohne Repository: Runtime, Lizenz und Build manuell prüfen.');
    } else {
      if (!x.compose || !caps.inlineCompose)
        fail('Freier Compose-Inhalt benötigt die verifizierte Coolify-4.4-Service-API.');
      const compose = inspectCompose(x.compose);
      blocked.push(...compose.blocked);
      risks.push(...compose.risks, 'Freie Compose-Konfiguration und Image-Herkunft explizit prüfen.');
      if (/^\s*(?:build|env_file|extends)\s*:/m.test(x.compose))
        blocked.push('Freies Compose muss ohne lokale Build-Kontexte oder externe Dateien auskommen.');
      if (!x.composeService || !compose.services.includes(x.composeService))
        fail('Öffentlichen Compose-Dienst auswählen.');
      if (x.volumes.length) fail('Persistenz für freie Compose-Stacks ausschließlich in Compose definieren.');
      if (x.access !== 'application')
        blocked.push(
          'Compose-Services benötigen nachgewiesenen vorgeschalteten oder eigenen Zugriffsschutz in der Compose-Konfiguration.'
        );
      x.compose = limitCompose(x.compose, x);
      x.buildPack = 'dockercompose';
    }
    if (blocked.length) fail('Deployment nicht freigegeben: ' + blocked.join(' '));
    if (!x.containerPort) fail('Internen Anwendungsport aus Installationsanleitung oder Docker-Konfiguration angeben.');
    if (x.buildPack === 'dockercompose' && !x.composeService) fail('Bei Compose den öffentlichen Dienst auswählen.');
    if (x.buildPack === 'dockercompose' && x.volumes.length)
      fail('Persistente Volumes für Compose in der Compose-Datei definieren.');
    if (x.buildPack === 'dockercompose' && x.access !== 'application')
      fail('Compose benötigt nachgewiesene Authentifizierung in der Anwendung oder im vorgeschalteten Compose-Dienst.');
    if (x.sourceKind === 'git' && x.buildPack === 'dockercompose') {
      if (x.sourceType !== 'public' && x.compose) {
        const reviewed = inspectCompose(x.compose);
        if (reviewed.blocked.length) fail(reviewed.blocked.join(' '));
      }
      const composition =
        x.sourceType === 'public' ? analysis : x.compose ? { composeLimits: inspectCompose(x.compose).limits } : null;
      if (!composition?.composeLimits?.length)
        fail(
          'Für Git-Compose müssen die geprüften Dienstlimits aus der Compose-Datei bekannt sein. Private Quellen benötigen zusätzlich den geprüften Compose-Inhalt.'
        );
      for (const limit of composition.composeLimits) {
        const memory = /^(\d+(?:\.\d+)?)\s*([kmg])(?:i?b)?$/i.exec(String(limit.memory || ''));
        const mb = memory
          ? Number(memory[1]) * { k: 1 / 1024, m: 1, g: 1024 }[memory[2].toLowerCase()]
          : Number(limit.memory) / 1048576;
        if (!mb || mb > x.memoryMb || !Number(limit.cpus) || Number(limit.cpus) > x.cpus)
          fail(
            'Git-Compose benötigt pro Dienst belegte mem_limit/cpus innerhalb der gewählten Limits. Repository-Konfiguration prüfen; Coolify überschreibt diese Datei beim Git-Build.'
          );
      }
    }
    if (x.gitRepository && x.gitRepository.length > 255)
      fail('Repository-Adresse überschreitet die unterstützte Website-Feldlänge von 255 Zeichen.');
    if (x.gitRepository) {
      const host = x.gitRepository.startsWith('git@')
        ? x.gitRepository.slice(4).split(':')[0]
        : new URL(x.gitRepository).hostname;
      await addresses(host);
    }
    if (x.sourceKind === 'image') {
      const registry = x.image.split('/')[0];
      if (registry.includes('.') || registry.includes(':')) await addresses(registry.split(':')[0]);
    }
    if (x.access === 'basic' && (!caps.basicAuth || !x.authUsername || !x.authPassword))
      fail(
        'Basic-Zugriffsschutz benötigt Benutzer/Passwort und Coolify ab 4.4. Alternativ geprüfte Anwendungsanmeldung konfigurieren.'
      );
    if (x.access === 'application' && !x.applicationAuthEvidence)
      fail('Anwendungseigene Authentifizierung mit nachvollziehbarem Nachweis konfigurieren.');
    if (
      x.access === 'public-static' &&
      (x.sourceKind !== 'git' ||
        x.sourceType !== 'public' ||
        x.buildPack !== 'static' ||
        analysis?.applicationType !== 'static-web')
    )
      fail(
        'Öffentliche Bereitstellung ohne Anmeldung ist nur für nachgewiesene statische Dateien ohne Backend möglich.'
      );
    if (x.access === 'application')
      risks.push(
        'Anwendungseigenen Zugriffsschutz einschließlich aller API-/Agent-Routen prüfen: ' + x.applicationAuthEvidence
      );
    if (x.volumes.length && !caps.persistentStorage)
      fail('Persistente Volumes benötigen den verifizierten Storage-API-Vertrag ab Coolify 4.4.');
    if (!x.reviewEvidence)
      risks.push('Quellcode-/Image-Sicherheitsprüfung muss vor Ausführung ausdrücklich bestätigt werden.');
    const remoteProjects = inventory.projects.filter(p =>
      x.coolifyProjectUuid
        ? p.uuid === x.coolifyProjectUuid
        : p.name.toLowerCase() === (x.coolifyProjectName || x.projectName).toLowerCase()
    );
    if (remoteProjects.length > 1 || (x.coolifyProjectUuid && !remoteProjects.length))
      fail('Coolify-Projekt nicht eindeutig vorhanden.');
    x.coolifyProjectUuid ||= remoteProjects[0]?.uuid;
    if (x.siteopsProjectId) {
      if (!(await rows('SELECT id FROM customer_projects WHERE id=?', [x.siteopsProjectId])).length)
        fail('SiteOps-Projekt fehlt.');
    } else {
      const projects = (
        await rows('SELECT id,name,customer_id FROM customer_projects WHERE name=?', [x.projectName])
      ).filter(p => !x.customerId || p.customer_id === x.customerId);
      if (projects.length > 1) fail('SiteOps-Projektname ist nicht eindeutig; siteopsProjectId angeben.');
      x.siteopsProjectId = projects[0]?.id;
    }
    const dnsPlan = await dns.inspect({ domain: x.domain, serverIp: server.ip, accountId: x.allinklAccountId });
    x.allinklAccountId = dnsPlan.accountId;
    const safePlan = {
      name: x.name,
      domain: x.domain,
      sourceKind: x.sourceKind,
      repository: x.gitRepository || null,
      branch: x.gitBranch || null,
      commit: x.gitCommit || null,
      image: x.image || null,
      imageTag: x.imageTag || null,
      buildPack: x.buildPack,
      serverUuid: x.serverUuid,
      serverIp: server.ip,
      connectionOrigin: connection.base_url,
      projectName: x.projectName,
      coolifyProjectName: x.coolifyProjectName || x.projectName,
      environmentName: x.environmentName,
      containerPort: x.containerPort,
      composeService: x.composeService || null,
      access: x.access,
      volumes: x.volumes,
      environmentKeys: x.environment.map(e => e.key),
      resources: { memoryMb: x.memoryMb, cpus: x.cpus, diskEstimateMb: x.diskMb },
      health: { path: x.healthPath, status: x.healthStatus, textConfigured: Boolean(x.healthText) },
      contentSha256: x.compose || x.dockerfile ? sha(x.compose || x.dockerfile) : null,
      dns: dnsPlan,
      risks,
      requiresRiskApproval: risks.length > 0,
      experimental: x.sourceKind === 'dockerfile',
      analysis,
      capabilities: caps,
      steps
    };
    return lock('domain:' + x.domain, async () => {
      const existing = (await rows('SELECT * FROM coolify_deployments WHERE domain=?', [x.domain]))[0];
      const hash = requestHash;
      if (existing) {
        if (existing.config_hash !== hash || existing.connection_id !== x.connectionId)
          fail('Für diese Domain existiert ein anderer unveränderlicher Auftrag. Bestehenden Auftrag prüfen.');
        if (existing.state === 'planned')
          await save(existing.id, {
            encrypted_config: encrypt(x),
            plan: JSON.stringify(redactValue(safePlan, secrets(x))),
            expires_at: new Date(now().getTime() + 3600000)
          });
        return summary(await row(existing.id));
      }
      if ((await rows('SELECT id FROM sites WHERE domain=?', [x.domain])).length)
        fail('Die Domain gehört bereits zu einer SiteOps-Website. Keine Übernahme.');
      const id = randomUUID();
      const progress = Object.fromEntries(
        steps.map(s => [s, { state: ['analyze', 'plan'].includes(s) ? 'done' : 'pending' }])
      );
      await query(
        'INSERT INTO coolify_deployments(id,connection_id,domain,config_hash,encrypted_config,plan,progress,resource_kind,expires_at) VALUES(?,?,?,?,?,?,?,?,?)',
        [
          id,
          x.connectionId,
          x.domain,
          hash,
          encrypt(x),
          JSON.stringify(redactValue(safePlan, secrets(x))),
          JSON.stringify(progress),
          x.sourceKind === 'compose' ? 'service' : 'application',
          new Date(now().getTime() + 3600000)
        ]
      );
      return summary(await row(id));
    });
  }
  async function execute(raw) {
    const x = executeSchema.parse(raw);
    return lock('run:' + x.id, async () => {
      const current = await row(x.id),
        p = parse(current.plan);
      if (['online', 'queued', 'running', 'verifying'].includes(current.state)) return summary(current);
      if (!current.approved_at && new Date(current.expires_at) <= now())
        fail('Plan abgelaufen. Vor Freigabe erneut planen.');
      if (p.requiresRiskApproval && (!x.approveRisks || !x.riskAcknowledgement))
        fail('Risiken erfordern eine ausdrückliche Freigabe und Beschreibung der geprüften Schutzmaßnahmen.');
      const progress = parse(current.progress);
      // A failed deployment can be retried explicitly. Ambiguous writes stay
      // reconcilable and must never issue a second blind start request.
      if (progress.verify?.state === 'failed') progress.verify = { state: 'pending' };
      if (current.deployment_uuid) {
        const deployment = await (await apiFor(current.connection_id)).deployment(current.deployment_uuid);
        if (/failed|cancelled/.test(deployment.status || '')) {
          progress.deploy = { state: 'pending' };
          progress.verify = { state: 'pending' };
          await save(current.id, { deployment_uuid: null, deploy_requested_at: null });
        }
      }
      progress.approval = {
        at: now().toISOString(),
        risksAccepted: x.approveRisks,
        acknowledgement: maskSecrets(x.riskAcknowledgement || '', secrets(decrypt(current.encrypted_config))).slice(
          0,
          1000
        )
      };
      await save(current.id, {
        state: 'queued',
        approved_at: current.approved_at || now(),
        last_error: null,
        progress: JSON.stringify(progress)
      });
      return summary(await row(current.id));
    });
  }
  async function ownedResource(api, current) {
    const getter = current.resource_kind === 'service' ? api.service : api.application;
    const remote = await getter(current.resource_uuid);
    if (remote.description !== 'SiteOps/deployment/' + current.id)
      fail('Remote-Ressource gehört nicht eindeutig zu diesem SiteOps-Auftrag. Keine Änderung.');
    const x = decrypt(current.encrypted_config);
    if (x.sourceKind === 'git') {
      const normalize = value =>
        String(value)
          .replace(/^git@([^:]+):/, 'https://$1/')
          .replace(/\.git\/?$/, '')
          .replace(/\/$/, '')
          .replace(/^https:\/\/github.com\//, '');
      if (
        (remote.git_repository && normalize(remote.git_repository) !== normalize(x.gitRepository)) ||
        (remote.git_commit_sha && remote.git_commit_sha !== x.gitCommit) ||
        (remote.git_branch && remote.git_branch !== x.gitBranch)
      )
        fail(
          'Repository, Branch oder fixierter Commit wurde außerhalb des Plans geändert. Keine automatische Ausführung.'
        );
    }
    return remote;
  }
  async function provision(api, current, x) {
    if (!current.siteops_project_id) {
      const project = x.siteopsProjectId
        ? { id: x.siteopsProjectId }
        : await siteopsProjectEnsure({ name: x.projectName, customerId: x.customerId });
      await save(current.id, { siteops_project_id: project.id });
      current.siteops_project_id = project.id;
    }
    if (!current.project_uuid) {
      const project = x.coolifyProjectUuid
        ? { uuid: x.coolifyProjectUuid }
        : await projectEnsure({ connectionId: x.connectionId, name: x.coolifyProjectName || x.projectName });
      await save(current.id, { project_uuid: project.uuid });
      current.project_uuid = project.uuid;
    }
    const envs = list(await api.environments(current.project_uuid), 'environments');
    if (!envs.some(e => e.name === x.environmentName))
      await lock('environment:' + current.project_uuid + ':' + x.environmentName, async () => {
        if (!list(await api.environments(current.project_uuid), 'environments').some(e => e.name === x.environmentName))
          await api.createEnvironment(current.project_uuid, x.environmentName);
      });
    if (current.resource_uuid) return ownedResource(api, current);
    const marker = 'SiteOps/deployment/' + current.id;
    const inventory = list(
      await (current.resource_kind === 'service' ? api.services() : api.applications()),
      'resources'
    );
    const own = inventory.filter(a => a.description === marker);
    if (own.length > 1 || inventory.some(a => a.name === x.name && a.description !== marker))
      fail('Konflikt mit einer vorhandenen Anwendung. Keine Übernahme/Änderung.');
    let remote = own[0];
    if (!remote) {
      const payload = {
        project_uuid: current.project_uuid,
        server_uuid: x.serverUuid,
        environment_name: x.environmentName,
        name: x.name,
        description: marker,
        instant_deploy: false,
        force_domain_override: false,
        ...(x.destinationUuid ? { destination_uuid: x.destinationUuid } : {})
      };
      if (x.sourceKind === 'compose')
        remote = await api.createService({
          ...payload,
          docker_compose_raw: Buffer.from(x.compose).toString('base64'),
          connect_to_docker_network: false
        });
      else {
        const kind = x.sourceKind === 'git' ? x.sourceType : x.sourceKind === 'image' ? 'dockerimage' : 'dockerfile';
        Object.assign(payload, {
          ports_exposes: String(x.containerPort),
          is_auto_deploy_enabled: false,
          autogenerate_domain: false
        });
        if (x.sourceKind === 'git')
          Object.assign(payload, {
            git_repository: x.gitRepository,
            git_branch: x.gitBranch || 'main',
            git_commit_sha: x.gitCommit,
            build_pack: x.buildPack,
            base_directory: x.baseDirectory,
            ...(x.publishDirectory ? { publish_directory: x.publishDirectory } : {}),
            ...(x.dockerfileLocation ? { dockerfile_location: x.dockerfileLocation } : {}),
            ...(x.dockerComposeLocation ? { docker_compose_location: x.dockerComposeLocation } : {}),
            ...(x.sourceType === 'private-github-app' ? { github_app_uuid: x.sourceUuid } : {}),
            ...(x.sourceType === 'private-deploy-key' ? { private_key_uuid: x.sourceUuid } : {})
          });
        else if (x.sourceKind === 'image')
          Object.assign(payload, {
            docker_registry_image_name: x.image,
            ...(x.imageTag ? { docker_registry_image_tag: x.imageTag } : {})
          });
        else payload.dockerfile = Buffer.from(x.dockerfile).toString('base64');
        remote = await api.createApplication(kind, payload);
      }
    }
    current.resource_uuid = resourceId.parse(remote.uuid);
    await save(current.id, { resource_uuid: current.resource_uuid });
    return ownedResource(api, current);
  }
  async function configure(api, current, x) {
    await ownedResource(api, current);
    const env = x.environment.map(e => ({
      key: e.key,
      value: e.value,
      is_preview: false,
      is_literal: true,
      is_multiline: e.value.includes('\n'),
      is_buildtime: e.buildTime,
      is_runtime: true
    }));
    if (current.resource_kind === 'service') {
      if (env.length)
        await api.setServiceEnvs(
          current.resource_uuid,
          env.map(({ key, value, is_literal, is_multiline }) => ({ key, value, is_literal, is_multiline }))
        );
      await api.updateService(current.resource_uuid, {
        urls: [{ name: x.composeService, url: 'https://' + x.domain + ':' + x.containerPort }],
        force_domain_override: false
      });
      return;
    }
    if (env.length) await api.setApplicationEnvs(current.resource_uuid, env);
    const config = {
      ports_exposes: String(x.containerPort),
      is_auto_deploy_enabled: false,
      is_force_https_enabled: true,
      health_check_enabled: true,
      health_check_path: x.healthPath,
      health_check_port: String(x.containerPort),
      health_check_method: 'GET',
      health_check_scheme: 'http',
      health_check_return_code: x.healthStatus,
      ...(x.healthText ? { health_check_response_text: x.healthText } : {}),
      limits_memory: x.memoryMb + 'M',
      limits_cpus: String(x.cpus),
      force_domain_override: false,
      ...(x.access === 'basic'
        ? {
            is_http_basic_auth_enabled: true,
            http_basic_auth_username: x.authUsername,
            http_basic_auth_password: x.authPassword
          }
        : {})
    };
    if (x.buildPack === 'dockercompose')
      config.docker_compose_domains = [
        { name: x.composeService, domain: 'https://' + x.domain + ':' + x.containerPort }
      ];
    else config.domains = 'https://' + x.domain;
    await api.updateApplication(current.resource_uuid, config);
    if (x.volumes.length) {
      const storage = await api.applicationStorages(current.resource_uuid);
      const existing = storage.persistent_storages || storage;
      for (const volume of x.volumes) {
        const found = list(existing, 'storage').filter(s => s.mount_path === volume.mountPath);
        if (found.some(s => s.name !== current.resource_uuid + '-' + volume.name && s.name !== volume.name))
          fail('Vorhandenes Volume mit anderem Namen/Pfad. Keine Änderung.');
        if (!found.length)
          await api.createApplicationStorage(current.resource_uuid, {
            type: 'persistent',
            name: volume.name,
            mount_path: volume.mountPath
          });
      }
    }
  }
  async function deploy(api, current) {
    await ownedResource(api, current);
    if (current.deploy_requested_at) {
      if (current.resource_kind === 'service') return; // no deployment queue UUID for services
      if (current.deployment_uuid) return;
      const result = await api.applicationDeployments(current.resource_uuid);
      const recent = list(result.deployments || result, 'deployments').filter(
        d => new Date(d.created_at) >= new Date(current.deploy_requested_at)
      );
      if (recent.length !== 1)
        fail(
          'Startauftrag hat ein ungewisses Ergebnis. Deployment-Historie in Coolify prüfen; kein zweiter Start wird automatisch ausgelöst.'
        );
      current.deployment_uuid = resourceId.parse(recent[0].deployment_uuid || recent[0].uuid);
      await save(current.id, { deployment_uuid: current.deployment_uuid });
      return;
    }
    current.deploy_requested_at = now();
    await save(current.id, { deploy_requested_at: current.deploy_requested_at });
    const result = await (current.resource_kind === 'service'
      ? api.startService(current.resource_uuid)
      : api.startApplication(current.resource_uuid));
    if (result.deployment_uuid) {
      current.deployment_uuid = resourceId.parse(result.deployment_uuid);
      await save(current.id, { deployment_uuid: current.deployment_uuid });
    } else if (current.resource_kind === 'application') return deploy(api, current);
  }
  async function verify(api, current, x) {
    // Übernommene Anwendungen tragen keine SiteOps-Kennung und haben keinen SiteOps-Build:
    // Es zählen Existenz in Coolify, DNS und der HTTPS-Health-Check.
    const remote = x.adopted ? await api.application(current.resource_uuid) : await ownedResource(api, current);
    if (x.adopted) {
      if (!remote?.uuid && !remote?.name) fail('Übernommene Anwendung ist in Coolify nicht mehr vorhanden.', 404);
    } else if (current.resource_kind === 'application') {
      if (!current.deployment_uuid) fail('Deployment-UUID für Verifizierung fehlt.');
      const deployment = await api.deployment(current.deployment_uuid);
      if (deployment.application_uuid && deployment.application_uuid !== current.resource_uuid)
        fail('Deployment gehört zu einer anderen Anwendung.');
      if (/failed|cancelled/.test(deployment.status || ''))
        fail('Coolify-Bereitstellung fehlgeschlagen: ' + deployment.status);
      if (deployment.status !== 'finished') return { ok: false, waiting: 'Coolify-Build läuft.' };
      if (!/^running(?::healthy)?$/.test(remote.status || ''))
        return { ok: false, waiting: 'Coolify bestätigt noch keinen gesunden Anwendungszustand.' };
    } else {
      const apps = list(remote.applications, 'service applications');
      const selected = apps.find(a => a.name === x.composeService);
      const observedAt = Math.max(
        ...[remote, ...apps, ...(remote.databases || [])]
          .map(r => new Date(r.updated_at).getTime())
          .filter(Number.isFinite)
      );
      if (
        !selected ||
        selected.status !== 'running:healthy' ||
        remote.status !== 'running:healthy' ||
        !Number.isFinite(observedAt) ||
        observedAt < new Date(current.deploy_requested_at).getTime()
      )
        return {
          ok: false,
          waiting:
            'Coolify-Service bestätigt noch keinen aktuellen gesunden Zustand. Zeitstempel und Health-Checks aller Dienste prüfen.'
        };
    }
    const expectedIp = x.serverIp;
    const resolved = await addresses(x.domain);
    if (!resolved.every(r => r.address === expectedIp))
      return { ok: false, waiting: 'DNS ist noch nicht vollständig auf den Zielserver verteilt.' };
    const headers =
      x.access === 'basic'
        ? { Authorization: 'Basic ' + Buffer.from(x.authUsername + ':' + x.authPassword).toString('base64') }
        : {};
    const result = await http('https://' + x.domain + x.healthPath, { headers, maxBytes: 1_000_000, redirects: 0 });
    if (result.status !== x.healthStatus || (x.healthText && !result.body.includes(x.healthText)))
      return { ok: false, waiting: 'HTTPS-Health-Check noch nicht bestanden.' };
    if (x.access === 'basic') {
      const anonymous = await http('https://' + x.domain + x.healthPath, { redirects: 0 });
      if (anonymous.status !== 401) fail('Vorgeschalteter Zugriffsschutz ist nicht wirksam.');
    }
    return { ok: true, dns: true, tls: true, httpsStatus: result.status, at: now().toISOString() };
  }
  async function process(id) {
    return lock('run:' + id, async () => {
      const current = await row(id);
      if (!current.approved_at || !['queued', 'running', 'verifying'].includes(current.state)) return summary(current);
      const x = decrypt(current.encrypted_config),
        api = await apiFor(x.connectionId),
        progress = parse(current.progress);
      let step = 'provision';
      await save(id, { state: 'running' });
      try {
        const savedConnection = await loadConnection(x.connectionId, scopedDb);
        if (savedConnection.base_url !== x.connectionOrigin)
          fail('Coolify-Adresse hat sich seit der Planung geändert. Keine Ausführung.');
        for (step of steps.slice(2)) {
          if (progress[step]?.state === 'done') continue;
          progress[step] = {
            ...progress[step],
            state: 'running',
            startedAt: progress[step]?.startedAt || now().toISOString()
          };
          await save(id, { progress: JSON.stringify(progress) });
          let result;
          if (step === 'provision') await provision(api, current, x);
          if (step === 'configure') await configure(api, current, x);
          if (step === 'dns') {
            const server = list(await api.servers(), 'servers').find(s => s.uuid === x.serverUuid);
            if (server?.ip !== x.serverIp) fail('Server-IP hat sich seit der Planung geändert. Keine DNS-Änderung.');
            result = await lock('dns:' + x.domain, () =>
              dns.ensure({ domain: x.domain, serverIp: server.ip, accountId: x.allinklAccountId })
            );
          }
          if (step === 'deploy') await deploy(api, current);
          if (step === 'verify') {
            if (now().getTime() - new Date(progress.verify.startedAt).getTime() > 45 * 60 * 1000)
              fail(
                'Verifizierung nach 45 Minuten abgebrochen. DNS, Zertifikat, Build und Health-Check prüfen; Auftrag fortsetzen.'
              );
            try {
              result = await verify(api, current, x);
            } catch (error) {
              if (/HTTPS|DNS/.test(error.message))
                result = { ok: false, waiting: 'DNS/TLS/HTTPS noch nicht verfügbar.' };
              else throw error;
            }
            if (!result.ok) {
              progress.verify = { ...progress.verify, state: 'waiting', detail: result.waiting };
              await save(id, { state: 'verifying', progress: JSON.stringify(progress) });
              return summary(await row(id));
            }
          }
          if (step === 'register') {
            // Verification is journalled before registration. Recheck on resumed registration.
            const verified = await verify(api, current, x);
            if (!verified.ok) fail('Anwendung vor Website-Registrierung nicht mehr verifiziert.');
            const site = await registerWebsite({ deployment: current, config: x, database: scopedDb });
            await save(id, { site_id: site.id });
            current.site_id = site.id;
            await siteProjectService.link(site.id, { project_id: current.siteops_project_id });
          }
          progress[step] = {
            ...progress[step],
            state: 'done',
            completedAt: now().toISOString(),
            ...(result ? { result } : {})
          };
          await save(id, { progress: JSON.stringify(progress) });
        }
        await save(id, { state: 'online', last_error: null, last_success_at: now() });
        await query(
          "UPDATE sites SET deployment_status='online',last_deployed_at=? WHERE id=? AND coolify_deployment_id=?",
          [now(), current.site_id, current.id]
        );
      } catch (error) {
        const detail = maskSecrets(error.message || 'Bereitstellung fehlgeschlagen.', secrets(x)).slice(0, 430);
        progress[step] = { ...progress[step], state: 'failed', error: detail };
        await save(id, {
          state: 'needs_attention',
          last_error: step + ': ' + detail,
          progress: JSON.stringify(progress)
        });
        if (current.site_id)
          await query("UPDATE sites SET deployment_status='needs_attention' WHERE id=? AND coolify_deployment_id=?", [
            current.site_id,
            current.id
          ]);
      }
      return summary(await row(id));
    });
  }
  async function logs(id, lines = 100, service) {
    const current = await row(id),
      x = decrypt(current.encrypted_config),
      api = await apiFor(current.connection_id);
    if (!current.resource_uuid) fail('Anwendung noch nicht angelegt.');
    const remote = await ownedResource(api, current);
    const count = Math.min(500, Math.max(1, Number(lines) || 100));
    const result =
      current.resource_kind === 'service'
        ? await api.serviceLogs(current.resource_uuid, { lines: count, sub_service_name: service || x.composeService })
        : await api.applicationLogs(current.resource_uuid, { lines: count });
    const output = maskSecrets(typeof result === 'string' ? result : JSON.stringify(result), secrets(x));
    // Avoid returning remote env/config from either API response.
    return { id, resourceUuid: remote.uuid, output: output.slice(-64000) };
  }
  async function redeploy(raw) {
    const x = executeSchema.parse(raw);
    return lock('run:' + x.id, async () => {
      const current = await row(x.id);
      if (current.state !== 'online')
        fail('Redeployment nur für abgeschlossene Aufträge; unterbrochene Aufträge fortsetzen.');
      if (parse(current.plan).requiresRiskApproval && (!x.approveRisks || !x.riskAcknowledgement))
        fail('Risiken des bestehenden Plans ausdrücklich bestätigen.');
      const progress = parse(current.progress);
      for (const step of ['deploy', 'verify', 'register']) progress[step] = { state: 'pending' };
      await save(x.id, {
        state: 'queued',
        progress: JSON.stringify(progress),
        deployment_uuid: null,
        deploy_requested_at: null,
        last_error: null
      });
      if (current.site_id)
        await query("UPDATE sites SET deployment_status='deploying' WHERE id=? AND coolify_deployment_id=?", [
          current.site_id,
          current.id
        ]);
      return summary(await row(x.id));
    });
  }
  async function deploymentStatus(id) {
    const current = await row(id);
    if (!current.deployment_uuid) return { id, state: current.state, deploymentUuid: null };
    const result = await (await apiFor(current.connection_id)).deployment(current.deployment_uuid);
    return {
      id,
      deploymentUuid: current.deployment_uuid,
      status: String(result.status || '').slice(0, 80),
      createdAt: result.created_at,
      updatedAt: result.updated_at
    };
  }
  async function adopt(raw) {
    const x0 = adoptSchema.parse(raw);
    return lock('adopt:' + x0.domain, async () => {
      const existing = await rows('SELECT * FROM coolify_deployments WHERE domain=?', [x0.domain]);
      if (existing.length) {
        const prior = existing[0];
        const cfg = decrypt(prior.encrypted_config);
        if (cfg.adopted && prior.resource_uuid === x0.applicationUuid && prior.connection_id === x0.connectionId)
          return summary(prior);
        fail('Für diese Domain gibt es bereits einen SiteOps-Auftrag. Keine Übernahme.');
      }
      if ((await rows('SELECT id FROM sites WHERE domain=?', [x0.domain])).length)
        fail('Domain gehört bereits zu einer anderen Website.');
      const connection = await loadConnection(x0.connectionId, scopedDb);
      const api = await apiFor(x0.connectionId);
      const remote = await api.application(x0.applicationUuid);
      if (!remote || remote.uuid !== x0.applicationUuid)
        fail('Anwendung nicht in dieser Coolify-Verbindung gefunden.', 404);
      let projectId = x0.siteopsProjectId;
      if (projectId) {
        if (!(await rows('SELECT id FROM customer_projects WHERE id=?', [projectId])).length)
          fail('SiteOps-Projekt nicht gefunden.', 404);
      } else projectId = (await siteopsProjectEnsure({ name: x0.projectName })).id;
      // Die Domain muss schon heute korrekt antworten, sonst wäre die Übernahme ungeprüft.
      const resolved = await addresses(x0.domain);
      if (!resolved.length || !resolved.every(r => r.address === resolved[0].address))
        fail('DNS der Domain ist nicht eindeutig aufgelöst. Keine Übernahme.');
      const result = await http('https://' + x0.domain + x0.healthPath, { maxBytes: 1_000_000, redirects: 0 });
      if (result.status !== x0.healthStatus || (x0.healthText && !result.body.includes(x0.healthText)))
        fail(
          'HTTPS-Health-Check nicht bestanden (Status ' +
            result.status +
            '). healthPath/healthStatus prüfen, z. B. /up bei Laravel.'
        );
      const x = {
        adopted: true,
        connectionId: x0.connectionId,
        connectionOrigin: connection.base_url,
        name: x0.name,
        domain: x0.domain,
        healthPath: x0.healthPath,
        healthStatus: x0.healthStatus,
        healthText: x0.healthText,
        access: 'application',
        serverIp: resolved[0].address,
        gitRepository: remote.git_repository || null,
        gitBranch: remote.git_branch || null,
        buildPack: remote.build_pack || null
      };
      const id = randomUUID();
      await query(
        'INSERT INTO coolify_deployments(id,connection_id,domain,config_hash,encrypted_config,plan,progress,resource_kind,expires_at) VALUES(?,?,?,?,?,?,?,?,?)',
        [
          id,
          x.connectionId,
          x.domain,
          sha(JSON.stringify(x)),
          encrypt(x),
          JSON.stringify({ adopted: true, applicationUuid: x0.applicationUuid }),
          JSON.stringify({ register: { state: 'running' } }),
          'application',
          new Date(now().getTime() + 3600000)
        ]
      );
      const at = now();
      await save(id, {
        state: 'online',
        resource_uuid: x0.applicationUuid,
        siteops_project_id: projectId,
        approved_at: at,
        last_success_at: at
      });
      const current = await row(id);
      const site = await registerWebsite({ deployment: current, config: x, database: scopedDb });
      await save(id, {
        site_id: site.id,
        progress: JSON.stringify({ register: { state: 'done', completedAt: at.toISOString() } })
      });
      await siteProjectService.link(site.id, { project_id: projectId });
      await query(
        "UPDATE sites SET deployment_status='online',last_deployed_at=? WHERE id=? AND coolify_deployment_id=?",
        [at, site.id, id]
      );
      return { ...summary(await row(id)), siteId: site.id, adopted: true };
    });
  }
  async function verifyNow(id) {
    const current = await row(id);
    if (!current.resource_uuid || !current.approved_at) fail('Noch keine freigegebene Anwendung vorhanden.');
    return verify(await apiFor(current.connection_id), current, decrypt(current.encrypted_config));
  }
  let ticking = false;
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const pending = await rows(
        "SELECT id FROM coolify_deployments WHERE state IN ('queued','running','verifying') ORDER BY updated_at LIMIT 5"
      );
      for (const item of pending) {
        try {
          await process(item.id);
        } catch {
          /* another worker or unavailable DB; journal retained */
        }
      }
    } finally {
      ticking = false;
    }
  }
  function startWorker() {
    tick().catch(() => console.error('Coolify deployer: Datenbank nicht verfügbar.'));
    setInterval(() => tick().catch(() => console.error('Coolify deployer: Datenbank nicht verfügbar.')), 15000).unref();
  }
  return {
    analyze: analyzer.analyze,
    plan,
    execute,
    process,
    targets,
    environments,
    capabilities,
    projectEnsure,
    siteopsProjectEnsure,
    get: async id => summary(await row(id)),
    list: async () => (await rows('SELECT * FROM coolify_deployments ORDER BY updated_at DESC LIMIT 200')).map(summary),
    maskApplicationLogs: async (connectionId, applicationUuid, value) => {
      const managed = await rows(
        'SELECT encrypted_config FROM coolify_deployments WHERE connection_id=? AND resource_uuid=?',
        [connectionId, applicationUuid]
      );
      return redactValue(
        value,
        managed.flatMap(r => secrets(decrypt(r.encrypted_config)))
      );
    },
    logs,
    redeploy,
    deploymentStatus,
    verify: verifyNow,
    adopt,
    ensureDns: async id => {
      const current = await row(id);
      if (!current.approved_at) fail('DNS-Schreibzugriff benötigt einen freigegebenen Deployment-Plan.');
      const x = decrypt(current.encrypted_config),
        server = list(await (await apiFor(x.connectionId)).servers(), 'servers').find(s => s.uuid === x.serverUuid);
      if (server?.ip !== x.serverIp) fail('Server-IP seit Planung geändert.');
      return lock('dns:' + x.domain, () =>
        dns.ensure({ domain: x.domain, serverIp: server.ip, accountId: x.allinklAccountId })
      );
    },
    tick,
    startWorker
  };
}
