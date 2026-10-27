import test from 'node:test';
import assert from 'node:assert/strict';
import { createMcpHandler } from '@modelcontextprotocol/server';

test('authenticated ChatGPT and Claude discover the same complete tool definitions', async t => {
  process.env.SITEOPS_TEST_NO_AUTOSTART = '1';
  const { mcpAuth, mcpServer, db } = await import('../app.mjs');
  t.after(() => db.end());
  let clientId;
  t.mock.method(db, 'query', async () => [
    [{ client_id: clientId, subject: 'catalog-test', scope: 'siteops:access', resource: 'http://localhost:3000/mcp' }],
    []
  ]);
  const catalogs = [];
  for (clientId of ['https://chatgpt.com/oauth/client.json', 'https://claude.ai/oauth/mcp-oauth-client-metadata']) {
    const request = { headers: { authorization: 'Bearer catalog-test-token' } };
    const reply = {
      header() {
        return this;
      },
      code() {
        return this;
      },
      send() {
        assert.fail('valid OAuth catalog request was rejected');
      }
    };
    assert.equal(await mcpAuth(request, reply), true);
    const handler = createMcpHandler(() => mcpServer(request.siteopsAuth.profile));
    try {
      const response = await handler.fetch(
        new globalThis.Request('http://localhost:3000/mcp', {
          method: 'POST',
          headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
        })
      );
      assert.equal(response.status, 200);
      const body = await response.text();
      catalogs.push(
        JSON.parse(
          body
            .split('\n')
            .find(line => line.startsWith('data: '))
            .slice(6)
        ).result.tools
      );
    } finally {
      await handler.close();
    }
  }
  assert.deepEqual(catalogs[0], catalogs[1]);
  assert.ok(catalogs[0].length >= 125);
  for (const name of [
    'cms_admin_recovery',
    'cms_project_begin',
    'cms_project_file',
    'cms_project_status',
    'cms_project_finish',
    'backup_restore_preview',
    'youtube_upload_preview',
    'video_studio_demo_templates'
  ]) {
    assert.ok(
      catalogs[0].some(tool => tool.name === name),
      name
    );
  }
});
