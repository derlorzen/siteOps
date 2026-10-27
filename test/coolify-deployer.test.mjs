import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createCoolifyDeployer, capabilitiesFor } from '../lib/coolify-deployer.mjs';
import { createCoolifyClient } from '../lib/coolify.mjs';
import { inspectFiles, inspectCompose, createApplicationAnalyzer } from '../lib/coolify-analyze.mjs';
import { createCoolifyDns } from '../lib/coolify-dns.mjs';
import { publicIp, maskSecrets, redactValue, publicAddresses } from '../lib/coolify-public-http.mjs';
import { encryptWithKey, decryptWithKey } from '../lib/crypto.mjs';
import { registerCoolifyDeploymentTools } from '../lib/coolify-deployer-api.mjs';
import * as z from 'zod/v4';

const connectionId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const siteId = '33333333-3333-4333-8333-333333333333';
const ip = '8.8.4.4';
const base = {
  connectionId,
  name: 'Example',
  projectName: 'Tools',
  domain: 'app.example.de',
  sourceKind: 'image',
  image: 'example/app',
  containerPort: 3000,
  authUsername: 'operator',
  authPassword: 'secret-password-012345',
  reviewEvidence: 'Official image, authentication and storage reviewed.'
};
const approval = id => ({
  id,
  approve: true,
  approveRisks: true,
  riskAcknowledgement: 'Reviewed the source and all API authentication routes.'
});

function fixture(options = {}) {
  const state = {
    records: [],
    apps: [],
    services: [],
    sites: [],
    projects: [],
    localProjects: [],
    starts: 0,
    envs: [],
    storage: [],
    writes: [],
    deployStatus: 'finished',
    appStatus: 'running:healthy',
    httpStatus: 200,
    dnsIp: ip,
    authWorking: true,
    failConfig: false,
    failCreatePersistence: false,
    lostStartResponse: false,
    time: new Date('2026-10-22T12:00:00Z'),
    locks: new Set()
  };
  const db = {
    async query(sql, params = []) {
      if (sql.startsWith('INSERT INTO coolify_deployments')) {
        const names = sql.match(/\(([^)]+)\) VALUES/)[1].split(',');
        const record = Object.fromEntries(names.map((n, i) => [n, params[i]]));
        if (state.records.some(r => r.domain === record.domain)) throw new Error('Duplicate domain');
        state.records.push({
          ...record,
          state: 'planned',
          resource_uuid: null,
          site_id: null,
          deployment_uuid: null,
          deploy_requested_at: null
        });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE coolify_deployments SET ')) {
        const fields = sql
          .match(/SET (.*?) WHERE/)[1]
          .split(',')
          .map(x => x.split('=')[0]);
        if (state.failCreatePersistence && fields.includes('resource_uuid')) {
          state.failCreatePersistence = false;
          throw new Error('DB connection lost after remote create');
        }
        const r = state.records.find(r => r.id === params.at(-1));
        if (r)
          fields.forEach((f, i) => {
            r[f] = params[i];
          });
        return [{ affectedRows: r ? 1 : 0 }];
      }
      if (sql.startsWith('SELECT * FROM coolify_deployments WHERE domain='))
        return [state.records.filter(r => r.domain === params[0])];
      if (sql.startsWith('SELECT * FROM coolify_deployments WHERE id='))
        return [state.records.filter(r => r.id === params[0])];
      if (sql.startsWith('SELECT * FROM coolify_deployments ORDER')) return [state.records];
      if (sql.startsWith('SELECT id FROM coolify_deployments WHERE state'))
        return [state.records.filter(r => ['queued', 'running', 'verifying'].includes(r.state))];
      if (sql.startsWith('SELECT encrypted_config FROM coolify_deployments'))
        return [state.records.filter(r => r.connection_id === params[0] && r.resource_uuid === params[1])];
      if (sql.startsWith('SELECT id,name,customer_id FROM customer_projects WHERE name='))
        return [state.localProjects.filter(p => p.name === params[0])];
      if (sql.startsWith('SELECT id FROM customer_projects WHERE id='))
        return [state.localProjects.filter(p => p.id === params[0])];
      if (sql.startsWith('SELECT id FROM sites WHERE domain='))
        return [state.sites.filter(s => s.domain === params[0])];
      if (sql.startsWith('UPDATE sites SET')) {
        state.writes.push({ sql, params });
        return [{ affectedRows: 1 }];
      }
      throw new Error('Unexpected SQL: ' + sql);
    },
    async getConnection() {
      return {
        async query(sql, [key]) {
          if (sql.startsWith('SELECT GET_LOCK')) {
            if (state.locks.has(key)) return [[{ acquired: 0 }]];
            state.locks.add(key);
            return [[{ acquired: 1 }]];
          }
          if (sql.startsWith('SELECT RELEASE_LOCK')) {
            state.locks.delete(key);
            return [[{ acquired: 1 }]];
          }
          return db.query(sql, arguments[1]);
        },
        release() {}
      };
    }
  };
  const api = {
    version: async () => 'v4.4.7',
    servers: async () => [{ uuid: 'server-one', ip }],
    projects: async () => state.projects,
    createProject: async (name, description) => {
      const r = { uuid: 'project-one', name, description };
      state.projects.push(r);
      return r;
    },
    environments: async () => [{ name: 'production', uuid: 'env-one' }],
    createEnvironment: async () => {
      throw new Error('Unexpected environment create');
    },
    applications: async () => state.apps,
    services: async () => state.services,
    createApplication: async (kind, body) => {
      const r = { ...body, uuid: 'application-one', kind };
      state.apps.push(r);
      return r;
    },
    createService: async body => {
      const r = { ...body, uuid: 'service-one' };
      state.services.push(r);
      return r;
    },
    application: async id => ({ ...state.apps.find(a => a.uuid === id), status: state.appStatus }),
    service: async id => ({
      ...state.services.find(a => a.uuid === id),
      status: state.appStatus,
      updated_at: state.time.toISOString(),
      applications: [{ name: 'app', status: state.appStatus }]
    }),
    updateApplication: async (id, body) => {
      if (state.failConfig) {
        state.failConfig = false;
        throw new Error('Config failed ' + base.authPassword);
      }
      state.writes.push({ id, body });
    },
    updateService: async (id, body) => {
      state.writes.push({ id, body });
    },
    setApplicationEnvs: async (id, data) => state.envs.push({ id, data }),
    setServiceEnvs: async (id, data) => state.envs.push({ id, data }),
    applicationStorages: async () => ({ persistent_storages: state.storage }),
    createApplicationStorage: async (id, body) => state.storage.push({ ...body, name: id + '-' + body.name }),
    startApplication: async () => {
      state.starts++;
      if (state.lostStartResponse) {
        state.lostStartResponse = false;
        throw new Error('Request result unknown');
      }
      return { deployment_uuid: 'deployment-one' };
    },
    startService: async () => {
      state.starts++;
      return {};
    },
    applicationDeployments: async () => ({
      deployments: [{ deployment_uuid: 'deployment-one', created_at: state.time.toISOString() }]
    }),
    deployment: async () => ({ status: state.deployStatus, logs: 'MUST NOT RETURN RAW DEPLOYMENT LOGS' }),
    applicationLogs: async () => ({ logs: base.authPassword + ' API_KEY=' + base.authPassword }),
    serviceLogs: async () => ({ logs: base.authPassword })
  };
  const key = Buffer.alloc(32, 7);
  const controller = createCoolifyDeployer({
    db,
    encrypt: v => encryptWithKey(v, key),
    decrypt: v => decryptWithKey(v, key),
    loadConnection: async () => ({ id: connectionId, base_url: 'https://coolify.example.de' }),
    makeClient: () => api,
    billingController: {
      clients: async () => [{ id: projectId, name: 'SiteOps' }],
      createProject: async x => {
        const p = { id: projectId, name: x.name, customer_id: x.customer_id };
        state.localProjects.push(p);
        return p;
      }
    },
    siteProjectService: {
      link: async (id, { project_id }) => {
        state.link = { id, project_id };
      }
    },
    registerWebsite: async ({ deployment, config }) => {
      const site = state.sites.find(s => s.deploymentId === deployment.id) || {
        id: siteId,
        domain: config.domain,
        deploymentId: deployment.id
      };
      if (!state.sites.includes(site)) state.sites.push(site);
      return site;
    },
    dnsService: {
      inspect: async () => ({ accountId: projectId, zone: 'example.de', action: 'reuse' }),
      ensure: async () => ({ ensured: true })
    },
    addresses: async () => [{ address: state.dnsIp, family: 4 }],
    http: async (_url, { headers } = {}) => ({
      status: headers?.Authorization ? state.httpStatus : state.authWorking ? 401 : 200,
      body: 'healthy'
    }),
    now: () => state.time,
    ...options
  });
  return { state, controller, api, db };
}

test('plan is persistent, expiring, encrypted and performs no provisioning writes', async () => {
  const { controller, state } = fixture();
  const first = await controller.plan(base),
    second = await controller.plan(base);
  assert.equal(first.id, second.id);
  assert.equal(state.records.length, 1);
  assert.equal(state.apps.length, 0);
  assert.equal(state.starts, 0);
  assert.equal(state.localProjects.length, 0);
  assert.doesNotMatch(JSON.stringify(first), new RegExp(base.authPassword));
  assert.doesNotMatch(state.records[0].encrypted_config, new RegExp(base.authPassword));
  await assert.rejects(controller.execute({ id: first.id, approve: true }), /Risiken/);
  state.time = new Date('2026-10-22T14:00:00Z');
  await assert.rejects(controller.execute(approval(first.id)), /abgelaufen/);
});

test('verified installation creates one app, reuses projects, configures auth, volumes, envs and links website', async () => {
  const { controller, state } = fixture();
  state.projects.push({ uuid: 'project-one', name: 'Tools' });
  const input = {
    ...base,
    environment: [{ key: 'TOKEN', value: 'another-secret-123' }],
    volumes: [{ name: 'media', mountPath: '/app/media' }]
  };
  const p = await controller.plan(input);
  await controller.execute(approval(p.id));
  const result = await controller.process(p.id);
  assert.equal(result.state, 'online');
  assert.equal(result.siteId, siteId);
  assert.equal(result.siteopsProjectId, projectId);
  assert.equal(state.projects.length, 1);
  assert.equal(state.localProjects.length, 1);
  assert.equal(state.apps.length, 1);
  assert.equal(state.starts, 1);
  assert.equal(state.apps[0].instant_deploy, false);
  assert.equal(state.apps[0].autogenerate_domain, false);
  assert.equal(state.writes.find(w => w.body)?.body.is_http_basic_auth_enabled, true);
  assert.equal(state.writes.find(w => w.body)?.body.limits_memory, '1024M');
  assert.equal(state.envs[0].data[0].value, 'another-secret-123');
  assert.equal(state.storage[0].mount_path, '/app/media');
  assert.deepEqual(state.link, { id: siteId, project_id: projectId });
  assert.equal((await controller.plan(input)).id, p.id);
  await controller.execute(approval(p.id));
  await controller.process(p.id);
  assert.equal(state.starts, 1);
  assert.equal(state.apps.length, 1);
  assert.equal(state.sites.length, 1);
  await assert.rejects(controller.plan({ ...input, image: 'different/app' }), /anderer/);
  const logs = await controller.logs(p.id);
  assert.doesNotMatch(logs.output, new RegExp(base.authPassword));
  assert.doesNotMatch(JSON.stringify(await controller.deploymentStatus(p.id)), /MUST NOT/);
});

test('failure after remote creation reconciles ownership instead of creating a duplicate', async () => {
  const { controller, state } = fixture();
  const p = await controller.plan(base);
  await controller.execute(approval(p.id));
  state.failCreatePersistence = true;
  const failed = await controller.process(p.id);
  assert.equal(failed.state, 'needs_attention');
  assert.equal(state.apps.length, 1);
  assert.equal(state.starts, 0);
  await controller.execute(approval(p.id));
  assert.equal((await controller.process(p.id)).state, 'online');
  assert.equal(state.apps.length, 1);
});

test('configuration failure persists exact failed step, masks secrets and resumes safely', async () => {
  const { controller, state } = fixture();
  const p = await controller.plan(base);
  await controller.execute(approval(p.id));
  state.failConfig = true;
  const failed = await controller.process(p.id);
  assert.equal(failed.progress.configure.state, 'failed');
  assert.doesNotMatch(failed.lastError, new RegExp(base.authPassword));
  assert.equal(state.starts, 0);
  await controller.execute(approval(p.id));
  assert.equal((await controller.process(p.id)).state, 'online');
  assert.equal(state.apps.length, 1);
});

test('an ambiguous start is reconciled through deployment history, never blindly repeated', async () => {
  const { controller, state } = fixture();
  const p = await controller.plan(base);
  await controller.execute(approval(p.id));
  state.lostStartResponse = true;
  assert.equal((await controller.process(p.id)).state, 'needs_attention');
  assert.equal(state.starts, 1);
  await controller.execute(approval(p.id));
  assert.equal((await controller.process(p.id)).state, 'online');
  assert.equal(state.starts, 1);
});

test('DNS or a responding page never proves a successful deployment', async () => {
  for (const change of [
    { deployStatus: 'in_progress' },
    { appStatus: 'exited' },
    { appStatus: 'running:unhealthy' },
    { dnsIp: '8.8.8.8' },
    { httpStatus: 503 }
  ]) {
    const { controller, state } = fixture();
    Object.assign(state, change);
    const p = await controller.plan(base);
    await controller.execute(approval(p.id));
    const result = await controller.process(p.id);
    assert.equal(result.state, 'verifying');
    assert.equal(state.sites.length, 0);
    assert.equal(result.lastSuccessAt, undefined);
  }
});

test('failed deployment, absent authentication and foreign resource never become online', async () => {
  for (const change of [{ deployStatus: 'failed' }, { authWorking: false }]) {
    const { controller, state } = fixture();
    Object.assign(state, change);
    const p = await controller.plan(base);
    await controller.execute(approval(p.id));
    const result = await controller.process(p.id);
    assert.equal(result.state, 'needs_attention');
    assert.equal(state.sites.length, 0);
  }
  const { controller, state } = fixture();
  state.apps.push({ uuid: 'foreign-one', name: base.name, description: 'someone else' });
  const p = await controller.plan(base);
  await controller.execute(approval(p.id));
  assert.equal((await controller.process(p.id)).state, 'needs_attention');
  assert.equal(state.starts, 0);
});

test('verification resumes after restart and redeploy tracks a new verification cycle', async () => {
  const { controller, state } = fixture();
  state.deployStatus = 'in_progress';
  const p = await controller.plan(base);
  await controller.execute(approval(p.id));
  assert.equal((await controller.process(p.id)).state, 'verifying');
  state.deployStatus = 'finished';
  assert.equal((await controller.process(p.id)).state, 'online');
  await controller.redeploy(approval(p.id));
  assert.equal((await controller.process(p.id)).state, 'online');
  assert.equal(state.starts, 2);
  assert.equal(state.apps.length, 1);
  assert.equal(state.sites.length, 1);
});

test('inline Dockerfile is base64 encoded and free Compose uses the services API', async () => {
  const a = fixture(),
    p = await a.controller.plan({
      ...base,
      sourceKind: 'dockerfile',
      dockerfile: 'FROM node:24\nEXPOSE 3000\nCMD ["node", "server.js"]'
    });
  await a.controller.execute(approval(p.id));
  await a.controller.process(p.id);
  assert.match(Buffer.from(a.state.apps[0].dockerfile, 'base64').toString(), /^FROM node:24/);
  const b = fixture(),
    q = await b.controller.plan({
      ...base,
      sourceKind: 'compose',
      compose:
        'services:\n  app:\n    image: example/app\n    expose: [3000]\n    mem_limit: 1024m\n    cpus: 1\n    healthcheck:\n      test: [CMD, true]\n',
      composeService: 'app',
      access: 'application',
      applicationAuthEvidence: 'Application protects every API route through verified login.'
    });
  await b.controller.execute(approval(q.id));
  await b.controller.process(q.id);
  assert.equal(b.state.apps.length, 0);
  assert.equal(b.state.services.length, 1);
  assert.equal(b.state.services[0].instant_deploy, false);
  assert.match(Buffer.from(b.state.services[0].docker_compose_raw, 'base64').toString(), /^services:/);
});

test('SSRF, unsafe Compose capabilities and secret encodings are rejected/redacted', async () => {
  for (const address of [
    '127.0.0.1',
    '169.254.169.254',
    '10.0.0.1',
    '::1',
    '::ffff:8.8.8.8',
    '2001:0db8::1',
    '3fff::1'
  ])
    assert.equal(publicIp(address), false, address);
  await assert.rejects(
    publicAddresses('evil.test', async () => [{ family: 4, address: '127.0.0.1' }]),
    /interne/
  );
  for (const text of [
    'services:\n  app:\n    privileged: true',
    'services:\n  app:\n    volumes: ["/var/run/docker.sock:/socket"]',
    'services:\n  app:\n    ports: ["80:3000"]'
  ])
    assert.ok(inspectCompose(text).blocked.length);
  const secret = 's3c\"ret\n123';
  const masked = maskSecrets(secret + ' ' + encodeURIComponent(secret) + ' ' + Buffer.from(secret).toString('base64'), [
    secret
  ]);
  assert.doesNotMatch(masked, /123/);
  assert.deepEqual(redactValue({ logs: '"', nested: ['x'] }, ['"']), { logs: '[redacted]', nested: ['x'] });
});

test('analysis distinguishes unsupported desktop builds and documented Docker server sources', () => {
  const desktop = inspectFiles({
    'package.json': JSON.stringify({
      main: 'desktop-dist/main.mjs',
      engines: { node: '>=24 <25' },
      dependencies: { electron: '43' }
    }),
    'README.md': 'Local first desktop editor.',
    LICENSE: 'AGPL'
  });
  assert.equal(desktop.suitability, 'unsupported');
  assert.equal(desktop.nodeVersion, '>=24 <25');
  assert.equal(desktop.buildPack, null);
  const web = inspectFiles({
    Dockerfile: 'FROM node:24\nEXPOSE 3000\nHEALTHCHECK CMD curl localhost:3000',
    'README.md': 'Production self-host with Docker.',
    LICENSE: 'MIT'
  });
  assert.equal(web.buildPack, 'dockerfile');
  assert.deepEqual(web.ports, [3000]);
  assert.match(web.choice, /Dockerfile/);
});

test('ambiguous website sources request review and no code is executed', async () => {
  const analyzer = createApplicationAnalyzer({
    http: async () => ({
      status: 200,
      url: 'https://application.test/',
      body: '<a href="https://github.com/one/app">Source</a><a href="https://github.com/two/app">Fork</a>'
    })
  });
  const result = await analyzer.analyze({ url: 'https://application.test/' });
  assert.equal(result.sourceConfirmed, false);
  assert.equal(result.repository, null);
  assert.equal(result.candidates.length, 2);
});

test('new client endpoints use bounded allowlisted API paths and never expose API error echoes', async () => {
  const calls = [];
  const client = createCoolifyClient({
    baseUrl: 'https://coolify.example.de',
    token: 'test-token-at-least12',
    request: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        text: async () => (new URL(url).pathname.endsWith('/version') ? 'v4.4.7' : '{}')
      };
    }
  });
  assert.equal(await client.version(), 'v4.4.7');
  await client.createEnvironment('project-one', 'production');
  await client.updateApplication('application-one', { domains: 'https://app.example.de' });
  await client.createApplicationStorage('application-one', { type: 'persistent', name: 'data', mount_path: '/data' });
  await client.deployment('deployment-one');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[2].options.method, 'PATCH');
  assert.ok(calls[3].url.endsWith('/storages'));
  assert.throws(() => client.deployment('../secrets'));
  const failing = createCoolifyClient({
    baseUrl: 'https://coolify.example.de',
    token: 'test-token-at-least12',
    request: async () => ({ ok: false, status: 422, text: async () => base.authPassword })
  });
  await assert.rejects(failing.updateApplication('application-one', {}), e => !e.message.includes(base.authPassword));
  assert.equal(capabilitiesFor('v4.0.0-beta.400').inlineCompose, false);
  assert.equal(capabilitiesFor('v4.4.7').inlineCompose, true);
  assert.equal(capabilitiesFor('v5.0.0').knownContract, false);
});

test('MCP tools serialize schemas and enforce server-side explicit approval', async () => {
  const { controller } = fixture(),
    registered = new Map();
  registerCoolifyDeploymentTools(
    { registerTool: (name, definition, run) => registered.set(name, { definition, run }) },
    controller,
    x => x
  );
  assert.ok(registered.has('coolify_app_plan'));
  assert.ok(registered.has('coolify_install_execute'));
  for (const { definition } of registered.values()) assert.doesNotThrow(() => z.toJSONSchema(definition.inputSchema));
  assert.equal(registered.get('coolify_app_status').definition.annotations.readOnlyHint, true);
  assert.equal(registered.get('coolify_install_execute').definition.annotations.readOnlyHint, false);
  await assert.rejects(registered.get('coolify_install_execute').run({ id: 'bad', approve: false }));
  const source = await readFile(new URL('../app.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes('registerCoolifyDeploymentTools(s, coolifyDeployer, toolText)'));
  assert.ok(source.includes('async function mcpAuth(req, reply)'));
});

test('ALL-INKL DNS reuses only matching records, rejects conflicts and requires authority', async () => {
  const state = { records: [], adds: 0, provider: 'allinkl' };
  const service = createCoolifyDns({
    allInklService: {
      list: async () => [{ id: projectId }],
      domains: async () => ['example.de'],
      diagnostics: async () => ({ publicDnsProvider: state.provider }),
      records: async () => state.records,
      addRecord: async (_id, r) => {
        state.adds++;
        state.records.push(r);
      }
    },
    addresses: async () => [{ address: ip }]
  });
  const input = { domain: 'app.example.de', serverIp: ip };
  assert.equal((await service.inspect(input)).action, 'create');
  await service.ensure(input);
  await service.ensure(input);
  assert.equal(state.adds, 1);
  state.records = [{ name: 'app', type: 'AAAA', value: '2606:4700:4700::1111' }];
  await assert.rejects(service.ensure(input), /Widersprüchlicher/);
  assert.equal(state.adds, 1);
  state.records = [{ name: 'app.example.de.', type: 'CNAME', value: 'target.example.de.' }];
  assert.equal((await service.ensure(input)).action, 'reuse');
  state.provider = 'external_or_unknown';
  await assert.rejects(service.ensure(input), /Zuständigkeit/);
  await assert.rejects(service.ensure({ ...input, serverIp: '10.0.0.1' }), /öffentliche/);
});

test('concurrent identical plans and workers cannot create duplicate resources', async () => {
  const { controller, state } = fixture();
  const planned = await Promise.allSettled([controller.plan(base), controller.plan(base)]);
  assert.equal(state.records.length, 1);
  const p = planned.find(x => x.status === 'fulfilled').value;
  await controller.execute(approval(p.id));
  const processed = await Promise.allSettled([controller.process(p.id), controller.process(p.id)]);
  assert.ok(processed.some(x => x.status === 'fulfilled'));
  assert.equal(state.apps.length, 1);
  assert.equal(state.starts, 1);
});

test('expired verification can resume after a repair without another deployment', async () => {
  const { controller, state } = fixture();
  state.httpStatus = 503;
  const p = await controller.plan(base);
  await controller.execute(approval(p.id));
  assert.equal((await controller.process(p.id)).state, 'verifying');
  state.time = new Date('2026-10-22T13:00:00Z');
  assert.equal((await controller.process(p.id)).state, 'needs_attention');
  state.httpStatus = 200;
  await controller.execute(approval(p.id));
  assert.equal((await controller.process(p.id)).state, 'online');
  assert.equal(state.starts, 1);
});

test('the real MCP authentication guard rejects anonymous access before tool execution', async t => {
  process.env.SITEOPS_TEST_NO_AUTOSTART = '1';
  const { mcpAuth, db } = await import('../app.mjs');
  t.after(() => db.end());
  let status, body;
  const headers = {};
  const reply = {
    header: (k, v) => {
      headers[k] = v;
      return reply;
    },
    code: v => {
      status = v;
      return reply;
    },
    send: v => {
      body = v;
      return reply;
    }
  };
  assert.equal(await mcpAuth({ headers: {} }, reply), false);
  assert.equal(status, 401);
  assert.equal(body.oauth, true);
  assert.ok(Object.keys(headers).some(k => k.toLowerCase() === 'www-authenticate'));
});

test('public Git analysis pins the reviewed commit and auto-selects the repository build', async () => {
  const commit = 'a'.repeat(40),
    branch = 'production';
  const { controller, state } = fixture({
    analyzer: {
      analyze: async () => ({
        repository: 'https://github.com/example/app',
        branch,
        commit,
        buildPack: 'dockerfile',
        dockerfileLocation: '/Dockerfile',
        ports: [3000],
        environmentKeys: [],
        risks: [],
        blocked: [],
        suitability: 'supported'
      })
    }
  });
  const p = await controller.plan({
    ...base,
    sourceKind: 'git',
    url: 'https://github.com/example/app',
    containerPort: undefined
  });
  assert.equal(p.plan.buildPack, 'dockerfile');
  assert.equal(p.plan.commit, commit);
  await controller.execute(approval(p.id));
  assert.equal((await controller.process(p.id)).state, 'online');
  assert.equal(state.apps[0].git_commit_sha, commit);
  assert.equal(state.apps[0].git_branch, branch);
  assert.equal(state.apps[0].is_auto_deploy_enabled, false);
});

test('analysis checks the selected monorepo build file and records reproducible sources', async () => {
  const commit = 'a'.repeat(40),
    paths = ['README.md', 'LICENSE', 'web/package.json', 'web/Dockerfile.prod'];
  const files = {
    'README.md': 'Production deployment instructions',
    LICENSE: 'MIT',
    'web/package.json': '{"engines":{"node":">=24 <25"},"scripts":{"start":"node server.js"}}',
    'web/Dockerfile.prod': 'FROM node:24\nEXPOSE 8080\n'
  };
  const calls = [];
  const analyzer = createApplicationAnalyzer({
    http: async url => {
      calls.push(url);
      const body = url.endsWith('/repos/example/app')
        ? { default_branch: 'main' }
        : url.includes('/commits/')
          ? { sha: commit, commit: { tree: { sha: commit } } }
          : url.includes('/git/trees/')
            ? { tree: paths.map(path => ({ path, size: 100, type: 'blob' })) }
            : null;
      return { status: 200, body: body ? JSON.stringify(body) : files[url.split(commit + '/')[1]] };
    }
  });
  const result = await analyzer.analyze({
    url: 'https://github.com/example/app',
    baseDirectory: '/web',
    dockerfileLocation: '/Dockerfile.prod'
  });
  assert.equal(result.buildPack, 'dockerfile');
  assert.equal(result.nodeVersion, '>=24 <25');
  assert.deepEqual(result.ports, [8080]);
  assert.equal(result.dockerfileLocation, '/Dockerfile.prod');
  assert.ok(result.evidence.some(e => e.url.endsWith('/web/Dockerfile.prod') && e.sha256));
  assert.ok(calls.filter(url => url.includes('raw.githubusercontent.com')).every(url => url.includes(commit)));
});

test('analysis discovers default monorepo build files without using unrelated root builds', async () => {
  for (const buildPath of ['Dockerfile', 'docker/Dockerfile', 'compose.yml', 'deploy/docker-compose.yaml']) {
    const commit = 'b'.repeat(40);
    const compose = buildPath.endsWith('.yml') || buildPath.endsWith('.yaml');
    const files = {
      'README.md': 'Production deployment instructions',
      LICENSE: 'MIT',
      Dockerfile: 'FROM unrelated:latest\nEXPOSE 9999',
      'compose.yml': 'services:\n  unrelated:\n    image: unrelated:latest',
      ['web/' + buildPath]: compose
        ? 'services:\n  web:\n    image: example/web\n    expose: [8080]'
        : 'FROM node:24\nEXPOSE 8080'
    };
    const fetched = [];
    const analyzer = createApplicationAnalyzer({
      http: async url => {
        const body = url.endsWith('/repos/example/app')
          ? { default_branch: 'main' }
          : url.includes('/commits/')
            ? { sha: commit, commit: { tree: { sha: commit } } }
            : url.includes('/git/trees/')
              ? { tree: Object.keys(files).map(path => ({ path, size: 100, type: 'blob' })) }
              : null;
        if (body) return { status: 200, body: JSON.stringify(body) };
        const path = url.split(commit + '/')[1];
        fetched.push(path);
        return { status: 200, body: files[path] };
      }
    });
    const result = await analyzer.analyze({ url: 'https://github.com/example/app', baseDirectory: '/web' });
    assert.equal(result.buildPack, compose ? 'dockercompose' : 'dockerfile');
    assert.equal(result[compose ? 'dockerComposeLocation' : 'dockerfileLocation'], '/' + buildPath);
    assert.ok(fetched.includes('web/' + buildPath));
    assert.ok(!fetched.includes('Dockerfile'));
    assert.ok(!fetched.includes('compose.yml'));
    if (compose) assert.deepEqual(result.composeServices, ['web']);
    else assert.deepEqual(result.ports, [8080]);
  }
});

test('Static requires existing HTML and public access cannot bypass protection on images', async () => {
  const built = inspectFiles({
    'README.md': 'Production static deployment',
    LICENSE: 'MIT',
    'index.html': '<h1>Public site</h1>'
  });
  assert.equal(built.buildPack, 'static');
  assert.equal(built.applicationType, 'static-web');
  const needsBuild = inspectFiles({
    'package.json': '{"scripts":{"build":"vite build"},"dependencies":{"astro":"5"}}',
    'README.md': 'Static site build instructions'
  });
  assert.notEqual(needsBuild.buildPack, 'static');
  const { controller } = fixture();
  await assert.rejects(controller.plan({ ...base, access: 'public-static' }), /statische Dateien/);
});

test('Docker image tags and digests are sent without appending an accidental latest tag', async () => {
  for (const image of ['example/app:stable', 'example/app@sha256:' + 'a'.repeat(64)]) {
    const { controller, state } = fixture();
    const p = await controller.plan({ ...base, image });
    await controller.execute(approval(p.id));
    await controller.process(p.id);
    const sent = state.apps[0];
    if (image.includes('@')) {
      assert.equal(sent.docker_registry_image_name, image);
      assert.equal(sent.docker_registry_image_tag, undefined);
    } else {
      assert.equal(sent.docker_registry_image_name, 'example/app');
      assert.equal(sent.docker_registry_image_tag, 'stable');
    }
  }
});

test('adopt registers an existing Coolify app as website without touching Coolify', async () => {
  const { state, controller } = fixture();
  state.apps.push({ uuid: 'existing-app', name: 'Marktschreier', git_repository: 'owner/app', git_branch: 'main' });
  // The adopted app has no SiteOps marker and may report an odd status; HTTPS health decides.
  state.appStatus = 'restarting:unknown';
  state.authWorking = false; // the public health path answers 200 without credentials
  const input = {
    connectionId,
    applicationUuid: 'existing-app',
    name: 'Marktschreier',
    domain: 'app.example.de',
    projectName: 'Money',
    healthPath: '/up'
  };
  const first = await controller.adopt(input);
  assert.equal(first.state, 'online');
  assert.equal(first.adopted, true);
  assert.equal(first.resourceUuid, 'existing-app');
  assert.equal(first.siteId, siteId);
  assert.equal(state.sites.length, 1);
  assert.deepEqual(state.link, { id: siteId, project_id: projectId });
  assert.equal(state.localProjects[0].name, 'Money');
  // Nothing was created, configured or deployed in Coolify.
  assert.equal(state.apps.length, 1);
  assert.equal(state.starts, 0);
  assert.equal(state.writes.filter(w => w.id).length, 0);

  // Idempotent for the same app and domain.
  const again = await controller.adopt(input);
  assert.equal(again.id, first.id);
  assert.equal(state.records.length, 1);

  // Monitoring verification works for the adopted app.
  const verified = await controller.verify(first.id);
  assert.equal(verified.ok, true);

  // A different app for the same domain is refused.
  state.apps.push({ uuid: 'other-app', name: 'Other' });
  await assert.rejects(
    () => controller.adopt({ ...input, applicationUuid: 'other-app' }),
    /bereits einen SiteOps-Auftrag/
  );
});

test('adopt refuses unknown apps and failing health checks', async () => {
  const { state, controller } = fixture();
  state.apps.push({ uuid: 'existing-app', name: 'App' });
  const input = {
    connectionId,
    applicationUuid: 'missing-app',
    name: 'App',
    domain: 'app.example.de',
    projectName: 'X'
  };
  await assert.rejects(() => controller.adopt(input), /nicht in dieser Coolify-Verbindung/);
  state.authWorking = true; // the fixture answers anonymous requests with 401
  await assert.rejects(
    () => controller.adopt({ ...input, applicationUuid: 'existing-app' }),
    /Health-Check nicht bestanden/
  );
  assert.equal(state.records.length, 0);
  assert.equal(state.sites.length, 0);
  await assert.rejects(() =>
    controller.adopt({ connectionId, applicationUuid: 'existing-app', name: 'App', domain: 'app.example.de' })
  );
});
