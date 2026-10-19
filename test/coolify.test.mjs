import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { coolifyBaseUrl, createCoolifyClient, createCoolifyService, coolifySupabaseSchema } from '../lib/coolify.mjs';
import { renderCoolifyWorkspace } from '../lib/coolify-ui.mjs';

const connectionId = '11111111-1111-4111-8111-111111111111';
const fakeToken = 'secret-test-token-do-not-expose';
const baseUrl = 'https://coolify.example.de';
const projectKey = 'meine-app';
const name = 'Meine App';

function coolifyMock() {
  const state = { projects: [], services: [], starts: [], requests: [] };
  const response = (data, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(data)
  });
  const request = async (url, options) => {
    const path = new URL(url).pathname;
    state.requests.push({
      path,
      method: options.method,
      authorization: options.headers.Authorization,
      redirect: options.redirect
    });
    assert.equal(options.headers.Authorization, 'Bearer ' + fakeToken);
    assert.equal(options.redirect, 'error');
    if (path === '/api/v1/projects' && options.method === 'GET') return response(state.projects);
    if (path === '/api/v1/projects' && options.method === 'POST') {
      const payload = JSON.parse(options.body);
      const project = { uuid: 'project-one', ...payload };
      state.projects.push(project);
      return response(project, 201);
    }
    if (path === '/api/v1/servers' && options.method === 'GET')
      return response([{ uuid: 'server-one', name: 'Coolify' }]);
    if (path === '/api/v1/services' && options.method === 'GET') return response(state.services);
    if (path === '/api/v1/services' && options.method === 'POST') {
      const payload = JSON.parse(options.body);
      const service = { uuid: 'supabase-one', service_type: 'supabase', ...payload };
      state.services.push(service);
      return response(service, 201);
    }
    if (path === '/api/v1/services/supabase-one/start' && options.method === 'POST') {
      state.starts.push('supabase-one');
      return response({ message: 'Service starting request queued.' });
    }
    if (path.startsWith('/api/v1/services/') && !path.endsWith('/start') && options.method === 'GET') {
      const uuid = path.split('/').at(-1);
      const found = state.services.find(s => s.uuid === uuid);
      return response(found || { message: 'Resource not found.' }, found ? 200 : 404);
    }
    throw new Error('Unmocked Coolify endpoint: ' + options.method + ' ' + path);
  };
  return { state, request };
}

function memoryDb() {
  const state = { connections: [], instances: [], q: [] };
  const db = {
    getConnection: async () => ({
      query: async sql => {
        assert.match(sql, /GET_LOCK|RELEASE_LOCK/);
        return [[{ acquired: 1 }]];
      },
      release() {}
    }),
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').toLowerCase().trim();
      state.q.push({ sql: normalized, params });
      if (normalized.startsWith('select * from coolify_connections where id'))
        return [state.connections.filter(c => c.id === params[0])];
      if (normalized.startsWith('select id,name,base_url,default_server_uuid')) return [state.connections];
      if (normalized.startsWith('insert into coolify_connections')) {
        const [id, name, base_url, encrypted_token, default_server_uuid] = params;
        state.connections.push({ id, name, base_url, encrypted_token, default_server_uuid });
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith('update coolify_connections set')) {
        const [name, base_url, encrypted_token, default_server_uuid, id] = params;
        const record = state.connections.find(c => c.id === id);
        if (!record) return [{ affectedRows: 0 }];
        Object.assign(record, { name, base_url, encrypted_token, default_server_uuid });
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith('select id from customer_projects')) return [[{ id: params[0] }]];
      if (normalized.startsWith('insert ignore into coolify_supabase_instances')) {
        const [
          id,
          connection_id,
          project_key,
          name,
          siteops_project_id,
          coolify_project_uuid,
          environment_name,
          server_uuid,
          destination_uuid
        ] = params;
        if (!state.instances.some(x => x.connection_id === connection_id && x.project_key === project_key))
          state.instances.push({
            id,
            connection_id,
            project_key,
            name,
            siteops_project_id,
            coolify_project_uuid,
            environment_name,
            server_uuid,
            destination_uuid,
            service_uuid: null,
            state: 'queued',
            last_error: null
          });
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith('select * from coolify_supabase_instances where connection_id'))
        return [state.instances.filter(r => r.connection_id === params[0] && r.project_key === params[1])];
      if (normalized.startsWith('select * from coolify_supabase_instances where id'))
        return [state.instances.filter(r => r.id === params[0])];
      if (normalized.startsWith('select * from coolify_supabase_instances order by')) return [state.instances];
      if (normalized.startsWith('select * from coolify_supabase_instances where state='))
        return [state.instances.filter(r => r.state === 'queued').slice(0, 1)];
      if (normalized.startsWith('update coolify_supabase_instances set')) {
        let count = 0;
        for (const r of state.instances) {
          if (normalized.includes("where state='provisioning'") && r.state === 'provisioning') {
            r.state = 'needs_attention';
            count++;
          } else if (normalized.includes('server_uuid=?') && r.id === params[1]) {
            r.server_uuid = params[0];
            count++;
          } else if (normalized.includes('coolify_project_uuid=?') && r.id === params[1]) {
            r.coolify_project_uuid = params[0];
            count++;
          } else if (normalized.includes('service_uuid=?') && r.id === params[1]) {
            r.service_uuid = params[0];
            count++;
          } else if (normalized.includes("state='provisioning'") && r.id === params[0] && r.state === 'queued') {
            r.state = 'provisioning';
            count++;
          } else if (normalized.includes("state='deployment_requested'") && r.id === params[0]) {
            r.state = 'deployment_requested';
            r.last_error = null;
            count++;
          } else if (normalized.includes("state='needs_attention'") && r.id === params[1]) {
            r.state = 'needs_attention';
            r.last_error = params[0];
            count++;
          } else if (normalized.includes("state='queued'") && r.id === params[0] && r.state === 'needs_attention') {
            r.state = 'queued';
            r.last_error = null;
            count++;
          }
        }
        return [{ affectedRows: count }];
      }
      throw new Error('Unmocked SQL: ' + normalized);
    }
  };
  return { state, db };
}

test('Coolify connection accepts only clean HTTPS origin, no paths or credentials', () => {
  assert.equal(coolifyBaseUrl('https://coolify.example.de/'), baseUrl);
  for (const url of [
    'http://coolify.example.de',
    'https://user:secret@coolify.example.de',
    'https://coolify.example.de/some/api',
    'https://coolify.example.de/?token=abc',
    'https://localhost'
  ])
    assert.throws(() => coolifyBaseUrl(url));
});

test('Coolify API uses bearer authentication, no redirects, and accepts only internal endpoint paths', async () => {
  const { request, state } = coolifyMock();
  const api = createCoolifyClient({ baseUrl, token: fakeToken, request });
  assert.deepEqual(await api.projects(), []);
  assert.equal((await api.servers()).length, 1);
  assert.equal(state.requests[0].authorization, 'Bearer ' + fakeToken);
  assert.throws(() => api.service('../../metadata'));
});

test('unique Supabase per project, using the documented Coolify one-click service API', async () => {
  const { db, state } = memoryDb(),
    remote = coolifyMock();
  const encrypt = value => 'encrypted:' + value;
  const decrypt = value => value.slice('encrypted:'.length);
  const controller = createCoolifyService({ db, encrypt, decrypt, request: remote.request });
  const connection = await controller.addConnection({
    name: 'Eigene Coolify Instanz',
    baseUrl,
    token: fakeToken
  });
  assert.equal(connection.baseUrl, baseUrl);
  assert.equal(JSON.stringify(await controller.listConnections()).includes(fakeToken), false);
  assert.equal(state.connections[0].encrypted_token, 'encrypted:' + fakeToken);
  const input = { connectionId: connection.id, projectKey, name };
  assert.equal(coolifySupabaseSchema.safeParse(input).success, true);
  const first = await controller.enqueue(input);
  const second = await controller.enqueue(input);
  assert.equal(first.id, second.id);
  assert.equal(state.instances.length, 1);
  assert.equal(first.state, 'queued');
  await controller.tick();
  assert.equal(state.instances[0].state, 'deployment_requested');
  const service = remote.state.services[0];
  assert.equal(remote.state.services.length, 1);
  assert.equal(service.type, 'supabase');
  assert.equal(service.project_uuid, 'project-one');
  assert.equal(service.server_uuid, 'server-one');
  assert.equal(service.environment_name, 'production');
  assert.equal(service.instant_deploy, false);
  assert.equal(service.destination_uuid, undefined);
  assert.equal(service.force_domain_override, false);
  assert.equal(remote.state.starts.length, 1);
  const status = await controller.status(first.id);
  assert.equal(status.serviceUuid, 'supabase-one');
  assert.equal(status.remote.serviceType, 'supabase');
  assert.ok(!JSON.stringify(status).includes(fakeToken));
  assert.ok(!JSON.stringify(status).includes('service_role'));
  await controller.tick();
  assert.equal(remote.state.services.length, 1);
  assert.equal(remote.state.starts.length, 1);
});

test('explicit Coolify destination is persisted and forwarded without leaking project metadata', async () => {
  const { db } = memoryDb(),
    remote = coolifyMock();
  const ctl = createCoolifyService({
    db,
    encrypt: x => 'encrypted:' + x,
    decrypt: x => x.slice(10),
    request: remote.request
  });
  const connection = await ctl.addConnection({ name: 'Coolify', baseUrl, token: fakeToken });
  const created = await ctl.enqueue({
    connectionId: connection.id,
    projectKey,
    name,
    destinationUuid: 'docker-main',
    siteopsProjectId: '22222222-2222-4222-8222-222222222222'
  });
  assert.equal(created.destinationUuid, 'docker-main');
  await ctl.tick();
  assert.equal(remote.state.services[0].destination_uuid, 'docker-main');
  assert.equal(remote.state.services.length, 1);
  assert.equal(remote.state.starts.length, 1);
});

test('remote reconciliation after interrupted project/service API succeeds without second creation', async () => {
  const { db, state } = memoryDb(),
    remote = coolifyMock();
  const enc = value => 'encoded:' + value,
    dec = value => value.slice(8);
  const service = createCoolifyService({ db, encrypt: enc, decrypt: dec, request: remote.request });
  const connection = await service.addConnection({ name: 'Production', baseUrl, token: fakeToken });
  const created = await service.enqueue({ connectionId: connection.id, projectKey, name });
  // Simulate remote POSTs having succeeded, while database checkpoint writes were interrupted.
  remote.state.projects.push({
    uuid: 'project-one',
    name: 'SiteOps meine-app',
    description: 'Managed by SiteOps / supabase / meine-app'
  });
  remote.state.services.push({
    uuid: 'supabase-one',
    name: 'siteops-supabase-meine-app',
    description: 'Managed by SiteOps / supabase / meine-app',
    service_type: 'supabase'
  });
  await service.tick();
  assert.equal(remote.state.projects.length, 1);
  assert.equal(remote.state.services.length, 1);
  assert.equal(remote.state.starts.length, 1);
  assert.equal((await service.status(created.id)).state, 'deployment_requested');
  assert.equal(state.instances.length, 1);
});

test('preexisting Coolify resources with same name but wrong SiteOps marker are rejected', async () => {
  const { db } = memoryDb(),
    remote = coolifyMock();
  const controller = createCoolifyService({ db, encrypt: x => x, decrypt: x => x, request: remote.request });
  const connection = await controller.addConnection({ name: 'Coolify', baseUrl, token: fakeToken });
  const job = await controller.enqueue({ connectionId: connection.id, projectKey, name });
  remote.state.projects.push({
    uuid: 'another-project',
    name: 'SiteOps meine-app',
    description: 'not managed by SiteOps'
  });
  await controller.tick();
  const status = await controller.status(job.id);
  assert.equal(status.state, 'needs_attention');
  assert.match(status.lastError, /Namenskonflikt/);
  assert.equal(remote.state.services.length, 0);
  assert.equal(remote.state.starts.length, 0);
});

test('API errors and project mismatch do not return secrets or modify an unrelated project', async () => {
  const { db } = memoryDb(),
    remote = coolifyMock();
  const controller = createCoolifyService({
    db,
    encrypt: x => 'encrypted:' + x,
    decrypt: x => x.slice(10),
    request: remote.request
  });
  const connection = await controller.addConnection({ name: 'Production', baseUrl, token: fakeToken });
  await controller.enqueue({ connectionId: connection.id, projectKey, name });
  await assert.rejects(
    () =>
      controller.enqueue({
        connectionId: connection.id,
        projectKey,
        name,
        coolifyProjectUuid: 'different-existing-project'
      }),
    /anderer Projekt- oder Serverzuordnung/
  );
});

test('updating Coolify connection retains token, checks HTTPS URL syntax and never leaks it', async () => {
  const { db, state } = memoryDb();
  const remote = coolifyMock();
  const service = createCoolifyService({
    db,
    encrypt: value => 'enc:' + value,
    decrypt: value => value.slice(4),
    request: remote.request
  });
  const original = await service.addConnection({
    name: 'Coolify Test',
    baseUrl,
    token: fakeToken,
    defaultServerUuid: 'server-one'
  });
  const storedEncrypted = state.connections[0].encrypted_token;
  const modified = await service.updateConnection(original.id, {
    name: 'Coolify Produktiv',
    baseUrl: baseUrl + '/',
    defaultServerUuid: null
  });
  assert.equal(modified.name, 'Coolify Produktiv');
  assert.equal(modified.defaultServerUuid, null);
  assert.equal(state.connections[0].encrypted_token, storedEncrypted);
  assert.equal(modified.baseUrl, baseUrl);
  assert.ok(!JSON.stringify(await service.listConnections()).includes(fakeToken));
  const saved = await service.listConnections();
  assert.equal(saved[0].name, 'Coolify Produktiv');
  assert.equal(saved[0].defaultServerUuid, null);
  assert.ok(state.q.some(item => item.sql.startsWith('update coolify_connections')));

  await assert.rejects(
    () =>
      service.updateConnection(original.id, { name: 'Invalid endpoint', baseUrl: 'https://coolify.example.de/api/v1' }),
    /HTTPS-URL ohne Pfad/
  );
  assert.equal(state.connections[0].name, 'Coolify Produktiv');
  await assert.rejects(
    () => service.updateConnection('22222222-2222-4222-8222-222222222222', { name: 'Other', baseUrl }),
    /nicht gefunden/
  );
});

test('saved Coolify connections are visible on the page and the submit script no longer silently reloads', async () => {
  const html = renderCoolifyWorkspace(
    [{ id: connectionId, name: 'Coolify Produktiv', baseUrl, defaultServerUuid: 'server-one' }],
    [],
    x => String(x).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  );
  assert.match(html, /Gespeicherte Coolify-Verbindungen/);
  assert.match(html, /data-coolify-edit/);
  assert.match(html, /Coolify Produktiv/);
  assert.match(html, /id="coolifySaveStatus"/);
  assert.match(html, /id="coolifyCancelEdit"/);
  assert.doesNotMatch(html, /secret-test-token/);
  const script = await readFile(new URL('../public/coolify.js', import.meta.url), 'utf8');
  assert.doesNotMatch(script, /window\.location\.reload/);
  assert.match(script, /refreshConnections\(saved\.id\)/);
  assert.match(script, /method: isEdit \? 'PUT' : 'POST'/);
  assert.match(script, /tokenField\.required = !connection/);
});

test('Coolify credentials remain saved when the remote API is offline', async () => {
  const { db, state } = memoryDb();
  const service = createCoolifyService({
    db,
    encrypt: x => 'encrypted:' + x,
    decrypt: x => x.slice(10),
    request: async () => {
      throw new Error('Remote server offline');
    }
  });
  const original = await service.addConnection({ name: 'Offline Coolify', baseUrl, token: fakeToken });
  assert.equal((await service.listConnections())[0].id, original.id);
  assert.equal(state.connections[0].encrypted_token, 'encrypted:' + fakeToken);
  await assert.rejects(() => service.connectionInfo(original.id), /API nicht erreichbar/);
  const edited = await service.updateConnection(original.id, { name: 'Offline Updated', baseUrl });
  assert.equal(edited.name, 'Offline Updated');
  assert.equal((await service.listConnections())[0].name, 'Offline Updated');
  assert.equal(state.connections[0].encrypted_token, 'encrypted:' + fakeToken);
});

test('Coolify browser script is served explicitly with fresh build URL', async () => {
  const app = await readFile(new URL('../app.mjs', import.meta.url), 'utf8');
  assert.ok(app.includes("app.get('/assets/coolify.js'"));
  assert.ok(app.includes("new URL('./public/coolify.js', import.meta.url)"));
  assert.ok(app.includes('coolify.js?v='));
  const script = await readFile(new URL('../public/coolify.js', import.meta.url), 'utf8');
  assert.match(script, /Verbindung prüfen/);
  assert.match(script, /ist gespeichert, aber die API-Prüfung scheitert/);
});

test('read-only discovery finds manually created Coolify services without exposing secrets', async () => {
  const { db } = memoryDb(),
    remote = coolifyMock();
  const ctl = createCoolifyService({
    db,
    encrypt: s => 'encrypted:' + s,
    decrypt: s => s.slice('encrypted:'.length),
    request: remote.request
  });
  const conn = await ctl.addConnection({ name: 'Saved Coolify', baseUrl, token: fakeToken });
  remote.state.services.push({
    uuid: 'manual-supabase-01',
    name: 'supabase schleishare',
    service_type: 'supabase',
    environment_id: 1,
    server_id: 1,
    docker_compose_raw: 'sensitive-secret',
    environment_variables: ['other-secret']
  });
  const listed = await ctl.remoteServices(conn.id);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, 'supabase schleishare');
  assert.equal(listed[0].serviceType, 'supabase');
  assert.equal(JSON.stringify(listed).includes('sensitive-secret'), false);
  assert.equal(JSON.stringify(listed).includes('other-secret'), false);
  const detail = await ctl.remoteServiceInfo(conn.id, 'manual-supabase-01');
  assert.equal(detail.uuid, 'manual-supabase-01');
  assert.equal(JSON.stringify(detail).includes('sensitive-secret'), false);
  await assert.rejects(() => ctl.remoteServiceInfo(conn.id, '../../etc/passwd'));
  assert.equal(remote.state.services.length, 1);
  assert.equal(remote.state.starts.length, 0);
});
