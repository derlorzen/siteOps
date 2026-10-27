import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { registerVideoStudioTools } from '../lib/video-studio-mcp.mjs';
import { defaultVideoMetadata, metadataSchema } from '../lib/video-production.mjs';

test('Video Studio tools/list patterns compile in non-JavaScript discovery validators', async t => {
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: 'schema-regression', version: '1.0.0' });
    registerVideoStudioTools(
      server,
      () => ({}),
      value => value
    );
    return server;
  });
  t.after(() => handler.close());
  const response = await handler.fetch(
    new globalThis.Request('http://localhost/mcp', {
      method: 'POST',
      headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    })
  );
  assert.equal(response.status, 200);
  const body = await response.text();
  const payload = JSON.parse(
    body
      .split('\n')
      .find(line => line.startsWith('data: '))
      .slice(6)
  );
  assert.ok(payload.result.tools.some(tool => tool.name === 'video_studio_create_job'));
  const patterns = [];
  function visit(value, path) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.pattern === 'string') patterns.push({ path, pattern: value.pattern });
    for (const [key, child] of Object.entries(value)) visit(child, path + '.' + key);
  }
  for (const tool of payload.result.tools) visit(tool.inputSchema, tool.name);
  assert.ok(patterns.length > 0);
  const result = spawnSync(
    process.platform === 'win32' ? 'python' : 'python3',
    [
      '-c',
      'import json,re,sys\nfor item in json.load(sys.stdin):\n try: re.compile(item["pattern"])\n except re.error as error: sys.exit(item["path"]+": "+str(error))'
    ],
    { input: JSON.stringify(patterns), encoding: 'utf8' }
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('portable hashtag discovery keeps Unicode acceptance and server validation for every MCP client', () => {
  const metadata = defaultVideoMetadata(
    { title: 'Unicode metadata', topic: 'Hashtags' },
    { language: 'de', channel: 'Kanal' },
    [{ headline: 'Start', narration: 'Eine ausreichende Beschreibung.' }]
  );
  for (const hashtag of ['#Grüße', '#東京', '#العربية', '#Video_2026']) {
    assert.deepEqual(metadataSchema.parse({ ...metadata, hashtags: [hashtag] }).hashtags, [hashtag]);
  }
  for (const hashtag of ['#', '#mit Leerzeichen', '#Video!', '#emoji🎬', 'Video', '#a-b', '#' + 'a'.repeat(60)]) {
    assert.equal(metadataSchema.safeParse({ ...metadata, hashtags: [hashtag] }).success, false, hashtag);
  }
});
