import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  coolifyGitApplicationSchema,
  coolifyProjectCreateSchema,
  createCoolifyGitService
} from '../lib/coolify-git.mjs';
import { createCoolifyClient } from '../lib/coolify.mjs';

const connectionId = '11111111-1111-4111-8111-111111111111';
const token = 'test-secret-coolify-token';
const baseUrl = 'https://coolify.example.de';
const projectUuid = 'project-one';
const appUuid = 'git-app-one';
const input = {
  connectionId,
  projectUuid,
  appKey: 'web-app',
  name: 'Website App',
  gitRepository: 'https://github.com/example/app',
  gitBranch: 'main',
  buildPack: 'nixpacks',
  portsExposes: '3000'
};

function setup() {
  const data = { projects: [], apps: [], posts: [], deployments: [], envs: [] };
  const apiResult = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body)
  });
  const request = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer ' + token);
    const path = new URL(url).pathname;
    data.posts.push({ path, method: options.method, body: options.body ? JSON.parse(options.body) : null });
    if (path === '/api/v1/projects' && options.method === 'GET') return apiResult(data.projects);
    if (path === '/api/v1/projects' && options.method === 'POST') {
      const project = { uuid: projectUuid, ...JSON.parse(options.body) };
      data.projects.push(project);
      return apiResult(project, 201);
    }
    if (path === '/api/v1/github-apps')
      return apiResult([
        {
          uuid: 'gh-app-one',
          name: 'Lorzen GitHub',
          organization: 'derlorzen',
          is_public: false,
          client_secret: 'LEAK'
        }
      ]);
    if (path === '/api/v1/security/keys')
      return apiResult([
        { uuid: 'key-one', name: 'deploy', description: 'Marktschreier', private_key: 'DO-NOT-LEAK-KEY' },
        { uuid: 'key-app', name: 'github-app-key', is_git_related: true, private_key: 'DO-NOT-LEAK-APP-KEY' }
      ]);
    if (path === '/api/v1/servers') return apiResult([{ uuid: 'server-one', name: 'Docker A' }]);
    if (path === '/api/v1/applications' && options.method === 'GET') return apiResult(data.apps);
    if (path.endsWith('/envs/bulk') && options.method === 'PATCH') {
      data.envs.push({ path, body: JSON.parse(options.body) });
      return apiResult({ message: 'ok' });
    }
    if (path.startsWith('/api/v1/applications/') && options.method === 'POST') {
      if (path.endsWith('/start')) {
        data.deployments.push(path);
        return apiResult({ deployment_uuid: 'deploy-one', message: 'Deployment request queued.' });
      }
      const app = { uuid: appUuid, ...JSON.parse(options.body) };
      app.git_repository = app.git_repository || '';
      app.git_branch = app.git_branch || '';
      app.build_pack = app.build_pack || '';
      app.status = 'exited';
      data.apps.push(app);
      return apiResult(app, 201);
    }
    if (path === '/api/v1/applications/' + appUuid && options.method === 'GET') {
      return apiResult({
        ...data.apps[0],
        http_basic_auth_password: 'DO-NOT-LEAK',
        environment_variables: [{ key: 'PASSWORD', value: 'ANOTHER-SECRET' }]
      });
    }
    throw new Error('Unexpected Coolify request ' + options.method + ' ' + path);
  };
  const db = {
    getConnection: async () => ({
      query: async sql => {
        if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired: 1 }]];
        if (sql.startsWith('SELECT RELEASE_LOCK')) return [[{ acquired: 1 }]];
        throw new Error('Unexpected lock SQL');
      },
      release() {}
    })
  };
  const service = createCoolifyGitService({
    db,
    loadConnection: async id => {
      assert.equal(id, connectionId);
      return { id, base_url: baseUrl, encrypted_token: 'encrypted', default_server_uuid: null };
    },
    makeClient: () => createCoolifyClient({ baseUrl, token, request })
  });
  return { data, service };
}

test('regular Coolify project creation is idempotent and rejects foreign projects', async () => {
  const { service, data } = setup();
  const command = { connectionId, projectKey: 'my-project', name: 'My Project' };
  assert.equal(coolifyProjectCreateSchema.safeParse(command).success, true);
  const first = await service.createProject(command);
  const second = await service.createProject(command);
  assert.equal(first.uuid, projectUuid);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(data.projects.length, 1);
  assert.equal(data.posts.filter(x => x.path === '/api/v1/projects' && x.method === 'POST').length, 1);
  assert.match(data.projects[0].description, /^SiteOps\/project\//);
  await assert.rejects(() => service.createProject({ ...command, name: 'Renamed' }), /abweichender/);
  await assert.rejects(
    () => service.createProject({ connectionId, projectKey: 'other-project', name: 'My Project' }),
    /abweichender/
  );
});

test('public Git app creation uses documented API and never creates duplicates', async () => {
  const { service, data } = setup();
  data.projects.push({ uuid: projectUuid, name: 'My Project' });
  const first = await service.createApplication({
    ...input,
    deployNow: true,
    autoDeploy: false,
    domain: 'https://app.example.de'
  });
  assert.equal(first.uuid, appUuid);
  assert.equal(first.created, true);
  assert.equal(first.deploymentRequested, true);
  const createCall = data.posts.find(x => x.path === '/api/v1/applications/public' && x.method === 'POST');
  assert.equal(createCall.body.project_uuid, projectUuid);
  assert.equal(createCall.body.server_uuid, 'server-one');
  assert.equal(createCall.body.environment_name, 'production');
  assert.equal(createCall.body.git_repository, input.gitRepository);
  assert.equal(createCall.body.git_branch, 'main');
  assert.equal(createCall.body.build_pack, 'nixpacks');
  assert.equal(createCall.body.instant_deploy, true);
  assert.equal(createCall.body.is_auto_deploy_enabled, false);
  assert.equal(createCall.body.domains, 'https://app.example.de');
  assert.equal(createCall.body.force_domain_override, false);
  const second = await service.createApplication({
    ...input,
    deployNow: true,
    autoDeploy: false,
    domain: 'https://app.example.de'
  });
  assert.equal(second.created, false);
  assert.equal(second.deploymentRequested, false);
  assert.equal(data.apps.length, 1);
  assert.equal(data.posts.filter(x => x.path === '/api/v1/applications/public').length, 1);
  await assert.rejects(() => service.createApplication({ ...input, gitBranch: 'develop' }), /abweichender/);
  const safe = await service.applicationInfo(connectionId, appUuid);
  assert.equal(safe.gitRepository, input.gitRepository);
  assert.doesNotMatch(JSON.stringify(safe), /DO-NOT-LEAK|ANOTHER-SECRET/);
  const deployed = await service.deployApplication({ connectionId, applicationUuid: appUuid });
  assert.equal(deployed.state, 'deployment_requested');
  assert.equal(deployed.deploymentUuid, 'deploy-one');
  assert.deepEqual(data.deployments, ['/api/v1/applications/' + appUuid + '/start']);
});

test('private Git apps require existing credential UUID and use separate API endpoint', async () => {
  for (const variant of [
    { sourceType: 'private-deploy-key', sourceUuid: 'deploy-key-one', field: 'private_key_uuid' },
    { sourceType: 'private-github-app', sourceUuid: 'github-app-one', field: 'github_app_uuid' }
  ]) {
    const { service, data } = setup();
    data.projects.push({ uuid: projectUuid, name: 'My Project' });
    await service.createApplication({ ...input, ...variant, gitRepository: 'git@github.com:example/private.git' });
    const created = data.posts.find(x => x.path === '/api/v1/applications/' + variant.sourceType);
    assert.equal(created.body[variant.field], variant.sourceUuid);
    assert.equal(created.body.instant_deploy, false);
  }
  assert.equal(coolifyGitApplicationSchema.safeParse({ ...input, sourceType: 'private-deploy-key' }).success, false);
  assert.equal(
    coolifyGitApplicationSchema.safeParse({ ...input, gitRepository: 'git@github.com:foo/bar' }).success,
    false
  );
});

test('rejects unsafe credentials in repository URLs and unknown project/server', async () => {
  for (const gitRepository of [
    'https://user:secret@github.com/team/repo',
    'http://github.com/team/repo',
    'https://localhost/team/repo',
    'https://192.168.1.5/team/repo',
    'https://github.com/team/repo?token=abc'
  ])
    assert.equal(coolifyGitApplicationSchema.safeParse({ ...input, gitRepository }).success, false);
  const { service, data } = setup();
  await assert.rejects(() => service.createApplication(input), /gehört nicht/);
  data.projects.push({ uuid: projectUuid, name: 'My Project' });
  await assert.rejects(
    () => service.createApplication({ ...input, serverUuid: 'server-wrong' }),
    /gültigen Coolify-Server/
  );
});

test('Compose apps get service domains, compose path and variables before the deployment', async () => {
  const { service, data } = setup();
  data.projects.push({ uuid: projectUuid, name: 'My Project' });
  const command = {
    ...input,
    buildPack: 'dockercompose',
    portsExposes: '8080',
    dockerComposeLocation: '/docker-compose.yml',
    dockerComposeDomains: [{ service: 'app', domain: 'https://shop.example.de:8080' }],
    environment: [
      { key: 'APP_KEY', value: 'base64:TOP-SECRET-VALUE' },
      { key: 'APP_URL', value: 'https://shop.example.de' }
    ],
    deployNow: true
  };
  const result = await service.createApplication(command);
  assert.equal(result.deploymentRequested, true);
  assert.deepEqual(result.environmentKeys, ['APP_KEY', 'APP_URL']);
  assert.doesNotMatch(JSON.stringify(result), /TOP-SECRET/);
  const create = data.posts.find(x => x.path === '/api/v1/applications/public');
  assert.equal(create.body.instant_deploy, false);
  assert.equal(create.body.docker_compose_location, '/docker-compose.yml');
  assert.deepEqual(create.body.docker_compose_domains, [{ name: 'app', domain: 'https://shop.example.de:8080' }]);
  assert.equal(create.body.domains, undefined);
  assert.doesNotMatch(create.body.description, /TOP-SECRET/);
  assert.equal(data.envs.length, 1);
  assert.equal(data.envs[0].path, '/api/v1/applications/' + appUuid + '/envs/bulk');
  assert.equal(data.envs[0].body.data[0].key, 'APP_KEY');
  assert.equal(data.envs[0].body.data[0].is_literal, true);
  assert.equal(data.envs[0].body.data[0].is_buildtime, true);
  const order = data.posts.map(x => x.method + ' ' + x.path);
  assert.ok(
    order.indexOf('PATCH /api/v1/applications/' + appUuid + '/envs/bulk') <
      order.indexOf('POST /api/v1/applications/' + appUuid + '/start')
  );
  const again = await service.createApplication(command);
  assert.equal(again.created, false);
  assert.equal(data.envs.length, 1);
  await assert.rejects(
    () => service.createApplication({ ...command, environment: [{ key: 'OTHER', value: 'x' }] }),
    /abweichender/
  );
  await assert.rejects(
    () =>
      service.createApplication({
        ...command,
        environment: command.environment.map(item => ({ ...item, buildTime: false }))
      }),
    /abweichender/
  );
  for (const bad of [
    { ...command, buildPack: 'nixpacks' },
    { ...command, domain: 'https://shop.example.de' },
    { ...command, environment: [{ key: 'lower', value: 'x' }] },
    {
      ...command,
      environment: [
        { key: 'A', value: '1' },
        { key: 'A', value: '2' }
      ]
    },
    { ...command, dockerComposeDomains: [{ service: 'app', domain: 'http://shop.example.de' }] },
    { ...command, dockerComposeLocation: '/compose.json' }
  ])
    assert.equal(coolifyGitApplicationSchema.safeParse(bad).success, false);
});

test('Coolify dashboard and MCP publish regular projects and Git apps', async () => {
  const app = await readFile(new URL('../app.mjs', import.meta.url), 'utf8');
  const ui = await readFile(new URL('../lib/coolify-ui.mjs', import.meta.url), 'utf8');
  const script = await readFile(new URL('../public/coolify.js', import.meta.url), 'utf8');
  assert.match(app, /coolify_project_create/);
  assert.match(app, /coolify_app_create/);
  assert.match(app, /coolify_app_deploy/);
  assert.match(app, /\/api\/coolify\/applications/);
  assert.match(ui, /coolifyProjectCreate/);
  assert.match(ui, /coolifyGitAppCreate/);
  assert.match(ui, /coolifyAppProject/);
  assert.match(script, /updateAppTargets/);
  assert.match(script, /refreshApps/);
});

test('git sources list exposes only uuid, name and type, never key material', async () => {
  const { service } = setup();
  const result = await service.sources(connectionId);
  assert.deepEqual(
    result.map(x => [x.sourceType, x.uuid, x.name]),
    [
      ['private-github-app', 'gh-app-one', 'Lorzen GitHub'],
      ['private-deploy-key', 'key-one', 'deploy']
    ]
  );
  const text = JSON.stringify(result);
  assert.doesNotMatch(text, /LEAK/);
});
