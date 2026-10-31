import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMcpAdmin } from '../lib/mcp-ui.mjs';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('MCP administration has real catalog, approvals, connections, audit and a staged self-test without a false active claim', () => {
  const html = renderMcpAdmin('https://example.test/mcp');
  for (const id of ['mcpTools', 'mcpApprovals', 'oauthConnections', 'auditLog', 'mcpSelfTest'])
    assert.ok(html.includes('id="' + id + '"'));
  assert.doesNotMatch(html, /OAUTH 2.1 AKTIV/);
  assert.match(html, /Noch kein Selbsttest/);
  assert.match(html, /noch nicht aus/);
});
test('MCP administration escapes its endpoint and loads recoverable panels with valid JavaScript', async () => {
  const html = renderMcpAdmin('https://example.test/mcp?x=<script>');
  assert.doesNotMatch(html, /<script>/);
  const source = await readFile(new URL('../public/product-workspace.js', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new vm.Script(source));
  assert.match(source, /response.ok/);
  assert.match(source, /Erneut laden/);
  assert.match(source, /textContent=data.message/);
});
