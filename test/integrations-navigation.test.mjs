import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workspaceSource = () => readFile(new URL('../public/ops-workspace.js', import.meta.url), 'utf8');
const appSource = () => readFile(new URL('../app.mjs', import.meta.url), 'utf8');

test('ALL-INKL hosting is visible directly under Integrationen in the shared sidebar', async () => {
  const source = await workspaceSource();
  assert.match(
    source,
    /\['\/mcp-info','Integrationen','⇄'\],\s*\['\/hosting','Hosting & DNS','[^']+','Integrationen'\]/
  );
  assert.match(source, /parent\?' ops-nav-subitem'/);
  assert.match(source, /path\.startsWith\('\/hosting'\)\?'Hosting & DNS'/);
});

test('Integration landing page links to the existing authenticated hosting workspace', async () => {
  const app = await appSource();
  assert.match(app, /<a class="btn" href="\/hosting">Hosting & DNS verwalten/);
  assert.match(app, /app\.get\('\/hosting',/);
  assert.match(app, /allinkl_provision, cms_install_allinkl/);
  assert.doesNotMatch(app, /<a href="\/lorzcms">LorzCMS<\/a><a href="\/hosting">Hosting & DNS<\/a>/);
});
