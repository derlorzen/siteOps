import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCoolifyExecService, validateArgs, validateCommand } from '../lib/coolify-exec.mjs';
import { createCoolifyClient } from '../lib/coolify.mjs';

const connectionId = '11111111-1111-4111-8111-111111111111';
const token = 'test-secret-coolify-token';
const baseUrl = 'https://coolify.example.de';
const appUuid = 'app-one';

function setup({ executionStatus = 'success', never = false } = {}) {
  const state = { commands: [], runs: [], tasks: [], executions: [], calls: [] };
  const apiResult = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body)
  });
  const request = async (url, options) => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const body = options.body ? JSON.parse(options.body) : null;
    state.calls.push({ method: options.method, path, query: parsed.search, body });
    if (path === '/api/v1/applications' && options.method === 'GET') return apiResult([{ uuid: appUuid, name: 'A' }]);
    const base = '/api/v1/applications/' + appUuid;
    if (path === base + '/scheduled-tasks' && options.method === 'GET') return apiResult(state.tasks);
    if (path === base + '/scheduled-tasks' && options.method === 'POST') {
      const task = { uuid: 'task-' + (state.tasks.length + 1), ...body };
      state.tasks.push(task);
      return apiResult(task, 201);
    }
    if (path.endsWith('/execute')) {
      if (!never)
        state.executions.unshift({
          uuid: 'exec-' + (state.executions.length + 1),
          status: executionStatus,
          message: 'done Bearer abc123 ok'
        });
      return apiResult({ message: 'ok' });
    }
    if (path.endsWith('/executions')) return apiResult(state.executions);
    if (path === base + '/logs') return apiResult({ logs: 'line one\nBearer topsecret\nline three' });
    if (path === base + '/restart') return apiResult({ message: 'Restart request queued.', deployment_uuid: 'dep-1' });
    throw new Error('Unexpected Coolify request ' + options.method + ' ' + path);
  };
  const db = {
    query: async (sql, params = []) => {
      if (sql.startsWith('INSERT INTO coolify_commands')) {
        if (state.commands.some(c => c[1] === params[1] && c[2] === params[2] && c[3] === params[3]))
          throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
        state.commands.push(params);
        return [{ affectedRows: 1 }];
      }
      if (
        sql.startsWith('SELECT * FROM coolify_commands WHERE connection_id=? AND application_uuid=? AND command_key=?')
      ) {
        const found = state.commands.find(c => c[1] === params[0] && c[2] === params[1] && c[3] === params[2]);
        return [
          found
            ? [
                {
                  id: found[0],
                  connection_id: found[1],
                  application_uuid: found[2],
                  command_key: found[3],
                  label: found[4],
                  command: found[5],
                  container: found[6],
                  allow_args: found[7]
                }
              ]
            : []
        ];
      }
      if (sql.startsWith('INSERT INTO coolify_command_runs')) {
        state.runs.push({ id: params[0], key: params[3], argCount: params[4], state: 'started' });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE coolify_command_runs')) {
        state.runs.find(r => r.id === params[1]).state = params[0];
        return [{ affectedRows: 1 }];
      }
      throw new Error('Unexpected SQL ' + sql);
    }
  };
  const service = createCoolifyExecService({
    db,
    loadConnection: async id => {
      assert.equal(id, connectionId);
      return { id, base_url: baseUrl, encrypted_token: 'encrypted' };
    },
    makeClient: () => createCoolifyClient({ baseUrl, token, request }),
    sleep: async () => {}
  });
  return { state, service };
}

const define = (service, extra = {}) =>
  service.defineCommand({
    connectionId,
    applicationUuid: appUuid,
    commandKey: 'create-user',
    label: 'Benutzer anlegen',
    command: 'php artisan marktschreier:user',
    container: 'app',
    allowArgs: true,
    ...extra
  });

test('command validation rejects shells, metacharacters and code-execution flags', () => {
  assert.equal(validateCommand('php artisan marktschreier:user'), 'php artisan marktschreier:user');
  for (const bad of [
    'bash -c ls',
    'sh',
    'php artisan tinker',
    'php -r phpinfo()',
    'ls; rm -rf /',
    'ls && id',
    'cat $(id)',
    'echo `id`',
    'php a|b',
    "php 'x'",
    'php artisan\nmigrate',
    '/bin/ls',
    '-rf',
    'cat ../etc/passwd',
    'docker ps'
  ])
    assert.throws(() => validateCommand(bad), undefined, bad);
  assert.throws(() => validateCommand('a b c d e f g h i j k l m'), /leer oder zu lang/);
  assert.deepEqual(validateArgs(['--email=a@b.de', 'name']), ['--email=a@b.de', 'name']);
  assert.throws(() => validateArgs(['x;id']));
  assert.throws(() => validateArgs(['$(id)']));
  assert.throws(() => validateArgs(['tinker']));
  assert.throws(() => validateArgs(Array(9).fill('a')), /Zu viele/);
});

test('defining a command validates it and rejects duplicates', async () => {
  const { service } = setup();
  const created = await define(service);
  assert.equal(created.commandKey, 'create-user');
  assert.equal(created.allowArgs, true);
  await assert.rejects(() => define(service), /bereits/);
  await assert.rejects(() => define(service, { commandKey: 'other-one', command: 'bash -c id' }), /nicht erlaubt/);
});

test('only allowlisted commands run, via a disabled Coolify task', async () => {
  const { service, state } = setup();
  await define(service);
  await assert.rejects(
    () => service.runCommand({ connectionId, applicationUuid: appUuid, commandKey: 'unknown-key' }),
    /Allowlist/
  );
  const result = await service.runCommand({
    connectionId,
    applicationUuid: appUuid,
    commandKey: 'create-user',
    args: ['Benny', 'benny@example.de']
  });
  assert.equal(result.status, 'success');
  assert.equal(result.finished, true);
  assert.match(result.output, /Bearer \[redacted\]/);
  assert.doesNotMatch(result.output, /abc123/);
  const created = state.calls.find(c => c.method === 'POST' && c.path.endsWith('/scheduled-tasks'));
  assert.equal(created.body.command, 'php artisan marktschreier:user Benny benny@example.de');
  assert.equal(created.body.enabled, false);
  assert.equal(created.body.container, 'app');
  assert.match(created.body.name, /^siteops-cmd-[0-9a-f]{16}$/);
  assert.equal(state.calls.filter(c => c.path.endsWith('/execute')).length, 1);
  // Audit stores the key and argument count, never the argument values.
  assert.deepEqual(
    state.runs.map(r => [r.key, r.argCount, r.state]),
    [['create-user', 2, 'success']]
  );
  assert.doesNotMatch(JSON.stringify(state.runs), /Benny|example\.de/);
});

test('the same command reuses its task instead of creating another', async () => {
  const { service, state } = setup();
  await define(service);
  const run = () =>
    service.runCommand({ connectionId, applicationUuid: appUuid, commandKey: 'create-user', args: ['x'] });
  await run();
  await run();
  assert.equal(state.tasks.length, 1);
  assert.equal(state.calls.filter(c => c.path.endsWith('/execute')).length, 2);
});

test('arguments are refused when the entry does not allow them or contain unsafe characters', async () => {
  const { service } = setup();
  await define(service, { commandKey: 'fixed-one', command: 'php artisan about', allowArgs: false });
  await assert.rejects(
    () => service.runCommand({ connectionId, applicationUuid: appUuid, commandKey: 'fixed-one', args: ['x'] }),
    /keine Argumente/
  );
  await define(service);
  await assert.rejects(
    () => service.runCommand({ connectionId, applicationUuid: appUuid, commandKey: 'create-user', args: ['a;id'] }),
    /nicht erlaubt|Sonderzeichen/
  );
});

test('a run without a Coolify answer reports running instead of failing', async () => {
  const { service, state } = setup({ never: true });
  await define(service);
  const result = await service.runCommand({ connectionId, applicationUuid: appUuid, commandKey: 'create-user' });
  assert.equal(result.status, 'running');
  assert.equal(result.finished, false);
  assert.equal(state.runs[0].state, 'running');
});

test('logs are limited, redacted and need a known application', async () => {
  const { service, state } = setup();
  const result = await service.logs({ connectionId, applicationUuid: appUuid, lines: 50, serviceName: 'app' });
  assert.match(result.logs, /line one/);
  assert.doesNotMatch(result.logs, /topsecret/);
  const call = state.calls.find(c => c.path.endsWith('/logs'));
  assert.equal(call.query, '?lines=50&service_name=app');
  await assert.rejects(() => service.logs({ connectionId, applicationUuid: appUuid, lines: 5000 }));
  await assert.rejects(
    () => service.logs({ connectionId, applicationUuid: 'unknown-app', lines: 10 }),
    /nicht in dieser/
  );
});

test('restart queues a Coolify restart for a known application only', async () => {
  const { service } = setup();
  const result = await service.restart({ connectionId, applicationUuid: appUuid });
  assert.equal(result.state, 'restart_requested');
  assert.equal(result.deploymentUuid, 'dep-1');
  await assert.rejects(() => service.restart({ connectionId, applicationUuid: 'unknown-app' }), /nicht in dieser/);
});
