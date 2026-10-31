import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerHttpActionGuard, needsHttpApproval } from '../lib/http-action-guard.mjs';

test('REST and MCP share the approval service; direct critical requests cannot bypass it', async t => {
  const app = Fastify();
  t.after(() => app.close());
  let writes = 0,
    prepared,
    consumed;
  app.addHook('onRequest', async req => {
    req.siteopsAuth = { type: 'dashboard_session', subject: 'owner' };
  });
  registerHttpActionGuard(app, {
    state: async () => ({ revision: 1 }),
    approvals: {
      prepare: async input => {
        prepared = input;
        return { id: 'approval', status: 'pending' };
      },
      consume: async input => {
        consumed = input;
        if (input.id !== 'approved') throw Object.assign(Error('denied'), { statusCode: 409 });
      }
    }
  });
  app.post('/api/previews/:id/apply', () => {
    writes++;
    return { verified: true };
  });
  const first = await app.inject({ method: 'POST', url: '/api/previews/preview-a/apply', payload: {} });
  assert.equal(first.statusCode, 428);
  assert.equal(writes, 0);
  assert.equal(prepared.args.path, '/api/previews/preview-a/apply');
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/previews/preview-a/apply',
        headers: { 'x-siteops-approval': 'invalid' },
        payload: {}
      })
    ).statusCode,
    409
  );
  assert.equal(writes, 0);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/previews/preview-a/apply',
        headers: { 'x-siteops-approval': 'approved' },
        payload: {}
      })
    ).json().verified,
    true
  );
  assert.equal(writes, 1);
  assert.deepEqual(consumed.args, prepared.args);
});
test('local edits stay direct while external changes and paid operations require review', () => {
  for (const [method, path] of [
    ['POST', '/api/video-suite/chat'],
    ['POST', '/api/video-studio/jobs/id/render'],
    ['DELETE', '/api/hosting/allinkl/accounts/id/dns/record'],
    ['POST', '/api/coolify/commands/run'],
    ['POST', '/api/lorzcms/installations']
  ])
    assert.equal(needsHttpApproval(method, path), true, path);
  for (const [method, path] of [
    ['PATCH', '/api/billing/tasks/id'],
    ['POST', '/api/billing/timer/start'],
    ['GET', '/api/sites'],
    ['POST', '/api/mcp/self-test']
  ])
    assert.equal(needsHttpApproval(method, path), false, path);
});
