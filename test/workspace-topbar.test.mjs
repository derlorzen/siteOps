import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const load = path => readFile(new URL(path, import.meta.url), 'utf8');

test('search remains in the right-side actions of both desktop and mobile headers', async () => {
  const search = await load('../public/workspace-search.js');
  const ops = await load('../public/ops-workspace.js');
  const crm = await load('../public/crm-app.js');
  const searchCss = await load('../public/workspace-search.css');
  const crmCss = await load('../public/crm-app.css');
  for (const js of [search, ops, crm]) assert.doesNotThrow(() => new vm.Script(js));
  assert.match(search, /header\.querySelector\('\.crm-top-actions, \.ops-top-actions'\)/);
  assert.match(search, /actions\.prepend\(trigger\)/);
  const shell = await load('../lib/workspace-shell.mjs');
  assert.match(shell, /class="ops-top-actions"/);
  assert.match(crm, /class="crm-top-actions"/);
  assert.match(searchCss, /width:42px;min-width:42px/);
  assert.match(await load('../public/workspace-shell.css'), /\.siteops-topbar \.ops-top-actions/);
  assert.match(crmCss, /#crmRoot \.crm-topbar\{flex-direction:row;flex-wrap:nowrap/);
});

test('both settings views expose the appearance picker without topbar buttons', async () => {
  const server = await load('../app.mjs');
  const crm = await load('../public/crm-app.js');
  const theme = await load('../public/siteops-theme.js');
  assert.match(server, /form-card siteops-appearance-section/);
  assert.match(crm, /crm-panel siteops-appearance-section/);
  assert.match(server, /data-siteops-theme-open/);
  assert.match(crm, /data-siteops-theme-open/);
  assert.match(theme, /event\.target\.closest\('\[data-siteops-theme-open\]'\)/);
  assert.doesNotMatch(theme, /topbar\.insertBefore\(/);
});
