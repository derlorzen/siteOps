import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import * as z from 'zod/v4';
import { configuredApprovalMode, mcpOperatingInstructions } from '../lib/approval-mode.mjs';
import { createCapabilityRegistry, toolResult } from '../lib/capability-registry.mjs';
import { registerHttpActionGuard } from '../lib/http-action-guard.mjs';
import { renderMcpAdmin } from '../lib/mcp-ui.mjs';

test('direct is the branch default; required is explicit; unknown configuration never silently disables approval', () => {
  assert.equal(configuredApprovalMode({}), 'direct');
  assert.equal(configuredApprovalMode({ SITEOPS_APPROVAL_MODE: 'required' }), 'required');
  for (const value of ['false', '', 'disabled', 'DIRECT'])
    assert.throws(() => configuredApprovalMode({ SITEOPS_APPROVAL_MODE: value }));
  assert.match(mcpOperatingInstructions('direct'), /Direktmodus/);
  assert.doesNotMatch(mcpOperatingInstructions('direct'), /mit action_prepare vorbereiten/);
  assert.match(mcpOperatingInstructions('required'), /mit action_prepare vorbereiten/);
  assert.match(renderMcpAdmin('https://example.test/mcp', 'direct'), /Arbeitsmodus: Direkt/);
});
test('direct MCP runs an authorized write once without approvals while retaining auth, write scopes and truthful metadata', async () => {
  let actor = { type: 'oauth', scope: 'siteops:access' },
    calls = 0,
    audits = 0;
  const tools = {};
  const registry = createCapabilityRegistry({
    approvalMode: 'direct',
    principal: () => actor,
    approvals: { consume: () => assert.fail('no dashboard approval in direct mode') },
    audit: async () => audits++
  });
  registry
    .instrument({
      registerTool: (name, config, run) => {
        tools[name] = { config, run };
      }
    })
    .registerTool('change_apply', { inputSchema: z.object({ target: z.string() }) }, async () => {
      calls++;
      return toolResult({ verified: true });
    });
  assert.equal(tools.change_apply.config._meta['siteops/approvalRequired'], false);
  assert.equal(tools.change_apply.config._meta['siteops/approvalMode'], 'direct');
  assert.equal(tools.change_apply.config.annotations.destructiveHint, true);
  assert.equal((await tools.change_apply.run({ target: 'own-site' })).isError, true);
  assert.equal(calls, 0);
  actor = null;
  assert.equal((await tools.change_apply.run({ target: 'own-site' })).isError, true);
  assert.equal(calls, 0);
  actor = { type: 'oauth', scope: 'siteops:access siteops:write' };
  assert.equal((await tools.change_apply.run({ target: 'own-site' })).structuredContent.data.verified, true);
  assert.equal(calls, 1);
  assert.equal(audits, 3);
});
test('direct HTTP keeps authentication hooks and does not prepare or consume an approval', async t => {
  const app = Fastify();
  t.after(() => app.close());
  let writes = 0;
  app.addHook('onRequest', async (req, reply) => {
    if (req.headers.authorization !== 'Bearer fixture') return reply.code(401).send({ error: 'sign in' });
  });
  registerHttpActionGuard(app, {
    approvalMode: 'direct',
    approvals: { prepare: () => assert.fail(), consume: () => assert.fail() },
    state: () => assert.fail()
  });
  app.post('/api/coolify/applications/app/deploy', () => ({ writes: ++writes }));
  assert.equal((await app.inject({ method: 'POST', url: '/api/coolify/applications/app/deploy' })).statusCode, 401);
  const result = await app.inject({
    method: 'POST',
    url: '/api/coolify/applications/app/deploy',
    headers: { authorization: 'Bearer fixture' }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().writes, 1);
});

test('application wires direct mode to the real MCP catalog and still rejects anonymous HTTP writes', async () => {
  const { spawnSync } = await import('node:child_process');
  const code = `
    const {mcpServer,buildApplication,db}=await import('./app.mjs');
    // Stub persistence only; exercise the real application auth and mode wiring.
    db.query=async()=>[[],[]];
    const catalog=mcpServer().siteopsCapabilities();
    const app=await buildApplication({initialize:false});
    const response=await app.inject({method:'POST',url:'/api/coolify/applications/example/deploy',payload:{}});
    console.log('RESULT:'+JSON.stringify({count:catalog.length,approvals:catalog.filter(x=>x.approval).length,status:response.statusCode}));
    await app.close();await db.end();
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      SITEOPS_TEST_NO_AUTOSTART: '1',
      SITEOPS_APPROVAL_MODE: 'direct',
      SITEOPS_MASTER_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      DASHBOARD_USER: 'test',
      DASHBOARD_PASSWORD: 'test-password'
    },
    encoding: 'utf8',
    timeout: 20000
  });
  assert.equal(result.status, 0, result.stderr);
  const line = result.stdout.split('\n').find(x => x.startsWith('RESULT:'));
  assert.ok(line, result.stdout);
  const actual = JSON.parse(line.slice(7));
  assert.ok(actual.count > 200);
  assert.equal(actual.approvals, 0);
  assert.ok([401, 403].includes(actual.status));
});
