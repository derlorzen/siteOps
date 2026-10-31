import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceNavigation, renderWorkspaceShell } from '../lib/workspace-shell.mjs';
import { readFile } from 'node:fs/promises';

test('one integration group links to hosting, deployment, Google, YouTube and MCP', () => {
  const group = workspaceNavigation.find(item => item.label === 'Integrationen');
  assert.deepEqual(
    group.children.map(item => item.href),
    ['/mcp-info', '/hosting', '/coolify', '/search-console', '/youtube']
  );
  const html = renderWorkspaceShell('<h1>Test</h1>', 'Test');
  assert.equal((html.match(/class="siteops-sidebar/g) || []).length, 1);
  assert.ok(!workspaceNavigation.find(item => item.href === '/video-suite').children);
});
test('settings links target the existing sections and preserve one form implementation', async () => {
  const group = workspaceNavigation.find(item => item.label === 'Einstellungen');
  assert.deepEqual(
    group.children.map(item => item.href),
    ['/settings#system', '/settings#backups', '/settings#defaults', '/settings#alerts', '/settings#seo']
  );
  const script = await readFile(new URL('../public/ops-workspace.js', import.meta.url), 'utf8');
  assert.match(script, /scrollToSetting/);
  assert.match(script, /hashchange/);
});
test('integration routes remain available and Search Console links to the website context', async () => {
  const app = await readFile(new URL('../app.mjs', import.meta.url), 'utf8');
  assert.ok(app.includes("app.get('/hosting',"));
  assert.ok(app.includes("app.get('/search-console',"));
  assert.match(app, /searchConsoleService.status/);
});
