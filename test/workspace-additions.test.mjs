import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createWorkspaceSearch, registerWorkspaceSearchRoutes } from '../lib/workspace-search.mjs';
import { createProjectOverview, registerProjectOverviewRoutes } from '../lib/project-overview.mjs';
import { createWorkspaceActivity, registerWorkspaceActivityRoutes } from '../lib/workspace-activity.mjs';
import { createConnectionProfiles, registerConnectionProfileRoutes } from '../lib/connection-profiles.mjs';

test('global search escapes SQL wildcard input and parameterizes queries', async () => {
  const queries = [];
  const db = { query: async (sql,values) => {
    queries.push({sql,values});
    return [[{id: randomUUID(),title:'100% Wartung',subtitle:'Testkunde',project_id:randomUUID(),slug:'testseite'}]];
  }};
  const search = createWorkspaceSearch({db});
  assert.equal((await search.search('a')).results.length,0);
  assert.equal(queries.length,0);
  const result = await search.search('100%');
  assert.equal(queries.length,5);
  assert.ok(queries.every(entry=>!entry.sql.includes('100%') && entry.sql.includes('ESCAPE')));
  assert.ok(queries.every(entry=>entry.values.every(value=>value==='%100!%%')));
  assert.ok(result.results.some(item=>item.type==='project'));
  assert.ok(result.results.some(item=>item.type==='task' && item.url.includes('?task=')));
});
test('search enforces bounded queries',async()=>{
  const db={query:async()=>{throw Error('should not query')}};
  assert.deepEqual((await createWorkspaceSearch({db}).search(' '.repeat(15))).results,[]);
  assert.deepEqual((await createWorkspaceSearch({db}).search('x'.repeat(250))).results,[]);
});

test('360 overview rejects unknown projects and scopes all data to project',async()=>{
  const projectId=randomUUID(),customerId=randomUUID();
  const calls=[];
  const db={query:async(sql,params)=>{
    calls.push({sql,params});
    if(sql.includes('FROM customer_projects p JOIN customers c'))return [[{id:projectId,customer_id:customerId,name:'Kundenwebsite'}]];
    if(sql.includes('FROM project_sites ps JOIN sites s'))return [[{id:randomUUID(),name:'Website',slug:'site',monitor_enabled:1,last_check_ok:1}]];
    if(sql.includes('FROM project_tasks t WHERE'))return [[{total:3,done:1,doing:1,overdue:1}]];
    if(sql.includes('FROM time_entries e JOIN project_tasks'))return [[{total_seconds:7200,unbilled_seconds:3600,unbilled_cents:7500}]];
    return [[]];
  }};
  const service=createProjectOverview(db);
  const result=await service.get(projectId);
  assert.equal(result.project.id,projectId);
  assert.equal(result.sites[0].slug,'site');
  assert.equal(result.time.unbilled_cents,7500);
  assert.equal(result.task_counts.total,3);
  assert.ok(calls.every(call=>call.params.includes(projectId)));
});
test('360 rejects invalid identifiers without query',async()=>{
  let count=0;
  const service=createProjectOverview({query:async()=>{count++;return [[]]}});
  await assert.rejects(service.get('invalid'));
  assert.equal(count,0);
});

test('activity feed reads existing events, sorts and filters by project',async()=>{
  const projectId=randomUUID();
  const calls=[];
  const now='2026-10-15T12:00:00.000Z',earlier='2026-10-14T12:00:00.000Z';
  const db={query:async(sql,params)=>{
    calls.push({sql,params});
    if(sql.includes('FROM billing_task_events'))
      return [[{id:3,event_type:'kanban_moved',details:'open → done',created_at:earlier,
        task_name:'SEO',project_id:projectId}]];
    if(sql.includes('FROM incident_events'))
      return [[{id:7,event_type:'opened',created_at:now,site_name:'Test',slug:'test',
        project_id:projectId}]];
    return [[]];
  }};
  const service=createWorkspaceActivity(db);
  const result=await service.list({projectId,limit:30});
  assert.equal(result.entries.length,2);
  assert.equal(result.entries[0].kind,'monitor');
  assert.equal(result.entries[1].kind,'task');
  assert.ok(calls.every(call=>call.params.includes(projectId)));
  assert.equal(result.project_id,projectId);
  await assert.rejects(service.list({projectId:'invalid'}));
});

test('connection profiles store encrypted passwords; public list never returns secrets',async()=>{
  const saved=[],credential={password:'test-secret',privateKey:'',passphrase:''};
  const db={query:async(sql,params=[])=>{
    saved.push({sql,params});
    if(sql.startsWith('SELECT id,name,protocol,host,port,username,created_at'))
      return [[{id:randomUUID(),name:'Hauptserver',host:'server.example',port:22,username:'deploy',protocol:'sftp'}]];
    if(sql.startsWith('SELECT * FROM server_connection_profiles'))
      return [[{protocol:'sftp',host:'server.example',port:22,username:'deploy',encrypted_credentials:'cipher'}]];
    return [{affectedRows:1}];
  }};
  const profiles=createConnectionProfiles({db,encrypt:value=>'encrypted',decrypt:()=>credential});
  const created=await profiles.create({name:'Hauptserver',protocol:'sftp',host:'server.example',
    port:22,username:'deploy',password:'test-secret'});
  assert.ok(created.id);
  assert.equal(created.password,undefined);
  assert.ok(saved.some(x=>x.sql.startsWith('INSERT')&&!x.params.includes('test-secret')));
  const rows=await profiles.list();
  assert.equal(rows[0].encrypted_credentials,undefined);
  const selected=await profiles.resolve(randomUUID(),'/kundenwebsite');
  assert.equal(selected.remoteRoot,'/kundenwebsite');
  assert.equal(selected.password,'test-secret');
});
test('import from existing site keeps credentials server-side',async()=>{
  const siteId=randomUUID();
  const db={query:async(sql,params)=>{
    if(sql.startsWith('SELECT protocol,host,port,username,encrypted_credentials'))
      return [[{protocol:'ftps',host:'web.example',port:21,username:'admin',encrypted_credentials:'ciphertext'}]];
    return [{affectedRows:1}];
  }};
  const profiles=createConnectionProfiles({db,encrypt:value=>'encrypted-credentials',decrypt:()=>({password:'hidden'})});
  const result=await profiles.fromSite({site_id:siteId,name:'Zentrale Serververbindung'});
  assert.equal(result.protocol,'ftps');
  assert.equal(result.password,undefined);
});

test('backend routes and browser UI are present without regressions',async()=>{
  const routes=[];
  const app={addHook(){},get:(p)=>routes.push('GET '+p),
    post:(p)=>routes.push('POST '+p),delete:(p)=>routes.push('DELETE '+p)};
  registerWorkspaceSearchRoutes(app,createWorkspaceSearch({}));
  registerProjectOverviewRoutes(app,createProjectOverview({}));
  registerWorkspaceActivityRoutes(app,createWorkspaceActivity({}));
  registerConnectionProfileRoutes(app,{},()=> 'https://siteops.example');
  for(const route of ['GET /api/workspace/search','GET /api/workspace/projects/:id/overview',
    'GET /api/workspace/activity','GET /api/server-profiles','POST /api/server-profiles/from-site'])
    assert.ok(routes.includes(route),route);
  const js=await readFile(new URL('../public/workspace-search.js',import.meta.url),'utf8');
  assert.doesNotThrow(()=>new vm.Script(js));
  assert.match(js,/ctrlKey/);
  const appJs=await readFile(new URL('../public/crm-app.js',import.meta.url),'utf8');
  assert.match(appJs,/project360Panel/);
  assert.match(appJs,/activityTimeline/);
  const server=await readFile(new URL('../app.mjs',import.meta.url),'utf8');
  assert.match(server,/serverProfileSelect/);
  assert.match(server,/\/api\/site-connection-test/);
  const migration=await readFile(new URL('../migrations/0010_connection_profiles.sql',import.meta.url),'utf8');
  assert.match(migration,/encrypted_credentials LONGTEXT NOT NULL/);
});
