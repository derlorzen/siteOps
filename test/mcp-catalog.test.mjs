import test from 'node:test';
import assert from 'node:assert/strict';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv';
import { spawnSync } from 'node:child_process';

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
  const validator = new AjvJsonSchemaValidator(),
    patterns = [];
  const visit = (value, path) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.pattern === 'string') patterns.push({ path, pattern: value.pattern });
    for (const [key, child] of Object.entries(value)) visit(child, path + '.' + key);
  };
  for (const tool of catalogs[0])
    for (const field of ['inputSchema', 'outputSchema']) {
      assert.equal(tool[field]?.type, 'object', tool.name + ' ' + field);
      assert.doesNotThrow(() => validator.getValidator(tool[field]), tool.name + ' ' + field);
      visit(tool[field], tool.name + '.' + field);
    }
  const compiled = spawnSync(
    process.platform === 'win32' ? 'python' : 'python3',
    [
      '-c',
      'import json,re,sys\nfor item in json.load(sys.stdin):\n try: re.compile(item["pattern"])\n except re.error as error: sys.exit(item["path"]+": "+str(error))'
    ],
    { input: JSON.stringify(patterns), encoding: 'utf8' }
  );
  assert.ifError(compiled.error);
  assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
  assert.ok(catalogs[0].length >= 125);
  for (const name of [
    'cms_admin_recovery',
    'cms_project_begin',
    'cms_project_file',
    'cms_project_status',
    'cms_project_finish',
    'backup_restore_preview',
    'youtube_upload_preview',
    'search_console_status',
    'search_console_change_execute',
    'search_console_performance',
    'video_studio_demo_templates'
  ]) {
    assert.ok(
      catalogs[0].some(tool => tool.name === name),
      name
    );
  }
});
