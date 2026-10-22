import * as z from 'zod/v4';
import { parseDocument } from 'yaml';
import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';
import { publicHttp } from './coolify-public-http.mjs';

export const analyzeSchema = z.object({
  url: z.url().max(700),
  branch: z
    .string()
    .regex(/^[\w./-]{1,190}$/)
    .optional(),
  baseDirectory: z
    .string()
    .regex(/^\/[a-zA-Z0-9_./-]*$/)
    .optional(),
  dockerfileLocation: z
    .string()
    .regex(/^\/[a-zA-Z0-9_./-]+$/)
    .optional(),
  dockerComposeLocation: z
    .string()
    .regex(/^\/[a-zA-Z0-9_./-]+\.ya?ml$/)
    .optional()
});
const digest = value => createHash('sha256').update(value).digest('hex');
const basename = path => path.split('/').at(-1).toLowerCase();

export function inspectCompose(text) {
  const doc = parseDocument(text, { uniqueKeys: true, maxAliasCount: 30 });
  if (doc.errors.length) throw new Error('Compose ist kein gültiges YAML.');
  const value = doc.toJS({ maxAliasCount: 30 });
  if (!value?.services || typeof value.services !== 'object' || Array.isArray(value.services))
    throw new Error('Compose benötigt services.');
  const services = Object.entries(value.services);
  if (!services.length || services.length > 30) throw new Error('Compose benötigt 1–30 Dienste.');
  const risks = [],
    blocked = [],
    volumes = [],
    ports = [],
    limits = [],
    variables = new Set();
  for (const [name, service] of services) {
    if (!/^[a-zA-Z0-9][\w.-]{0,62}$/.test(name) || !service || typeof service !== 'object')
      throw new Error('Ungültiger Compose-Dienst.');
    if (
      service.privileged ||
      service.network_mode ||
      service.pid === 'host' ||
      service.ipc === 'host' ||
      service.devices ||
      service.cap_add ||
      service.volumes_from ||
      service.uts === 'host' ||
      service.userns_mode === 'host' ||
      service.device_cgroup_rules ||
      service.security_opt?.some(option => !/^no-new-privileges(?::true|:1)?$/.test(String(option)))
    )
      blocked.push(name + ': privilegierte Host-Funktionen sind nicht erlaubt.');
    if (service.ports?.length)
      blocked.push(name + ': öffentliche Portbindungen entfernen; ausschließlich über Coolify-Proxy routen.');
    if (service.extends || service.build?.additional_contexts)
      blocked.push(name + ': ungeprüfte externe Definitionen/Build-Kontexte sind nicht erlaubt.');
    if (service.env_file) risks.push(name + ': referenzierte env_file-Dateien prüfen.');
    const labels = Array.isArray(service.labels) ? service.labels : Object.keys(service.labels || {});
    if (labels.some(label => /^(?:traefik\.|caddy)/i.test(label)))
      blocked.push(name + ': eigene Proxy-Router dürfen die Domain-/Zugriffsprüfung nicht umgehen.');
    if (service.build) risks.push(name + ': Build-Kontext und alle referenzierten Dateien prüfen.');
    for (const volume of service.volumes || []) {
      const source = typeof volume === 'string' ? volume.split(':')[0] : volume.source;
      const target = typeof volume === 'string' ? volume.split(':')[1] : volume.target;
      if (
        !target ||
        (typeof volume === 'object' && volume.type === 'bind') ||
        !/^[a-zA-Z0-9][\w-]*$/.test(source || '')
      )
        blocked.push(name + ': nur benannte persistente Volumes sind zulässig.');
      else if (!safeMount(target)) blocked.push(name + ': unsicherer Mount-Pfad.');
      else volumes.push({ service: name, name: source, mountPath: target });
    }
    ports.push(...(service.expose || []).map(port => ({ service: name, port: String(port) })));
    limits.push({
      service: name,
      memory: service.mem_limit || service.deploy?.resources?.limits?.memory || null,
      cpus: service.cpus || service.deploy?.resources?.limits?.cpus || null
    });
    const env = service.environment || {};
    for (const item of Array.isArray(env) ? env : Object.keys(env)) variables.add(String(item).split('=')[0]);
  }
  if (value.include) blocked.push('Compose include ist nicht erlaubt.');
  if (
    Object.values(value.volumes || {}).some(
      v => v?.external || v?.name || v?.driver_opts || (v?.driver && v.driver !== 'local')
    )
  )
    blocked.push('Externe Volumes oder Volume-Treiberoptionen sind nicht erlaubt.');
  if (Object.values(value.networks || {}).some(v => v?.external || v?.name || (v?.driver && v.driver !== 'bridge')))
    blocked.push('Externe oder Host-Netzwerke sind nicht erlaubt.');
  if (value.configs || value.secrets)
    blocked.push(
      'Compose-Dateiquellen für configs/secrets vor Verwendung in geschützte Umgebungsvariablen überführen.'
    );
  for (const match of text.matchAll(/\$\{([A-Z_][A-Z0-9_]*)/g)) variables.add(match[1]);
  return {
    services: services.map(([name]) => name),
    risks,
    blocked,
    volumes,
    ports,
    limits,
    variables: [...variables]
  };
}

export function limitCompose(text, { memoryMb, cpus }) {
  const checked = inspectCompose(text);
  if (checked.blocked.length) throw new Error(checked.blocked.join(' '));
  const doc = parseDocument(text);
  for (const service of checked.services) {
    doc.setIn(['services', service, 'mem_limit'], memoryMb + 'm');
    doc.setIn(['services', service, 'cpus'], String(cpus));
    if (doc.hasIn(['services', service, 'deploy', 'resources', 'limits'])) {
      doc.setIn(['services', service, 'deploy', 'resources', 'limits', 'memory'], memoryMb + 'm');
      doc.setIn(['services', service, 'deploy', 'resources', 'limits', 'cpus'], String(cpus));
    }
  }
  return doc.toString();
}

export function composeEnvironmentValues(text) {
  if (!text) return [];
  try {
    const value = parseDocument(text).toJS({ maxAliasCount: 30 });
    return Object.values(value.services || {})
      .flatMap(service =>
        Array.isArray(service.environment)
          ? service.environment.map(item => String(item).split('=').slice(1).join('='))
          : Object.values(service.environment || {}).filter(v => typeof v === 'string')
      )
      .filter(v => v && !v.startsWith('${'));
  } catch {
    return [];
  }
}

export function safeMount(path) {
  return (
    typeof path === 'string' &&
    /^\/[a-zA-Z0-9_./-]+$/.test(path) &&
    !path.split('/').some(x => x === '..' || x === '.') &&
    !/^\/(?:proc|sys|dev|etc|var\/run|run|root)(?:\/|$)/.test(path)
  );
}

export function inspectFiles(files, selected = {}) {
  const readme = Object.entries(files).find(([p]) => /^readme(?:\.md|\.rst|\.txt)?$/i.test(p))?.[1] || '';
  const license = Object.entries(files).find(([p]) => /^(?:license|copying)(?:\..*)?$/i.test(p))?.[1] || '';
  let pkg = {};
  try {
    pkg = JSON.parse(files[selected.packagePath || 'package.json'] || '{}');
  } catch {
    throw new Error('package.json ist ungültig.');
  }
  const docker = selected.dockerfilePath || Object.keys(files).find(p => basename(p) === 'dockerfile');
  const compose =
    selected.composePath || Object.keys(files).find(p => /^(?:docker-)?compose\.ya?ml$/i.test(basename(p)));
  if ((docker && !files[docker]) || (compose && !files[compose]))
    throw new Error('Ausgewählte Build-Datei fehlt im geprüften Commit.');
  const desktop = Boolean(
    pkg.dependencies?.electron || pkg.devDependencies?.electron || /desktop-dist|electron/.test(pkg.main || '')
  );
  const serverStart = Boolean(pkg.scripts?.start && !/electron|vite(?:\s+preview)?(?:\s|$)/.test(pkg.scripts.start));
  const webEvidence = /(?:self.host|deploy|production|web server|docker run|docker compose)/i.test(readme);
  const baseImages = docker
    ? [...files[docker].matchAll(/^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)/gim)].map(m => m[1])
    : [];
  const nodeVersion =
    pkg.engines?.node ||
    (files['.nvmrc'] || files['.node-version'] || '').trim() ||
    baseImages
      .find(image => /^(?:docker.io\/library\/)?node:/.test(image))
      ?.split(':')
      .at(-1) ||
    null;
  const risks = [],
    blocked = [],
    notes = [];
  let composition = null;
  if (compose) {
    composition = inspectCompose(files[compose]);
    risks.push(...composition.risks);
    blocked.push(...composition.blocked);
  }
  if (!license && !pkg.license) risks.push('Keine Lizenzdatei oder Paketlizenz gefunden; Nutzungsrechte prüfen.');
  if (desktop && !serverStart && !docker && !compose)
    blocked.push(
      'Desktop-Anwendung ohne nachgewiesenen unterstützten Server-Start. Ein statischer UI-Build genügt nicht.'
    );
  if (!webEvidence) risks.push('Kein eindeutiger Produktions-/Self-Hosting-Nachweis in der README.');
  if (
    /agent|filesystem|file system|arbitrary|shell|terminal|upload|admin/i.test(
      readme + JSON.stringify(pkg.dependencies || {})
    )
  )
    risks.push('Sensible Funktionen: Zugriffsschutz vor Veröffentlichung erforderlich.');
  const dockerText = docker ? files[docker] : '';
  const ports = [...new Set([...dockerText.matchAll(/^\s*EXPOSE\s+(\d+)/gm)].map(x => Number(x[1])))];
  const envFiles = Object.entries(files).filter(([p]) =>
    /(?:\.env\.(?:example|sample|template)|env\.example)$/.test(p)
  );
  const variables = [
    ...new Set(
      envFiles
        .flatMap(([, body]) => [...body.matchAll(/^\s*([A-Z_][A-Z0-9_]*)\s*=/gm)].map(x => x[1]))
        .concat(composition?.variables || [])
    )
  ];
  const database = [
    ...new Set(
      ['postgres', 'mysql', 'redis', 'sqlite', 'mongodb'].filter(x =>
        new RegExp(x, 'i').test(readme + JSON.stringify(pkg.dependencies || {}) + (compose ? files[compose] : ''))
      )
    )
  ];
  let buildPack = compose ? 'dockercompose' : docker ? 'dockerfile' : serverStart ? 'nixpacks' : null;
  if (!buildPack && !desktop && !Object.keys(pkg).length && files[selected.indexPath || 'index.html'])
    buildPack = 'static';
  if (!buildPack) risks.push('Keine belegte Build-/Startstrategie ermittelt. Konfiguration vor Ausführung prüfen.');
  const choice = compose
    ? 'Repository-Compose definiert Dienste, Netzwerke und Persistenz gemeinsam.'
    : docker
      ? 'Repository-eigenes Dockerfile bewahrt die vom Autor festgelegte Runtime.'
      : serverStart
        ? 'Nixpacks erkennt die Paket-Runtime; ein start-Script ist vorhanden.'
        : buildPack === 'static'
          ? 'Bereits vorhandene HTML-Dateien ohne serverseitige Runtime werden direkt ausgeliefert.'
          : 'Keine sichere automatische Auswahl möglich.';
  if (!ports.length) notes.push('Container-Port nicht belegt; vor Planung explizit setzen.');
  return {
    applicationType: desktop
      ? serverStart || docker || compose
        ? 'desktop-with-server-components'
        : 'desktop'
      : buildPack === 'static'
        ? 'static-web'
        : serverStart || docker || compose
          ? 'web-or-server'
          : 'unknown',
    suitability: blocked.length ? 'unsupported' : risks.length ? 'review_required' : 'supported',
    buildPack,
    choice,
    nodeVersion,
    runtimeImages: baseImages,
    ports,
    environmentKeys: variables,
    volumes: composition?.volumes || [],
    database,
    healthCheck: /HEALTHCHECK/i.test(dockerText) ? 'Dockerfile HEALTHCHECK vorhanden' : null,
    ffmpeg: /ffmpeg/i.test(readme + dockerText + JSON.stringify(pkg.dependencies || {})),
    license: pkg.license || (license ? license.slice(0, 130).replace(/\s+/g, ' ') : null),
    dockerfileLocation: docker ? '/' + docker : null,
    dockerComposeLocation: compose ? '/' + compose : null,
    composeServices: composition?.services || [],
    composePorts: composition?.ports || [],
    composeLimits: composition?.limits || [],
    risks,
    blocked,
    notes
  };
}

export function createApplicationAnalyzer({ http = publicHttp } = {}) {
  async function json(url) {
    const response = await http(url, { maxBytes: 2_000_000 });
    if (response.status !== 200)
      throw new Error(
        'Quellenabruf HTTP ' +
          response.status +
          '. Private/andere Git-Quellen benötigen explizit geprüfte Konfiguration.'
      );
    return JSON.parse(response.body);
  }
  async function analyze(raw) {
    const x = analyzeSchema.parse(raw);
    for (const path of [x.baseDirectory, x.dockerfileLocation, x.dockerComposeLocation].filter(Boolean))
      if (path.split('/').some(part => part === '..' || part === '.')) throw new Error('Unsicherer Repository-Pfad.');
    let url = new URL(x.url),
      sourceConfirmed = true;
    const evidence = [];
    if (url.hostname !== 'github.com') {
      const response = await http(url.href);
      if (response.status !== 200) throw new Error('Anwendungswebsite nicht erreichbar.');
      const $ = cheerio.load(response.body);
      const links = [
        ...new Set(
          $('a[href]')
            .map((_i, a) => {
              try {
                const link = new URL($(a).attr('href'), response.url || url);
                return link.hostname === 'github.com' && /^\/[^/]+\/[^/]+\/?$/.test(link.pathname)
                  ? link.origin + link.pathname.replace(/\/$/, '')
                  : null;
              } catch {
                return null;
              }
            })
            .get()
            .filter(Boolean)
        )
      ];
      if (links.length !== 1)
        return {
          sourceUrl: x.url,
          repository: null,
          suitability: 'review_required',
          sourceConfirmed: false,
          candidates: links,
          risks: ['Offizielles Repository ist nicht eindeutig zuordenbar. Explizite Quellenfreigabe erforderlich.'],
          evidence: [{ url: response.url || x.url, kind: 'website' }]
        };
      evidence.push({ url: response.url || x.url, kind: 'official-website-link', repository: links[0] });
      url = new URL(links[0]);
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.port ||
      !/^\/[^/]+\/[^/]+(?:\.git)?\/?$/.test(url.pathname)
    )
      throw new Error('Für automatische Analyse eine saubere GitHub-Repository-URL angeben.');
    const repo = url.pathname
      .replace(/^\//, '')
      .replace(/\/$/, '')
      .replace(/\.git$/, '');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Ungültiges Repository.');
    const meta = await json('https://api.github.com/repos/' + repo);
    const ref = await json(
      'https://api.github.com/repos/' + repo + '/commits/' + encodeURIComponent(x.branch || meta.default_branch)
    );
    const commit = ref.sha;
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Quellrevision fehlt.');
    const tree = await json(
      'https://api.github.com/repos/' + repo + '/git/trees/' + ref.commit.tree.sha + '?recursive=1'
    );
    if (tree.truncated) throw new Error('Repository-Baum unvollständig; explizite Konfiguration erforderlich.');
    const base = (x.baseDirectory || '/').replace(/^\/+|\/+$/g, '');
    const pathInBase = path => [base, path.replace(/^\//, '')].filter(Boolean).join('/');
    const selected = {
      indexPath: pathInBase('index.html'),
      packagePath: pathInBase('package.json'),
      ...(x.dockerfileLocation ? { dockerfilePath: pathInBase(x.dockerfileLocation) } : {}),
      ...(x.dockerComposeLocation ? { composePath: pathInBase(x.dockerComposeLocation) } : {})
    };
    const paths = tree.tree
      .filter(
        p =>
          p.type === 'blob' &&
          p.size <= 150000 &&
          (/^(README(?:\.md|\.rst|\.txt)?|LICENSE(?:\..*)?|COPYING|package.json|\.nvmrc|\.node-version|\.env\.(example|sample|template))$/i.test(
            p.path
          ) ||
            ((!base || p.path.startsWith(base + '/')) &&
              /^(?:(?:docker|deploy|deployment)\/)?(?:Dockerfile|(?:docker-)?compose\.ya?ml)$/i.test(
                base ? p.path.slice(base.length + 1) : p.path
              )) ||
            Object.values(selected).includes(p.path))
      )
      .slice(0, 16);
    const files = {};
    for (const file of paths) {
      const response = await http('https://raw.githubusercontent.com/' + repo + '/' + commit + '/' + file.path, {
        maxBytes: 160000
      });
      if (response.status !== 200) throw new Error('Repository-Datei nicht abrufbar.');
      files[file.path] = response.body;
      evidence.push({
        url: 'https://github.com/' + repo + '/blob/' + commit + '/' + file.path,
        sha256: digest(response.body),
        kind: 'repository-file'
      });
    }
    const result = inspectFiles(files, selected);
    if (base) {
      if (result.dockerfileLocation?.startsWith('/' + base + '/'))
        result.dockerfileLocation = result.dockerfileLocation.slice(base.length + 1);
      if (result.dockerComposeLocation?.startsWith('/' + base + '/'))
        result.dockerComposeLocation = result.dockerComposeLocation.slice(base.length + 1);
    }
    if (
      new URL(x.url).hostname !== 'github.com' &&
      !String(Object.entries(files).find(([p]) => /^readme/i.test(p))?.[1] || '').includes(new URL(x.url).hostname)
    ) {
      sourceConfirmed = false;
      result.risks.push(
        'Repository verlinkt die Anwendungswebsite nicht eindeutig zurück; Quellenzuordnung ausdrücklich bestätigen.'
      );
    }
    if (meta.archived) result.risks.push('Repository ist archiviert.');
    if (meta.disabled) result.blocked.push('Repository ist deaktiviert.');
    if (result.blocked.length) result.suitability = 'unsupported';
    else if (result.risks.length) result.suitability = 'review_required';
    return {
      sourceUrl: x.url,
      repository: 'https://github.com/' + repo,
      branch: x.branch || meta.default_branch,
      commit,
      sourceConfirmed,
      ...result,
      evidence
    };
  }
  return { analyze };
}
