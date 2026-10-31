import test from 'node:test';
import assert from 'node:assert/strict';
import * as z from 'zod/v4';
import { createCapabilityRegistry, publicError, toolResult, capabilityPolicy } from '../lib/capability-registry.mjs';
import { createActionApprovals } from '../lib/action-approvals.mjs';

test('read-only annotations cannot authorize an unknown operation; writes fail closed', async () => {
  assert.equal(capabilityPolicy('unknown_shell_command', { annotations: { readOnlyHint: true } }).approval, true);
  const registered = {},
    audit = [];
  let calls = 0;
  const registry = createCapabilityRegistry({
    principal: () => ({ type: 'oauth', scope: 'siteops:access' }),
    approvals: { consume: async () => assert.fail() },
    audit: async row => audit.push(row)
  });
  const server = registry.instrument({
    registerTool: (name, config, run) => {
      registered[name] = { config, run };
    }
  });
  server.registerTool('dangerous_write', { inputSchema: z.object({ target: z.string() }) }, async () => {
    calls++;
    return toolResult({ ok: true });
  });
  const response = await registered.dangerous_write.run({ target: 'demo' });
  assert.equal(response.isError, true);
  assert.equal(response.structuredContent.error.code, 'PERMISSION_DENIED');
  assert.equal(calls, 0);
  assert.equal(audit[0].statusCode, 422);
});
test('tool failures stay failures, redact provider details and carry machine-readable next actions', async () => {
  const tools = {};
  const registry = createCapabilityRegistry({
    principal: () => ({ type: 'oauth', scope: 'siteops:access' }),
    approvals: {}
  });
  const server = registry.instrument({
    registerTool: (name, _config, run) => {
      tools[name] = run;
    }
  });
  server.registerTool('site_get', { inputSchema: z.object({ site: z.string() }) }, async () => {
    throw Object.assign(Error('password=super-secret'), { statusCode: 502 });
  });
  const result = await tools.site_get({ site: 'studio' });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error.retryable, true);
  assert.doesNotMatch(JSON.stringify(result), /super-secret/);
  assert.equal(
    toolResult({ password: 'secret', nested: { access_token: 'secret' }, approval_token: 'action-handle' })
      .structuredContent.data.password,
    '[Geschützt]'
  );
  assert.equal(
    publicError(new z.ZodError([{ code: 'custom', path: ['domain'], message: 'secret' }])).fields[0].path,
    'domain'
  );
});
test('critical callbacks cannot run until the shared approval service accepts the exact action', async () => {
  const tools = {};
  let calls = 0,
    consumed;
  const registry = createCapabilityRegistry({
    principal: () => ({ type: 'oauth', subject: 'owner', clientId: 'client-a', scope: 'siteops:access siteops:write' }),
    state: async () => ({ revision: 2 }),
    approvals: {
      consume: async input => {
        consumed = input;
        if (!input.id) throw Object.assign(Error('blocked'), { statusCode: 403, publicCode: 'APPROVAL_REQUIRED' });
      }
    }
  });
  const server = registry.instrument({
    registerTool: (name, _config, run) => {
      tools[name] = run;
    }
  });
  server.registerTool('change_apply', { inputSchema: z.object({ preview_id: z.string() }) }, async () => {
    calls++;
    return toolResult({ verified: true });
  });
  assert.equal((await tools.change_apply({ preview_id: 'preview' })).isError, true);
  assert.equal(calls, 0);
  assert.equal(
    (await tools.change_apply({ preview_id: 'preview', approval_id: '11111111-1111-4111-8111-111111111111' })).isError,
    undefined
  );
  assert.deepEqual(consumed.args, { preview_id: 'preview' });
  assert.deepEqual(consumed.state, { revision: 2 });
  assert.equal(calls, 1);
});
test('a negative provider result remains a failed business action even when HTTP succeeds', async () => {
  let execute;
  const audited = [];
  const registry = createCapabilityRegistry({
    principal: () => ({ type: 'dashboard_session', subject: 'owner' }),
    approvals: {},
    audit: async value => audited.push(value)
  });
  registry
    .instrument({
      registerTool: (_name, _config, run) => {
        execute = run;
      }
    })
    .registerTool(
      'local_attempt',
      { inputSchema: z.object({}), _siteops: { access: 'write', approval: false } },
      async () => toolResult({ ok: false, confirmed: false })
    );
  const result = await execute({});
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.data.confirmed, false);
  assert.equal(audited[0].statusCode, 422);
});
test('approval is expiring, encrypted, user/client/argument/state bound and consumed atomically once', async () => {
  let row;
  const actor = { type: 'oauth', subject: 'owner', clientId: 'client-a' };
  const db = {
    query: async (sql, p) => {
      if (sql.startsWith('INSERT')) {
        row = {
          id: p[0],
          owner: p[1],
          tool: p[2],
          enc: p[3],
          args: p[4],
          state: p[5],
          expires: p[6],
          status: 'pending'
        };
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("status='approved'") && sql.includes('approved_by')) {
        if (row.status !== 'pending') return [{ affectedRows: 0 }];
        row.status = 'approved';
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("status='consumed'")) {
        const match =
          row.id === p[0] &&
          row.owner === p[1] &&
          row.tool === p[2] &&
          row.args === p[3] &&
          row.state === p[4] &&
          row.status === 'approved';
        if (match) row.status = 'consumed';
        return [{ affectedRows: match ? 1 : 0 }];
      }
      throw Error('Unexpected query');
    }
  };
  const service = createActionApprovals({
    db,
    encrypt: value => 'encrypted:' + JSON.stringify(value),
    decrypt: value => JSON.parse(value.slice(10)),
    now: () => 0
  });
  const draft = await service.prepare({
    tool: 'deploy',
    args: { password: 'secret', target: 'studio' },
    state: { revision: 1 },
    actor
  });
  assert.equal(draft.arguments.password, '[Geschützt]');
  assert.equal(draft.status, 'pending');
  assert.equal(draft.expires_at, '1970-01-01T00:10:00.000Z');
  await assert.rejects(service.approve(draft.id, actor), { statusCode: 403 });
  await service.approve(draft.id, { type: 'dashboard_session', subject: 'owner' });
  const input = {
    id: draft.id,
    tool: 'deploy',
    args: { password: 'secret', target: 'studio' },
    state: { revision: 1 },
    actor
  };
  await assert.rejects(service.consume({ ...input, actor: { ...actor, clientId: 'other' } }), { statusCode: 409 });
  await assert.rejects(service.consume({ ...input, args: { ...input.args, target: 'other' } }), { statusCode: 409 });
  await assert.rejects(service.consume({ ...input, state: { revision: 2 } }), { statusCode: 409 });
  await service.consume(input);
  await assert.rejects(service.consume(input), { statusCode: 409 });
});
