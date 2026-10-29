import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workspaceSource = () => readFile(new URL('../public/ops-workspace.js', import.meta.url), 'utf8');
const appSource = () => readFile(new URL('../app.mjs', import.meta.url), 'utf8');

test('Integrations group contains hosting, deployment, Google/YouTube and MCP', async () => {
  const source = await workspaceSource();
  assert.match(source, /\['\/mcp-info','Übersicht & MCP','⇄','Integrationen'\]/);
  assert.match(source, /\['\/hosting','Hosting & DNS','◎','Integrationen'\]/);
  assert.match(source, /\['\/coolify','Coolify & Supabase','◈','Integrationen'\]/);
  assert.match(source, /\['\/search-console','Google Search Console','◎','Integrationen'\]/);
  assert.match(source, /\['\/youtube','YouTube & Kanäle','▶','Integrationen'\]/);
  assert.doesNotMatch(source, /\['\/youtube','YouTube & Kanäle','↗','Video Suite'\]/);
  assert.match(source, /parent\?' ops-nav-subitem'/);
  assert.match(source, /current\.startsWith\('\/hosting'\)/);
  assert.match(source, /data-nav-group/);
});

test('Settings links expose existing sections instead of cloned forms', async () => {
  const source = await workspaceSource();
  for (const anchor of ['system', 'backups', 'defaults', 'alerts', 'seo']) {
    assert.ok(source.includes("'/settings#" + anchor + "'"));
  }
  for (const heading of ['Design & Farben', 'GitHub', 'Standardwerte', 'Benachrichtigungen', 'SEO-Audits']) {
    assert.ok(source.includes("['" + heading + "'"));
  }
  assert.match(source, /window\.addEventListener\('hashchange',scrollToSetting\)/);
});

test('Integration landing page links to the authenticated hosting workspace', async () => {
  const app = await appSource();
  assert.match(app, /<a class="btn" href="\/hosting">Hosting & DNS verwalten/);
  assert.match(app, /app\.get\('\/hosting',/);
  assert.match(app, /allinkl_provision, cms_install_allinkl/);
});

test('Search Console central overview links to per-site property management', async () => {
  const app = await appSource();
  assert.match(app, /app\.get\('\/search-console',/);
  assert.match(app, /encodeURIComponent\(site\.slug\) \+ '\/search-console'/);
  assert.match(app, /searchConsoleService\.status\(\)/);
});
