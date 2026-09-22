import Fastify from 'fastify';
import mysql from 'mysql2/promise';
import crypto from 'node:crypto';
import tls from 'node:tls';
import { lookup as dnsLookup } from 'node:dns/promises';
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
  port: Number(env('PORT','3000')), host: env('HOST','0.0.0.0'), databaseUrl: process.env.DATABASE_URL || '',
  dbHost: env('DB_HOST','localhost'), dbPort: Number(env('DB_PORT','3306')), dbUser: process.env.DB_USER || '', dbPassword: process.env.DB_PASSWORD || '', dbName: process.env.DB_NAME || '',
  masterKey: process.env.SITEOPS_MASTER_KEY || '', mcpToken: process.env.MCP_API_TOKEN || '', dashboardUser: process.env.DASHBOARD_USER || '',
  dashboardPassword: process.env.DASHBOARD_PASSWORD || '', publicBaseUrl: process.env.PUBLIC_BASE_URL || 'https://siteops.lorzen.cloud',
  githubBackupRepo: process.env.GITHUB_BACKUP_REPO || '', githubBackupToken: process.env.GITHUB_BACKUP_TOKEN || '', backupBranch: env('BACKUP_REPO_BRANCH','main'),
  backupMaxFileBytes: Number(env('BACKUP_MAX_FILE_BYTES','52428800')),
  defaultBackupIntervalSeconds: Number(env('DEFAULT_BACKUP_INTERVAL_SECONDS','86400')), defaultBackupMaxFiles: Number(env('DEFAULT_BACKUP_MAX_FILES','10000')),
  defaultMonitorIntervalSeconds: Number(env('DEFAULT_MONITOR_INTERVAL_SECONDS','60')), defaultMonitorFailureThreshold: Number(env('DEFAULT_MONITOR_FAILURE_THRESHOLD','3')),
  defaultSslWarnDays: Number(env('DEFAULT_SSL_WARN_DAYS','14')),
  alertEmail: process.env.ALERT_EMAIL_TO || '', smtpHost: process.env.SMTP_HOST || '', smtpPort: Number(env('SMTP_PORT','587')),
  smtpSecure: env('SMTP_SECURE','false') === 'true', smtpUser: process.env.SMTP_USER || '', smtpPassword: process.env.SMTP_PASSWORD || '',
  smtpFrom: env('SMTP_FROM','SiteOps <siteops@localhost>'), webhook: process.env.ALERT_WEBHOOK_URL || '',
  workerInterval: Number(env('MONITOR_WORKER_INTERVAL_MS','30000')),
  backupWorkerInterval: Number(env('BACKUP_WORKER_INTERVAL_MS','60000'))
};
const db=mysql.createPool(cfg.databaseUrl||{host:cfg.dbHost,port:cfg.dbPort,user:cfg.dbUser,password:cfg.dbPassword,database:cfg.dbName,connectionLimit:5,charset:'utf8mb4'});
const jsonFields=new Set(['exclude_patterns','changes','validation','files','health_result','details']);
function normalizeRow(row){if(!row||typeof row!=='object')return row;for(const k of jsonFields)if(typeof row[k]==='string'){try{row[k]=JSON.parse(row[k]);}catch{}}return row;}
async function q(text,params=[]){const [raw]=await db.query(text,params);return{rows:Array.isArray(raw)?raw.map(normalizeRow):[],meta:raw};}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
function safeEqual(a,b){const aa=Buffer.from(String(a??'')),bb=Buffer.from(String(b??''));return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);}
function key(){ const raw=Buffer.from(cfg.masterKey,'base64'); if(raw.length!==32) throw new Error('SITEOPS_MASTER_KEY must decode to 32 bytes'); return raw; }
function encrypt(value){ const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',key(),iv); const data=Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value))),cipher.final()]); return [iv,cipher.getAuthTag(),data].map(x=>x.toString('base64url')).join('.'); }
function decrypt(value){ const [iv,tag,data]=value.split('.'); const d=crypto.createDecipheriv('aes-256-gcm',key(),Buffer.from(iv,'base64url')); d.setAuthTag(Buffer.from(tag,'base64url')); return JSON.parse(Buffer.concat([d.update(Buffer.from(data,'base64url')),d.final()]).toString()); }
const phpParser=new PHPParser({parser:{suppressErrors:false,extractDoc:false},ast:{withPositions:false}});
async function ensureColumn(table,column,definition){const r=await q(`show columns from ${table} like ?`,[column]);if(!r.rows.length)await db.query(`alter table ${table} add column ${column} ${definition}`);}
async function migrate(){const sql=await readFile(new URL('./schema.sql',import.meta.url),'utf8');for(const statement of sql.split(/;\s*(?:\n|$)/).map(x=>x.trim()).filter(Boolean))await db.query(statement);await ensureColumn('sites','deployment_mode',"VARCHAR(30) NOT NULL DEFAULT 'webspace'");await ensureColumn('sites','source_repository','VARCHAR(255) NULL');await ensureColumn('sites','source_branch','VARCHAR(191) NULL');await ensureColumn('sites','source_root','TEXT NULL');await ensureColumn('sites','git_credentials','LONGTEXT NULL');await ensureColumn('sites','hostinger_target_directory','TEXT NULL');await ensureColumn('sites','monitor_expected_title','TEXT NULL');await ensureColumn('sites','monitor_check_dns','BOOLEAN NOT NULL DEFAULT TRUE');await ensureColumn('sites','monitor_check_wordpress','BOOLEAN NOT NULL DEFAULT FALSE');await ensureColumn('sites','alert_repeat_minutes','INT NOT NULL DEFAULT 60');await ensureColumn('monitor_state','last_alert_at','DATETIME NULL');await ensureColumn('monitor_state','alert_count','INT NOT NULL DEFAULT 0');}
async function loadSavedConfig(){
  const rows=(await q('select setting_key,setting_value,encrypted from app_settings')).rows;
  const values={};
  for(const row of rows){
    let value=row.setting_value??'';
    if(row.encrypted&&value)value=decrypt(value);
    values[row.setting_key]=value;
  }
  const apply=(key,target,convert=v=>v)=>{if(values[key]!==undefined&&values[key]!==null&&values[key]!=='')cfg[target]=convert(values[key]);};
  apply('public_base_url','publicBaseUrl');
  apply('github_backup_repo','githubBackupRepo',v=>String(v).trim().replace(/^\/+|\/+$/g,''));
  apply('github_backup_token','githubBackupToken');
  apply('backup_branch','backupBranch');
  apply('backup_max_file_bytes','backupMaxFileBytes',Number);
  apply('default_backup_interval_seconds','defaultBackupIntervalSeconds',Number);
  apply('default_backup_max_files','defaultBackupMaxFiles',Number);
  apply('default_monitor_interval_seconds','defaultMonitorIntervalSeconds',Number);
  apply('default_monitor_failure_threshold','defaultMonitorFailureThreshold',Number);
  apply('default_ssl_warn_days','defaultSslWarnDays',Number);
  apply('alert_email','alertEmail');
  apply('alert_webhook','webhook');
  apply('smtp_host','smtpHost');
  apply('smtp_port','smtpPort',Number);
  apply('smtp_secure','smtpSecure',v=>String(v)==='true'||String(v)==='1');
  apply('smtp_user','smtpUser');
  apply('smtp_password','smtpPassword');
  apply('smtp_from','smtpFrom');
}
async function storeSetting(settingKey,value,{secret=false}={}){
  const stored=secret&&value?encrypt(value):String(value??'');
  await q('insert into app_settings(setting_key,setting_value,encrypted) values(?,?,?) on duplicate key update setting_value=values(setting_value),encrypted=values(encrypted),updated_at=now()',[settingKey,stored,secret?1:0]);
}
async function saveAppSettings(x){
  const plain=[
    ['public_base_url','publicBaseUrl'],['github_backup_repo','githubBackupRepo'],['backup_branch','backupBranch'],
    ['backup_max_file_bytes','backupMaxFileBytes'],['default_backup_interval_seconds','defaultBackupIntervalSeconds'],
    ['default_backup_max_files','defaultBackupMaxFiles'],['default_monitor_interval_seconds','defaultMonitorIntervalSeconds'],
    ['default_monitor_failure_threshold','defaultMonitorFailureThreshold'],['default_ssl_warn_days','defaultSslWarnDays'],
    ['alert_email','alertEmail'],['alert_webhook','webhook'],['smtp_host','smtpHost'],['smtp_port','smtpPort'],
    ['smtp_secure','smtpSecure'],['smtp_user','smtpUser'],['smtp_from','smtpFrom']
  ];
  for(const [keyName,target] of plain){
    if(x[target]===undefined)continue;
    const value=target==='githubBackupRepo'?String(x[target]).trim().replace(/^\/+|\/+$/g,''):x[target];
    cfg[target]=value;
    await storeSetting(keyName,value);
  }
  if(x.githubBackupToken){
    cfg.githubBackupToken=x.githubBackupToken;
    await storeSetting('github_backup_token',x.githubBackupToken,{secret:true});
  }
  if(x.smtpPassword){
    cfg.smtpPassword=x.smtpPassword;
    await storeSetting('smtp_password',x.smtpPassword,{secret:true});
  }
  backupRepoChecked=false;
  commitTreeCache.clear();
  return publicSettings();
}
function publicSettings(){return{
  publicBaseUrl:cfg.publicBaseUrl,
  githubBackupRepo:cfg.githubBackupRepo,githubBackupTokenConfigured:Boolean(cfg.githubBackupToken),backupBranch:cfg.backupBranch,
  backupMaxFileBytes:cfg.backupMaxFileBytes,
  defaultBackupIntervalSeconds:cfg.defaultBackupIntervalSeconds,defaultBackupMaxFiles:cfg.defaultBackupMaxFiles,
  defaultMonitorIntervalSeconds:cfg.defaultMonitorIntervalSeconds,defaultMonitorFailureThreshold:cfg.defaultMonitorFailureThreshold,
  defaultSslWarnDays:cfg.defaultSslWarnDays,
  alertEmail:cfg.alertEmail,webhook:cfg.webhook,smtpHost:cfg.smtpHost,smtpPort:cfg.smtpPort,smtpSecure:cfg.smtpSecure,
  smtpUser:cfg.smtpUser,smtpPasswordConfigured:Boolean(cfg.smtpPassword),smtpFrom:cfg.smtpFrom
};}


function joinRemote(root,path=''){ const clean=String(path).replaceAll('\\','/').replace(/^\/+/, ''); if(clean.split('/').includes('..')) throw new Error('Path traversal rejected'); return `${root.replace(/\/+$/,'')}/${clean}`.replace(/\/$/,'') || '/'; }
class SftpAdapter { constructor(client){this.client=client;} static async connect(site,cred){ const c=new SftpClient(); await c.connect({host:site.host,port:site.port,username:site.username,password:cred.password,privateKey:cred.privateKey,passphrase:cred.passphrase,readyTimeout:15000}); return new SftpAdapter(c); } async list(path){ return (await this.client.list(path)).map(r=>({name:r.name,path:`${path.replace(/\/$/,'')}/${r.name}`,type:r.type==='d'?'directory':r.type==='l'?'link':'file',size:r.size,modifiedAt:r.modifyTime})); } async read(path){const x=await this.client.get(path);return Buffer.isBuffer(x)?x:Buffer.from(x);} async write(path,content){await this.client.mkdir(pathPosix.dirname(path),true);await this.client.put(content,path);} async exists(path){return Boolean(await this.client.exists(path));} async remove(path){if(await this.exists(path))await this.client.delete(path);} async close(){await this.client.end();} }
class FtpAdapter { constructor(client){this.client=client;} static async connect(site,cred,secure){ const c=new FtpClient(15000); await c.access({host:site.host,port:site.port,user:site.username,password:cred.password,secure,secureOptions:secure?{rejectUnauthorized:true}:undefined}); return new FtpAdapter(c); } async list(path){return (await this.client.list(path)).map(r=>({name:r.name,path:`${path.replace(/\/$/,'')}/${r.name}`,type:r.isDirectory?'directory':r.isSymbolicLink?'link':'file',size:r.size,modifiedAt:r.modifiedAt?.getTime()}));} async read(path){const chunks=[];const w=new Writable({write(chunk,_e,cb){chunks.push(Buffer.from(chunk));cb();}});await this.client.downloadTo(w,path);return Buffer.concat(chunks);} async write(path,content){const dir=pathPosix.dirname(path);await this.client.ensureDir(dir);await this.client.uploadFrom(Readable.from(content),pathPosix.basename(path));} async exists(path){try{await this.client.size(path);return true;}catch{return false;}} async remove(path){try{await this.client.remove(path);}catch{}} async close(){this.client.close();} }
class GitHubSourceAdapter {
  constructor(site,token,state){this.site=site;this.token=token;this.repo=String(site.source_repository||'').replace(/^\/+|\/+$/g,'');this.branch=site.source_branch||'main';this.headSha=state.headSha;this.rootTreeSha=state.rootTreeSha;this.treeMap=state.treeMap;this.staged=new Map();}
  static async connect(site,cred){
    const repo=String(site.source_repository||'').replace(/^\/+|\/+$/g,'');
    if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))throw new Error('Source repository must be owner/repository');
    if(!cred?.token)throw new Error('GitHub deploy token is missing');
    const api=async(path,{method='GET',body,allow404=false}={})=>{
      const res=await fetch('https://api.github.com/repos/'+repo+path,{method,headers:{accept:'application/vnd.github+json',authorization:'Bearer '+cred.token,'x-github-api-version':'2022-11-28','user-agent':'Lorzen-SiteOps/0.6.2'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
      const raw=await res.text();let data=null;if(raw){try{data=JSON.parse(raw);}catch{data=raw;}}
      if(allow404&&res.status===404)return null;if(!res.ok)throw new Error('GitHub source '+method+' '+path+' failed ('+res.status+'): '+(data?.message||String(data||'').slice(0,500)));return data;
    };
    const meta=await api('');
    if(meta.archived)throw new Error('Source repository is archived');
    const branch=encodeURIComponent(site.source_branch||meta.default_branch||'main'),ref=await api('/git/ref/heads/'+branch,{allow404:true});
    if(!ref)throw new Error('Source branch not found: '+(site.source_branch||'main'));
    const commit=await api('/git/commits/'+ref.object.sha),tree=await api('/git/trees/'+commit.tree.sha+'?recursive=1');
    if(tree.truncated)throw new Error('Source repository tree is too large for safe processing');
    const state={headSha:ref.object.sha,rootTreeSha:commit.tree.sha,treeMap:new Map((tree.tree||[]).filter(x=>x.type==='blob').map(x=>[x.path,x]))};
    const a=new GitHubSourceAdapter(site,cred.token,state);a.api=api;a.meta=meta;return a;
  }
  clean(path){return String(path||'').replaceAll('\\','/').replace(/^\/+|\/+$/g,'');}
  async list(path){
    const prefix=this.clean(path),base=prefix?prefix+'/':'',seen=new Map();
    const paths=new Set([...this.treeMap.keys(),...this.staged.keys()]);
    for(const full of paths){
      if(base&&!full.startsWith(base))continue;
      if(!base&&full.includes('/')){} 
      const rel=base?full.slice(base.length):full;if(!rel||rel.startsWith('../'))continue;
      const first=rel.split('/')[0],child=base+first,staged=this.staged.get(child);
      if(rel.includes('/'))seen.set(first,{name:first,path:'/'+child,type:'directory'});
      else if(staged!==null)seen.set(first,{name:first,path:'/'+child,type:'file',size:staged?staged.length:undefined});
    }
    return[...seen.values()];
  }
  async read(path){
    const p=this.clean(path);if(this.staged.has(p)){const v=this.staged.get(p);if(v===null)throw new Error('File not found: '+p);return v;}
    const e=this.treeMap.get(p);if(!e)throw new Error('File not found: '+p);const blob=await this.api('/git/blobs/'+e.sha);return Buffer.from(String(blob.content||'').replace(/\n/g,''),'base64');
  }
  async exists(path){const p=this.clean(path);if(this.staged.has(p))return this.staged.get(p)!==null;return this.treeMap.has(p);}
  async write(path,content){this.staged.set(this.clean(path),Buffer.isBuffer(content)?content:Buffer.from(content));}
  async remove(path){this.staged.set(this.clean(path),null);}
  async close(){
    if(!this.staged.size)return;
    const changes=[];
    for(const [path,content] of this.staged){
      if(content===null){if(this.treeMap.has(path))changes.push({path,mode:'100644',type:'blob',sha:null});continue;}
      const existing=this.treeMap.get(path),sha=gitBlobSha(content);if(existing?.sha===sha)continue;
      const blob=await this.api('/git/blobs',{method:'POST',body:{content:content.toString('base64'),encoding:'base64'}});
      changes.push({path,mode:'100644',type:'blob',sha:blob.sha});
    }
    if(!changes.length){this.staged.clear();return;}
    const tree=await this.api('/git/trees',{method:'POST',body:{base_tree:this.rootTreeSha,tree:changes}});
    const commit=await this.api('/git/commits',{method:'POST',body:{message:'SiteOps: update '+this.site.domain,tree:tree.sha,parents:[this.headSha]}});
    await this.api('/git/refs/heads/'+encodeURIComponent(this.branch),{method:'PATCH',body:{sha:commit.sha,force:false}});
    this.headSha=commit.sha;this.rootTreeSha=tree.sha;for(const ch of changes){if(ch.sha===null)this.treeMap.delete(ch.path);else this.treeMap.set(ch.path,{path:ch.path,type:'blob',sha:ch.sha});}this.staged.clear();
  }
}
async function connectSite(site){
  if(site.deployment_mode==='hostinger_git'){const cred=site.git_credentials?decrypt(site.git_credentials):{};return GitHubSourceAdapter.connect(site,cred);}
  const cred=decrypt(site.encrypted_credentials);return site.protocol==='sftp'?SftpAdapter.connect(site,cred):FtpAdapter.connect(site,cred,site.protocol==='ftps');
}
async function listSites(){return (await q('select * from sites order by name')).rows;}
async function getSite(idOrSlug){const r=await q('select * from sites where id=? or slug=? limit 1',[idOrSlug,idOrSlug]);if(!r.rows[0])throw new Error(`Unknown site ${idOrSlug}`);return r.rows[0];}
function publicSite(site){
  return {
    id:site.id,slug:site.slug,name:site.name,domain:site.domain,siteType:site.site_type,deploymentMode:site.deployment_mode||'webspace',
    enabled:Boolean(site.enabled),protocol:site.protocol,host:site.deployment_mode==='hostinger_git'?null:site.host,port:site.deployment_mode==='hostinger_git'?null:site.port,
    username:site.deployment_mode==='hostinger_git'?null:site.username,remoteRoot:site.deployment_mode==='hostinger_git'?null:site.remote_root,
    credentialsConfigured:Boolean(site.encrypted_credentials),
    sourceRepository:site.source_repository,sourceBranch:site.source_branch,sourceRoot:site.source_root,gitTokenConfigured:Boolean(site.git_credentials),
    hostingerTargetDirectory:site.hostinger_target_directory,
    monitor:{enabled:Boolean(site.monitor_enabled),url:site.monitor_url,intervalSeconds:site.monitor_interval_seconds,expectedStatus:site.monitor_expected_status,
      expectedContent:site.monitor_content,expectedTitle:site.monitor_expected_title,checkDns:Boolean(site.monitor_check_dns),checkWordPress:Boolean(site.monitor_check_wordpress),
      timeoutMs:site.monitor_timeout_ms,failureThreshold:site.monitor_failure_threshold,alertRepeatMinutes:site.alert_repeat_minutes,responseWarnMs:site.response_warn_ms,sslWarnDays:site.ssl_warn_days},
    backup:{enabled:Boolean(site.backup_enabled),intervalSeconds:site.backup_interval_seconds,maxFiles:site.backup_max_files},
    exclusions:Array.isArray(site.exclude_patterns)?site.exclude_patterns:[],createdAt:site.created_at,updatedAt:site.updated_at
  };
}
async function testStoredConnection(site){
  const remote=await connectSite(site);
  try{
    const entries=await remote.list(joinRemote(site.remote_root,''));
    return {ok:true,mode:site.deployment_mode||'webspace',path:site.remote_root,repository:site.source_repository||undefined,branch:site.source_branch||undefined,entries:entries.slice(0,20).map(e=>({name:e.name,type:e.type}))};
  }finally{await remote.close();}
}
async function updateSiteConnection(idOrSlug,x){
  const site=await getSite(idOrSlug),mode=x.deploymentMode||site.deployment_mode||'webspace';
  if(mode==='hostinger_git'){
    const repo=String(x.sourceRepository??site.source_repository??'').trim().replace(/^\/+|\/+$/g,'');
    const branch=String(x.sourceBranch??site.source_branch??'main').trim()||'main',root=String(x.sourceRoot??site.source_root??'').trim().replace(/^\/+|\/+$/g,'');
    let creds=site.git_credentials;
    if(x.gitToken)creds=encrypt({token:x.gitToken});
    if(!creds)throw new Error('GitHub source token is required');
    const candidate={...site,deployment_mode:'hostinger_git',source_repository:repo,source_branch:branch,source_root:root,remote_root:root?'/'+root:'/',git_credentials:creds,hostinger_target_directory:x.hostingerTargetDirectory??site.hostinger_target_directory??'public_html'};
    await testStoredConnection(candidate);
    await q('update sites set deployment_mode=?,source_repository=?,source_branch=?,source_root=?,remote_root=?,git_credentials=?,hostinger_target_directory=?,updated_at=now() where id=?',
      ['hostinger_git',repo,branch,root,candidate.remote_root,creds,candidate.hostinger_target_directory,site.id]);
  }else{
    const protocol=x.protocol??site.protocol,host=String(x.host??site.host??'').trim(),port=Number(x.port??site.port),username=String(x.username??site.username??'').trim(),remoteRoot=String(x.remoteRoot??site.remote_root??'/').trim()||'/';
    let creds=site.encrypted_credentials;
    if(x.password!==undefined||x.privateKey!==undefined||x.passphrase!==undefined){
      const previous=site.encrypted_credentials?decrypt(site.encrypted_credentials):{};
      creds=encrypt({password:x.password!==undefined?x.password:previous.password,privateKey:x.privateKey!==undefined?x.privateKey:previous.privateKey,passphrase:x.passphrase!==undefined?x.passphrase:previous.passphrase});
    }
    if(!creds)throw new Error('Webspace credentials are required');
    const candidate={...site,deployment_mode:'webspace',protocol,host,port,username,remote_root:remoteRoot,encrypted_credentials:creds};
    await testStoredConnection(candidate);
    await q('update sites set deployment_mode=?,protocol=?,host=?,port=?,username=?,remote_root=?,encrypted_credentials=?,updated_at=now() where id=?',
      ['webspace',protocol,host,port,username,remoteRoot,creds,site.id]);
  }
  return getSite(site.id);
}

async function createSite(x){
  const id=crypto.randomUUID(),gitMode=x.deploymentMode==='hostinger_git',sourceRoot=String(x.sourceRoot||'').replace(/^\/+|\/+$/g,'');
  const remoteRoot=gitMode?(sourceRoot?'/'+sourceRoot:'/'):(x.remoteRoot||'/');
  const protocol=gitMode?'sftp':x.protocol,host=gitMode?'github.com':x.host,port=gitMode?443:x.port,username=gitMode?'git':x.username;
  await q(`insert into sites(id,slug,name,domain,protocol,host,port,username,encrypted_credentials,remote_root,site_type,deployment_mode,source_repository,source_branch,source_root,git_credentials,hostinger_target_directory,monitor_url,exclude_patterns) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
    id,x.slug,x.name,x.domain,protocol,host,port,username,
    encrypt(gitMode?{}:{password:x.password,privateKey:x.privateKey,passphrase:x.passphrase}),remoteRoot,x.siteType||'php',
    gitMode?'hostinger_git':'webspace',gitMode?String(x.sourceRepository||'').replace(/^\/+|\/+$/g,''):null,gitMode?(x.sourceBranch||'main'):null,
    gitMode?sourceRoot:null,gitMode?encrypt({token:x.gitToken}):null,gitMode?(x.hostingerTargetDirectory||'public_html'):null,
    x.monitorUrl||`https://${x.domain}`,JSON.stringify(['.git','node_modules','wp-content/cache','wp-content/uploads'])
  ]);
  await updateSite(id,{backup_enabled:x.backupEnabled??true,backup_interval_seconds:x.backupIntervalSeconds??cfg.defaultBackupIntervalSeconds,backup_max_files:x.backupMaxFiles??cfg.defaultBackupMaxFiles,monitor_enabled:x.monitorEnabled??true,monitor_interval_seconds:x.monitorIntervalSeconds??cfg.defaultMonitorIntervalSeconds,monitor_failure_threshold:x.monitorFailureThreshold??cfg.defaultMonitorFailureThreshold,ssl_warn_days:x.sslWarnDays??cfg.defaultSslWarnDays});
  return getSite(id);
}
async function testSiteConnection(x){
  const gitMode=x.deploymentMode==='hostinger_git',sourceRoot=String(x.sourceRoot||'').replace(/^\/+|\/+$/g,'');
  const site=gitMode?{domain:x.domain,deployment_mode:'hostinger_git',source_repository:String(x.sourceRepository||'').replace(/^\/+|\/+$/g,''),source_branch:x.sourceBranch||'main',remote_root:sourceRoot?'/'+sourceRoot:'/',git_credentials:encrypt({token:x.gitToken})}:{protocol:x.protocol,host:x.host,port:x.port,username:x.username,remote_root:x.remoteRoot,encrypted_credentials:encrypt({password:x.password,privateKey:x.privateKey,passphrase:x.passphrase})};
  const remote=await connectSite(site);try{const entries=await remote.list(joinRemote(site.remote_root,''));return{ok:true,mode:gitMode?'hostinger_git':'webspace',path:site.remote_root,repository:gitMode?site.source_repository:undefined,branch:gitMode?site.source_branch:undefined,entries:entries.slice(0,12).map(e=>({name:e.name,type:e.type}))};}finally{await remote.close();}
}
async function updateSite(idOrSlug,x){const site=await getSite(idOrSlug),allowed=['name','domain','enabled','backup_enabled','backup_interval_seconds','backup_max_files','monitor_enabled','monitor_url','monitor_interval_seconds','monitor_expected_status','monitor_content','monitor_expected_title','monitor_check_dns','monitor_check_wordpress','monitor_timeout_ms','monitor_failure_threshold','alert_repeat_minutes','response_warn_ms','ssl_warn_days','exclude_patterns','source_repository','source_branch','source_root','hostinger_target_directory'],entries=Object.entries(x).filter(([k,v])=>allowed.includes(k)&&v!==undefined);if(!entries.length)return site;const params=[...entries.map(([k,v])=>k==='exclude_patterns'?JSON.stringify(v):v),site.id],sets=entries.map(([k])=>k+'=?'),sql='update sites set '+sets.join(',')+',updated_at=now() where id=?';await q(sql,params);return getSite(site.id);}
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
      'user-agent':'Lorzen-SiteOps/0.6.2'
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
  cfg.githubBackupRepo=String(cfg.githubBackupRepo||'').trim().replace(/^\/+|\/+$/g,'');
  if(!cfg.githubBackupRepo||!cfg.githubBackupToken)throw new Error('GitHub backup is not configured. Set GITHUB_BACKUP_REPO and GITHUB_BACKUP_TOKEN.');
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
      const backupId=crypto.randomUUID();await q('insert into backups(id,site_id,git_commit,backup_type,file_count,changed) values(?,?,?,?,?,?)',[backupId,site.id,commit,'full',count,changed]);
      return{commit,files:count,changed};
    }finally{try{await remote.close();}catch{}}
  });
}
async function listBackups(site,limit=30){return(await q('select id,git_commit,backup_type,file_count,changed,created_at from backups where site_id=? order by created_at desc limit ?',[site.id,limit])).rows;}
async function backupRestorePreview(backupId,actor='mcp'){const b=(await q('select * from backups where id=?',[backupId])).rows[0];if(!b)throw new Error('Backup not found');const site=await getSite(b.site_id);const safety=await fullBackup(site,site.backup_max_files||10000);const files=await changedFiles(site,b.git_commit,safety.commit);if(!files.length)return{site:site.domain,backupId,noChanges:true,safetyCommit:safety.commit,message:'Live state already matches this backup'};const proposed=[];for(const path of files){const old=await readCommitMaybe(site,path,b.git_commit);proposed.push(old===null?{path,content:null}:{path,sourceCommit:b.git_commit});}const preview=await createPreview(site.id,proposed,'Restore backup '+backupId+' ('+String(b.git_commit).slice(0,8)+')',actor);return{...preview,backupId,safetyCommit:safety.commit};}

async function validateFiles(files){const results=[];for(const f of files){if(f.content===null||!f.path.endsWith('.php'))continue;try{phpParser.parseCode(f.content.toString('utf8'),f.path);results.push({path:f.path,ok:true,output:'PHP syntax parsed'});}catch(e){results.push({path:f.path,ok:false,output:String(e.message||e)});}}return results;}
async function createPreview(siteId,files,description,actor='mcp'){const site=await getSite(siteId),remote=await connectSite(site),details=[],validationFiles=[];try{for(const f of files){const rp=joinRemote(site.remote_root,f.path),exists=await remote.exists(rp),old=exists?await remote.read(rp):null;let afterBuffer=null,afterEncoding='utf8',after=null;if(f.content===null){afterBuffer=null;}else if(f.sourceCommit){afterBuffer=await readCommitMaybe(site,f.path,f.sourceCommit);if(afterBuffer===null)throw new Error(`File missing in source commit: ${f.path}`);afterEncoding='git';after=f.sourceCommit;}else{afterBuffer=Buffer.isBuffer(f.content)?f.content:Buffer.from(f.content);afterEncoding=Buffer.isBuffer(f.content)?'base64':'utf8';after=Buffer.isBuffer(f.content)?afterBuffer.toString('base64'):f.content;}if(afterBuffer!==null)validationFiles.push({path:f.path,content:afterBuffer});details.push({path:f.path,beforeExists:exists,beforeHash:old?hash(old):null,afterExists:afterBuffer!==null,afterHash:afterBuffer?hash(afterBuffer):null,afterEncoding,after});}}finally{await remote.close();}const validation=await validateFiles(validationFiles);if(validation.some(v=>!v.ok))throw new Error(`Validation failed: ${JSON.stringify(validation)}`);const previewId=crypto.randomUUID();await q(`insert into change_previews(id,site_id,description,actor,changes,validation,expires_at) values(?,?,?,?,?,?,date_add(now(),interval 24 hour))`,[previewId,site.id,description,actor,JSON.stringify(details),JSON.stringify(validation)]);return{previewId,site:site.domain,description,files:details.map(d=>({path:d.path,beforeExists:d.beforeExists,beforeHash:d.beforeHash,afterExists:d.afterExists,afterHash:d.afterHash})),validation};}
async function restoreRemoteSnapshot(site,paths,commit){const remote=await connectSite(site);try{for(const path of paths){const old=await readCommitMaybe(site,path,commit),rp=joinRemote(site.remote_root,path);if(old===null)await remote.remove(rp);else await remote.write(rp,old);}}finally{await remote.close();}}
async function applyPreview(previewId){const p=await q(`select * from change_previews where id=? and status='pending' and expires_at>now()`,[previewId]),preview=p.rows[0];if(!preview)throw new Error('Preview not found or expired');const site=await getSite(preview.site_id),changes=preview.changes,paths=changes.map(c=>c.path),preCommit=await commitPaths(site,paths,'Pre-change snapshot'),remote=await connectSite(site),touched=[];let writeError=null;try{for(const c of changes){const rp=joinRemote(site.remote_root,c.path),exists=await remote.exists(rp);if(exists!==c.beforeExists)throw new Error(`Remote existence changed: ${c.path}`);if(exists&&hash(await remote.read(rp))!==c.beforeHash)throw new Error(`Remote file changed since preview: ${c.path}`);if(c.after===null){touched.push(c.path);await remote.remove(rp);}else{let payload;if(c.afterEncoding==='git'){payload=await readCommitMaybe(site,c.path,c.after);if(payload===null)throw new Error(`File missing in source commit during apply: ${c.path}`);}else payload=c.afterEncoding==='base64'?Buffer.from(c.after,'base64'):Buffer.from(c.after);touched.push(c.path);await remote.write(rp,payload);}}}catch(e){writeError=e;}finally{try{await remote.close();}catch{}}if(writeError){if(touched.length){try{await restoreRemoteSnapshot(site,touched,preCommit);}catch(restoreError){console.error('restore after transfer failure',site.domain,restoreError);}}throw writeError;}let postCommit;try{postCommit=await commitPaths(site,paths,preview.description);}catch(e){try{await restoreRemoteSnapshot(site,paths,preCommit);}catch(restoreError){console.error('restore after Git snapshot failure',site.domain,restoreError);}throw new Error(`Live files restored after Git snapshot failure: ${e.message||e}`);}const health=site.monitor_enabled?await checkSiteNow(site):null,status=site.deployment_mode==='hostinger_git'?'deploy_triggered':health&&!health.ok?'deployed_unhealthy':'deployed';const changeId=crypto.randomUUID();await q(`insert into changes(id,site_id,preview_id,description,actor,files,pre_commit,post_commit,status,health_result) values(?,?,?,?,?,?,?,?,?,?)`,[changeId,site.id,preview.id,preview.description,preview.actor,JSON.stringify(paths),preCommit,postCommit,status,health?JSON.stringify(health):null]);await q(`update change_previews set status='applied' where id=?`,[preview.id]);return{changeId,preCommit,postCommit,files:paths,status,health};}
async function listHistory(siteId,limit=30){const site=await getSite(siteId);return(await q('select id,description,actor,files,pre_commit,post_commit,status,created_at from changes where site_id=? order by created_at desc limit ?',[site.id,limit])).rows;}
async function changeDiff(changeId){const r=await q('select * from changes where id=?',[changeId]),ch=r.rows[0];if(!ch)throw new Error('Change not found');return diffCommits(await getSite(ch.site_id),ch.pre_commit,ch.post_commit);}
async function rollbackPreview(changeId,actor='mcp'){const r=await q('select * from changes where id=?',[changeId]),ch=r.rows[0];if(!ch)throw new Error('Change not found');const site=await getSite(ch.site_id),files=await changedFiles(site,ch.pre_commit,ch.post_commit),proposed=[];for(const path of files){const old=await readCommitMaybe(site,path,ch.pre_commit);proposed.push(old===null?{path,content:null}:{path,sourceCommit:ch.pre_commit});}return createPreview(site.id,proposed,`Rollback ${changeId}: ${ch.description}`,actor);}

async function sslDays(url){if(!url.startsWith('https:'))return null;const u=new URL(url);return new Promise(resolve=>{const s=tls.connect(Number(u.port||443),u.hostname,{servername:u.hostname,rejectUnauthorized:true,timeout:7000},()=>{const cert=s.getPeerCertificate();s.end();resolve(cert.valid_to?Math.floor((new Date(cert.valid_to).getTime()-Date.now())/86400000):null);});s.on('error',()=>resolve(null));s.on('timeout',()=>{s.destroy();resolve(null);});});}
async function fetchWithRedirectTrace(url,timeoutMs){
  const redirects=[];let current=url,response=null;
  for(let i=0;i<8;i++){
    response=await fetch(current,{redirect:'manual',signal:AbortSignal.timeout(timeoutMs),headers:{'User-Agent':'Lorzen-SiteOps/0.7.0'}});
    if(response.status>=300&&response.status<400){
      const location=response.headers.get('location');if(!location)break;
      const next=new URL(location,current).toString();redirects.push({status:response.status,from:current,to:next});current=next;continue;
    }
    break;
  }
  return{response,finalUrl:current,redirects};
}
function htmlTitle(body){const m=String(body||'').match(/<title[^>]*>([\s\S]*?)<\/title>/i);return m?m[1].replace(/\s+/g,' ').trim():null;}
async function checkSiteNow(site){
  const url=site.monitor_url||`https://${site.domain}`,started=Date.now();let status=null,error=null,body='',finalUrl=url,redirects=[],dns=null,wp=null,title=null;
  try{
    const host=new URL(url).hostname;
    if(site.monitor_check_dns){try{dns=(await dnsLookup(host,{all:true})).map(x=>x.address);}catch(e){dns=[];error='DNS: '+String(e.message||e);}}
    if(!error){
      const traced=await fetchWithRedirectTrace(url,site.monitor_timeout_ms);status=traced.response?.status??null;finalUrl=traced.finalUrl;redirects=traced.redirects;
      if(traced.response)body=(await traced.response.text()).slice(0,262144);
      title=htmlTitle(body);
    }
    if(!error&&site.monitor_check_wordpress){
      try{
        const origin=new URL(finalUrl).origin,wpRes=await fetch(origin+'/wp-json/',{redirect:'follow',signal:AbortSignal.timeout(site.monitor_timeout_ms),headers:{'User-Agent':'Lorzen-SiteOps/0.7.0'}});
        wp={ok:wpRes.ok,status:wpRes.status};
      }catch(e){wp={ok:false,error:String(e.message||e)};}
    }
  }catch(e){error=e.message||String(e);}
  const responseMs=Date.now()-started,ssl=await sslDays(finalUrl||url);
  const checks={
    dns:!site.monitor_check_dns||(Array.isArray(dns)&&dns.length>0),
    http:status===site.monitor_expected_status,
    content:!site.monitor_content||body.includes(site.monitor_content),
    title:!site.monitor_expected_title||title===site.monitor_expected_title,
    wordpress:!site.monitor_check_wordpress||Boolean(wp?.ok),
    speed:!site.response_warn_ms||responseMs<=site.response_warn_ms,
    ssl:ssl===null||ssl>=site.ssl_warn_days
  };
  const ok=!error&&Object.values(checks).every(Boolean);
  return{ok,url,finalUrl,status,responseMs,sslDays:ssl,title,dns,redirects,wordpress:wp,error,checks,checkedAt:new Date().toISOString()};
}
async function sendAlert(subject,text){
  const jobs=[];
  if(cfg.alertEmail&&cfg.smtpHost){const t=nodemailer.createTransport({host:cfg.smtpHost,port:cfg.smtpPort,secure:cfg.smtpSecure,auth:cfg.smtpUser?{user:cfg.smtpUser,pass:cfg.smtpPassword}:undefined});jobs.push({channel:'email',promise:t.sendMail({from:cfg.smtpFrom,to:cfg.alertEmail,subject:`[SiteOps] ${subject}`,text})});}
  if(cfg.webhook)jobs.push({channel:'webhook',promise:fetch(cfg.webhook,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:'siteops',subject,text,timestamp:new Date().toISOString()})})});
  const settled=await Promise.allSettled(jobs.map(x=>x.promise));
  return jobs.map((x,i)=>({channel:x.channel,ok:settled[i]?.status==='fulfilled',error:settled[i]?.status==='rejected'?String(settled[i].reason?.message||settled[i].reason):null}));
}
async function incidentEvent(incidentId,siteId,eventType,details){await q('insert into incident_events(incident_id,site_id,event_type,details) values(?,?,?,?)',[incidentId,siteId,eventType,details?JSON.stringify(details):null]);}
async function processMonitor(site){
  const result=await checkSiteNow(site);
  await q('insert into monitor_checks(site_id,ok,http_status,response_ms,ssl_days,error,details) values(?,?,?,?,?,?,?)',[site.id,result.ok,result.status,result.responseMs,result.sslDays,result.error,JSON.stringify(result)]);
  const state=(await q('select * from monitor_state where site_id=?',[site.id])).rows[0],open=state?.incident_id||null;let failures=state?.consecutive_failures||0;
  if(result.ok){
    if(open){
      await q("update incidents set resolved_at=now(),status='resolved' where id=?",[open]);
      await incidentEvent(open,site.id,'recovered',{responseMs:result.responseMs,status:result.status});
      const alertResult=await sendAlert(`RECOVERED: ${site.domain}`,`${site.domain} is healthy again. Response ${result.responseMs} ms.`);
      await incidentEvent(open,site.id,'recovery_alert',alertResult);
    }
    await q(`insert into monitor_state(site_id,consecutive_failures,last_check_at,last_ok_at,last_alert_at,alert_count,incident_id) values(?,0,now(),now(),null,0,null) on duplicate key update consecutive_failures=0,last_check_at=now(),last_ok_at=now(),last_alert_at=null,alert_count=0,incident_id=null`,[site.id]);
  }else{
    failures++;let incidentId=open,alertCount=Number(state?.alert_count||0),lastAlert=state?.last_alert_at?new Date(state.last_alert_at).getTime():0;
    if(!open&&failures>=site.monitor_failure_threshold){
      incidentId=crypto.randomUUID();
      await q(`insert into incidents(id,site_id,status,title,details) values(?,?,'open',?,?)`,[incidentId,site.id,`${site.domain} unhealthy`,JSON.stringify(result)]);
      await incidentEvent(incidentId,site.id,'opened',{failureCount:failures,result});
      const alertResult=await sendAlert(`DOWN: ${site.domain}`,JSON.stringify(result,null,2));
      alertCount=1;lastAlert=Date.now();await incidentEvent(incidentId,site.id,'alert',alertResult);
    }else if(incidentId){
      await incidentEvent(incidentId,site.id,'check_failed',{failureCount:failures,result});
      const repeatMs=Math.max(1,Number(site.alert_repeat_minutes||60))*60000;
      if(!lastAlert||Date.now()-lastAlert>=repeatMs){
        const alertResult=await sendAlert(`STILL DOWN: ${site.domain}`,JSON.stringify({failures,result},null,2));
        alertCount++;lastAlert=Date.now();await incidentEvent(incidentId,site.id,'repeat_alert',{alertCount,delivery:alertResult});
      }
    }
    await q(`insert into monitor_state(site_id,consecutive_failures,last_check_at,last_alert_at,alert_count,incident_id) values(?,?,now(),?,?,?) on duplicate key update consecutive_failures=?,last_check_at=now(),last_alert_at=?,alert_count=?,incident_id=?`,
      [site.id,failures,lastAlert?new Date(lastAlert):null,alertCount,incidentId,failures,lastAlert?new Date(lastAlert):null,alertCount,incidentId]);
  }
  return result;
}
async function listMonitorChecks(siteId,limit=50){const site=await getSite(siteId);return(await q('select id,ok,http_status,response_ms,ssl_days,error,details,created_at from monitor_checks where site_id=? order by created_at desc limit ?',[site.id,limit])).rows;}
async function listIncidents(siteId,limit=50){const site=await getSite(siteId);return(await q('select id,status,title,details,created_at,resolved_at from incidents where site_id=? order by created_at desc limit ?',[site.id,limit])).rows;}
async function getIncident(incidentId){const i=(await q('select i.*,s.slug,s.domain from incidents i join sites s on s.id=i.site_id where i.id=?',[incidentId])).rows[0];if(!i)throw new Error('Incident not found');const events=(await q('select id,event_type,details,created_at from incident_events where incident_id=? order by created_at asc',[incidentId])).rows;return{...i,events};}
let monitorRunning=false;function startMonitor(){setInterval(async()=>{if(monitorRunning)return;monitorRunning=true;try{const sites=(await q(`select s.* from sites s left join monitor_state ms on ms.site_id=s.id where s.enabled=1 and s.monitor_enabled=1 and (ms.last_check_at is null or timestampdiff(second,ms.last_check_at,now())>=s.monitor_interval_seconds)`)).rows;for(const site of sites){try{await processMonitor(site);}catch(e){console.error('monitor',site.domain,e);}}}finally{monitorRunning=false;}},cfg.workerInterval).unref();}
let backupRunning=false;function startBackupWorker(){setInterval(async()=>{if(backupRunning)return;backupRunning=true;try{const sites=(await q(`select s.* from sites s left join (select site_id,max(created_at) last_backup_at from backups group by site_id) b on b.site_id=s.id left join backup_state bs on bs.site_id=s.id where s.enabled=1 and s.backup_enabled=1 and (b.last_backup_at is null or timestampdiff(second,b.last_backup_at,now())>=s.backup_interval_seconds) and (bs.last_attempt_at is null or timestampdiff(second,bs.last_attempt_at,now())>=least(s.backup_interval_seconds,900)) order by coalesce(b.last_backup_at,'1970-01-01 00:00:00')`)).rows;for(const site of sites){const previous=(await q('select * from backup_state where site_id=?',[site.id])).rows[0];await q(`insert into backup_state(site_id,last_attempt_at,updated_at) values(?,now(),now()) on duplicate key update last_attempt_at=now(),updated_at=now()`,[site.id]);try{await fullBackup(site,site.backup_max_files||10000);await q(`update backup_state set last_success_at=now(),last_error=null,updated_at=now() where site_id=?`,[site.id]);}catch(e){const msg=String(e.message||e).slice(0,4000);await q(`update backup_state set last_error=?,updated_at=now() where site_id=?`,[msg,site.id]);if(!previous?.last_error)await sendAlert(`BACKUP FAILED: ${site.domain}`,msg);console.error('backup',site.domain,e);}}}finally{backupRunning=false;}},cfg.backupWorkerInterval).unref();}

const toolText=value=>({content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value,null,2)}]});
function mcpServer(){const s=new McpServer({name:'lorzen-siteops',version:'0.6.2'});s.registerTool('sites_list',{description:'List managed websites',inputSchema:z.object({})},async()=>toolText((await listSites()).map(x=>({id:x.id,slug:x.slug,name:x.name,domain:x.domain,protocol:x.protocol,monitor_enabled:x.monitor_enabled}))));s.registerTool('site_status',{description:'Immediate HTTP/SSL health check',inputSchema:z.object({site:z.string()})},async({site})=>toolText(await checkSiteNow(await getSite(site))));s.registerTool('files_list',{description:'List live remote files/directories',inputSchema:z.object({site:z.string(),path:z.string().default('')})},async({site,path})=>toolText(await listRemote(site,path)));s.registerTool('file_read',{description:'Read a live remote text file',inputSchema:z.object({site:z.string(),path:z.string()})},async({site,path})=>toolText(await readRemoteText(site,path)));s.registerTool('change_preview',{description:'Prepare safe file changes. content=null deletes. No production write yet.',inputSchema:z.object({site:z.string(),description:z.string().min(3),files:z.array(z.object({path:z.string(),content:z.string().nullable()})).min(1)})},async({site,description,files})=>toolText(await createPreview(site,files,description)));s.registerTool('change_apply',{description:'Apply an approved preview with Git snapshots and health check',inputSchema:z.object({preview_id:z.string().uuid()})},async({preview_id})=>toolText(await applyPreview(preview_id)));s.registerTool('history_list',{description:'List recent recorded changes',inputSchema:z.object({site:z.string(),limit:z.number().int().min(1).max(100).default(30)})},async({site,limit})=>toolText(await listHistory(site,limit)));s.registerTool('history_diff',{description:'Get Git diff for a recorded change',inputSchema:z.object({change_id:z.string().uuid()})},async({change_id})=>toolText(await changeDiff(change_id)));s.registerTool('rollback_preview',{description:'Prepare rollback of a change; does not write production',inputSchema:z.object({change_id:z.string().uuid()})},async({change_id})=>toolText(await rollbackPreview(change_id)));s.registerTool('site_backup',{description:'Create a full Git-backed site snapshot',inputSchema:z.object({site:z.string()})},async({site})=>toolText(await fullBackup(await getSite(site))));s.registerTool('backups_list',{description:'List full backups',inputSchema:z.object({site:z.string(),limit:z.number().int().min(1).max(100).default(30)})},async({site,limit})=>toolText(await listBackups(await getSite(site),limit)));s.registerTool('backup_restore_preview',{description:'Create a safe restore preview from a full backup. A fresh safety backup is made first.',inputSchema:z.object({backup_id:z.string().uuid()})},async({backup_id})=>toolText(await backupRestorePreview(backup_id)));return s;}

function dashboardAuth(req,reply){if(!cfg.dashboardUser||!cfg.dashboardPassword){reply.code(503).send('SiteOps dashboard authentication is not configured');return false;}const h=req.headers.authorization||'';if(!h.startsWith('Basic ')){reply.header('WWW-Authenticate','Basic realm="SiteOps"');reply.code(401).send('Authentication required');return false;}const decoded=Buffer.from(h.slice(6),'base64').toString(),i=decoded.indexOf(':'),u=i>=0?decoded.slice(0,i):'',p=i>=0?decoded.slice(i+1):'';if(!safeEqual(u,cfg.dashboardUser)||!safeEqual(p,cfg.dashboardPassword)){reply.header('WWW-Authenticate','Basic realm="SiteOps"');reply.code(401).send('Authentication required');return false;}return true;}
function mcpAuth(req,reply){if(!cfg.mcpToken){reply.code(503).send({error:'MCP_API_TOKEN is not configured'});return false;}const h=req.headers.authorization||'',t=h.startsWith('Bearer ')?h.slice(7):'';if(!safeEqual(t,cfg.mcpToken)){reply.code(401).send({error:'unauthorized'});return false;}return true;}
function page(title,body){return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · SiteOps</title><link rel="stylesheet" href="/assets/app.css?v=0.6.2"></head><body><nav class="topnav"><div class="navinner"><a class="brand" href="/">SiteOps</a><div class="navlinks"><a href="/">Übersicht</a><a href="/setup">Website hinzufügen</a><a href="/settings">Einstellungen</a></div></div></nav><main>${body}</main></body></html>`;}
function settingsPage(){
  const s=publicSettings(),backupMiB=Math.round(s.backupMaxFileBytes/1024/1024),backupHours=Math.round(s.defaultBackupIntervalSeconds/360)/10;
  return page('Einstellungen',`
    <header><div><span class="eyebrow">System</span><h1>Einstellungen</h1><p>Zentrale Konfiguration für Backups, Standardwerte neuer Websites und Benachrichtigungen.</p></div><span class="pill ok">MySQL verbunden</span></header>
    <form id="configForm" class="config-form">
      <section class="form-card"><div class="sectionhead"><div><span class="eyebrow">Backup-Ziel</span><h2>GitHub</h2></div><span class="pill ${s.githubBackupTokenConfigured&&s.githubBackupRepo?'ok':''}">${s.githubBackupTokenConfigured&&s.githubBackupRepo?'KONFIGURIERT':'OFFEN'}</span></div>
        <p class="lead">SiteOps legt Versionsstände aller verwalteten Websites in einem separaten privaten GitHub-Repository ab. Der Token wird verschlüsselt in MySQL gespeichert.</p>
        <div class="formgrid">
          <label>Backup-Repository <small>Format: Besitzer/Repository, z. B. derlorzen/lorzen-site-backups</small><input name="githubBackupRepo" value="${esc(s.githubBackupRepo)}" placeholder="derlorzen/lorzen-site-backups"></label>
          <label>Branch <small>Normalerweise <code>main</code>.</small><input name="backupBranch" value="${esc(s.backupBranch)}"></label>
          <label class="span2">GitHub Fine-grained PAT <small>${s.githubBackupTokenConfigured?'Ein Token ist gespeichert. Leer lassen, um ihn unverändert zu behalten.':'Benötigt Contents: Read and write sowie Metadata: Read für genau das Backup-Repository.'}</small><input name="githubBackupToken" type="password" autocomplete="new-password" placeholder="${s.githubBackupTokenConfigured?'Token bereits gespeichert':'github_pat_…'}"></label>
          <label>Max. Dateigröße <small>Einzeldateien oberhalb dieses Limits werden nicht gesichert.</small><div class="inputsuffix"><input name="backupMaxFileMiB" type="number" min="1" max="90" value="${backupMiB}"><span>MiB</span></div></label>
          <label>SiteOps Basis-URL <small>Für Links und externe Integrationen.</small><input name="publicBaseUrl" type="url" value="${esc(s.publicBaseUrl)}"></label>
        </div>
        <div class="buttonrow"><button type="button" class="ghost" id="testGitHub">GitHub-Verbindung testen</button><span class="inline-status" id="githubStatus"></span></div>
      </section>

      <section class="form-card"><div class="sectionhead"><div><span class="eyebrow">Neue Websites</span><h2>Standardwerte</h2></div></div>
        <p class="lead">Diese Werte werden beim Anlegen einer neuen Website vorgeschlagen. Pro Website kannst du sie danach separat ändern.</p>
        <div class="formgrid">
          <label>Backup-Intervall <small>Empfehlung für normale Websites: 24 Stunden.</small><div class="inputsuffix"><input name="defaultBackupHours" type="number" min="0.25" max="720" step="0.25" value="${backupHours}"><span>Std.</span></div></label>
          <label>Max. Dateien pro Backup <small>Schutz vor versehentlich zu großen Verzeichnissen.</small><input name="defaultBackupMaxFiles" type="number" min="100" max="200000" value="${s.defaultBackupMaxFiles}"></label>
          <label>Monitoring-Intervall <small>Wie oft die Website geprüft wird.</small><div class="inputsuffix"><input name="defaultMonitorIntervalSeconds" type="number" min="30" max="86400" value="${s.defaultMonitorIntervalSeconds}"><span>Sek.</span></div></label>
          <label>Fehler bis Alarm <small>Verhindert Alarm bei einem einzelnen kurzen Aussetzer.</small><input name="defaultMonitorFailureThreshold" type="number" min="1" max="20" value="${s.defaultMonitorFailureThreshold}"></label>
          <label>SSL-Warnung <small>Alarm, wenn das Zertifikat in weniger als X Tagen abläuft.</small><div class="inputsuffix"><input name="defaultSslWarnDays" type="number" min="1" max="365" value="${s.defaultSslWarnDays}"><span>Tage</span></div></label>
        </div>
      </section>

      <section class="form-card"><div class="sectionhead"><div><span class="eyebrow">Alarme</span><h2>Benachrichtigungen</h2></div></div>
        <p class="lead">E-Mail und Webhook können parallel genutzt werden. Das SMTP-Passwort wird wie der GitHub-Token verschlüsselt gespeichert.</p>
        <div class="formgrid">
          <label>Alarm-E-Mail <small>Empfänger für DOWN-, RECOVERED- und Backup-Fehler.</small><input name="alertEmail" type="email" value="${esc(s.alertEmail)}" placeholder="kai@example.de"></label>
          <label>Webhook-URL <small>Optional, z. B. für eigene Automationen.</small><input name="webhook" type="url" value="${esc(s.webhook)}" placeholder="https://…"></label>
          <label>SMTP-Host<input name="smtpHost" value="${esc(s.smtpHost)}" placeholder="smtp.example.de"></label>
          <label>SMTP-Port<input name="smtpPort" type="number" min="1" max="65535" value="${s.smtpPort}"></label>
          <label>SMTP-Benutzer<input name="smtpUser" value="${esc(s.smtpUser)}"></label>
          <label>SMTP-Passwort <small>${s.smtpPasswordConfigured?'Passwort gespeichert – leer lassen für unverändert.':'Noch kein Passwort gespeichert.'}</small><input name="smtpPassword" type="password" autocomplete="new-password" placeholder="${s.smtpPasswordConfigured?'Passwort bereits gespeichert':'Passwort'}"></label>
          <label>Absender<input name="smtpFrom" value="${esc(s.smtpFrom)}" placeholder="SiteOps <siteops@lorzen.cloud>"></label>
          <label class="check standalone"><input name="smtpSecure" type="checkbox" ${s.smtpSecure?'checked':''}> SMTP direkt mit TLS verbinden</label>
        </div>
        <div class="buttonrow"><button type="button" class="ghost" id="testAlert">Testbenachrichtigung senden</button><span class="inline-status" id="alertStatus"></span></div>
      </section>

      <div class="sticky-save"><button type="submit">Einstellungen speichern</button><span id="configStatus"></span></div>
    </form>
    <script>
    const form=document.getElementById('configForm');
    function payload(){
      const fd=new FormData(form);
      return {
        publicBaseUrl:fd.get('publicBaseUrl'),githubBackupRepo:fd.get('githubBackupRepo').trim(),githubBackupToken:fd.get('githubBackupToken'),
        backupBranch:fd.get('backupBranch').trim(),backupMaxFileBytes:Number(fd.get('backupMaxFileMiB'))*1024*1024,
        defaultBackupIntervalSeconds:Math.round(Number(fd.get('defaultBackupHours'))*3600),defaultBackupMaxFiles:Number(fd.get('defaultBackupMaxFiles')),
        defaultMonitorIntervalSeconds:Number(fd.get('defaultMonitorIntervalSeconds')),defaultMonitorFailureThreshold:Number(fd.get('defaultMonitorFailureThreshold')),
        defaultSslWarnDays:Number(fd.get('defaultSslWarnDays')),alertEmail:fd.get('alertEmail').trim(),webhook:fd.get('webhook').trim(),
        smtpHost:fd.get('smtpHost').trim(),smtpPort:Number(fd.get('smtpPort')),smtpSecure:form.smtpSecure.checked,smtpUser:fd.get('smtpUser').trim(),
        smtpPassword:fd.get('smtpPassword'),smtpFrom:fd.get('smtpFrom').trim()
      };
    }
    form.onsubmit=async e=>{e.preventDefault();configStatus.textContent='Speichere…';const r=await fetch('/api/settings',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(payload())});const x=await r.json();configStatus.textContent=r.ok?'Gespeichert.':'Fehler: '+(x.message||x.error||JSON.stringify(x));if(r.ok)setTimeout(()=>location.reload(),500);};
    testGitHub.onclick=async()=>{githubStatus.textContent='Prüfe…';const p=payload();const r=await fetch('/api/settings/github-test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({githubBackupRepo:p.githubBackupRepo,githubBackupToken:p.githubBackupToken,backupBranch:p.backupBranch})}),x=await r.json();githubStatus.textContent=r.ok?'✓ '+x.repository+' erreichbar und privat':'✗ '+(x.message||x.error||JSON.stringify(x));};
    testAlert.onclick=async()=>{alertStatus.textContent='Sende…';const r=await fetch('/api/settings/alert-test',{method:'POST'}),x=await r.json();alertStatus.textContent=r.ok?'✓ Test ausgelöst':'✗ '+(x.message||x.error||JSON.stringify(x));};
    </script>`);
}
function setupPage(){
  return page('Website hinzufügen',`
    <header><div><span class="eyebrow">Neue Website</span><h1>Website hinzufügen</h1><p>Lege zuerst fest, was für eine Website es ist und wie sie deployed wird. SiteOps behandelt einen Hostinger-Git-Deploy anders als einen klassischen FTP-/SFTP-Webspace.</p></div></header>
    <form id="siteForm" class="config-form">
      <section class="form-card">
        <div class="sectionhead"><div><span class="eyebrow">1 · Zuordnung</span><h2>Website & Deployment</h2></div></div>
        <div class="formgrid">
          <label>Anzeigename <small>Nur für SiteOps, z. B. „Dagos Shop“ oder „HSG Angeln“.</small><input name="name" required placeholder="Dagos Shop"></label>
          <label>Domain <small>Ohne https:// und ohne Pfad.</small><input name="domain" required placeholder="dagos.shop"></label>
          <label>Slug <small>Interne kurze Kennung. Wird aus der Domain vorgeschlagen.</small><input name="slug" required pattern="[a-z0-9-]+" placeholder="dagos-shop"></label>
          <label>Website-Typ <small>Bestimmt spätere Prüfungen und typische Ausschlüsse.</small><select name="siteType"><option value="wordpress">WordPress</option><option value="php" selected>PHP / HTML</option><option value="static">Statische Website</option><option value="node">Node.js Web App</option></select></label>
          <label class="span2">Deployment-Methode <small>Bei Hostinger Git ist das GitHub-Repository die Source of Truth. SiteOps schreibt dann nicht direkt auf den Live-Webspace.</small><select name="deploymentMode"><option value="webspace" selected>Direkter Webspace – SFTP / FTPS / FTP</option><option value="hostinger_git">Hostinger Git Deploy – GitHub</option></select></label>
        </div>
      </section>

      <section class="form-card" id="webspaceSection">
        <div class="sectionhead"><div><span class="eyebrow">2 · Webspace</span><h2>Direkter Dateizugriff</h2></div></div>
        <div class="notice"><strong>SFTP ist die erste Wahl.</strong><span>Nutze FTPS oder unverschlüsseltes FTP nur, wenn der Hoster kein SFTP anbietet. Zugangsdaten werden verschlüsselt gespeichert.</span></div>
        <div class="formgrid">
          <label>Verbindungsart <small>SFTP verschlüsselt die komplette Verbindung.</small><select name="protocol"><option value="sftp" selected>SFTP – empfohlen</option><option value="ftps">FTPS</option><option value="ftp">FTP – unverschlüsselt</option></select></label>
          <label>Port <small>SFTP meist 22, FTP/FTPS meist 21.</small><input name="port" type="number" value="22"></label>
          <label class="span2">Host / Server <small>Der Servername des Hosters, nicht zwingend die Website-Domain.</small><input name="host" placeholder="ssh.example-host.de"></label>
          <label>Benutzername <small>FTP-/SFTP-Benutzer des Webspaces.</small><input name="username" autocomplete="username"></label>
          <label>Passwort <small>Wird mit dem SiteOps-Master-Key verschlüsselt gespeichert.</small><input name="password" type="password" autocomplete="new-password"></label>
          <label class="span2">Webroot / Remote Root <small>Der Ordner, in dem die Website tatsächlich liegt. Wenn der Login direkt dort startet, ist <code>/</code> richtig.</small><input name="remoteRoot" value="/" placeholder="/"></label>
        </div>
      </section>

      <section class="form-card" id="gitSection" hidden>
        <div class="sectionhead"><div><span class="eyebrow">2 · Hostinger Git</span><h2>GitHub als Source of Truth</h2></div><span class="pill">AUTO-DEPLOY</span></div>
        <div class="notice"><strong>Kein SFTP-Schreiben bei Git-Deploy.</strong><span>SiteOps committed Änderungen gesammelt in genau einem Commit auf den Deployment-Branch. Hostinger übernimmt danach den automatischen Build/Deploy. In hPanel muss das Repository bereits mit der Website verbunden und Auto-Deployment aktiviert sein.</span></div>
        <div class="formgrid">
          <label class="span2">GitHub-Repository <small>Format Besitzer/Repository, z. B. <code>derlorzen/lorzen.de</code>.</small><input name="sourceRepository" placeholder="derlorzen/projekt"></label>
          <label>Deployment-Branch <small>Der Branch, den Hostinger deployed. Normalerweise <code>main</code>.</small><input name="sourceBranch" value="main"></label>
          <label>Repository-Unterordner <small>Optional. Leer lassen, wenn die Website im Repository-Root liegt.</small><input name="sourceRoot" placeholder="z. B. website"></label>
          <label class="span2">GitHub Fine-grained PAT für dieses Quell-Repo <small>Benötigt <strong>Contents: Read and write</strong>. Dieser Token ist getrennt vom Backup-Token und wird verschlüsselt gespeichert.</small><input name="gitToken" type="password" autocomplete="new-password" placeholder="github_pat_…"></label>
          <label>Hostinger Zielverzeichnis <small>Bei klassischem PHP/HTML-Git-Deploy meist <code>public_html</code>. Dient SiteOps zur Dokumentation.</small><input name="hostingerTargetDirectory" value="public_html"></label>
          <label>Live-Domain <small>SiteOps überwacht weiterhin die echte Website nach dem Deploy.</small><input value="wird aus der Domain oben übernommen" disabled></label>
        </div>
        <div class="callout"><strong>Ablauf:</strong> SiteOps prüft und ändert GitHub → ein Commit landet auf dem Deployment-Branch → Hostinger erkennt den Push und deployed → Monitoring prüft die Live-Domain.</div>
      </section>

      <section class="form-card">
        <div class="sectionhead"><div><span class="eyebrow">3 · Verbindung</span><h2>Zugriff prüfen</h2></div></div>
        <p class="lead" id="connectionHelp">Teste den Webspace, bevor du die Website speicherst.</p>
        <div class="buttonrow"><button type="button" class="ghost" id="testConnection">Webspace-Verbindung testen</button><span class="inline-status" id="connectionStatus"></span></div>
        <div id="connectionFiles" class="file-preview"></div>
      </section>

      <section class="form-card">
        <div class="sectionhead"><div><span class="eyebrow">4 · Betrieb</span><h2>Backup & Monitoring</h2></div></div>
        <p class="lead">Auch Git-deployte Websites erhalten SiteOps-Snapshots im separaten Backup-Repository. Monitoring prüft immer die öffentliche Live-Domain.</p>
        <div class="formgrid">
          <label class="check standalone"><input name="backupEnabled" type="checkbox" checked> Automatische Backups aktivieren</label>
          <label>Backup-Intervall <div class="inputsuffix"><input name="backupHours" type="number" min="0.25" max="720" step="0.25" value="${Math.round(cfg.defaultBackupIntervalSeconds/360)/10}"><span>Std.</span></div></label>
          <label>Max. Dateien pro Backup<input name="backupMaxFiles" type="number" min="100" max="200000" value="${cfg.defaultBackupMaxFiles}"></label>
          <label class="check standalone"><input name="monitorEnabled" type="checkbox" checked> Erreichbarkeit überwachen</label>
          <label>Prüfintervall <div class="inputsuffix"><input name="monitorIntervalSeconds" type="number" min="30" max="86400" value="${cfg.defaultMonitorIntervalSeconds}"><span>Sek.</span></div></label>
          <label>Fehler bis Alarm<input name="monitorFailureThreshold" type="number" min="1" max="20" value="${cfg.defaultMonitorFailureThreshold}"></label>
          <label>SSL-Warnung <div class="inputsuffix"><input name="sslWarnDays" type="number" min="1" max="365" value="${cfg.defaultSslWarnDays}"><span>Tage</span></div></label>
        </div>
      </section>

      <div class="sticky-save"><button type="submit">Website anlegen</button><span id="saveSiteStatus"></span></div>
    </form>
    <script>
    const form=document.getElementById('siteForm');
    const field=name=>form.elements.namedItem(name);
    const protocol=field('protocol');
    const port=field('port');
    const domain=field('domain');
    const slug=field('slug');
    const deployment=field('deploymentMode');
    const webspaceSection=document.getElementById('webspaceSection');
    const gitSection=document.getElementById('gitSection');
    const connectionHelp=document.getElementById('connectionHelp');
    const testConnectionButton=document.getElementById('testConnection');
    const connectionStatusEl=document.getElementById('connectionStatus');
    const connectionFilesEl=document.getElementById('connectionFiles');
    const saveSiteStatusEl=document.getElementById('saveSiteStatus');

    let slugTouched=false;
    slug.addEventListener('input',()=>slugTouched=true);

    function stripProtocol(value){
      let v=String(value||'').trim();
      if(v.toLowerCase().startsWith('https://'))v=v.slice(8);
      else if(v.toLowerCase().startsWith('http://'))v=v.slice(7);
      if(v.toLowerCase().startsWith('www.'))v=v.slice(4);
      while(v.endsWith('/'))v=v.slice(0,-1);
      return v;
    }
    function trimSlashes(value){
      let v=String(value||'').trim();
      while(v.startsWith('/'))v=v.slice(1);
      while(v.endsWith('/'))v=v.slice(0,-1);
      return v;
    }
    function slugify(value){
      return stripProtocol(value).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    }

    domain.addEventListener('input',()=>{if(!slugTouched)slug.value=slugify(domain.value);});
    protocol.addEventListener('change',()=>{port.value=protocol.value==='sftp'?22:21;});

    function syncDeployment(){
      const git=deployment.value==='hostinger_git';
      webspaceSection.hidden=git;
      gitSection.hidden=!git;
      webspaceSection.style.display=git?'none':'';
      gitSection.style.display=git?'':'none';
      webspaceSection.dataset.visible=git?'false':'true';
      gitSection.dataset.visible=git?'true':'false';
      testConnectionButton.textContent=git?'GitHub-Quelle testen':'Webspace-Verbindung testen';
      connectionHelp.textContent=git
        ?'Prüft Repository, Branch und Schreibzugriff auf das GitHub-Quell-Repository.'
        :'Teste den Webspace, bevor du die Website speicherst.';
      connectionStatusEl.textContent='';
      connectionFilesEl.innerHTML='';
    }

    deployment.addEventListener('change',syncDeployment);
    syncDeployment();

    function data(){
      const fd=new FormData(form);
      return {
        name:String(fd.get('name')||'').trim(),
        domain:stripProtocol(fd.get('domain')),
        slug:String(fd.get('slug')||'').trim(),
        siteType:fd.get('siteType'),
        deploymentMode:fd.get('deploymentMode'),
        protocol:fd.get('protocol'),
        host:String(fd.get('host')||'').trim(),
        port:Number(fd.get('port')),
        username:String(fd.get('username')||'').trim(),
        password:String(fd.get('password')||''),
        remoteRoot:String(fd.get('remoteRoot')||'/').trim()||'/',
        sourceRepository:trimSlashes(fd.get('sourceRepository')),
        sourceBranch:String(fd.get('sourceBranch')||'main').trim()||'main',
        sourceRoot:trimSlashes(fd.get('sourceRoot')),
        gitToken:String(fd.get('gitToken')||''),
        hostingerTargetDirectory:String(fd.get('hostingerTargetDirectory')||'public_html').trim()||'public_html',
        backupEnabled:field('backupEnabled').checked,
        backupIntervalSeconds:Math.round(Number(fd.get('backupHours'))*3600),
        backupMaxFiles:Number(fd.get('backupMaxFiles')),
        monitorEnabled:field('monitorEnabled').checked,
        monitorIntervalSeconds:Number(fd.get('monitorIntervalSeconds')),
        monitorFailureThreshold:Number(fd.get('monitorFailureThreshold')),
        sslWarnDays:Number(fd.get('sslWarnDays'))
      };
    }

    testConnectionButton.addEventListener('click',async()=>{
      connectionStatusEl.textContent='Prüfe…';
      connectionFilesEl.innerHTML='';
      try{
        const r=await fetch('/api/site-connection-test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data())});
        const x=await r.json();
        if(!r.ok){
          connectionStatusEl.textContent='✗ '+(x.message||x.error||JSON.stringify(x));
          return;
        }
        connectionStatusEl.textContent='✓ '+(x.mode==='hostinger_git'?'GitHub-Quelle erreichbar':'Verbindung erfolgreich');
        const prefix=x.repository?'<strong>'+x.repository+' · '+x.branch+'</strong><br>':'';
        connectionFilesEl.innerHTML=prefix+(x.entries.length
          ?'Gefundene Einträge: '+x.entries.map(e=>(e.type==='directory'?'Ordner: ':'Datei: ')+e.name).join(' · ')
          :'Verbindung erfolgreich, Ordner ist leer.');
      }catch(error){
        connectionStatusEl.textContent='✗ '+String(error?.message||error);
      }
    });

    form.addEventListener('submit',async e=>{
      e.preventDefault();
      saveSiteStatusEl.textContent='Lege Website an…';
      try{
        const r=await fetch('/api/sites',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data())});
        const x=await r.json();
        if(!r.ok){
          saveSiteStatusEl.textContent='Fehler: '+(x.message||x.error||JSON.stringify(x));
          return;
        }
        location.href='/sites/'+encodeURIComponent(x.slug);
      }catch(error){
        saveSiteStatusEl.textContent='Fehler: '+String(error?.message||error);
      }
    });
    </script>`);
}
async function dashboard(){const sites=await listSites(),checks=(await q('select mc.site_id,mc.ok,mc.http_status,mc.response_ms,mc.ssl_days,mc.created_at from monitor_checks mc join (select site_id,max(created_at) created_at from monitor_checks group by site_id) latest on latest.site_id=mc.site_id and latest.created_at=mc.created_at')).rows,checkMap=new Map(checks.map(x=>[x.site_id,x])),backups=(await q('select b.site_id,b.git_commit,b.file_count,b.created_at from backups b join (select site_id,max(created_at) created_at from backups group by site_id) latest on latest.site_id=b.site_id and latest.created_at=b.created_at')).rows,backupMap=new Map(backups.map(x=>[x.site_id,x])),incidents=(await q("select i.*,s.domain from incidents i join sites s on s.id=i.site_id where i.status='open' order by i.created_at desc")).rows,changes=(await q('select c.*,s.domain from changes c join sites s on s.id=c.site_id order by c.created_at desc limit 20')).rows;const cards=sites.map(s=>{const c=checkMap.get(s.id),b=backupMap.get(s.id),deploy=s.deployment_mode==='hostinger_git'?'HOSTINGER GIT':s.protocol.toUpperCase();return `<a class="card" href="/sites/${esc(s.slug)}"><div class="row"><strong>${esc(s.name)}</strong><span class="pill ${c?.ok?'ok':'bad'}">${c?c.ok?'ONLINE':'ALARM':'NO DATA'}</span></div><small>${esc(s.domain)} · ${esc(deploy)}</small><div class="metrics"><span>${c?.response_ms??'–'} ms<em>Response</em></span><span>${c?.ssl_days??'–'} d<em>SSL</em></span><span>${s.monitor_enabled?'ON':'OFF'}<em>Monitor</em></span><span>${b?.created_at?new Date(b.created_at).toLocaleDateString('de-DE'):'–'}<em>Backup</em></span></div></a>`}).join('');const inc=incidents.length?incidents.map(i=>`<li><b>${esc(i.domain)}</b> ${esc(i.title)}<small>${new Date(i.created_at).toLocaleString('de-DE')}</small></li>`).join(''):'<li>Keine offenen Incidents.</li>',hist=changes.map(c=>`<li><b>${esc(c.domain)}</b> ${esc(c.description)} <span class="pill">${esc(c.status)}</span><small>${new Date(c.created_at).toLocaleString('de-DE')} · ${esc(c.actor)}</small></li>`).join('')||'<li>Noch keine Änderungen.</li>';return page('SiteOps',`<header><div><span class="eyebrow">Lorzen</span><h1>SiteOps</h1><p>Websites, Backups, Monitoring und Rollbacks.</p></div><div class="actions"><a class="ghost btn" href="/settings">Einstellungen</a><a class="btn" href="/setup">+ Website</a></div></header><section><h2>Websites</h2><div class="grid">${cards}</div></section><div class="twocol"><section><h2>Offene Incidents</h2><ul>${inc}</ul></section><section><h2>Letzte Änderungen</h2><ul>${hist}</ul></section></div>`);}

async function start(){let databaseReady=false,databaseError=null;try{await migrate();await loadSavedConfig();databaseReady=true;}catch(e){databaseError=String(e?.message||e);console.error('database startup',e);}const app=Fastify({logger:true,bodyLimit:8*1024*1024});const missingConfig=()=>[['SITEOPS_MASTER_KEY',cfg.masterKey],['MCP_API_TOKEN',cfg.mcpToken],['DASHBOARD_USER',cfg.dashboardUser],['DASHBOARD_PASSWORD',cfg.dashboardPassword],['DB_USER',cfg.databaseUrl||cfg.dbUser],['DB_NAME',cfg.databaseUrl||cfg.dbName]].filter(([,v])=>!v).map(([k])=>k);app.get('/health',async(_req,reply)=>{const missing=missingConfig(),ok=databaseReady&&missing.length===0;return reply.code(ok?200:503).send({status:ok?'ok':'degraded',version:'0.6.2',port:cfg.port,database:{engine:'mysql',ready:databaseReady,error:databaseError},backup:{configured:Boolean(cfg.githubBackupRepo&&cfg.githubBackupToken),repository:cfg.githubBackupRepo||null},baseUrl:cfg.publicBaseUrl,missingConfig:missing,worker:databaseReady?'ok':'paused',time:new Date().toISOString()});});app.get('/assets/app.css',async(_r,reply)=>reply.header('Cache-Control','no-store, max-age=0').type('text/css').send(await readFile(new URL('./public/app.css',import.meta.url),'utf8')));app.addHook('onRequest',async(req,reply)=>{if(req.url==='/health'||req.url.startsWith('/assets/'))return;if(req.url.startsWith('/mcp')){if(!mcpAuth(req,reply))return reply;}else if(!dashboardAuth(req,reply))return reply;});const handler=createMcpHandler(()=>mcpServer()),nodeHandler=toNodeHandler(handler);app.all('/mcp',async(req,reply)=>nodeHandler(req.raw,reply.raw,req.body));app.get('/',async(_r,reply)=>reply.type('text/html').send(await dashboard()));app.get('/api/sites',async()=>listSites());
const siteCommonSchema=z.object({slug:z.string().regex(/^[a-z0-9-]+$/),name:z.string().min(1),domain:z.string().min(1),siteType:z.enum(['wordpress','php','static','node']).default('php'),monitorUrl:z.string().url().optional(),backupEnabled:z.boolean().optional(),backupIntervalSeconds:z.coerce.number().int().min(900).max(2592000).optional(),backupMaxFiles:z.coerce.number().int().min(100).max(200000).optional(),monitorEnabled:z.boolean().optional(),monitorIntervalSeconds:z.coerce.number().int().min(30).max(86400).optional(),monitorFailureThreshold:z.coerce.number().int().min(1).max(20).optional(),sslWarnDays:z.coerce.number().int().min(1).max(365).optional()});
const webspaceSiteSchema=siteCommonSchema.extend({deploymentMode:z.literal('webspace'),protocol:z.enum(['sftp','ftps','ftp']),host:z.string().min(1),port:z.coerce.number().int().min(1).max(65535),username:z.string().min(1),password:z.string().optional(),privateKey:z.string().optional(),passphrase:z.string().optional(),remoteRoot:z.string().min(1),sourceRepository:z.string().optional(),sourceBranch:z.string().optional(),sourceRoot:z.string().optional(),gitToken:z.string().optional(),hostingerTargetDirectory:z.string().optional()});
const hostingerGitSiteSchema=siteCommonSchema.extend({deploymentMode:z.literal('hostinger_git'),sourceRepository:z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),sourceBranch:z.string().min(1),sourceRoot:z.string().optional(),gitToken:z.string().min(1),hostingerTargetDirectory:z.string().optional(),protocol:z.enum(['sftp','ftps','ftp']).optional(),host:z.string().optional(),port:z.coerce.number().optional(),username:z.string().optional(),password:z.string().optional(),remoteRoot:z.string().optional()});
const siteCreateSchema=z.discriminatedUnion('deploymentMode',[webspaceSiteSchema,hostingerGitSiteSchema]);
app.post('/api/sites',async(req,reply)=>{const site=await createSite(siteCreateSchema.parse(req.body));return reply.code(201).send({id:site.id,slug:site.slug});});
app.post('/api/site-connection-test',async req=>testSiteConnection(siteCreateSchema.parse(req.body)));
app.get('/api/settings',async()=>publicSettings());
app.patch('/api/settings',async req=>{const schema=z.object({publicBaseUrl:z.string().url(),githubBackupRepo:z.string().max(255),githubBackupToken:z.string().max(500).optional(),backupBranch:z.string().min(1).max(191),backupMaxFileBytes:z.coerce.number().int().min(1048576).max(94371840),defaultBackupIntervalSeconds:z.coerce.number().int().min(900).max(2592000),defaultBackupMaxFiles:z.coerce.number().int().min(100).max(200000),defaultMonitorIntervalSeconds:z.coerce.number().int().min(30).max(86400),defaultMonitorFailureThreshold:z.coerce.number().int().min(1).max(20),defaultSslWarnDays:z.coerce.number().int().min(1).max(365),alertEmail:z.string().max(320),webhook:z.string().max(2000),smtpHost:z.string().max(255),smtpPort:z.coerce.number().int().min(1).max(65535),smtpSecure:z.boolean(),smtpUser:z.string().max(255),smtpPassword:z.string().max(1000).optional(),smtpFrom:z.string().max(500)});return{ok:true,settings:await saveAppSettings(schema.parse(req.body))};});
app.post('/api/settings/github-test',async req=>{const schema=z.object({githubBackupRepo:z.string().max(255).optional(),githubBackupToken:z.string().max(500).optional(),backupBranch:z.string().max(191).optional()}),x=schema.parse(req.body||{}),previous={repo:cfg.githubBackupRepo,token:cfg.githubBackupToken,branch:cfg.backupBranch};try{if(x.githubBackupRepo!==undefined)cfg.githubBackupRepo=x.githubBackupRepo.trim().replace(/^\/+|\/+$/g,'');if(x.githubBackupToken)cfg.githubBackupToken=x.githubBackupToken;if(x.backupBranch)cfg.backupBranch=x.backupBranch.trim();backupRepoChecked=false;await ensureBackupRepository();const r=await gh('');return{ok:true,repository:r.full_name,private:r.private,defaultBranch:r.default_branch,branch:cfg.backupBranch};}finally{cfg.githubBackupRepo=previous.repo;cfg.githubBackupToken=previous.token;cfg.backupBranch=previous.branch;backupRepoChecked=false;}});
app.post('/api/settings/alert-test',async()=>{if(!(cfg.webhook||(cfg.alertEmail&&cfg.smtpHost)))throw new Error('Configure an alert email with SMTP or a webhook first');await sendAlert('TEST','SiteOps test notification from '+cfg.publicBaseUrl);return{ok:true};});app.post('/api/sites/:site/backup',async req=>{const site=await getSite(req.params.site);return fullBackup(site,site.backup_max_files||10000);});app.post('/api/sites/:site/check',async req=>processMonitor(await getSite(req.params.site)));app.patch('/api/sites/:site',async req=>{const schema=z.object({name:z.string().min(1).optional(),domain:z.string().min(1).optional(),enabled:z.boolean().optional(),backup_enabled:z.boolean().optional(),backup_interval_seconds:z.coerce.number().int().min(900).max(2592000).optional(),backup_max_files:z.coerce.number().int().min(100).max(200000).optional(),monitor_enabled:z.boolean().optional(),monitor_url:z.string().url().optional(),monitor_interval_seconds:z.coerce.number().int().min(30).max(86400).optional(),monitor_expected_status:z.coerce.number().int().min(100).max(599).optional(),monitor_content:z.string().nullable().optional(),monitor_timeout_ms:z.coerce.number().int().min(1000).max(60000).optional(),monitor_failure_threshold:z.coerce.number().int().min(1).max(20).optional(),response_warn_ms:z.coerce.number().int().min(1).max(60000).nullable().optional(),ssl_warn_days:z.coerce.number().int().min(1).max(365).optional(),exclude_patterns:z.array(z.string()).optional()});const site=await updateSite(req.params.site,schema.parse(req.body));return{ok:true,site:{id:site.id,slug:site.slug,name:site.name,domain:site.domain}};});app.post('/api/backups/:id/restore-preview',async req=>backupRestorePreview(req.params.id,'dashboard'));app.post('/api/changes/:id/rollback-preview',async req=>rollbackPreview(req.params.id,'dashboard'));app.post('/api/previews/:id/apply',async req=>applyPreview(req.params.id));app.get('/settings',async(_r,reply)=>reply.type('text/html').send(settingsPage()));app.get('/setup',async(_r,reply)=>reply.type('text/html').send(setupPage()));app.get('/sites/:slug',async(req,reply)=>{const site=await getSite(req.params.slug),hist=await listHistory(site.id,30),backups=await listBackups(site,30),checks=(await q('select * from monitor_checks where site_id=? order by created_at desc limit 50',[site.id])).rows,backupState=(await q('select * from backup_state where site_id=?',[site.id])).rows[0],uptime=checks.length?Math.round(checks.filter(x=>x.ok).length/checks.length*10000)/100:'–',rows=hist.map(c=>`<tr><td>${new Date(c.created_at).toLocaleString('de-DE')}</td><td>${esc(c.description)}</td><td>${esc(c.actor)}</td><td><span class="pill">${esc(c.status)}</span></td><td><button class="ghost" onclick="rollback('${c.id}')">Rollback</button></td></tr>`).join('')||'<tr><td colspan="5">Noch keine Änderungen.</td></tr>',backupRows=backups.map(b=>`<tr><td>${new Date(b.created_at).toLocaleString('de-DE')}</td><td><code>${esc(String(b.git_commit).slice(0,8))}</code></td><td>${b.file_count??'–'}</td><td>${b.changed?'geändert':'identisch'}</td><td><button class="ghost" onclick="restoreBackup('${b.id}')">Restore</button></td></tr>`).join('')||'<tr><td colspan="5">Noch keine Backups.</td></tr>';return reply.type('text/html').send(page(site.name,`<a href="/">← Übersicht</a><header><div><span class="eyebrow">${site.deployment_mode==='hostinger_git'?'HOSTINGER GIT':esc(site.protocol.toUpperCase())} · ${site.enabled?'aktiv':'pausiert'}</span><h1>${esc(site.name)}</h1><p>${esc(site.domain)} · ${site.deployment_mode==='hostinger_git'?esc(site.source_repository+' @ '+site.source_branch):esc(site.remote_root)}</p></div><div class="actions"><button class="ghost" onclick="checkNow('${site.slug}')">Jetzt prüfen</button><button onclick="backup('${site.slug}')">Backup jetzt</button></div></header><div class="metrics big"><span>${uptime}%<em>Uptime letzte Checks</em></span><span>${checks[0]?.response_ms??'–'} ms<em>Response</em></span><span>${checks[0]?.ssl_days??'–'} d<em>SSL</em></span><span>${backups[0]?.created_at?new Date(backups[0].created_at).toLocaleString('de-DE'):'–'}<em>Letztes Backup</em></span></div>${backupState?.last_error?`<div class="notice bad"><strong>Backupfehler</strong><span>${esc(backupState.last_error)}</span></div>`:''}<div class="twocol detail"><section><h2>Betrieb</h2><form id="settings"><label class="check"><input type="checkbox" name="enabled" ${site.enabled?'checked':''}> Website aktiv verwalten</label><label class="check"><input type="checkbox" name="monitor_enabled" ${site.monitor_enabled?'checked':''}> Monitoring aktiv</label><label>Monitor-URL<input name="monitor_url" value="${esc(site.monitor_url||'')}"></label><label>Prüfintervall (Sek.)<input type="number" min="30" name="monitor_interval_seconds" value="${site.monitor_interval_seconds}"></label><label>Fehler bis Alarm<input type="number" min="1" name="monitor_failure_threshold" value="${site.monitor_failure_threshold}"></label><label>SSL-Warnung (Tage)<input type="number" min="1" name="ssl_warn_days" value="${site.ssl_warn_days}"></label><label class="check"><input type="checkbox" name="backup_enabled" ${site.backup_enabled?'checked':''}> Automatische Backups</label><label>Backup-Intervall (Sek.)<input type="number" min="900" name="backup_interval_seconds" value="${site.backup_interval_seconds}"></label><label>Max. Dateien pro Backup<input type="number" min="100" name="backup_max_files" value="${site.backup_max_files}"></label><button>Speichern</button><span id="saveState"></span></form></section><section><h2>Backup-Zustand</h2><dl class="facts"><div><dt>Nächstes Intervall</dt><dd>${Math.round(site.backup_interval_seconds/3600*10)/10} h</dd></div><div><dt>Letzter Versuch</dt><dd>${backupState?.last_attempt_at?new Date(backupState.last_attempt_at).toLocaleString('de-DE'):'–'}</dd></div><div><dt>Letzter Erfolg</dt><dd>${backupState?.last_success_at?new Date(backupState.last_success_at).toLocaleString('de-DE'):'–'}</dd></div><div><dt>Backup-Repo</dt><dd>sites/${esc(site.slug)}/public</dd></div></dl></section></div><section><div class="sectionhead"><div><span class="eyebrow">Versionen</span><h2>Backups</h2></div><small>Restore erstellt zuerst automatisch einen Safety-Snapshot.</small></div><div class="tablewrap"><table><thead><tr><th>Zeit</th><th>Commit</th><th>Dateien</th><th>Stand</th><th></th></tr></thead><tbody>${backupRows}</tbody></table></div></section><section><div class="sectionhead"><div><span class="eyebrow">Audit</span><h2>Änderungen</h2></div></div><div class="tablewrap"><table><thead><tr><th>Zeit</th><th>Änderung</th><th>Quelle</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section><script>
const settings=document.getElementById('settings');
settings.onsubmit=async e=>{e.preventDefault();const fd=new FormData(settings),data={enabled:settings.enabled.checked,monitor_enabled:settings.monitor_enabled.checked,backup_enabled:settings.backup_enabled.checked,monitor_url:fd.get('monitor_url'),monitor_interval_seconds:Number(fd.get('monitor_interval_seconds')),monitor_failure_threshold:Number(fd.get('monitor_failure_threshold')),ssl_warn_days:Number(fd.get('ssl_warn_days')),backup_interval_seconds:Number(fd.get('backup_interval_seconds')),backup_max_files:Number(fd.get('backup_max_files'))};const r=await fetch('/api/sites/${site.slug}',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(data)});saveState.textContent=r.ok?'Gespeichert':'Fehler beim Speichern';};
async function backup(s){const r=await fetch('/api/sites/'+s+'/backup',{method:'POST'}),x=await r.json();alert(r.ok?'Backup erstellt: '+String(x.commit||'').slice(0,8):JSON.stringify(x));if(r.ok)location.reload();}
async function checkNow(s){const r=await fetch('/api/sites/'+s+'/check',{method:'POST'}),x=await r.json();alert(x.ok?'Website ist erreichbar':'Prüfung fehlgeschlagen');location.reload();}
async function rollback(id){const r=await fetch('/api/changes/'+id+'/rollback-preview',{method:'POST'}),p=await r.json();if(!r.ok)return alert(JSON.stringify(p));if(confirm('Rollback-Preview '+p.previewId+' anwenden?')){const a=await fetch('/api/previews/'+p.previewId+'/apply',{method:'POST'});alert(JSON.stringify(await a.json()));location.reload();}}
async function restoreBackup(id){if(!confirm('Diesen Backup-Stand vorbereiten? Vorher wird automatisch ein aktueller Safety-Snapshot erstellt.'))return;const r=await fetch('/api/backups/'+id+'/restore-preview',{method:'POST'}),p=await r.json();if(!r.ok)return alert(JSON.stringify(p));if(p.noChanges)return alert(p.message);if(confirm('Restore-Preview '+p.previewId+' jetzt anwenden?')){const a=await fetch('/api/previews/'+p.previewId+'/apply',{method:'POST'});alert(JSON.stringify(await a.json()));location.reload();}}
</script>`));});if(databaseReady){startMonitor();startBackupWorker();}await app.listen({host:cfg.host,port:cfg.port});app.log.info({port:cfg.port,host:cfg.host,databaseReady},'SiteOps listening');}

if(process.argv.includes('--check-runtime')){phpParser.parseCode('<?php echo 1;','smoke.php');await db.end();console.log('Runtime imports OK.');}else if(process.argv.includes('--migrate')){await migrate();await db.end();console.log('Database schema applied.');}else{start().catch(e=>{console.error(e);process.exit(1);});}
