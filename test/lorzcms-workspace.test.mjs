import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { cmsAgentRoutingHtaccess } from '../lib/lorzcms.mjs';
import { cmsDashboardBody } from '../lib/lorzcms-ui.mjs';

test('legacy rewrite keeps current site functional and grants connector precedence',()=>{
  const before='Options -Indexes\nRewriteEngine On\nRewriteRule ^api/cms/ - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]\nRewriteRule ^ index.php [L,QSA]\n';
  const after=cmsAgentRoutingHtaccess(before);
  assert.equal(after.includes('RewriteRule ^siteops\\.php$ - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization},L]'),true);
  assert.ok(after.indexOf('siteops\\.php')<after.indexOf('RewriteRule ^ index.php'));
  assert.equal(after.includes('RewriteRule ^ index.php [L,QSA]'),true);
  assert.equal(cmsAgentRoutingHtaccess(after),after);
  assert.throws(()=>cmsAgentRoutingHtaccess('RewriteRule ^ index.php [L]'),/Apache-Regeln/);
});

test('CMS dashboard offers a project and saved credentials without emitting passwords',()=>{
  const html=cmsDashboardBody({
    projects:[{id:'00000000-0000-4000-8000-000000000000',name:'Projekt',customer_name:'Kunde'}],
    installations:[],jobs:[],releases:[],
    existingSites:[{id:'test',name:'Website',domain:'example.de',deploymentMode:'webspace'}]
  },value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
  assert.match(html,/cms-section-tabs/);
  assert.match(html,/id="cmsInstallations"/);
  assert.match(html,/name="projectId"/);
  assert.match(html,/name="savedConnection"/);
  assert.match(html,/Projekt/);
  assert.match(html,/Kunde/);
  assert.doesNotMatch(html,/value="secret"/);
});

test('CMS browser integration parses and uses existing profile/site endpoints',async()=>{
  const script=await readFile(new URL('../public/lorzcms.js',import.meta.url),'utf8');
  assert.doesNotThrow(()=>new vm.Script(script));
  assert.match(script,/\/api\/server-profiles/);
  assert.match(script,/existingSiteId/);
  assert.match(script,/profileId/);
  assert.match(script,/projectId/);
});

test('CMS controller resolves encrypted credentials and links installations server-side',async()=>{
  const source=await readFile(new URL('../lib/lorzcms.mjs',import.meta.url),'utf8');
  assert.match(source,/resolveHostingConnection/);
  assert.match(source,/linkSiteToProject/);
  assert.match(source,/await agentCall\(inst, \{ action: 'preflight'/);
  const rule=source.indexOf("const temporaryRules = cmsAgentRoutingHtaccess");
  const preflight=source.indexOf("await agentCall(inst, { action: 'preflight'");
  assert.ok(rule>=0 && preflight>rule);
});
