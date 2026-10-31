import test from 'node:test';
import assert from 'node:assert/strict';
import { runMcpDiagnostics } from '../lib/mcp-diagnostics.mjs';

test(
  'authenticated HTTP discovery and real read calls work after OAuth for both protocol generations',
  { timeout: 20000 },
  async t => {
    process.env.SITEOPS_TEST_NO_AUTOSTART = '1';
    const { buildApplication, db } = await import('../app.mjs');
    t.mock.method(db, 'query', async sql => [
      sql.includes('from oauth_tokens where')
        ? [
            {
              subject: 'test-owner',
              client_id: 'https://chatgpt.com/oauth/client.json',
              scope: 'siteops:access',
              resource: 'http://localhost:3000/mcp'
            }
          ]
        : [],
      []
    ]);
    const app = await buildApplication({ initialize: false });
    t.after(async () => {
      await app.close();
      await db.end();
    });
    const result = await runMcpDiagnostics({ inject: input => app.inject(input), accessToken: 'test-only' });
    assert.equal(result.ok, true, JSON.stringify(result.checks));
    assert.deepEqual(result.external_clients_verified, []);
    const call = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: 'Bearer test-only',
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json'
      },
      payload: {
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: {
          name: 'task_create',
          arguments: { project_id: '11111111-1111-4111-8111-111111111111', name: 'Unzulässige Änderung' }
        }
      }
    });
    assert.match(call.body, /PERMISSION_DENIED/);
  }
);
