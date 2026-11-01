import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import * as z from 'zod/v4';
import { registerHttpActionGuard } from '../lib/http-action-guard.mjs';
import { createCapabilityRegistry, toolResult } from '../lib/capability-registry.mjs';
import { createBillingController } from '../lib/billing.mjs';

test('reset needs a bound personal HTTP approval even in direct mode', async t => {
  const app = Fastify();
  t.after(() => app.close());
  let writes = 0,
    actor = { type: 'dashboard_session', subject: 'owner' },
    prepared;
  app.addHook('onRequest', async req => {
    req.siteopsAuth = actor;
  });
  registerHttpActionGuard(app, {
    approvalMode: 'direct',
    state: async () => ({ status: 'issued', paid_at: null }),
    approvals: {
      prepare: async input => {
        prepared = input;
        return { id: 'pending' };
      },
      consume: async input => {
        assert.deepEqual(input.args, prepared.args);
        assert.equal(input.state.status, 'issued');
        if (input.id !== 'approved') throw Object.assign(Error('Not approved'), { statusCode: 409 });
      }
    }
  });
  app.post('/api/billing/invoices/:id/reset-draft', () => ({ writes: ++writes }));
  const req = { method: 'POST', url: '/api/billing/invoices/original/reset-draft', payload: { reason: 'Korrektur' } };
  assert.equal((await app.inject(req)).statusCode, 428);
  assert.equal(writes, 0);
  assert.equal((await app.inject({ ...req, headers: { 'x-siteops-approval': 'pending' } })).statusCode, 409);
  assert.equal(writes, 0);
  assert.equal((await app.inject({ ...req, headers: { 'x-siteops-approval': 'approved' } })).statusCode, 200);
  assert.equal(writes, 1);
  actor = { type: 'oauth', scope: 'siteops:write' };
  assert.equal((await app.inject(req)).statusCode, 403);
});
test('MCP reset cannot bypass approval in direct mode', async () => {
  let run,
    writes = 0,
    consumes = 0;
  const registry = createCapabilityRegistry({
    approvalMode: 'direct',
    principal: () => ({ type: 'oauth', scope: 'siteops:write' }),
    state: async () => ({ status: 'issued' }),
    audit: async () => {},
    approvals: {
      consume: async ({ id }) => {
        consumes++;
        if (!id) throw Object.assign(Error('Approval missing'), { statusCode: 428 });
      }
    }
  });
  registry
    .instrument({
      registerTool: (name, config, handler) => {
        run = handler;
        assert.equal(config._meta['siteops/approvalRequired'], true);
      }
    })
    .registerTool(
      'invoice_reset_to_draft',
      {
        inputSchema: z.object({ invoice_id: z.string() }),
        _siteops: { module: 'billing', service: 'billing.resetDraft', access: 'write', approval: true }
      },
      async () => {
        writes++;
        return toolResult({ ok: true });
      }
    );
  assert.equal((await run({ invoice_id: 'invoice' })).isError, true);
  assert.equal(writes, 0);
  assert.equal((await run({ invoice_id: 'invoice', approval_id: 'approved' })).isError, undefined);
  assert.equal(writes, 1);
  assert.equal(consumes, 2);
});
test('payment timestamps and non-issued states prevent reset before any archive or write', async () => {
  for (const invoice of [
    { status: 'paid' },
    { status: 'issued', paid_at: '2026-11-01' },
    { status: 'draft' },
    { status: 'archiving' }
  ]) {
    const calls = [];
    const db = {
      query: async sql => {
        calls.push(sql);
        return [[{ ...invoice, id: 'i' }]];
      }
    };
    const api = createBillingController({ db, archive: () => assert.fail('must not archive') });
    await assert.rejects(api.resetDraft('i', { reason: 'Leistung korrigieren' }), error => error.statusCode === 409);
    assert.ok(calls.every(sql => sql.startsWith('SELECT')));
  }
});
