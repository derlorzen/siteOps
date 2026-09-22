import Fastify from 'fastify';
import pg from 'pg';
import crypto from 'node:crypto';
import tls from 'node:tls';
import { readFile } from 'node:fs/promises';
import { posix as pathPosix } from 'node:path';
import SftpClient from 'ssh2-sftp-client';
import { Client as FtpClient } from 'basic-ftp';
import { Readable, Writable } from 'node:stream';
import nodemailer from 'nodemailer';
import PHPParser from 'php-parser';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import * as z from 'zod/v4';

function env(name, fallback = undefined) { const value = process.env[name] ?? fallback; if (value === undefined) throw new Error(`Missing env ${name}`); return value; }
const cfg = {
  port: Number(env('PORT','3100')), host: env('HOST','0.0.0.0'), databaseUrl: env('DATABASE_URL'),
  masterKey: env('SITEOPS_MASTER_KEY'), mcpToken: env('MCP_API_TOKEN'), dashboardUser: env('DASHBOARD_USER'),
  dashboardPassword: env('DASHBOARD_PASSWORD'), githubBackupRepo: env('GITHUB_BACKUP_REPO'),
  githubBackupToken: env('GITHUB_BACKUP_TOKEN'), backupBranch: env('BACKUP_REPO_BRANCH','main'),
  backupMaxFileBytes: Number(env('BACKUP_MAX_FILE_BYTES','52428800')),
  alertEmail: process.env.ALERT_EMAIL_TO || '', smtpHost: process.env.SMTP_HOST || '', smtpPort: Number(env('SMTP_PORT','587')),
  smtpSecure: env('SMTP_SECURE','false') === 'true', smtpUser: process.env.SMTP_USER || '', smtpPassword: process.env.SMTP_PASSWORD || '',
  smtpFrom: env('SMTP_FROM','SiteOps <siteops@localhost>'), webhook: process.env.ALERT_WEBHOOK_URL || '',
  workerInterval: Number(env('MONITOR_WORKER_INTERVAL_MS','30000')),
  backupWorkerInterval: Number(env('BACKUP_WORKER_INTERVAL_MS','60000'))
};
const { Pool } = pg; const db = new Pool({ connectionString: cfg.databaseUrl, max: 5, idleTimeoutMillis: 30000 });
const q = (text, params=[]) => db.query(text, params);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
function safeEqual(a,b){ const aa=Buffer.from(a), bb=Buffer.from(b); return aa.length===bb.length && crypto.timingSafeEqual(aa,bb); }
function key(){ const raw=Buffer.from(cfg.masterKey,'base64'); if(raw.length!==32) throw new Error('SITEOPS_MASTER_KEY must decode to 32 bytes'); return raw; }
function encrypt(value){ const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',key(),iv); const data=Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value))),cipher.final()]); return [iv,cipher.getAuthTag(),data].map(x=>x.toString('base64url')).join('.'); }
function decrypt(value){ const [iv,tag,data]=value.split('.'); const d=crypto.createDecipheriv('aes-256-gcm',key(),Buffer.from(iv,'base64url')); d.setAuthTag(Buffer.from(tag,'base64url')); return JSON.parse(Buffer.concat([d.update(Buffer.from(data,'base64url')),d.final()]).toString()); }
const phpParser=new PHPParser({parser:{suppressErrors:false,extractDoc:false},ast:{withPositions:false}});
async function migrate(){ const sql=await readFile(new URL('./schema.sql', import.meta.url),'utf8'); await db.query(sql); }

function joinRemote(root,path=''){ const clean=String(path).replaceAll('\\','/').replace(/^\/+/, ''); if(clean.split('/').includes('..')) throw new Error('Path traversal rejected'); return `${root.replace(/\/+$/,'')}/${clean}`.replace(/\/$/,'') || '/'; }
class SftpAdapter { constructor(client){this.client=client;} static async connect(site,cred){ const c=new SftpClient(); await c.connect({host:site.host,port:site.port,username:site.username,password:cred.password,privateKey:cred.privateKey,passphrase:cred.passphrase,readyTimeout:15000}); return new SftpAdapter(c); } async list(path){ return (await this.client.list(path)).map(r=>({name:r.name,path:`${path.replace(/\/$/,'')}/${r.name}`,type:r.type==='d'?'directory':r.type==='l'?'link':'file',size:r.size,modifiedAt:r.modifyTime})); } async read(path){const x=await this.client.get(path);return Buffer.isBuffer(x)?x:Buffer.from(x);} async write(path,content){await this.client.mkdir(pathPosix.dirname(path),true);await this.client.put(content,path);} async exists(path){return Boolean(await this.client.exists(path));} async remove(path){if(await this.exists(path))await this.client.delete(path);} async close(){await this.client.end();} }
class FtpAdapter { constructor(client){this.client=client;} static async connect(site,cred,secure){ const c=new FtpClient(15000); await c.access({host:site.host,port:site.port,user:site.username,password:cred.password,secure,secureOptions:secure?{rejectUnauthorized:true}:undefined}); return new FtpAdapter(c); } async list(path){return (await this.client.list(path)).map(r=>({name:r.name,path:`${path.replace(/\/$/,'')}/${r.name}`,type:r.isDirectory?'directory':r.isSymbolicLink?'link':'file',size:r.size,modifiedAt:r.modifiedAt?.getTime()}));} async read(path){const chunks=[];const w=new Writable({write(chunk,_e,cb){chunks.push(Buffer.from(chunk));cb();}});await this.client.downloadTo(w,path);return Buffer.concat(chunks);} async write(path,content){const dir=pathPosix.dirname(path);await this.client.ensureDir(dir);await this.client.uploadFrom(Readable.from(content),pathPosix.basename(path));} async exists(path){try{await this.client.size(path);return true;}catch{return false;}} async remove(path){try{await this.client.remove(path);}catch{}} async close(){this.client.close();} }
async function connectSite(site){ const cred=decrypt(site.encrypted_credentials); return site.protocol==='sftp'?SftpAdapter.connect(site,cred):FtpAdapter.connect(site,cred,site.protocol==='ftps'); }
async function listSites(){return (await q('select * from sites order by name')).rows;}
async function getSite(idOrSlug){const r=await q('select * from sites where id::text=$1 or slug=$1 limit 1',[idOrSlug]);if(!r.rows[0])throw new Error(`Unknown site ${idOrSlug}`);return r.rows[0];}
async function createSite(x){const r=await q(`insert into sites(slug,name,domain,protocol,host,port,username,encrypted_credentials,remote_root,site_type,monitor_url) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,[x.slug,x.name,x.domain,x.protocol,x.host,x.port,x.username,encrypt({password:x.password,privateKey:x.privateKey,passphrase:x.passphrase}),x.remoteRoot,x.siteType||'php',x.monitorUrl||`https://${x.domain}`]);return r.rows[0];}
async function updateSite(idOrSlug,x){const site=await getSite(idOrSlug),allowed=['name','domain','enabled','backup_enabled','backup_interval_seconds','backup_max_files','monitor_enabled','monitor_url','monitor_interval_seconds','monitor_expected_status','monitor_content','monitor_timeout_ms','monitor_failure_threshold','response_warn_ms','ssl_warn_days','exclude_patterns'],entries=Object.entries(x).filter(([k,v])=>allowed.includes(k)&&v!==undefined);if(!entries.length)return site;const params=[...entries.map(([,v])=>v),site.id],sets=entries.map(([k],i)=>k+'=$'+(i+1)),sql='update sites set '+sets.join(',')+',updated_at=now() where id=$'+params.length+' returning *';const r=await q(sql,params);return r.rows[0];}
async function listRemote(siteId,path=''){const site=await getSite(siteId),r=await connectSite(site);try{return await r.list(joinRemote(site.remote_root,path));}finally{await r.close();}}
async function readRemoteText(siteId,path){const site=await getSite(siteId),r=await connectSite(site);try{const b=await r.read(joinRemote(site.remote_root,path));if(b.includes(0))throw new Error('Binary file rejected');return b.toString('utf8');}finally{await r.close();}}


let backupLock=Promise.resolve();
function withBackupLock(fn){const next=backupLock.then(fn,fn);backupLock=next.catch(()=>{});return next;}
function backupRepoPath(path=''){return '/repos/'+cfg.githubBackupRepo+path;}
function gitBlobSha(content){const b=Buffer.isBuffer(content)?content:Buffer.from(content),header=Buffer.from('blob '+b.length+'\0');return crypto.createHash('sha1').update(header).update(b).digest('hex');}
async function gh(path,{method='GET',body,allow404=false}={}){
  const res=await fetch('https://api.github.com'+backupRepoPath(path),{
    method,
    headers:{
      accept:'application/vnd.github+json',
      authorization:'Bearer '+cfg.githubBackupToken,
      'x-github-api-version':'2022-11-28',
      'user-agent':'Lorzen-SiteOps/0.3'
    },
    body:body===undefined?undefined:JSON.stringify(body),
    signal:AbortSignal.timeout(30000)
  });
  const raw=await res.text();
  let data=null;
  if(raw){try{data=JSON.parse(raw);}catch{data=raw;}}
  if(allow404&&res.status===404)return null;
  if(!res.ok)throw new Error('GitHub '+method+' '+path+' failed ('+res.status+'): '+(data?.message||String(data||'').slice(0,500)));
  return data;
}
let backupRepoChecked=false;
async function ensureBackupRepository(){
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(cfg.githubBackupRepo))throw new Error('GITHUB_BACKUP_REPO must be owner/repository');
  if(backupRepoChecked)return;
  const r=await gh('');
  if(!r.private)throw new Error('Backup repository must be private');
  if(r.archived)throw new Error('Backup repository is archived');
  backupRepoChecked=true;
}
async function branchState(){
  await ensureBackupRepository();
  const branch=encodeURIComponent(cfg.backupBranch);
  const ref=await gh('/git/ref/heads/'+branch,{allow404:true});
  if(!ref)return{headSha:null,rootTreeSha:null,treeMap:new Map()};
  const commit=await gh('/git/commits/'+ref.object.sha);
  const tree=await gh('/git/trees/'+commit.tree.sha+'?recursive=1');
  if(tree.truncated)throw new Error('Backup repository tree is too large for safe recursive processing');
  const map=new Map((tree.tree||[]).filter(x=>x.type==='blob').map(x=>[x.path,x]));
  return{headSha:ref.object.sha,rootTreeSha:commit.tree.sha,treeMap:map};
}
async function createGitBlob(content){
  const b=Buffer.isBuffer(content)?content:Buffer.from(content);
  if(b.length>cfg.backupMaxFileBytes)throw new Error('Backup file exceeds BACKUP_MAX_FILE_BYTES ('+b.length+' bytes)');
  return gh('/git/blobs',{method:'POST',body:{content:b.toString('base64'),encoding:'base64'}});
}
async function commitTreeChanges(state,changes,message){
  if(!changes.length)return state.headSha;
  const treeBody={tree:changes};
  if(state.rootTreeSha)treeBody.base_tree=state.rootTreeSha;
  const tree=await gh('/git/trees',{method:'POST',body:treeBody});
  if(state.rootTreeSha&&tree.sha===state.rootTreeSha)return state.headSha;
  const commitBody={message,tree:tree.sha};
  if(state.headSha)commitBody.parents=[state.headSha];
  const commit=await gh('/git/commits',{method:'POST',body:commitBody});
  const branch=encodeURIComponent(cfg.backupBranch);
  if(state.headSha)await gh('/git/refs/heads/'+branch,{method:'PATCH',body:{sha:commit.sha,force:false}});
  else await gh('/git/refs',{method:'POST',body:{ref:'refs/heads/'+cfg.backupBranch,sha:commit.sha}});
  return commit.sha;
}
async function commitPaths(site,paths,message){
  return withBackupLock(async()=>{
    const state=await branchState(),remote=await connectSite(site),changes=[];
    try{
      for(const path of paths){
        const repoPath='sites/'+site.slug+'/public/'+path,rp=joinRemote(site.remote_root,path),existing=state.treeMap.get(repoPath);
        if(await remote.exists(rp)){
          const content=await remote.read(rp),sha=gitBlobSha(content);
          if(existing?.sha!==sha){const blob=await createGitBlob(content);changes.push({path:repoPath,mode:'100644',type:'blob',sha:blob.sha});}
        }else if(existing)changes.push({path:repoPath,mode:'100644',type:'blob',sha:null});
      }
    }finally{await remote.close();}
    return commitTreeChanges(state,changes,'['+site.domain+'] '+message);
  });
}
const commitTreeCache=new Map();
async function treeForCommit(commit){
  if(commitTreeCache.has(commit))return commitTreeCache.get(commit);
  const c=await gh('/git/commits/'+commit),tree=await gh('/git/trees/'+c.tree.sha+'?recursive=1');
  if(tree.truncated)throw new Error('Commit tree is too large for safe recursive processing');
  const map=new Map((tree.tree||[]).filter(x=>x.type==='blob').map(x=>[x.path,x]));
  commitTreeCache.set(commit,map);
  if(commitTreeCache.size>50)commitTreeCache.delete(commitTreeCache.keys().next().value);
  return map;
}
async function readCommitMaybe(site,path,commit){
  const map=await treeForCommit(commit),entry=map.get('sites/'+site.slug+'/public/'+path);
  if(!entry)return null;
  const blob=await gh('/git/blobs/'+entry.sha);
  return Buffer.from(String(blob.content||'').replace(/\n/g,''),'base64');
}
async function diffCommits(site,before,after){
  const cmp=await gh('/compare/'+before+'...'+after),prefix='sites/'+site.slug+'/public/';
  const files=(cmp.files||[]).filter(x=>x.filename.startsWith(prefix));
  if(!files.length)return'No file differences.';
  return files.map(f=>{
    const name=f.filename.slice(prefix.length),head='--- '+name+' ['+f.status+', +'+f.additions+' -'+f.deletions+']';
    return head+'\n'+(f.patch||'[binary file or patch unavailable]');
  }).join('\n\n');
}
async function changedFiles(site,before,after){
  const [a,b]=await Promise.all([treeForCommit(before),treeForCommit(after)]),prefix='sites/'+site.slug+'/public/',paths=new Set();
  for(const p of a.keys())if(p.startsWith(prefix))paths.add(p);
  for(const p of b.keys())if(p.startsWith(prefix))paths.add(p);
  return[...paths].filter(p=>a.get(p)?.sha!==b.get(p)?.sha).map(p=>p.slice(prefix.length)).sort();
}
async function fullBackup(site,maxFiles=10000){
  return withBackupLock(async()=>{
    const state=await branchState(),remote=await connectSite(site),prefix='sites/'+site.slug+'/',publicPrefix=prefix+'public/',changes=[],seen=new Set();
    let count=0;
    const patterns=Array.isArray(site.exclude_patterns)?site.exclude_patterns:[],excluded=p=>patterns.some(x=>p.includes(x));
    async function addFile(rel){
      if(++count>maxFiles)throw new Error('Backup stopped after '+maxFiles+' files');
      const repoPath=publicPrefix+rel,content=await remote.read(joinRemote(site.remote_root,rel)),existing=state.treeMap.get(repoPath);
      seen.add(repoPath);
      if(existing?.sha!==gitBlobSha(content)){const blob=await createGitBlob(content);changes.push({path:repoPath,mode:'100644',type:'blob',sha:blob.sha});}
    }
    async function walk(rel=''){
      for(const e of await remote.list(joinRemote(site.remote_root,rel))){
        const child=rel?rel+'/'+e.name:e.name;
        if(excluded(child))continue;
        if(e.type==='directory')await walk(child);
        else if(e.type==='file')await addFile(child);
      }
    }
    try{
      await walk();
      const metaPath=prefix+'.siteops.json',meta=Buffer.from(JSON.stringify({domain:site.domain,fileCount:count},null,2)+'\n'),metaExisting=state.treeMap.get(metaPath);
      seen.add(metaPath);
      if(metaExisting?.sha!==gitBlobSha(meta)){const blob=await createGitBlob(meta);changes.push({path:metaPath,mode:'100644',type:'blob',sha:blob.sha});}
      for(const p of state.treeMap.keys())if(p.startsWith(prefix)&&!seen.has(p))changes.push({path:p,mode:'100644',type:'blob',sha:null});
      const commit=await commitTreeChanges(state,changes,'['+site.domain+'] Full backup'),changed=commit!==state.headSha;
      await q('insert into backups(site_id,git_commit,backup_type,file_count,changed) values($1,$2,$3,$4,$5)',[site.id,commit,'full',count,changed]);
      return{commit,files:count,changed};
    }finally{try{await remote.close();}catch{}}
  });
}
async function listBackups(site,limit=30){return(await q('select id,git_commit,backup_type,file_count,changed,created_at from backups where site_id=$1 order by created_at desc limit $2',[site.id,limit])).rows;}
async function backupRestorePreview(backupId,actor='mcp'){const b=(await q('select * from backups where id=$1',[backupId])).rows[0];if(!b)throw new Error('Backup not found');const site=await getSite(b.site_id);const safety=await fullBackup(site,site.backup_max_files||10000);const files=await changedFiles(site,b.git_commit,safety.commit);if(!files.length)return{site:site.domain,backupId,noChanges:true,safetyCommit:safety.commit,message:'Live state already matches this backup'};const proposed=[];for(const path of files){const old=await readCommitMaybe(site,path,b.git_commit);proposed.push(old===null?{path,content:null}:{path,sourceCommit:b.git_commit});}const preview=await createPreview(site.id,proposed,'Restore backup '+backupId+' ('+String(b.git_commit).slice(0,8)+')',actor);return{...preview,backupId,safetyCommit:safety.commit};}

async function validateFiles(files){const results=[];for(const f of files){if(f.content===null||!f.path.endsWith('.php'))continue;try{phpParser.parseCode(f.content.toString('utf8'),f.path);results.push({path:f.path,ok:true,output:'PHP syntax parsed'});}catch(e){results.push({path:f.path,ok:false,output:String(e.message||e)});}}return results;}
async function createPreview(siteId,files,description,actor='mcp'){const site=await getSite(siteId),remote=await connectSite(site),details=[],validationFiles=[];try{for(const f of files){const rp=joinRemote(site.remote_root,f.path),exists=await remote.exists(rp),old=exists?await remote.read(rp):null;let afterBuffer=null,afterEncoding='utf8',after=null;if(f.content===null){afterBuffer=null;}else if(f.sourceCommit){afterBuffer=await readCommitMaybe(site,f.path,f.sourceCommit);if(afterBuffer===null)throw new Error(`File missing in source commit: ${f.path}`);afterEncoding='git';after=f.sourceCommit;}else{afterBuffer=Buffer.isBuffer(f.content)?f.content:Buffer.from(f.content);afterEncoding=Buffer.isBuffer(f.content)?'base64':'utf8';after=Buffer.isBuffer(f.content)?afterBuffer.toString('base64'):f.content;}if(afterBuffer!==null)validationFiles.push({path:f.path,content:afterBuffer});details.push({path:f.path,beforeExists:exists,beforeHash:old?hash(old):null,afterExists:afterBuffer!==null,afterHash:afterBuffer?hash(afterBuffer):null,afterEncoding,after});}}finally{await remote.close();}const validation=await validateFiles(validationFiles);if(validation.some(v=>!v.ok))throw new Error(`Validation failed: ${JSON.stringify(validation)}`);const r=await q(`insert into change_previews(site_id,description,actor,changes,validation,expires_at) values($1,$2,$3,$4,$5,now()+interval '24 hours') returning id`,[site.id,description,actor,JSON.stringify(details),JSON.stringify(validation)]);return{previewId:r.rows[0].id,site:site.domain,description,files:details.map(d=>({path:d.path,beforeExists:d.beforeExists,beforeHash:d.beforeHash,afterExists:d.afterExists,afterHash:d.afterHash})),validation};}
async function restoreRemoteSnapshot(site,paths,commit){const remote=await connectSite(site);try{for(const path of paths){const old=await readCommitMaybe(site,path,commit),rp=joinRemote(site.remote_root,path);if(old===null)await remote.remove(rp);else await remote.write(rp,old);}}finally{await remote.close();}}
async function applyPreview(previewId){const p=await q(`select * from change_previews where id=$1 and status='pending' and expires_at>now()`,[previewId]),preview=p.rows[0];if(!preview)throw new Error('Preview not found or expired');const site=await getSite(preview.site_id),changes=preview.changes,paths=changes.map(c=>c.path),preCommit=await commitPaths(site,paths,'Pre-change snapshot'),remote=await connectSite(site),touched=[];let writeError=null;try{for(const c of changes){const rp=joinRemote(site.remote_root,c.path),exists=await remote.exists(rp);if(exists!==c.beforeExists)throw new Error(`Remote existence changed: ${c.path}`);if(exists&&hash(await remote.read(rp))!==c.beforeHash)throw new Error(`Remote file changed since preview: ${c.path}`);if(c.after===null){touched.push(c.path);await remote.remove(rp);}else{let payload;if(c.afterEncoding==='git'){payload=await readCommitMaybe(site,c.path,c.after);if(payload===null)throw new Error(`File missing in source commit during apply: ${c.path}`);}else payload=c.afterEncoding==='base64'?Buffer.from(c.after,'base64'):Buffer.from(c.after);touched.push(c.path);await remote.write(rp,payload);}}}catch(e){writeError=e;}finally{try{await remote.close();}catch{}}if(writeError){if(touched.length){try{await restoreRemoteSnapshot(site,touched,preCommit);}catch(restoreError){console.error('restore after transfer failure',site.domain,restoreError);}}throw writeError;}let postCommit;try{postCommit=await commitPaths(site,paths,preview.description);}catch(e){try{await restoreRemoteSnapshot(site,paths,preCommit);}catch(restoreError){console.error('restore after Git snapshot failure',site.domain,restoreError);}throw new Error(`Live files restored after Git snapshot failure: ${e.message||e}`);}const health=site.monitor_enabled?await checkSiteNow(site):null,status=health&&!health.ok?'deployed_unhealthy':'deployed';const ch=await q(`insert into changes(site_id,preview_id,description,actor,files,pre_commit,post_commit,status,health_result) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,[site.id,preview.id,preview.description,preview.actor,JSON.stringify(paths),preCommit,postCommit,status,health?JSON.stringify(health):null]);await q(`update change_previews set status='applied' where id=$1`,[preview.id]);return{changeId:ch.rows[0].id,preCommit,postCommit,files:paths,status,health};}
async function listHistory(siteId,limit=30){const site=await getSite(siteId);return(await q('select id,description,actor,files,pre_commit,post_commit,status,created_at from changes where site_id=$1 order by created_at desc limit $2',[site.id,limit])).rows;}
async function changeDiff(changeId){const r=await q('select * from changes where id=$1',[changeId]),ch=r.rows[0];if(!ch)throw new Error('Change not found');return diffCommits(await getSite(ch.site_id),ch.pre_commit,ch.post_commit);}
async function rollbackPreview(changeId,actor='mcp'){const r=await q('select * from changes where id=$1',[changeId]),ch=r.rows[0];if(!ch)throw new Error('Change not found');const site=await getSite(ch.site_id),files=await changedFiles(site,ch.pre_commit,ch.post_commit),proposed=[];for(const path of files){const old=await readCommitMaybe(site,path,ch.pre_commit);proposed.push(old===null?{path,content:null}:{path,sourceCommit:ch.pre_commit});}return createPreview(site.id,proposed,`Rollback ${changeId}: ${ch.description}`,actor);}

async function sslDays(url){if(!url.startsWith('https:'))return null;const u=new URL(url);return new Promise(resolve=>{const s=tls.connect(Number(u.port||443),u.hostname,{servername:u.hostname,rejectUnauthorized:true,timeout:7000},()=>{const cert=s.getPeerCertificate();s.end();resolve(cert.valid_to?Math.floor((new Date(cert.valid_to).getTime()-Date.now())/86400000):null);});s.on('error',()=>resolve(null));s.on('timeout',()=>{s.destroy();resolve(null);});});}
async function checkSiteNow(site){const url=site.monitor_url||`https://${site.domain}`,started=Date.now();let status=null,error=null,body='';try{const res=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(site.monitor_timeout_ms),headers:{'User-Agent':'Lorzen-SiteOps/0.3'}});status=res.status;body=(await res.text()).slice(0,262144);}catch(e){error=e.message||String(e);}const responseMs=Date.now()-started,ssl=await sslDays(url),checks={http:status===site.monitor_expected_status,content:!site.monitor_content||body.includes(site.monitor_content),speed:!site.response_warn_ms||responseMs<=site.response_warn_ms,ssl:ssl===null||ssl>=site.ssl_warn_days},ok=!error&&Object.values(checks).every(Boolean);return{ok,url,status,responseMs,sslDays:ssl,error,checks,checkedAt:new Date().toISOString()};}
async function sendAlert(subject,text){const jobs=[];if(cfg.alertEmail&&cfg.smtpHost){const t=nodemailer.createTransport({host:cfg.smtpHost,port:cfg.smtpPort,secure:cfg.smtpSecure,auth:cfg.smtpUser?{user:cfg.smtpUser,pass:cfg.smtpPassword}:undefined});jobs.push(t.sendMail({from:cfg.smtpFrom,to:cfg.alertEmail,subject:`[SiteOps] ${subject}`,text}));}if(cfg.webhook)jobs.push(fetch(cfg.webhook,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:'siteops',subject,text,timestamp:new Date().toISOString()})}));await Promise.allSettled(jobs);}
async function processMonitor(site){const result=await checkSiteNow(site);await q('insert into monitor_checks(site_id,ok,http_status,response_ms,ssl_days,error,details) values($1,$2,$3,$4,$5,$6,$7)',[site.id,result.ok,result.status,result.responseMs,result.sslDays,result.error,JSON.stringify(result)]);const state=(await q('select * from monitor_state where site_id=$1',[site.id])).rows[0],open=state?.incident_id||null;let failures=state?.consecutive_failures||0;if(result.ok){if(open){await q("update incidents set resolved_at=now(),status='resolved' where id=$1",[open]);await sendAlert(`RECOVERED: ${site.domain}`,`${site.domain} is healthy again. Response ${result.responseMs} ms.`);}await q(`insert into monitor_state(site_id,consecutive_failures,last_check_at,last_ok_at,incident_id) values($1,0,now(),now(),null) on conflict(site_id) do update set consecutive_failures=0,last_check_at=now(),last_ok_at=now(),incident_id=null`,[site.id]);}else{failures++;let incidentId=open;if(failures>=site.monitor_failure_threshold&&!open){const i=await q(`insert into incidents(site_id,status,title,details) values($1,'open',$2,$3) returning id`,[site.id,`${site.domain} unhealthy`,JSON.stringify(result)]);incidentId=i.rows[0].id;await sendAlert(`DOWN: ${site.domain}`,JSON.stringify(result,null,2));}await q(`insert into monitor_state(site_id,consecutive_failures,last_check_at,incident_id) values($1,$2,now(),$3) on conflict(site_id) do update set consecutive_failures=$2,last_check_at=now(),incident_id=$3`,[site.id,failures,incidentId]);}return result;}
let monitorRunning=false;function startMonitor(){setInterval(async()=>{if(monitorRunning)return;monitorRunning=true;try{const sites=(await q(`select s.* from sites s left join monitor_state ms on ms.site_id=s.id where s.enabled=true and s.monitor_enabled=true and (ms.last_check_at is null or ms.last_check_at < now() - make_interval(secs => s.monitor_interval_seconds))`)).rows;for(const site of sites){try{await processMonitor(site);}catch(e){console.error('monitor',site.domain,e);}}}finally{monitorRunning=false;}},cfg.workerInterval).unref();}
let backupRunning=false;function startBackupWorker(){setInterval(async()=>{if(backupRunning)return;backupRunning=true;try{const sites=(await q(`select s.* from sites s left join lateral (select max(created_at) last_backup_at from backups b where b.site_id=s.id) b on true left join backup_state bs on bs.site_id=s.id where s.enabled=true and s.backup_enabled=true and (b.last_backup_at is null or b.last_backup_at < now()-make_interval(secs => s.backup_interval_seconds)) and (bs.last_attempt_at is null or bs.last_attempt_at < now()-make_interval(secs => least(s.backup_interval_seconds,900))) order by coalesce(b.last_backup_at,'epoch'::timestamptz)`)).rows;for(const site of sites){const previous=(await q('select * from backup_state where site_id=$1',[site.id])).rows[0];await q(`insert into backup_state(site_id,last_attempt_at,updated_at) values($1,now(),now()) on conflict(site_id) do update set last_attempt_at=now(),updated_at=now()`,[site.id]);try{await fullBackup(site,site.backup_max_files||10000);await q(`update backup_state set last_success_at=now(),last_error=null,updated_at=now() where site_id=$1`,[site.id]);}catch(e){const msg=String(e.message||e).slice(0,4000);await q(`update backup_state set last_error=$2,updated_at=now() where site_id=$1`,[site.id,msg]);if(!previous?.last_error)await sendAlert(`BACKUP FAILED: ${site.domain}`,msg);console.error('backup',site.domain,e);}}}finally{backupRunning=false;}},cfg.backupWorkerInterval).unref();}

const toolText=value=>({content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value,null,2)}]});
function mcpServer(){const s=new McpServer({name:'lorzen-siteops',version:'0.3.0'});s.registerTool('sites_list',{description:'List managed websites',inputSchema:z.object({})},async()=>toolText((await listSites()).map(x=>({id:x.id,slug:x.slug,name:x.name,domain:x.domain,protocol:x.protocol,monitor_enabled:x.monitor_enabled}))));s.registerTool('site_status',{description:'Immediate HTTP/SSL health check',inputSchema:z.object({site:z.string()})},async({site})=>toolText(await checkSiteNow(await getSite(site))));s.registerTool('files_list',{description:'List live remote files/directories',inputSchema:z.object({site:z.string(),path:z.string().default('')})},async({site,path})=>toolText(await listRemote(site,path)));s.registerTool('file_read',{description:'Read a live remote text file',inputSchema:z.object({site:z.string(),path:z.string()})},async({site,path})=>toolText(await readRemoteText(site,path)));s.registerTool('change_preview',{description:'Prepare safe file changes. content=null deletes. No production write yet.',inputSchema:z.object({site:z.string(),description:z.string().min(3),files:z.array(z.object({path:z.string(),content:z.string().nullable()})).min(1)})},async({site,description,files})=>toolText(await createPreview(site,files,description)));s.registerTool('change_apply',{description:'Apply an approved preview with Git snapshots and health check',inputSchema:z.object({preview_id:z.string().uuid()})},async({preview_id})=>toolText(await applyPreview(preview_id)));s.registerTool('history_list',{description:'List recent recorded changes',inputSchema:z.object({site:z.string(),limit:z.number().int().min(1).max(100).default(30)})},async({site,limit})=>toolText(await listHistory(site,limit)));s.registerTool('history_diff',{description:'Get Git diff for a recorded change',inputSchema:z.object({change_id:z.string().uuid()})},async({change_id})=>toolText(await changeDiff(change_id)));s.registerTool('rollback_preview',{description:'Prepare rollback of a change; does not write production',inputSchema:z.object({change_id:z.string().uuid()})},async({change_id})=>toolText(await rollbackPreview(change_id)));s.registerTool('site_backup',{description:'Create a full Git-backed site snapshot',inputSchema:z.object({site:z.string()})},async({site})=>toolText(await fullBackup(await getSite(site))));s.registerTool('backups_list',{description:'List full backups',inputSchema:z.object({site:z.string(),limit:z.number().int().min(1).max(100).default(30)})},async({site,limit})=>toolText(await listBackups(await getSite(site),limit)));s.registerTool('backup_restore_preview',{description:'Create a safe restore preview from a full backup. A fresh safety backup is made first.',inputSchema:z.object({backup_id:z.string().uuid()})},async({backup_id})=>toolText(await backupRestorePreview(backup_id)));return s;}

function dashboardAuth(req,reply){const h=req.headers.authorization||'';if(!h.startsWith('Basic ')){reply.header('WWW-Authenticate','Basic realm="SiteOps"');reply.code(401).send('Authentication required');return false;}const decoded=Buffer.from(h.slice(6),'base64').toString(),i=decoded.indexOf(':'),u=i>=0?decoded.slice(0,i):'',p=i>=0?decoded.slice(i+1):'';if(!safeEqual(u,cfg.dashboardUser)||!safeEqual(p,cfg.dashboardPassword)){reply.header('WWW-Authenticate','Basic realm="SiteOps"');reply.code(401).send('Authentication required');return false;}return true;}
function mcpAuth(req,reply){const h=req.headers.authorization||'',t=h.startsWith('Bearer ')?h.slice(7):'';if(!safeEqual(t,cfg.mcpToken)){reply.code(401).send({error:'unauthorized'});return false;}return true;}
function page(title,body){return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · SiteOps</title><link rel="stylesheet" href="/assets/app.css"></head><body><main>${body}</main></body></html>`;}
async function dashboard(){const sites=await listSites(),checks=(await q('select distinct on(site_id) site_id,ok,http_status,response_ms,ssl_days,created_at from monitor_checks order by site_id,created_at desc')).rows,checkMap=new Map(checks.map(x=>[x.site_id,x])),backups=(await q('select distinct on(site_id) site_id,git_commit,file_count,created_at from backups order by site_id,created_at desc')).rows,backupMap=new Map(backups.map(x=>[x.site_id,x])),incidents=(await q("select i.*,s.domain from incidents i join sites s on s.id=i.site_id where i.status='open' order by i.created_at desc")).rows,changes=(await q('select c.*,s.domain from changes c join sites s on s.id=c.site_id order by c.created_at desc limit 20')).rows;const cards=sites.map(s=>{const c=checkMap.get(s.id),b=backupMap.get(s.id);return `<a class="card" href="/sites/${esc(s.slug)}"><div class="row"><strong>${esc(s.name)}</strong><span class="pill ${c?.ok?'ok':'bad'}">${c?c.ok?'ONLINE':'ALARM':'NO DATA'}</span></div><small>${esc(s.domain)} · ${esc(s.protocol.toUpperCase())}</small><div class="metrics"><span>${c?.response_ms??'–'} ms<em>Response</em></span><span>${c?.ssl_days??'–'} d<em>SSL</em></span><span>${s.monitor_enabled?'ON':'OFF'}<em>Monitor</em></span><span>${b?.created_at?new Date(b.created_at).toLocaleDateString('de-DE'):'–'}<em>Backup</em></span></div></a>`}).join('');const inc=incidents.length?incidents.map(i=>`<li><b>${esc(i.domain)}</b> ${esc(i.title)}<small>${new Date(i.created_at).toLocaleString('de-DE')}</small></li>`).join(''):'<li>Keine offenen Incidents.</li>',hist=changes.map(c=>`<li><b>${esc(c.domain)}</b> ${esc(c.description)} <span class="pill">${esc(c.status)}</span><small>${new Date(c.created_at).toLocaleString('de-DE')} · ${esc(c.actor)}</small></li>`).join('')||'<li>Noch keine Änderungen.</li>';return page('SiteOps',`<header><div><span class="eyebrow">Lorzen</span><h1>SiteOps</h1><p>Websites, Backups, Monitoring und Rollbacks.</p></div><a class="btn" href="/setup">+ Website</a></header><section><h2>Websites</h2><div class="grid">${cards}</div></section><div class="twocol"><section><h2>Offene Incidents</h2><ul>${inc}</ul></section><section><h2>Letzte Änderungen</h2><ul>${hist}</ul></section></div>`);}

async function start(){await migrate();const app=Fastify({logger:true,bodyLimit:8*1024*1024});app.get('/health',async()=>({status:'ok',version:'0.3.0',database:'ok',worker:'ok',time:new Date().toISOString()}));app.get('/assets/app.css',async(_r,reply)=>reply.type('text/css').send(await readFile(new URL('./public/app.css',import.meta.url),'utf8')));app.addHook('onRequest',async(req,reply)=>{if(req.url==='/health'||req.url.startsWith('/assets/'))return;if(req.url.startsWith('/mcp')){if(!mcpAuth(req,reply))return reply;}else if(!dashboardAuth(req,reply))return reply;});const handler=createMcpHandler(()=>mcpServer()),nodeHandler=toNodeHandler(handler);app.all('/mcp',async(req,reply)=>nodeHandler(req.raw,reply.raw,req.body));app.get('/',async(_r,reply)=>reply.type('text/html').send(await dashboard()));app.get('/api/sites',async()=>listSites());app.post('/api/sites',async(req,reply)=>{const schema=z.object({slug:z.string().regex(/^[a-z0-9-]+$/),name:z.string(),domain:z.string(),protocol:z.enum(['sftp','ftps','ftp']),host:z.string(),port:z.coerce.number(),username:z.string(),password:z.string().optional(),privateKey:z.string().optional(),passphrase:z.string().optional(),remoteRoot:z.string(),siteType:z.string().default('php'),monitorUrl:z.string().url().optional()});const site=await createSite(schema.parse(req.body));return reply.code(201).send({id:site.id,slug:site.slug});});app.post('/api/sites/:site/backup',async req=>{const site=await getSite(req.params.site);return fullBackup(site,site.backup_max_files||10000);});app.post('/api/sites/:site/check',async req=>processMonitor(await getSite(req.params.site)));app.patch('/api/sites/:site',async req=>{const schema=z.object({name:z.string().min(1).optional(),domain:z.string().min(1).optional(),enabled:z.boolean().optional(),backup_enabled:z.boolean().optional(),backup_interval_seconds:z.coerce.number().int().min(900).max(2592000).optional(),backup_max_files:z.coerce.number().int().min(100).max(200000).optional(),monitor_enabled:z.boolean().optional(),monitor_url:z.string().url().optional(),monitor_interval_seconds:z.coerce.number().int().min(30).max(86400).optional(),monitor_expected_status:z.coerce.number().int().min(100).max(599).optional(),monitor_content:z.string().nullable().optional(),monitor_timeout_ms:z.coerce.number().int().min(1000).max(60000).optional(),monitor_failure_threshold:z.coerce.number().int().min(1).max(20).optional(),response_warn_ms:z.coerce.number().int().min(1).max(60000).nullable().optional(),ssl_warn_days:z.coerce.number().int().min(1).max(365).optional(),exclude_patterns:z.array(z.string()).optional()});const site=await updateSite(req.params.site,schema.parse(req.body));return{ok:true,site:{id:site.id,slug:site.slug,name:site.name,domain:site.domain}};});app.post('/api/backups/:id/restore-preview',async req=>backupRestorePreview(req.params.id,'dashboard'));app.post('/api/changes/:id/rollback-preview',async req=>rollbackPreview(req.params.id,'dashboard'));app.post('/api/previews/:id/apply',async req=>applyPreview(req.params.id));app.get('/setup',async(_r,reply)=>reply.type('text/html').send(page('Website hinzufügen',`<a href="/">← Übersicht</a><h1>Website hinzufügen</h1><form id="f"><label>Name<input name="name" required></label><label>Slug<input name="slug" required pattern="[a-z0-9-]+"></label><label>Domain<input name="domain" required></label><label>Protokoll<select name="protocol"><option>sftp</option><option>ftps</option><option>ftp</option></select></label><label>Host<input name="host" required></label><label>Port<input name="port" type="number" value="22" required></label><label>Benutzer<input name="username" required></label><label>Passwort<input name="password" type="password"></label><label>Remote Root<input name="remoteRoot" value="/" required></label><button>Speichern</button></form><pre id="out"></pre><script>f.onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(f));d.port=Number(d.port);const r=await fetch('/api/sites',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d)});out.textContent=JSON.stringify(await r.json(),null,2)}</script>`)));app.get('/sites/:slug',async(req,reply)=>{const site=await getSite(req.params.slug),hist=await listHistory(site.id,30),backups=await listBackups(site,30),checks=(await q('select * from monitor_checks where site_id=$1 order by created_at desc limit 50',[site.id])).rows,backupState=(await q('select * from backup_state where site_id=$1',[site.id])).rows[0],uptime=checks.length?Math.round(checks.filter(x=>x.ok).length/checks.length*10000)/100:'–',rows=hist.map(c=>`<tr><td>${new Date(c.created_at).toLocaleString('de-DE')}</td><td>${esc(c.description)}</td><td>${esc(c.actor)}</td><td><span class="pill">${esc(c.status)}</span></td><td><button class="ghost" onclick="rollback('${c.id}')">Rollback</button></td></tr>`).join('')||'<tr><td colspan="5">Noch keine Änderungen.</td></tr>',backupRows=backups.map(b=>`<tr><td>${new Date(b.created_at).toLocaleString('de-DE')}</td><td><code>${esc(String(b.git_commit).slice(0,8))}</code></td><td>${b.file_count??'–'}</td><td>${b.changed?'geändert':'identisch'}</td><td><button class="ghost" onclick="restoreBackup('${b.id}')">Restore</button></td></tr>`).join('')||'<tr><td colspan="5">Noch keine Backups.</td></tr>';return reply.type('text/html').send(page(site.name,`<a href="/">← Übersicht</a><header><div><span class="eyebrow">${esc(site.protocol.toUpperCase())} · ${site.enabled?'aktiv':'pausiert'}</span><h1>${esc(site.name)}</h1><p>${esc(site.domain)} · ${esc(site.remote_root)}</p></div><div class="actions"><button class="ghost" onclick="checkNow('${site.slug}')">Jetzt prüfen</button><button onclick="backup('${site.slug}')">Backup jetzt</button></div></header><div class="metrics big"><span>${uptime}%<em>Uptime letzte Checks</em></span><span>${checks[0]?.response_ms??'–'} ms<em>Response</em></span><span>${checks[0]?.ssl_days??'–'} d<em>SSL</em></span><span>${backups[0]?.created_at?new Date(backups[0].created_at).toLocaleString('de-DE'):'–'}<em>Letztes Backup</em></span></div>${backupState?.last_error?`<div class="notice bad"><strong>Backupfehler</strong><span>${esc(backupState.last_error)}</span></div>`:''}<div class="twocol detail"><section><h2>Betrieb</h2><form id="settings"><label class="check"><input type="checkbox" name="enabled" ${site.enabled?'checked':''}> Website aktiv verwalten</label><label class="check"><input type="checkbox" name="monitor_enabled" ${site.monitor_enabled?'checked':''}> Monitoring aktiv</label><label>Monitor-URL<input name="monitor_url" value="${esc(site.monitor_url||'')}"></label><label>Prüfintervall (Sek.)<input type="number" min="30" name="monitor_interval_seconds" value="${site.monitor_interval_seconds}"></label><label>Fehler bis Alarm<input type="number" min="1" name="monitor_failure_threshold" value="${site.monitor_failure_threshold}"></label><label>SSL-Warnung (Tage)<input type="number" min="1" name="ssl_warn_days" value="${site.ssl_warn_days}"></label><label class="check"><input type="checkbox" name="backup_enabled" ${site.backup_enabled?'checked':''}> Automatische Backups</label><label>Backup-Intervall (Sek.)<input type="number" min="900" name="backup_interval_seconds" value="${site.backup_interval_seconds}"></label><label>Max. Dateien pro Backup<input type="number" min="100" name="backup_max_files" value="${site.backup_max_files}"></label><button>Speichern</button><span id="saveState"></span></form></section><section><h2>Backup-Zustand</h2><dl class="facts"><div><dt>Nächstes Intervall</dt><dd>${Math.round(site.backup_interval_seconds/3600*10)/10} h</dd></div><div><dt>Letzter Versuch</dt><dd>${backupState?.last_attempt_at?new Date(backupState.last_attempt_at).toLocaleString('de-DE'):'–'}</dd></div><div><dt>Letzter Erfolg</dt><dd>${backupState?.last_success_at?new Date(backupState.last_success_at).toLocaleString('de-DE'):'–'}</dd></div><div><dt>Backup-Repo</dt><dd>sites/${esc(site.slug)}/public</dd></div></dl></section></div><section><div class="sectionhead"><div><span class="eyebrow">Versionen</span><h2>Backups</h2></div><small>Restore erstellt zuerst automatisch einen Safety-Snapshot.</small></div><div class="tablewrap"><table><thead><tr><th>Zeit</th><th>Commit</th><th>Dateien</th><th>Stand</th><th></th></tr></thead><tbody>${backupRows}</tbody></table></div></section><section><div class="sectionhead"><div><span class="eyebrow">Audit</span><h2>Änderungen</h2></div></div><div class="tablewrap"><table><thead><tr><th>Zeit</th><th>Änderung</th><th>Quelle</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section><script>
const settings=document.getElementById('settings');
settings.onsubmit=async e=>{e.preventDefault();const fd=new FormData(settings),data={enabled:settings.enabled.checked,monitor_enabled:settings.monitor_enabled.checked,backup_enabled:settings.backup_enabled.checked,monitor_url:fd.get('monitor_url'),monitor_interval_seconds:Number(fd.get('monitor_interval_seconds')),monitor_failure_threshold:Number(fd.get('monitor_failure_threshold')),ssl_warn_days:Number(fd.get('ssl_warn_days')),backup_interval_seconds:Number(fd.get('backup_interval_seconds')),backup_max_files:Number(fd.get('backup_max_files'))};const r=await fetch('/api/sites/${site.slug}',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(data)});saveState.textContent=r.ok?'Gespeichert':'Fehler beim Speichern';};
async function backup(s){const r=await fetch('/api/sites/'+s+'/backup',{method:'POST'}),x=await r.json();alert(r.ok?'Backup erstellt: '+String(x.commit||'').slice(0,8):JSON.stringify(x));if(r.ok)location.reload();}
async function checkNow(s){const r=await fetch('/api/sites/'+s+'/check',{method:'POST'}),x=await r.json();alert(x.ok?'Website ist erreichbar':'Prüfung fehlgeschlagen');location.reload();}
async function rollback(id){const r=await fetch('/api/changes/'+id+'/rollback-preview',{method:'POST'}),p=await r.json();if(!r.ok)return alert(JSON.stringify(p));if(confirm('Rollback-Preview '+p.previewId+' anwenden?')){const a=await fetch('/api/previews/'+p.previewId+'/apply',{method:'POST'});alert(JSON.stringify(await a.json()));location.reload();}}
async function restoreBackup(id){if(!confirm('Diesen Backup-Stand vorbereiten? Vorher wird automatisch ein aktueller Safety-Snapshot erstellt.'))return;const r=await fetch('/api/backups/'+id+'/restore-preview',{method:'POST'}),p=await r.json();if(!r.ok)return alert(JSON.stringify(p));if(p.noChanges)return alert(p.message);if(confirm('Restore-Preview '+p.previewId+' jetzt anwenden?')){const a=await fetch('/api/previews/'+p.previewId+'/apply',{method:'POST'});alert(JSON.stringify(await a.json()));location.reload();}}
</script>`));});startMonitor();startBackupWorker();await app.listen({host:cfg.host,port:cfg.port});}

if(process.argv.includes('--check-runtime')){phpParser.parseCode('<?php echo 1;','smoke.php');await db.end();console.log('Runtime imports OK.');}else if(process.argv.includes('--migrate')){await migrate();await db.end();console.log('Database schema applied.');}else{start().catch(e=>{console.error(e);process.exit(1);});}
