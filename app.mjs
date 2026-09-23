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
import * as cheerio from 'cheerio';

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
  backupWorkerInterval: Number(env('BACKUP_WORKER_INTERVAL_MS','60000')),
  pageSpeedApiKey: process.env.PAGESPEED_API_KEY || '', seoMaxPages: Number(env('SEO_MAX_PAGES','100')),
  seoUserAgent: env('SEO_USER_AGENT','Lorzen-SiteOps-SEO/1.0'),
  browserRunnerUrl: process.env.BROWSER_RUNNER_URL || '', browserRunnerToken: process.env.BROWSER_RUNNER_TOKEN || '',
  syntheticWorkerInterval: Number(env('SYNTHETIC_WORKER_INTERVAL_MS','60000'))
};
const db=mysql.createPool(cfg.databaseUrl||{host:cfg.dbHost,port:cfg.dbPort,user:cfg.dbUser,password:cfg.dbPassword,database:cfg.dbName,connectionLimit:5,charset:'utf8mb4'});
const jsonFields=new Set(['exclude_patterns','changes','validation','files','health_result','details','summary','issues','wdfidf','structured_data','lighthouse_mobile','lighthouse_desktop','hreflang','social','security','accessibility','content_fingerprint','steps','result']);
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
async function migrate(){const sql=await readFile(new URL('./schema.sql',import.meta.url),'utf8');for(const statement of sql.split(/;\s*(?:\n|$)/).map(x=>x.trim()).filter(Boolean))await db.query(statement);await ensureColumn('sites','deployment_mode',"VARCHAR(30) NOT NULL DEFAULT 'webspace'");await ensureColumn('sites','source_repository','VARCHAR(255) NULL');await ensureColumn('sites','source_branch','VARCHAR(191) NULL');await ensureColumn('sites','source_root','TEXT NULL');await ensureColumn('sites','git_credentials','LONGTEXT NULL');await ensureColumn('sites','hostinger_target_directory','TEXT NULL');await ensureColumn('sites','monitor_expected_title','TEXT NULL');await ensureColumn('sites','monitor_check_dns','BOOLEAN NOT NULL DEFAULT TRUE');await ensureColumn('sites','monitor_check_wordpress','BOOLEAN NOT NULL DEFAULT FALSE');await ensureColumn('sites','alert_repeat_minutes','INT NOT NULL DEFAULT 60');await ensureColumn('monitor_state','last_alert_at','DATETIME NULL');await ensureColumn('monitor_state','alert_count','INT NOT NULL DEFAULT 0');await ensureColumn('seo_pages','final_url','TEXT NULL');await ensureColumn('seo_pages','redirect_count','INT NOT NULL DEFAULT 0');await ensureColumn('seo_pages','lang','VARCHAR(50) NULL');await ensureColumn('seo_pages','hreflang','LONGTEXT NULL');await ensureColumn('seo_pages','social','LONGTEXT NULL');await ensureColumn('seo_pages','security','LONGTEXT NULL');await ensureColumn('seo_pages','accessibility','LONGTEXT NULL');await ensureColumn('seo_pages','content_hash','CHAR(64) NULL');await ensureColumn('seo_pages','content_fingerprint','LONGTEXT NULL');await ensureColumn('seo_pages','indexable','BOOLEAN NOT NULL DEFAULT TRUE');}
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
  apply('pagespeed_api_key','pageSpeedApiKey');
  apply('seo_max_pages','seoMaxPages',Number);
  apply('browser_runner_url','browserRunnerUrl');
  apply('browser_runner_token','browserRunnerToken');
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
    ['smtp_secure','smtpSecure'],['smtp_user','smtpUser'],['smtp_from','smtpFrom'],['seo_max_pages','seoMaxPages'],['browser_runner_url','browserRunnerUrl']
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
  if(x.pageSpeedApiKey){
    cfg.pageSpeedApiKey=x.pageSpeedApiKey;
    await storeSetting('pagespeed_api_key',x.pageSpeedApiKey,{secret:true});
  }
  if(x.browserRunnerToken){
    cfg.browserRunnerToken=x.browserRunnerToken;
    await storeSetting('browser_runner_token',x.browserRunnerToken,{secret:true});
  }
  backupRepoChecked=false;backupRepoMeta=null;
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
  smtpUser:cfg.smtpUser,smtpPasswordConfigured:Boolean(cfg.smtpPassword),smtpFrom:cfg.smtpFrom,
  pageSpeedApiKeyConfigured:Boolean(cfg.pageSpeedApiKey),seoMaxPages:cfg.seoMaxPages,
  browserRunnerUrl:cfg.browserRunnerUrl,browserRunnerTokenConfigured:Boolean(cfg.browserRunnerToken),browserRunnerConfigured:Boolean(cfg.browserRunnerUrl&&cfg.browserRunnerToken)
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
      const res=await fetch('https://api.github.com/repos/'+repo+path,{method,headers:{accept:'application/vnd.github+json',authorization:'Bearer '+cred.token,'x-github-api-version':'2022-11-28','user-agent':'Lorzen-SiteOps/0.9.0'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
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
    if(x.password||x.privateKey||x.passphrase){
      const previous=site.encrypted_credentials?decrypt(site.encrypted_credentials):{};
      creds=encrypt({password:x.password||previous.password,privateKey:x.privateKey||previous.privateKey,passphrase:x.passphrase||previous.passphrase});
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
async function gh(path,{method='GET',body,allow404=false,allow409=false}={}){
  const res=await fetch('https://api.github.com'+backupRepoPath(path),{
    method,
    headers:{
      accept:'application/vnd.github+json',
      authorization:'Bearer '+cfg.githubBackupToken,
      'x-github-api-version':'2022-11-28',
      'user-agent':'Lorzen-SiteOps/0.9.0'
    },
    body:body===undefined?undefined:JSON.stringify(body),
    signal:AbortSignal.timeout(30000)
  });
  const raw=await res.text();
  let data=null;
  if(raw){try{data=JSON.parse(raw);}catch{data=raw;}}
  if(allow404&&res.status===404)return null;
  if(allow409&&res.status===409)return null;
  if(!res.ok)throw new Error('GitHub '+method+' '+path+' failed ('+res.status+'): '+(data?.message||String(data||'').slice(0,500)));
  return data;
}
let backupRepoChecked=false,backupRepoMeta=null;
async function ensureBackupRepository(){
  cfg.githubBackupRepo=String(cfg.githubBackupRepo||'').trim().replace(/^\/+|\/+$/g,'');
  if(!cfg.githubBackupRepo||!cfg.githubBackupToken)throw new Error('GitHub backup is not configured. Set GITHUB_BACKUP_REPO and GITHUB_BACKUP_TOKEN.');
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(cfg.githubBackupRepo))throw new Error('GITHUB_BACKUP_REPO must be owner/repository');
  if(backupRepoChecked&&backupRepoMeta)return backupRepoMeta;
  const r=await gh('');
  if(!r.private)throw new Error('Backup repository must be private');
  if(r.archived)throw new Error('Backup repository is archived');
  backupRepoMeta=r;backupRepoChecked=true;return r;
}
async function initializeEmptyBackupRepository(repoMeta){
  const marker=Buffer.from('SiteOps backup repository\n').toString('base64');
  try{
    await gh('/contents/.siteops',{method:'PUT',body:{message:'Initialize SiteOps backup repository',content:marker}});
  }catch(e){
    // A concurrent request may have initialized the repository in the meantime.
    const defaultBranch=encodeURIComponent(repoMeta?.default_branch||'main');
    const existing=await gh('/git/ref/heads/'+defaultBranch,{allow404:true,allow409:true});
    if(!existing)throw e;
  }
}
async function branchState(){
  const repoMeta=await ensureBackupRepository();
  const configuredBranch=String(cfg.backupBranch||repoMeta.default_branch||'main');
  const defaultBranch=String(repoMeta.default_branch||'main');

  let ref=await gh('/git/ref/heads/'+encodeURIComponent(configuredBranch),{allow404:true,allow409:true});
  if(!ref){
    let defaultRef=await gh('/git/ref/heads/'+encodeURIComponent(defaultBranch),{allow404:true,allow409:true});
    if(!defaultRef){
      await initializeEmptyBackupRepository(repoMeta);
      defaultRef=await gh('/git/ref/heads/'+encodeURIComponent(defaultBranch),{allow404:true});
      if(!defaultRef)throw new Error('Backup repository initialization succeeded but no default branch is available');
    }
    if(configuredBranch===defaultBranch)ref=defaultRef;
    else{
      try{await gh('/git/refs',{method:'POST',body:{ref:'refs/heads/'+configuredBranch,sha:defaultRef.object.sha}});}
      catch(e){
        const raced=await gh('/git/ref/heads/'+encodeURIComponent(configuredBranch),{allow404:true});
        if(!raced)throw e;
      }
      ref=await gh('/git/ref/heads/'+encodeURIComponent(configuredBranch));
    }
  }

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
  const treeBody={tree:changes,base_tree:state.rootTreeSha};
  const tree=await gh('/git/trees',{method:'POST',body:treeBody});
  if(tree.sha===state.rootTreeSha)return state.headSha;
  const commit=await gh('/git/commits',{method:'POST',body:{message,tree:tree.sha,parents:[state.headSha]}});
  await gh('/git/refs/heads/'+encodeURIComponent(cfg.backupBranch),{method:'PATCH',body:{sha:commit.sha,force:false}});
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
    response=await fetch(current,{redirect:'manual',signal:AbortSignal.timeout(timeoutMs),headers:{'User-Agent':'Lorzen-SiteOps/0.9.0'}});
    if(response.status>=300&&response.status<400){
      const location=response.headers.get('location');if(!location)break;
      const next=new URL(location,current).toString();redirects.push({status:response.status,from:current,to:next});current=next;continue;
    }
    break;
  }
  return{response,finalUrl:current,redirects};
}
function htmlTitle(body){const m=String(body||'').match(/<title[^>]*>([\s\S]*?)<\/title>/i);return m?m[1].replace(/\s+/g,' ').trim():null;}
const domainExpiryCache=new Map();
async function domainExpiryDays(domain){
  const key=String(domain||'').toLowerCase().replace(/^www\./,''),cached=domainExpiryCache.get(key);
  if(cached&&Date.now()-cached.at<12*60*60*1000)return cached.days;
  try{
    const res=await fetch('https://rdap.org/domain/'+encodeURIComponent(key),{redirect:'follow',signal:AbortSignal.timeout(10000),headers:{'User-Agent':'Lorzen-SiteOps/0.9.0'}});
    if(!res.ok)return null;const data=await res.json(),event=(data.events||[]).find(e=>/expiration/i.test(e.eventAction||''));
    const days=event?.eventDate?Math.floor((new Date(event.eventDate).getTime()-Date.now())/86400000):null;domainExpiryCache.set(key,{at:Date.now(),days});return days;
  }catch{return null;}
}
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
        const origin=new URL(finalUrl).origin,wpRes=await fetch(origin+'/wp-json/',{redirect:'follow',signal:AbortSignal.timeout(site.monitor_timeout_ms),headers:{'User-Agent':'Lorzen-SiteOps/0.9.0'}});
        wp={ok:wpRes.ok,status:wpRes.status};
      }catch(e){wp={ok:false,error:String(e.message||e)};}
    }
  }catch(e){error=e.message||String(e);}
  const responseMs=Date.now()-started,ssl=await sslDays(finalUrl||url),domainDays=await domainExpiryDays(site.domain);
  const checks={
    dns:!site.monitor_check_dns||(Array.isArray(dns)&&dns.length>0),
    http:status===site.monitor_expected_status,
    content:!site.monitor_content||body.includes(site.monitor_content),
    title:!site.monitor_expected_title||title===site.monitor_expected_title,
    wordpress:!site.monitor_check_wordpress||Boolean(wp?.ok),
    speed:!site.response_warn_ms||responseMs<=site.response_warn_ms,
    ssl:ssl===null||ssl>=site.ssl_warn_days,
    domain:domainDays===null||domainDays>=30
  };
  const ok=!error&&Object.values(checks).every(Boolean);
  return{ok,url,finalUrl,status,responseMs,sslDays:ssl,domainExpiryDays:domainDays,title,dns,redirects,wordpress:wp,error,checks,checkedAt:new Date().toISOString()};
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
async function deploymentInfo(siteId){
  const site=await getSite(siteId);
  if(site.deployment_mode!=='hostinger_git')return{mode:'webspace',protocol:site.protocol,host:site.host,port:site.port,remoteRoot:site.remote_root};
  let headSha=null,repositoryReachable=false,error=null;
  try{const remote=await connectSite(site);headSha=remote.headSha||null;repositoryReachable=true;await remote.close();}catch(e){error=String(e.message||e);}
  return{mode:'hostinger_git',repository:site.source_repository,branch:site.source_branch||'main',sourceRoot:site.source_root||'',hostingerTargetDirectory:site.hostinger_target_directory||'public_html',repositoryReachable,headSha,error};
}
async function backupStatus(siteId){
  const site=await getSite(siteId),state=(await q('select * from backup_state where site_id=?',[site.id])).rows[0]||null,last=(await q('select id,git_commit,backup_type,file_count,changed,created_at from backups where site_id=? order by created_at desc limit 1',[site.id])).rows[0]||null;
  return{enabled:Boolean(site.backup_enabled),intervalSeconds:site.backup_interval_seconds,maxFiles:site.backup_max_files,state,last};
}
async function siteOverview(siteId){
  const site=await getSite(siteId),latestCheck=(await q('select id,ok,http_status,response_ms,ssl_days,error,details,created_at from monitor_checks where site_id=? order by created_at desc limit 1',[site.id])).rows[0]||null,state=(await q('select * from monitor_state where site_id=?',[site.id])).rows[0]||null,openIncidents=(await q("select id,status,title,created_at from incidents where site_id=? and status='open' order by created_at desc",[site.id])).rows;
  return{site:publicSite(site),deployment:await deploymentInfo(site.id),monitor:{latestCheck,state,openIncidents},backup:await backupStatus(site.id)};
}
async function findFiles(siteId,needle,limit=100){
  const site=await getSite(siteId),remote=await connectSite(site),results=[],qneedle=String(needle||'').toLowerCase(),patterns=Array.isArray(site.exclude_patterns)?site.exclude_patterns:[];
  const excluded=p=>patterns.some(x=>p.includes(x));
  async function walk(rel=''){
    if(results.length>=limit)return;
    for(const e of await remote.list(joinRemote(site.remote_root,rel))){
      if(results.length>=limit)break;
      const child=rel?rel+'/'+e.name:e.name;if(excluded(child))continue;
      if(child.toLowerCase().includes(qneedle))results.push({path:child,type:e.type,size:e.size??null});
      if(e.type==='directory')await walk(child);
    }
  }
  try{await walk();return results;}finally{await remote.close();}
}
async function searchText(siteId,needle,{maxFiles=50,maxBytes=524288}={}){
  const site=await getSite(siteId),remote=await connectSite(site),matches=[],patterns=Array.isArray(site.exclude_patterns)?site.exclude_patterns:[],term=String(needle||'').toLowerCase();let scanned=0;
  const excluded=p=>patterns.some(x=>p.includes(x));
  async function walk(rel=''){
    if(scanned>=maxFiles)return;
    for(const e of await remote.list(joinRemote(site.remote_root,rel))){
      if(scanned>=maxFiles)break;
      const child=rel?rel+'/'+e.name:e.name;if(excluded(child))continue;
      if(e.type==='directory'){await walk(child);continue;}
      if(e.type!=='file'||Number(e.size||0)>maxBytes)continue;
      scanned++;try{const b=await remote.read(joinRemote(site.remote_root,child));if(b.includes(0))continue;const txt=b.toString('utf8'),idx=txt.toLowerCase().indexOf(term);if(idx>=0)matches.push({path:child,index:idx,excerpt:txt.slice(Math.max(0,idx-100),Math.min(txt.length,idx+term.length+180)).replace(/\s+/g,' ')});}catch{}
    }
  }
  try{await walk();return{needle,scanned,matches};}finally{await remote.close();}
}

async function getIncident(incidentId){const i=(await q('select i.*,s.slug,s.domain from incidents i join sites s on s.id=i.site_id where i.id=?',[incidentId])).rows[0];if(!i)throw new Error('Incident not found');const events=(await q('select id,event_type,details,created_at from incident_events where incident_id=? order by created_at asc',[incidentId])).rows;return{...i,events};}
let monitorRunning=false;function startMonitor(){setInterval(async()=>{if(monitorRunning)return;monitorRunning=true;try{const sites=(await q(`select s.* from sites s left join monitor_state ms on ms.site_id=s.id where s.enabled=1 and s.monitor_enabled=1 and (ms.last_check_at is null or timestampdiff(second,ms.last_check_at,now())>=s.monitor_interval_seconds)`)).rows;for(const site of sites){try{await processMonitor(site);}catch(e){console.error('monitor',site.domain,e);}}}finally{monitorRunning=false;}},cfg.workerInterval).unref();}
let backupRunning=false;function startBackupWorker(){setInterval(async()=>{if(backupRunning)return;backupRunning=true;try{const sites=(await q(`select s.* from sites s left join (select site_id,max(created_at) last_backup_at from backups group by site_id) b on b.site_id=s.id left join backup_state bs on bs.site_id=s.id where s.enabled=1 and s.backup_enabled=1 and (b.last_backup_at is null or timestampdiff(second,b.last_backup_at,now())>=s.backup_interval_seconds) and (bs.last_attempt_at is null or timestampdiff(second,bs.last_attempt_at,now())>=least(s.backup_interval_seconds,900)) order by coalesce(b.last_backup_at,'1970-01-01 00:00:00')`)).rows;for(const site of sites){const previous=(await q('select * from backup_state where site_id=?',[site.id])).rows[0];await q(`insert into backup_state(site_id,last_attempt_at,updated_at) values(?,now(),now()) on duplicate key update last_attempt_at=now(),updated_at=now()`,[site.id]);try{await fullBackup(site,site.backup_max_files||10000);await q(`update backup_state set last_success_at=now(),last_error=null,updated_at=now() where site_id=?`,[site.id]);}catch(e){const msg=String(e.message||e).slice(0,4000);await q(`update backup_state set last_error=?,updated_at=now() where site_id=?`,[msg,site.id]);if(!previous?.last_error)await sendAlert(`BACKUP FAILED: ${site.domain}`,msg);console.error('backup',site.domain,e);}}}finally{backupRunning=false;}},cfg.backupWorkerInterval).unref();}


function publicSyntheticTest(t){
  return{id:t.id,siteId:t.site_id,name:t.name,enabled:Boolean(t.enabled),startUrl:t.start_url,steps:Array.isArray(t.steps)?t.steps:[],secretsConfigured:Boolean(t.encrypted_secrets),intervalSeconds:t.interval_seconds,timeoutMs:t.timeout_ms,viewport:{width:t.viewport_width,height:t.viewport_height},visualEnabled:Boolean(t.visual_enabled),visualThreshold:Number(t.visual_threshold||0),baselineConfigured:Boolean(t.baseline_image),baselineHash:t.baseline_hash,lastRunAt:t.last_run_at,createdAt:t.created_at,updatedAt:t.updated_at};
}
async function syntheticTestGet(id){const t=(await q('select * from synthetic_tests where id=?',[id])).rows[0];if(!t)throw new Error('Synthetic test not found');return t;}
async function syntheticTestsList(siteId){
  const site=await getSite(siteId),tests=(await q('select * from synthetic_tests where site_id=? order by name',[site.id])).rows;
  const out=[];for(const t of tests){const last=(await q('select id,status,duration_ms,error,result,visual_mismatch,created_at,(screenshot_image is not null) screenshot_available from synthetic_runs where test_id=? order by created_at desc limit 1',[t.id])).rows[0]||null;out.push({...publicSyntheticTest(t),lastRun:last});}
  return out;
}
function syntheticValidateStartUrl(site,url){const u=new URL(url);if(!['http:','https:'].includes(u.protocol))throw new Error('Synthetic start URL must use http or https');const a=u.hostname.toLowerCase().replace(/^www\./,''),b=String(site.domain||'').toLowerCase().replace(/^www\./,'');if(a!==b)throw new Error('Synthetic start URL must use the managed site hostname');return u.toString();}
function syntheticSteps(value){if(!Array.isArray(value))throw new Error('steps must be an array');for(const [i,x] of value.entries())if(!x||typeof x!=='object'||!x.action)throw new Error('Step '+(i+1)+' needs an action');return value;}
async function syntheticCreate(siteId,x){
  const site=await getSite(siteId),id=crypto.randomUUID(),startUrl=syntheticValidateStartUrl(site,x.startUrl||site.monitor_url||('https://'+site.domain)),steps=syntheticSteps(x.steps||[]);
  const secrets=x.secrets&&Object.keys(x.secrets).length?encrypt(x.secrets):null;
  await q('insert into synthetic_tests(id,site_id,name,enabled,start_url,steps,encrypted_secrets,interval_seconds,timeout_ms,viewport_width,viewport_height,visual_enabled,visual_threshold) values(?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,site.id,x.name, x.enabled===false?0:1,startUrl,JSON.stringify(steps),secrets,Number(x.intervalSeconds||3600),Number(x.timeoutMs||30000),Number(x.viewportWidth||1440),Number(x.viewportHeight||1000),x.visualEnabled?1:0,Number(x.visualThreshold??.01)]);
  return publicSyntheticTest(await syntheticTestGet(id));
}
async function syntheticUpdate(id,x){
  const t=await syntheticTestGet(id),site=await getSite(t.site_id),allowed={name:'name',enabled:'enabled',startUrl:'start_url',steps:'steps',intervalSeconds:'interval_seconds',timeoutMs:'timeout_ms',viewportWidth:'viewport_width',viewportHeight:'viewport_height',visualEnabled:'visual_enabled',visualThreshold:'visual_threshold'},sets=[],params=[];
  for(const [key,col] of Object.entries(allowed)){if(x[key]===undefined)continue;let v=x[key];if(key==='startUrl')v=syntheticValidateStartUrl(site,v);if(key==='steps')v=JSON.stringify(syntheticSteps(v));if(['enabled','visualEnabled'].includes(key))v=v?1:0;sets.push(col+'=?');params.push(v);}
  if(x.secrets&&Object.keys(x.secrets).length){sets.push('encrypted_secrets=?');params.push(encrypt(x.secrets));}
  if(x.clearSecrets){sets.push('encrypted_secrets=null');}
  if(sets.length){params.push(id);await q('update synthetic_tests set '+sets.join(',')+',updated_at=now() where id=?',params);}
  return publicSyntheticTest(await syntheticTestGet(id));
}
function syntheticResolveSecrets(value,secrets){
  if(typeof value==='string')return value.replace(/\{\{secret\.([A-Za-z0-9_.-]+)\}\}/g,(_m,k)=>{if(secrets[k]===undefined)throw new Error('Missing synthetic secret '+k);return String(secrets[k]);});
  if(Array.isArray(value))return value.map(v=>syntheticResolveSecrets(v,secrets));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,syntheticResolveSecrets(v,secrets)]));
  return value;
}
async function browserRunnerRequest(path,{method='GET',body,token,url}={}){
  const base=String((url??cfg.browserRunnerUrl)||'').replace(/\/+$/,'');const authToken=token??cfg.browserRunnerToken;
  if(!base||!authToken)throw new Error('Browser Runner is not configured');
  const res=await fetch(base+path,{method,headers:{authorization:'Bearer '+authToken,...(body!==undefined?{'content-type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(150000)});
  const raw=await res.text();let data;try{data=raw?JSON.parse(raw):{};}catch{data={error:raw.slice(0,1000)};}if(!res.ok)throw new Error('Browser Runner '+res.status+': '+(data.error||data.message||raw.slice(0,500)));return data;
}
async function browserRunnerTest({url,token}={}){return browserRunnerRequest('/auth-test',{url,token});}
function publicSyntheticRun(r){if(!r)return null;return{id:r.id,testId:r.test_id,siteId:r.site_id,status:r.status,durationMs:r.duration_ms,error:r.error,result:r.result,visualMismatch:r.visual_mismatch,screenshotAvailable:Boolean(r.screenshot_available??r.screenshot_image),createdAt:r.created_at};}
async function syntheticRunGet(id){const r=(await q('select id,test_id,site_id,status,duration_ms,error,result,visual_mismatch,created_at,(screenshot_image is not null) screenshot_available from synthetic_runs where id=?',[id])).rows[0];if(!r)throw new Error('Synthetic run not found');return publicSyntheticRun(r);}
async function runSyntheticTest(testId,{saveBaseline=false,actor='manual'}={}){
  const t=await syntheticTestGet(testId),site=await getSite(t.site_id),secrets=t.encrypted_secrets?decrypt(t.encrypted_secrets):{},steps=syntheticResolveSecrets(Array.isArray(t.steps)?t.steps:[],secrets),baseline=t.visual_enabled&&t.baseline_image?t.baseline_image:null;
  const previous=(await q('select status from synthetic_runs where test_id=? order by created_at desc limit 1',[t.id])).rows[0]||null;
  const result=await browserRunnerRequest('/run',{method:'POST',body:{baseUrl:t.start_url,startUrl:t.start_url,steps,timeoutMs:t.timeout_ms,viewport:{width:t.viewport_width,height:t.viewport_height},visualThreshold:Number(t.visual_threshold||.01),visualAssert:Boolean(t.visual_enabled&&baseline),baselineBase64:baseline||undefined,captureScreenshot:Boolean(saveBaseline||t.visual_enabled)}});
  if(saveBaseline){if(!result.ok)throw new Error('Baseline not saved because the journey failed: '+(result.error||'unknown'));if(!result.screenshotBase64)throw new Error('Runner returned no screenshot for baseline');if(result.screenshotBase64.length>12*1024*1024)throw new Error('Baseline screenshot is too large');await q('update synthetic_tests set baseline_image=?,baseline_hash=?,updated_at=now() where id=?',[result.screenshotBase64,result.screenshotHash,t.id]);}
  const screenshot=result.screenshotBase64&&(!result.ok||saveBaseline)&&result.screenshotBase64.length<=12*1024*1024?result.screenshotBase64:null,stored={...result};delete stored.screenshotBase64;
  const runId=crypto.randomUUID(),status=result.ok?'passed':'failed';
  await q('insert into synthetic_runs(id,test_id,site_id,status,duration_ms,error,result,visual_mismatch,screenshot_image) values(?,?,?,?,?,?,?,?,?)',[runId,t.id,site.id,status,result.durationMs||null,result.error||null,JSON.stringify({...stored,actor,baselineSaved:Boolean(saveBaseline)}),result.visual?.mismatch??null,screenshot]);
  await q('update synthetic_tests set last_run_at=now() where id=?',[t.id]);
  await q('update synthetic_runs set screenshot_image=null where test_id=? and created_at<date_sub(now(),interval 30 day)',[t.id]);
  if(status==='failed'&&previous?.status!=='failed')await sendAlert('SYNTHETIC FAILED: '+site.domain+' · '+t.name,result.error||'Browser journey failed');
  if(status==='passed'&&previous?.status==='failed')await sendAlert('SYNTHETIC RECOVERED: '+site.domain+' · '+t.name,'Browser journey is healthy again.');
  return syntheticRunGet(runId);
}
async function syntheticStatus(siteId){
  const site=await getSite(siteId),tests=await syntheticTestsList(site.id),failed=tests.filter(t=>t.lastRun?.status==='failed').length,passed=tests.filter(t=>t.lastRun?.status==='passed').length;
  return{configured:Boolean(cfg.browserRunnerUrl&&cfg.browserRunnerToken),total:tests.length,enabled:tests.filter(t=>t.enabled).length,passed,failed,tests};
}
let syntheticWorkerRunning=false;
function startSyntheticWorker(){setInterval(async()=>{if(syntheticWorkerRunning||!cfg.browserRunnerUrl||!cfg.browserRunnerToken)return;syntheticWorkerRunning=true;try{const tests=(await q(`select t.* from synthetic_tests t join sites s on s.id=t.site_id where t.enabled=1 and s.enabled=1 and (t.last_run_at is null or timestampdiff(second,t.last_run_at,now())>=t.interval_seconds) order by coalesce(t.last_run_at,'1970-01-01 00:00:00') limit 20`)).rows;for(const t of tests){try{await runSyntheticTest(t.id,{actor:'scheduler'});}catch(e){console.error('synthetic',t.name,e);}}}finally{syntheticWorkerRunning=false;}},cfg.syntheticWorkerInterval).unref();}

function fixPromptBase(site){
  return `Arbeite an der verwalteten Website "${site.name}" (${site.domain}) über das verbundene SiteOps-MCP. Website-Typ: ${site.site_type}. Deployment: ${site.deployment_mode||'webspace'}.

Wichtig:
- Untersuche zuerst die Ursache, statt nur das Symptom zu verstecken.
- Nutze zunächst site_overview und danach files_find/text_search/file_read für die relevanten Quelldateien.
- Bei Git-Deployment ist das konfigurierte Repository die Source of Truth; ändere nicht parallel den Live-Webspace.
- Erstelle für Änderungen ausschließlich einen change_preview mit einer möglichst kleinen, nachvollziehbaren Änderung.
- Rufe change_apply NICHT auf. Gib mir zuerst preview_id, betroffene Dateien, Ursache, Änderung und erwartete Wirkung zurück.
- Deaktiviere keine Prüfungen, Monitoring-, Security-, SEO- oder Accessibility-Regeln, nur damit der Fehler verschwindet.
- Nach meiner späteren Freigabe soll die Änderung mit site_status und dem passenden SEO-/Synthetic-Test validiert werden.

`;
}
async function buildFixPrompt({kind,site:siteRef,id,issueCode}){
  if(kind==='seo_page'){
    const p=await seoPageGet(Number(id)),site=await getSite(p.site_id),issues=(Array.isArray(p.issues)?p.issues:[]).filter(x=>!issueCode||x.code===issueCode),problem=issues.length?issues.map(x=>x.level.toUpperCase()+' '+x.code+': '+x.text).join('\n'):'SEO-/Quality-Problem auf dieser Seite';
    return{title:'Fix '+(issueCode||'SEO issues')+' · '+site.domain,prompt:fixPromptBase(site)+`Problemquelle: SiteOps Website Quality Audit
URL: ${p.url}
Title: ${p.title||'(kein Title)'}
HTTP: ${p.status_code}
Canonical: ${p.canonical||'(kein Canonical)'}
H1: ${JSON.stringify(p.h1||[])}
Probleme:
${problem}

Behebe die technische Ursache passend zur vorhandenen Codebasis. Prüfe insbesondere Templates/Layouts, SEO-Konfiguration, interne Links oder Header-Konfiguration, je nach Fehlerart. Erzeuge anschließend den change_preview.`};
  }
  if(kind==='seo_site'){
    const site=await getSite(siteRef),data=await seoIssuesList(site.id,{limit:80}),issues=data.issues.filter(x=>x.level!=='info').slice(0,40);
    return{title:'Fix Website Quality · '+site.domain,prompt:fixPromptBase(site)+`Problemquelle: letzter SiteOps Website Quality Audit
Aktuelle Fehler/Warnungen:
${issues.map(x=>x.level.toUpperCase()+' '+x.code+' · '+x.url+' · '+x.text).join('\n')||'Keine Fehlerdetails vorhanden.'}

Priorisiere gemeinsame Root Causes und Template-Probleme, damit nicht dieselbe Korrektur seitenweise dupliziert wird. Erzeuge einen oder mehrere logisch getrennte change_preview-Vorschläge, aber wende nichts an.`};
  }
  if(kind==='incident'){
    const incident=await getIncident(id),site=await getSite(incident.site_id);
    return{title:'Fix Incident · '+site.domain,prompt:fixPromptBase(site)+`Problemquelle: SiteOps Monitoring Incident
Incident: ${incident.title}
Status: ${incident.status}
Gestartet: ${incident.created_at}
Details:
${JSON.stringify(incident.details||{},null,2)}
Letzte Ereignisse:
${JSON.stringify((incident.events||[]).slice(-8),null,2)}

Diagnostiziere, ob die Ursache im Deployment/Code, Redirect/DNS/SSL, WordPress oder in einer externen Abhängigkeit liegt. Wenn eine Codeänderung sinnvoll ist, erzeuge einen change_preview; wenn nicht, nenne die konkrete operative Maßnahme.`};
  }
  if(kind==='synthetic'){
    const run=(await q('select r.*,t.name,t.start_url,t.steps,s.name site_name,s.domain,s.site_type,s.deployment_mode from synthetic_runs r join synthetic_tests t on t.id=r.test_id join sites s on s.id=r.site_id where r.id=?',[id])).rows[0];if(!run)throw new Error('Synthetic run not found');
    const site={name:run.site_name,domain:run.domain,site_type:run.site_type,deployment_mode:run.deployment_mode};
    return{title:'Fix Browser Test · '+run.name,prompt:fixPromptBase(site)+`Problemquelle: SiteOps Synthetic Browser Test
Test: ${run.name}
Start-URL: ${run.start_url}
Status: ${run.status}
Fehler: ${run.error||'(kein Fehlertext)'}
Visual mismatch: ${run.visual_mismatch==null?'nicht geprüft':(Number(run.visual_mismatch)*100).toFixed(2)+'%'}
Testschritte:
${JSON.stringify(run.steps||[],null,2)}
Runner-Ergebnis:
${JSON.stringify(run.result||{},null,2)}

Reproduziere den fehlschlagenden Schritt gedanklich anhand des Codes. Achte besonders auf geänderte Selektoren, Navigation, JavaScript-Fehler, API-/Asset-Fehler und visuelle Regressionen. Passe den Test nur dann an, wenn die Website absichtlich geändert wurde und der Test nachweislich veraltet ist; ansonsten behebe die Website. Erzeuge bei Codeänderungen einen change_preview und wende ihn nicht an.`};
  }
  throw new Error('Unknown fix prompt kind');
}


const SEO_STOPWORDS=new Set('aber alle allem allen aller alles als also am an ander andere anderem anderen anderer anderes and auch auf aus bei bin bis bist da damit dann das dass dein deine dem den denn der des die dies diese diesem diesen dieser dieses doch dort du durch ein eine einem einen einer eines er es etwas für gegen gewesen hat hatte haben hier hin hinter ich im in ist ja jede jedem jeden jeder jedes jener jenes kann kein keine mit muss nach nicht nichts noch nun nur ob oder ohne sehr sein seine selbst sich sie sind so über um und uns unser unsere unter vom von vor war waren was weg weil weiter welche welchem welchen welcher welches wenn werde werden wie wieder will wir wo zu zum zur'.split(/\s+/));
function seoNormalizeUrl(value,base){
  try{
    const u=new URL(value,base);u.hash='';
    for(const k of [...u.searchParams.keys()])if(/^utm_|^(fbclid|gclid)$/i.test(k))u.searchParams.delete(k);
    if((u.protocol==='https:'&&u.port==='443')||(u.protocol==='http:'&&u.port==='80'))u.port='';
    if(u.pathname!=='/'&&u.pathname.endsWith('/'))u.pathname=u.pathname.replace(/\/+$/,'');
    return u.toString();
  }catch{return null;}
}
function seoCrawlableUrl(value,rootHost){
  try{
    const u=new URL(value);
    if(!['http:','https:'].includes(u.protocol)||u.hostname!==rootHost)return false;
    if(/\.(?:jpg|jpeg|png|gif|webp|avif|svg|ico|pdf|zip|rar|7z|gz|mp4|mp3|mov|avi|wmv|css|js|json|xml|woff2?|ttf|eot)(?:$|\?)/i.test(u.pathname+u.search))return false;
    return true;
  }catch{return false;}
}
async function seoDiscoverSitemaps(rootUrl,maxUrls){
  const root=new URL(rootUrl),sitemapUrls=new Set([new URL('/sitemap.xml',root).toString(),new URL('/sitemap_index.xml',root).toString()]),pages=new Set();let robotsTxt='';
  try{
    const robots=await fetch(new URL('/robots.txt',root),{signal:AbortSignal.timeout(8000),headers:{'User-Agent':cfg.seoUserAgent}});
    if(robots.ok){const txt=await robots.text();robotsTxt=txt;for(const m of txt.matchAll(/^sitemap:\s*(\S+)/gim))sitemapUrls.add(m[1]);}
  }catch{}
  const seenMaps=new Set(),queue=[...sitemapUrls];
  while(queue.length&&seenMaps.size<12&&pages.size<maxUrls){
    const sitemap=queue.shift();if(seenMaps.has(sitemap))continue;seenMaps.add(sitemap);
    try{
      const res=await fetch(sitemap,{signal:AbortSignal.timeout(12000),headers:{'User-Agent':cfg.seoUserAgent,accept:'application/xml,text/xml,*/*'}});
      if(!res.ok)continue;const xml=await res.text(),$=cheerio.load(xml,{xmlMode:true});
      if($('sitemapindex sitemap loc').length){
        $('sitemapindex sitemap loc').each((_,e)=>{const loc=$(e).text().trim();if(loc&&!seenMaps.has(loc)&&queue.length<30)queue.push(loc);});
      }else{
        $('urlset url loc').each((_,e)=>{const loc=seoNormalizeUrl($(e).text().trim(),rootUrl);if(loc&&new URL(loc).hostname===root.hostname&&seoCrawlableUrl(loc,root.hostname)&&pages.size<maxUrls)pages.add(loc);});
      }
    }catch{}
  }
  return{pages:[...pages],sitemaps:[...seenMaps],robotsTxt};
}
function seoAiBotAccess(robotsTxt){
  const bots=['GPTBot','OAI-SearchBot','ChatGPT-User','ClaudeBot','Claude-Web','PerplexityBot','Google-Extended'],lines=String(robotsTxt||'').split(/\r?\n/),groups=[];let agents=[],rules=[];
  const flush=()=>{if(agents.length)groups.push({agents:[...agents],rules:[...rules]});agents=[];rules=[];};
  for(const raw of lines){const line=raw.replace(/#.*$/,'').trim();if(!line)continue;const m=line.match(/^([^:]+):\s*(.*)$/);if(!m)continue;const key=m[1].trim().toLowerCase(),value=m[2].trim();if(key==='user-agent'){if(rules.length)flush();agents.push(value.toLowerCase());}else if((key==='allow'||key==='disallow')&&agents.length)rules.push({type:key,path:value});}
  flush();const wildcard=groups.filter(g=>g.agents.includes('*'));
  return bots.map(bot=>{const name=bot.toLowerCase(),specific=groups.filter(g=>g.agents.includes(name)),selected=specific.length?specific:wildcard,blocked=selected.some(g=>g.rules.some(r=>r.type==='disallow'&&r.path==='/'));return{bot,blocked};});
}
function seoTokens(text){
  return String(text||'').toLocaleLowerCase('de-DE').normalize('NFKC').match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu)?.filter(x=>!SEO_STOPWORDS.has(x)&&!/^\d+$/.test(x))||[];
}
function seoFingerprint(text){
  const tokens=seoTokens(text).filter(t=>t.length>2),seen=new Set(),out=[];
  for(const token of tokens){if(seen.has(token))continue;seen.add(token);out.push(token);if(out.length>=400)break;}
  return out;
}
function seoSimilarity(a,b){
  const aa=new Set(a||[]),bb=new Set(b||[]);if(!aa.size||!bb.size)return 0;
  let intersection=0;for(const x of aa)if(bb.has(x))intersection++;
  return intersection/(aa.size+bb.size-intersection);
}
function seoSecurity(headers,url){
  const val=n=>headers?.get?.(n)||'',https=String(url||'').startsWith('https://');
  const checks={https,hsts:Boolean(val('strict-transport-security')),csp:Boolean(val('content-security-policy')),xContentTypeOptions:/nosniff/i.test(val('x-content-type-options')),referrerPolicy:Boolean(val('referrer-policy')),permissionsPolicy:Boolean(val('permissions-policy')),frameProtection:Boolean(val('x-frame-options')||/frame-ancestors/i.test(val('content-security-policy')))};
  const missing=Object.entries(checks).filter(([k,v])=>k!=='https'&&!v).map(([k])=>k);
  const score=Math.max(0,100-(https?0:30)-missing.length*10);
  return{score,checks,missing};
}
function seoAccessibility($){
  const lang=($('html').attr('lang')||'').trim(),emptyLinks=$('a[href]').filter((_,e)=>!($(e).text()||'').trim()&&!$(e).attr('aria-label')&&!$(e).find('img[alt]').length).length;
  const emptyButtons=$('button').filter((_,e)=>!($(e).text()||'').trim()&&!$(e).attr('aria-label')&&!$(e).attr('title')).length;
  let unlabeledInputs=0;$('input,select,textarea').each((_,e)=>{const el=$(e),type=(el.attr('type')||'').toLowerCase();if(['hidden','submit','button','reset','image'].includes(type))return;const id=el.attr('id'),labelled=Boolean(el.attr('aria-label')||el.attr('aria-labelledby')||(id&&$('label[for="'+String(id).replace(/"/g,'\\\"')+'"]').length)||el.closest('label').length);if(!labelled)unlabeledInputs++;});
  return{langPresent:Boolean(lang),emptyLinks,emptyButtons,unlabeledInputs,issueCount:(lang?0:1)+emptyLinks+emptyButtons+unlabeledInputs};
}
function seoSocial($){
  const meta=(property,name)=>$('meta['+property+'="'+name+'"]').attr('content')?.trim()||'';
  return{ogTitle:meta('property','og:title'),ogDescription:meta('property','og:description'),ogImage:meta('property','og:image'),ogType:meta('property','og:type'),twitterCard:meta('name','twitter:card'),twitterTitle:meta('name','twitter:title'),twitterDescription:meta('name','twitter:description')};
}
function seoHealthScore(pages){
  if(!pages.length)return 0;let penalty=0;
  for(const p of pages)for(const i of p.issues||[])penalty+=i.level==='error'?5:i.level==='warn'?2:.5;
  return Math.max(0,Math.round(100-(penalty/pages.length)*2));
}
function seoIssues(page){
  const issues=[];
  if(page.statusCode!==200)issues.push({level:'error',code:'http_status',text:'HTTP '+page.statusCode});
  if(page.redirectCount>0)issues.push({level:page.redirectCount>1?'warn':'info',code:'redirect_chain',text:page.redirectCount+' Redirect'+(page.redirectCount===1?'':'s')+' bis zur finalen URL'});
  if(!page.title)issues.push({level:'error',code:'title_missing',text:'Title fehlt'});
  else if(page.title.length<25)issues.push({level:'warn',code:'title_short',text:'Title sehr kurz ('+page.title.length+' Zeichen)'});
  else if(page.title.length>65)issues.push({level:'warn',code:'title_long',text:'Title lang ('+page.title.length+' Zeichen)'});
  if(!page.metaDescription)issues.push({level:'warn',code:'description_missing',text:'Meta Description fehlt'});
  else if(page.metaDescription.length<70)issues.push({level:'info',code:'description_short',text:'Meta Description kurz ('+page.metaDescription.length+' Zeichen)'});
  else if(page.metaDescription.length>170)issues.push({level:'warn',code:'description_long',text:'Meta Description lang ('+page.metaDescription.length+' Zeichen)'});
  if(page.h1.length===0)issues.push({level:'error',code:'h1_missing',text:'H1 fehlt'});
  if(page.h1.length>1)issues.push({level:'warn',code:'h1_multiple',text:page.h1.length+' H1-Überschriften'});
  if(!page.canonical)issues.push({level:'info',code:'canonical_missing',text:'Canonical fehlt'});
  if(/noindex/i.test(page.robots||''))issues.push({level:'error',code:'noindex',text:'Seite steht auf noindex'});
  if(/nofollow/i.test(page.robots||''))issues.push({level:'warn',code:'page_nofollow',text:'Robots-Meta enthält nofollow'});
  if(page.wordCount<250)issues.push({level:'warn',code:'thin_content',text:'Wenig Text ('+page.wordCount+' Wörter)'});
  if(page.imagesMissingAlt>0)issues.push({level:'warn',code:'image_alt',text:page.imagesMissingAlt+' Bilder ohne Alt-Text'});
  if(page.depth!==null&&page.depth>3)issues.push({level:'info',code:'crawl_depth',text:'Tiefe '+page.depth});
  if(!page.lang)issues.push({level:'warn',code:'html_lang_missing',text:'HTML lang-Attribut fehlt'});
  if((page.structuredData||[]).some(x=>x?.invalid))issues.push({level:'warn',code:'structured_data_invalid',text:'Mindestens ein JSON-LD-Block ist ungültig'});
  if(!page.social?.ogTitle||!page.social?.ogDescription)issues.push({level:'info',code:'open_graph_incomplete',text:'Open-Graph-Titel oder -Beschreibung fehlt'});
  if(!page.social?.ogImage)issues.push({level:'info',code:'open_graph_image_missing',text:'Open-Graph-Bild fehlt'});
  if((page.accessibility?.issueCount||0)>0)issues.push({level:'warn',code:'accessibility_quickcheck',text:page.accessibility.issueCount+' statische Accessibility-Auffälligkeiten'});
  if((page.security?.score??100)<70)issues.push({level:'warn',code:'security_headers',text:'Security-Header-Score '+page.security.score+'/100'});
  if((page.resources||[]).some(x=>String(x).startsWith('http://'))&&String(page.url).startsWith('https://'))issues.push({level:'warn',code:'mixed_content',text:'HTTP-Ressource auf HTTPS-Seite gefunden'});
  return issues;
}
function calcPageRank(urls,links){
  const n=urls.length;if(!n)return new Map();const set=new Set(urls),out=new Map(urls.map(u=>[u,new Set()]));
  for(const l of links)if(l.internal&&set.has(l.source)&&set.has(l.target)&&l.source!==l.target)out.get(l.source).add(l.target);
  let rank=new Map(urls.map(u=>[u,1/n]));const damping=.85;
  for(let iter=0;iter<35;iter++){
    const next=new Map(urls.map(u=>[u,(1-damping)/n]));
    let sink=0;
    for(const u of urls){const targets=out.get(u),r=rank.get(u)||0;if(!targets.size){sink+=r;continue;}for(const t of targets)next.set(t,next.get(t)+damping*r/targets.size);}
    if(sink)for(const u of urls)next.set(u,next.get(u)+damping*sink/n);
    rank=next;
  }
  return rank;
}
function calcWdfIdf(pages){
  const docs=pages.map(p=>seoTokens(p.text)),N=Math.max(1,pages.length),df=new Map();
  for(const tokens of docs)for(const t of new Set(tokens))df.set(t,(df.get(t)||0)+1);
  return docs.map(tokens=>{
    const counts=new Map();for(const t of tokens)counts.set(t,(counts.get(t)||0)+1);
    const max=Math.max(1,...counts.values()),rows=[];
    for(const [term,freq] of counts){const wdf=(1+Math.log2(freq))/(1+Math.log2(max)),idf=Math.log((N+1)/((df.get(term)||0)+1))+1;rows.push({term,freq,wdf:Number(wdf.toFixed(4)),idf:Number(idf.toFixed(4)),score:Number((wdf*idf).toFixed(4))});}
    return rows.sort((a,b)=>b.score-a.score).slice(0,40);
  });
}
async function pageSpeedAudit(url,strategy='mobile'){
  if(!cfg.pageSpeedApiKey)return null;
  const p=new URLSearchParams({url,strategy,key:cfg.pageSpeedApiKey});
  for(const category of ['PERFORMANCE','ACCESSIBILITY','BEST_PRACTICES','SEO'])p.append('category',category);
  const res=await fetch('https://www.googleapis.com/pagespeedonline/v5/runPagespeed?'+p.toString(),{signal:AbortSignal.timeout(120000)});
  const raw=await res.text();let data;try{data=JSON.parse(raw);}catch{data={error:{message:raw.slice(0,500)}};}
  if(!res.ok)throw new Error('PageSpeed '+strategy+' '+res.status+': '+(data?.error?.message||'unknown error'));
  const lhr=data.lighthouseResult||{},cats=lhr.categories||{},audits=lhr.audits||{},score=k=>cats[k]?.score==null?null:Math.round(cats[k].score*100),num=id=>audits[id]?.numericValue??null;
  return{strategy,fetchTime:lhr.fetchTime,finalUrl:lhr.finalUrl,lighthouseVersion:lhr.lighthouseVersion,
    scores:{performance:score('performance'),accessibility:score('accessibility'),bestPractices:score('best-practices'),seo:score('seo')},
    metrics:{fcp:num('first-contentful-paint'),lcp:num('largest-contentful-paint'),tbt:num('total-blocking-time'),cls:num('cumulative-layout-shift'),speedIndex:num('speed-index'),tti:num('interactive')},
    field:data.loadingExperience?.metrics||null};
}
async function seoFetchDocument(url){
  let current=url;const redirects=[];
  for(let i=0;i<10;i++){
    const started=Date.now(),res=await fetch(current,{redirect:'manual',signal:AbortSignal.timeout(20000),headers:{'User-Agent':cfg.seoUserAgent,accept:'text/html,application/xhtml+xml'}});
    const status=res.status,location=res.headers.get('location');
    if(status>=300&&status<400&&location){
      const next=seoNormalizeUrl(location,current);redirects.push({status,from:current,to:next||location});
      if(!next)return{res,html:'',finalUrl:current,redirects,responseMs:Date.now()-started};
      current=next;continue;
    }
    return{res,html:await res.text(),finalUrl:current,redirects,responseMs:Date.now()-started};
  }
  throw new Error('Zu viele Redirects');
}
async function crawlSeoPage(url,rootHost,depth){
  const started=Date.now();let res,html='',error=null,finalUrl=url,redirects=[];
  try{const doc=await seoFetchDocument(url);res=doc.res;html=doc.html;finalUrl=doc.finalUrl;redirects=doc.redirects;}catch(e){error=String(e.message||e);}
  const statusCode=res?.status??0,responseMs=Date.now()-started,contentBytes=Buffer.byteLength(html||''),contentType=res?.headers?.get('content-type')||'';
  const empty={url,finalUrl,path:new URL(url).pathname,statusCode,responseMs,contentBytes,error,title:'',metaDescription:'',canonical:'',robots:'',h1:[],h2:[],wordCount:0,imagesTotal:0,imagesMissingAlt:0,structuredData:[],links:[],resources:[],text:'',depth,redirectCount:redirects.length,lang:'',hreflang:[],social:{},security:seoSecurity(res?.headers,finalUrl),accessibility:{issueCount:0},contentHash:null,contentFingerprint:[],indexable:false};
  if(error||!contentType.includes('text/html'))return{...empty,issues:[{level:'error',code:error?'fetch_error':'not_html',text:error||'Kein HTML-Dokument'}]};
  const $=cheerio.load(html);
  const title=$('title').first().text().replace(/\s+/g,' ').trim(),metaDescription=$('meta[name="description"]').attr('content')?.trim()||'',canonicalHref=$('link[rel="canonical"]').attr('href')||'',canonical=canonicalHref?seoNormalizeUrl(canonicalHref,finalUrl):'',robots=$('meta[name="robots"]').attr('content')||'',lang=($('html').attr('lang')||'').trim();
  const h1=$('h1').map((_,e)=>$(e).text().replace(/\s+/g,' ').trim()).get().filter(Boolean),h2=$('h2').map((_,e)=>$(e).text().replace(/\s+/g,' ').trim()).get().filter(Boolean);
  const structuredData=[];$('script[type="application/ld+json"]').each((_,e)=>{const raw=$(e).text().trim();if(raw){try{structuredData.push(JSON.parse(raw));}catch{structuredData.push({invalid:true,preview:raw.slice(0,300)});}}});
  const hreflang=[];$('link[rel="alternate"][hreflang]').each((_,e)=>{const el=$(e),href=seoNormalizeUrl(el.attr('href')||'',finalUrl);if(href)hreflang.push({lang:(el.attr('hreflang')||'').trim(),href});});
  const social=seoSocial($),accessibility=seoAccessibility($),security=seoSecurity(res.headers,finalUrl);
  const images=$('img').length,imagesMissingAlt=$('img').filter((_,e)=>!($(e).attr('alt')||'').trim()).length;
  const body=$('main,article').first().length?$('main,article').first().clone():$('body').clone();body.find('script,style,noscript,svg,template').remove();const text=body.text().replace(/\s+/g,' ').trim(),wordCount=seoTokens(text).length,contentHash=hash(Buffer.from(text.toLowerCase())),contentFingerprint=seoFingerprint(text);
  const links=[];$('a[href]').each((_,e)=>{const href=$(e).attr('href');if(!href||/^(mailto:|tel:|javascript:)/i.test(href))return;const target=seoNormalizeUrl(href,finalUrl);if(!target)return;const tu=new URL(target),internal=tu.hostname===rootHost,anchor=$(e).text().replace(/\s+/g,' ').trim().slice(0,250),nofollow=/\bnofollow\b/i.test($(e).attr('rel')||'');links.push({source:url,target,anchor,internal,nofollow});});
  const resources=[];$('img[src],script[src],link[rel="stylesheet"][href]').each((_,e)=>{const el=$(e),raw=el.attr('src')||el.attr('href'),target=raw?seoNormalizeUrl(raw,finalUrl):null;if(target)resources.push(target);});
  const indexable=statusCode===200&&!/noindex/i.test(robots||'');
  const page={url,finalUrl,path:new URL(url).pathname+(new URL(url).search||''),statusCode,responseMs,contentBytes,title,metaDescription,canonical,robots,h1,h2,wordCount,imagesTotal:images,imagesMissingAlt,structuredData,links,resources,text,depth,redirectCount:redirects.length,redirects,lang,hreflang,social,security,accessibility,contentHash,contentFingerprint,indexable};
  page.issues=seoIssues(page);return page;
}
async function seoAuditResources(pages,rootHost,limit=250){
  const owners=new Map();
  for(const p of pages)for(const resource of p.resources||[]){let u;try{u=new URL(resource);}catch{continue;}if(u.hostname!==rootHost)continue;if(!owners.has(resource))owners.set(resource,[]);owners.get(resource).push(p);}
  const entries=[...owners.entries()].slice(0,limit),results=[];
  for(let i=0;i<entries.length;i+=10){
    const batch=entries.slice(i,i+10);
    const checked=await Promise.all(batch.map(async([url,pagesFor])=>{try{let r=await fetch(url,{method:'HEAD',redirect:'follow',signal:AbortSignal.timeout(10000),headers:{'User-Agent':cfg.seoUserAgent}});if(r.status===405)r=await fetch(url,{method:'GET',redirect:'follow',signal:AbortSignal.timeout(10000),headers:{'User-Agent':cfg.seoUserAgent,Range:'bytes=0-0'}});return{url,status:r.status,pagesFor};}catch(e){return{url,status:0,error:String(e.message||e),pagesFor};}}));
    results.push(...checked);
  }
  for(const r of results)if(r.status===0||r.status>=400)for(const p of r.pagesFor)p.issues.push({level:'warn',code:'broken_resource',text:'Ressource nicht erreichbar ('+(r.status||'Netzwerkfehler')+'): '+r.url});
  return{checked:results.length,broken:results.filter(r=>r.status===0||r.status>=400).length};
}
async function runSeoAudit(runId,site,{maxPages=cfg.seoMaxPages,pageSpeed='homepage',pageSpeedMaxPages=10}={}){
  const configured=seoNormalizeUrl(site.monitor_url||('https://'+site.domain));if(!configured)throw new Error('Invalid site URL');const configuredUrl=new URL(configured),root=seoNormalizeUrl(configuredUrl.origin+'/'),rootUrl=new URL(root),rootHost=rootUrl.hostname,queue=[{url:root,depth:0}],queued=new Set([root]),crawled=new Set(),pages=[],links=[];
  const sitemap=await seoDiscoverSitemaps(root,Math.min(maxPages*3,1500)),sitemapSet=new Set(sitemap.pages),sitemapPending=sitemap.pages.filter(url=>url!==root);
  try{
    while((queue.length||sitemapPending.length)&&pages.length<maxPages){
      if(!queue.length){let candidate=null;while(sitemapPending.length&&!candidate){const next=sitemapPending.shift();if(!crawled.has(next)&&!queued.has(next))candidate=next;}if(!candidate)break;queued.add(candidate);queue.push({url:candidate,depth:null});}
      const item=queue.shift();queued.delete(item.url);if(crawled.has(item.url))continue;crawled.add(item.url);
      const page=await crawlSeoPage(item.url,rootHost,item.depth);pages.push(page);links.push(...page.links);
      for(const l of page.links){if(!l.internal||!seoCrawlableUrl(l.target,rootHost)||crawled.has(l.target))continue;const linkedDepth=item.depth==null?1:item.depth+1,existing=queue.find(x=>x.url===l.target);if(existing){if(existing.depth==null||linkedDepth<existing.depth)existing.depth=linkedDepth;continue;}if(pages.length+queue.length<maxPages){queued.add(l.target);queue.push({url:l.target,depth:linkedDepth});}}
    }
    const pageMap=new Map(pages.map(p=>[p.url,p])),urls=pages.map(p=>p.url),rank=calcPageRank(urls,links),incoming=new Map(urls.map(u=>[u,0]));
    for(const l of links)if(l.internal&&incoming.has(l.target))incoming.set(l.target,incoming.get(l.target)+1);
    const wdfidf=calcWdfIdf(pages),titleMap=new Map(),descMap=new Map(),h1Map=new Map(),contentMap=new Map();
    pages.forEach((p,i)=>{p.pagerank=rank.get(p.url)||0;p.incomingLinks=incoming.get(p.url)||0;p.internalLinks=p.links.filter(x=>x.internal).length;p.externalLinks=p.links.filter(x=>!x.internal).length;p.wdfidf=wdfidf[i];for(const [value,map] of [[p.title,titleMap],[p.metaDescription,descMap],[p.h1?.[0]||'',h1Map],[p.contentHash,contentMap]])if(value){if(!map.has(value))map.set(value,[]);map.get(value).push(p.url);}});
    for(const p of pages){
      if(p.depth==null&&p.url!==root&&p.incomingLinks===0)p.issues.push({level:'warn',code:'orphan_page',text:'In Sitemap gefunden, aber von keiner gecrawlten Seite intern verlinkt'});
      if(p.title&&(titleMap.get(p.title)?.length||0)>1)p.issues.push({level:'warn',code:'duplicate_title',text:'Title auf '+titleMap.get(p.title).length+' Seiten identisch'});
      if(p.metaDescription&&(descMap.get(p.metaDescription)?.length||0)>1)p.issues.push({level:'warn',code:'duplicate_description',text:'Meta Description mehrfach identisch'});
      if(p.h1?.[0]&&(h1Map.get(p.h1[0])?.length||0)>1)p.issues.push({level:'info',code:'duplicate_h1',text:'H1 auf '+h1Map.get(p.h1[0]).length+' Seiten identisch'});
      if(p.contentHash&&(contentMap.get(p.contentHash)?.length||0)>1)p.issues.push({level:'error',code:'duplicate_content',text:'Hauptinhalt auf '+contentMap.get(p.contentHash).length+' Seiten identisch'});
      if(p.canonical){try{if(new URL(p.canonical).hostname!==rootHost)p.issues.push({level:'warn',code:'canonical_external',text:'Canonical zeigt auf andere Domain'});else if(p.indexable&&p.canonical!==p.url)p.issues.push({level:'info',code:'canonical_to_other',text:'Indexierbare Seite canonicalisiert auf andere URL'});}catch{p.issues.push({level:'warn',code:'canonical_invalid',text:'Canonical ist ungültig'});}}
      if(sitemapSet.size&&p.indexable&&!sitemapSet.has(p.url)&&p.url!==root)p.issues.push({level:'info',code:'not_in_sitemap',text:'Indexierbare Seite fehlt in der Sitemap'});
      for(const l of p.links.filter(x=>x.internal)){const target=pageMap.get(l.target);if(!target)continue;if(target.statusCode>=400||target.statusCode===0)p.issues.push({level:'error',code:'broken_internal_link',text:'Interner Link auf HTTP '+target.statusCode+': '+l.target});else if(target.redirectCount>0)p.issues.push({level:'warn',code:'redirecting_internal_link',text:'Interner Link zeigt auf Redirect: '+l.target});}
      for(const h of p.hreflang||[]){if(!h.lang||(!/^x-default$/i.test(h.lang)&&!/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(h.lang)))p.issues.push({level:'warn',code:'hreflang_invalid',text:'Ungewöhnlicher hreflang-Wert: '+(h.lang||'(leer)')});}
    }
    for(let i=0;i<pages.length;i++)for(let j=i+1;j<pages.length;j++){const a=pages[i],b=pages[j];if(a.contentHash===b.contentHash||a.wordCount<200||b.wordCount<200)continue;const similarity=seoSimilarity(a.contentFingerprint,b.contentFingerprint);if(similarity>=.88){a.issues.push({level:'warn',code:'near_duplicate_content',text:'Sehr ähnlich zu '+b.url+' ('+Math.round(similarity*100)+'%)'});b.issues.push({level:'warn',code:'near_duplicate_content',text:'Sehr ähnlich zu '+a.url+' ('+Math.round(similarity*100)+'%)'});}}
    const resourceAudit=await seoAuditResources(pages,rootHost);
    const psiCandidates=pages.filter(p=>p.statusCode===200).slice(0,pageSpeed==='all'?Math.min(pageSpeedMaxPages,pages.length):pageSpeed==='homepage'?1:0);
    for(const p of psiCandidates){try{p.lighthouseMobile=await pageSpeedAudit(p.url,'mobile');p.lighthouseDesktop=await pageSpeedAudit(p.url,'desktop');}catch(e){p.issues.push({level:'warn',code:'pagespeed_error',text:String(e.message||e)});}}
    for(const p of pages){
      await q(`insert into seo_pages(run_id,site_id,url,path,status_code,response_ms,content_bytes,title,meta_description,canonical,robots,h1,h2,word_count,internal_links,external_links,incoming_links,depth,pagerank,issues,wdfidf,structured_data,images_total,images_missing_alt,lighthouse_mobile,lighthouse_desktop,final_url,redirect_count,lang,hreflang,social,security,accessibility,content_hash,content_fingerprint,indexable) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [runId,site.id,p.url,p.path,p.statusCode,p.responseMs,p.contentBytes,p.title,p.metaDescription,p.canonical,p.robots,JSON.stringify(p.h1),JSON.stringify(p.h2),p.wordCount,p.internalLinks,p.externalLinks,p.incomingLinks,p.depth,p.pagerank,JSON.stringify(p.issues),JSON.stringify(p.wdfidf),JSON.stringify(p.structuredData),p.imagesTotal,p.imagesMissingAlt,p.lighthouseMobile?JSON.stringify(p.lighthouseMobile):null,p.lighthouseDesktop?JSON.stringify(p.lighthouseDesktop):null,p.finalUrl,p.redirectCount,p.lang,JSON.stringify(p.hreflang),JSON.stringify(p.social),JSON.stringify(p.security),JSON.stringify(p.accessibility),p.contentHash,JSON.stringify(p.contentFingerprint),p.indexable?1:0]);
    }
    for(const l of links)await q('insert into seo_links(run_id,site_id,source_url,target_url,anchor_text,internal_link,nofollow) values(?,?,?,?,?,?,?)',[runId,site.id,l.source,l.target,l.anchor,l.internal,l.nofollow]);
    const allIssues=pages.flatMap(p=>(p.issues||[]).map(i=>({...i,url:p.url}))),count=code=>allIssues.filter(i=>i.code===code).length;
    const categories={technical:allIssues.filter(i=>['http_status','redirect_chain','canonical_missing','canonical_external','canonical_invalid','canonical_to_other','noindex','page_nofollow','not_in_sitemap','orphan_page'].includes(i.code)).length,content:allIssues.filter(i=>/title|description|h1|content|word|wdf|duplicate/.test(i.code)).length,links:allIssues.filter(i=>/link|crawl_depth/.test(i.code)).length,media:allIssues.filter(i=>/image|resource|mixed_content/.test(i.code)).length,accessibility:allIssues.filter(i=>/accessibility|html_lang/.test(i.code)).length,security:allIssues.filter(i=>/security|mixed_content/.test(i.code)).length,social:allIssues.filter(i=>/open_graph|twitter/.test(i.code)).length};
    const summary={healthScore:seoHealthScore(pages),pages:pages.length,indexablePages:pages.filter(p=>p.indexable).length,okPages:pages.filter(p=>p.statusCode===200).length,errorPages:pages.filter(p=>p.statusCode>=400||p.error).length,issues:{error:allIssues.filter(i=>i.level==='error').length,warn:allIssues.filter(i=>i.level==='warn').length,info:allIssues.filter(i=>i.level==='info').length},categories,brokenInternalLinks:count('broken_internal_link'),redirectingInternalLinks:count('redirecting_internal_link'),duplicateContent:count('duplicate_content'),nearDuplicateContent:count('near_duplicate_content'),brokenResources:resourceAudit.broken,resourcesChecked:resourceAudit.checked,avgResponseMs:pages.length?Math.round(pages.reduce((n,p)=>n+p.responseMs,0)/pages.length):0,avgWordCount:pages.length?Math.round(pages.reduce((n,p)=>n+p.wordCount,0)/pages.length):0,strongestPages:[...pages].sort((a,b)=>b.pagerank-a.pagerank).slice(0,10).map(p=>({url:p.url,title:p.title,pagerank:Number(p.pagerank.toFixed(6)),incomingLinks:p.incomingLinks})),pageSpeedEnabled:Boolean(cfg.pageSpeedApiKey),pageSpeedPages:psiCandidates.length,sitemapUrls:sitemap.sitemaps.length,sitemapPages:sitemap.pages.length,aiBots:seoAiBotAccess(sitemap.robotsTxt)};
    await q('update seo_runs set status=?,pages_crawled=?,summary=?,finished_at=now() where id=?',['completed',pages.length,JSON.stringify(summary),runId]);
  }catch(e){await q('update seo_runs set status=?,error=?,finished_at=now() where id=?',['failed',String(e.message||e).slice(0,10000),runId]);throw e;}
}
async function startSeoAudit(siteId,options={}){
  const site=await getSite(siteId),runId=crypto.randomUUID(),maxPages=Math.max(1,Math.min(500,Number(options.maxPages||cfg.seoMaxPages||100)));
  await q('insert into seo_runs(id,site_id,status,max_pages) values(?,?,?,?)',[runId,site.id,'running',maxPages]);
  setImmediate(()=>runSeoAudit(runId,site,{...options,maxPages}).catch(e=>console.error('seo audit',site.domain,e)));
  return{id:runId,status:'running',site:site.slug,maxPages,pageSpeed:options.pageSpeed||'homepage',pageSpeedConfigured:Boolean(cfg.pageSpeedApiKey)};
}
async function seoRunGet(runId){const run=(await q('select * from seo_runs where id=?',[runId])).rows[0];if(!run)throw new Error('SEO run not found');return run;}
async function seoLatest(siteId){const site=await getSite(siteId),run=(await q('select * from seo_runs where site_id=? order by started_at desc limit 1',[site.id])).rows[0]||null;if(!run)return{site:site.slug,run:null,pages:[]};const pages=(await q('select id,url,path,status_code,response_ms,content_bytes,title,meta_description,canonical,robots,h1,h2,word_count,internal_links,external_links,incoming_links,depth,pagerank,issues,wdfidf,images_total,images_missing_alt,lighthouse_mobile,lighthouse_desktop,final_url,redirect_count,lang,hreflang,social,security,accessibility,content_hash,indexable from seo_pages where run_id=? order by pagerank desc',[run.id])).rows;return{site:site.slug,run,pages};}
async function seoPageGet(pageId){const page=(await q('select * from seo_pages where id=?',[pageId])).rows[0];if(!page)throw new Error('SEO page not found');const links=(await q('select source_url,target_url,anchor_text,internal_link,nofollow from seo_links where run_id=? and source_url=?',[page.run_id,page.url])).rows;return{...page,links};}
async function seoGraph(siteId,limit=30){
  const site=await getSite(siteId),run=(await q("select * from seo_runs where site_id=? and status='completed' order by started_at desc limit 1",[site.id])).rows[0];
  if(!run)return{run:null,nodes:[],edges:[]};
  const nodes=(await q('select id,url,path,title,depth,pagerank,incoming_links,internal_links,status_code from seo_pages where run_id=? order by pagerank desc limit ?',[run.id,limit])).rows;
  const set=new Set(nodes.map(n=>n.url));
  const links=(await q('select source_url,target_url,anchor_text,nofollow from seo_links where run_id=? and internal_link=1',[run.id])).rows;
  const edges=links.filter(l=>set.has(l.source_url)&&set.has(l.target_url)).slice(0,300);
  return{run:{id:run.id,started_at:run.started_at,finished_at:run.finished_at},nodes,edges};
}
async function seoIssuesList(siteId,{level,limit=200}={}){
  const latest=await seoLatest(siteId);if(!latest.run)return{run:null,issues:[]};
  const issues=[];
  for(const p of latest.pages)for(const issue of (Array.isArray(p.issues)?p.issues:[]))if(!level||issue.level===level)issues.push({pageId:p.id,url:p.url,path:p.path,title:p.title,...issue});
  return{run:latest.run,issues:issues.slice(0,limit)};
}

async function seoCompare(siteId){
  const site=await getSite(siteId),runs=(await q("select * from seo_runs where site_id=? and status='completed' order by started_at desc limit 2",[site.id])).rows;
  if(runs.length<2)return{site:site.slug,current:runs[0]||null,previous:null,available:false,newIssues:[],resolvedIssues:[],changedPages:[],newPages:[],removedPages:[]};
  const [current,previous]=runs,[curPages,prevPages]=await Promise.all([(await q('select url,title,meta_description,canonical,status_code,issues from seo_pages where run_id=?',[current.id])).rows,(await q('select url,title,meta_description,canonical,status_code,issues from seo_pages where run_id=?',[previous.id])).rows]);
  const issueSet=pages=>new Map(pages.flatMap(p=>(Array.isArray(p.issues)?p.issues:[]).map(i=>[p.url+'|'+i.code,{url:p.url,...i}])));
  const curIssues=issueSet(curPages),prevIssues=issueSet(prevPages),newIssues=[...curIssues].filter(([k])=>!prevIssues.has(k)).map(([,v])=>v).slice(0,250),resolvedIssues=[...prevIssues].filter(([k])=>!curIssues.has(k)).map(([,v])=>v).slice(0,250);
  const cm=new Map(curPages.map(p=>[p.url,p])),pm=new Map(prevPages.map(p=>[p.url,p])),newPages=[...cm.keys()].filter(u=>!pm.has(u)),removedPages=[...pm.keys()].filter(u=>!cm.has(u)),changedPages=[];
  for(const [url,p] of cm){const old=pm.get(url);if(!old)continue;const changed={};for(const key of ['title','meta_description','canonical','status_code'])if((p[key]??null)!==(old[key]??null))changed[key]={before:old[key]??null,after:p[key]??null};if(Object.keys(changed).length)changedPages.push({url,changed});}
  const currentScore=Number(current.summary?.healthScore??0),previousScore=Number(previous.summary?.healthScore??0);
  return{site:site.slug,available:true,current:{id:current.id,startedAt:current.started_at,healthScore:currentScore},previous:{id:previous.id,startedAt:previous.started_at,healthScore:previousScore},scoreDelta:currentScore-previousScore,newIssues,resolvedIssues,changedPages:changedPages.slice(0,200),newPages:newPages.slice(0,200),removedPages:removedPages.slice(0,200)};
}
async function qualityOverview(siteId){
  const site=await getSite(siteId),latest=await seoLatest(site.id),compare=await seoCompare(site.id),checks=await listMonitorChecks(site.id,20),incidents=await listIncidents(site.id,20),backup=await backupStatus(site.id),last=checks[0]||null;
  const uptime=checks.length?Math.round(checks.filter(x=>x.ok).length/checks.length*10000)/100:null,seoScore=latest.run?.summary?.healthScore??null;
  return{site:{id:site.id,slug:site.slug,name:site.name,domain:site.domain,type:site.site_type},qualityScore:seoScore,seo:latest.run?{runId:latest.run.id,status:latest.run.status,startedAt:latest.run.started_at,summary:latest.run.summary}:null,regression:compare,operations:{uptime,lastCheck:last,openIncidents:incidents.filter(x=>x.status==='open').length,backup},synthetics:await syntheticStatus(site.id)};
}
async function clientReportPage(slug){
  const qv=await qualityOverview(slug),site=await getSite(slug),s=qv.seo?.summary||{},r=qv.regression||{},ops=qv.operations||{},score=s.healthScore??'–';
  const delta=r.available?(r.scoreDelta>0?'+':'')+r.scoreDelta:'–';
  let html='<a class="backlink" href="/sites/'+esc(site.slug)+'">← '+esc(site.name)+'</a><header><div><span class="eyebrow">QUALITY REPORT</span><h1>'+esc(site.name)+'</h1><p>'+esc(site.domain)+' · Bericht '+new Date().toLocaleDateString('de-DE')+'</p></div><div class="actions"><button onclick="window.print()">Drucken / PDF</button></div></header>';
  html+='<div class="metrics big seo-metrics"><span>'+score+'<em>Health Score</em></span><span>'+delta+'<em>vs. vorheriger Audit</em></span><span>'+(ops.uptime??'–')+'%<em>Uptime letzte Checks</em></span><span>'+(ops.openIncidents??0)+'<em>Offene Incidents</em></span><span>'+(s.pages??0)+'<em>Gecrawlte Seiten</em></span><span>'+(s.issues?.error??0)+'<em>SEO-Fehler</em></span></div>';
  html+='<div class="twocol ops-grid"><section><div class="sectionhead"><div><span class="eyebrow">SEO</span><h2>Technische Qualität</h2></div></div><dl class="facts compact-facts"><div><dt>Indexierbare Seiten</dt><dd>'+(s.indexablePages??'–')+'</dd></div><div><dt>Defekte interne Links</dt><dd>'+(s.brokenInternalLinks??0)+'</dd></div><div><dt>Redirect-Links</dt><dd>'+(s.redirectingInternalLinks??0)+'</dd></div><div><dt>Duplicate Content</dt><dd>'+(s.duplicateContent??0)+'</dd></div><div><dt>Near-Duplicates</dt><dd>'+(s.nearDuplicateContent??0)+'</dd></div><div><dt>Defekte Ressourcen</dt><dd>'+(s.brokenResources??0)+'</dd></div></dl></section><section><div class="sectionhead"><div><span class="eyebrow">Betrieb</span><h2>Website Care</h2></div></div><dl class="facts compact-facts"><div><dt>Letzter HTTP-Status</dt><dd>'+(ops.lastCheck?.http_status??'–')+'</dd></div><div><dt>Response</dt><dd>'+(ops.lastCheck?.response_ms??'–')+' ms</dd></div><div><dt>SSL Restlaufzeit</dt><dd>'+(ops.lastCheck?.ssl_days??'–')+' Tage</dd></div><div><dt>Domain Restlaufzeit</dt><dd>'+esc(ops.lastCheck?.details?.domainExpiryDays??'–')+' Tage</dd></div><div><dt>Backup zuletzt</dt><dd>'+esc(ops.backup?.last?.created_at?new Date(ops.backup.last.created_at).toLocaleString('de-DE'):'–')+'</dd></div></dl></section></div>';
  if(r.available)html+='<section><div class="sectionhead"><div><span class="eyebrow">Regression</span><h2>Seit dem letzten Audit</h2></div></div><div class="metrics"><span>'+r.newIssues.length+'<em>Neue Issues</em></span><span>'+r.resolvedIssues.length+'<em>Gelöste Issues</em></span><span>'+r.changedPages.length+'<em>Meta-/Status-Änderungen</em></span><span>'+r.newPages.length+'<em>Neue Seiten</em></span><span>'+r.removedPages.length+'<em>Entfernte Seiten</em></span></div></section>';
  return page('Report · '+site.name,html);
}


const toolText=value=>({content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value,null,2)}]});
function mcpServer(){
  const s=new McpServer({name:'lorzen-siteops',version:'1.0.0'});
  s.registerTool('sites_list',{description:'List managed websites with deployment and monitor mode. Never returns credentials.',inputSchema:z.object({})},async()=>toolText((await listSites()).map(x=>({id:x.id,slug:x.slug,name:x.name,domain:x.domain,site_type:x.site_type,deployment_mode:x.deployment_mode,protocol:x.deployment_mode==='hostinger_git'?null:x.protocol,monitor_enabled:Boolean(x.monitor_enabled),backup_enabled:Boolean(x.backup_enabled)}))));
  s.registerTool('site_get',{description:'Get redacted SiteOps configuration for one website. Secrets are represented only as configured/not configured.',inputSchema:z.object({site:z.string()})},async({site})=>toolText(publicSite(await getSite(site))));
  s.registerTool('site_overview',{description:'Get the main operational picture for a website in one call: redacted config, deployment, latest monitor state, open incidents and backup state.',inputSchema:z.object({site:z.string()})},async({site})=>toolText(await siteOverview(site)));
  s.registerTool('site_status',{description:'Run an immediate detailed health check including HTTP, redirects, DNS, SSL, title/content and optional WordPress REST check.',inputSchema:z.object({site:z.string()})},async({site})=>toolText(await checkSiteNow(await getSite(site))));
  s.registerTool('site_update',{description:'Update non-secret site operations settings. Does not alter connection credentials.',inputSchema:z.object({
    site:z.string(),name:z.string().min(1).optional(),domain:z.string().min(1).optional(),enabled:z.boolean().optional(),
    backup_enabled:z.boolean().optional(),backup_interval_seconds:z.number().int().min(900).max(2592000).optional(),backup_max_files:z.number().int().min(100).max(200000).optional(),
    monitor_enabled:z.boolean().optional(),monitor_url:z.string().url().optional(),monitor_interval_seconds:z.number().int().min(30).max(86400).optional(),
    monitor_expected_status:z.number().int().min(100).max(599).optional(),monitor_content:z.string().nullable().optional(),monitor_expected_title:z.string().nullable().optional(),
    monitor_check_dns:z.boolean().optional(),monitor_check_wordpress:z.boolean().optional(),monitor_timeout_ms:z.number().int().min(1000).max(60000).optional(),
    monitor_failure_threshold:z.number().int().min(1).max(20).optional(),alert_repeat_minutes:z.number().int().min(1).max(1440).optional(),
    response_warn_ms:z.number().int().min(1).max(60000).nullable().optional(),ssl_warn_days:z.number().int().min(1).max(365).optional(),exclude_patterns:z.array(z.string()).optional()
  })},async args=>{const {site,...changes}=args;return toolText(publicSite(await updateSite(site,changes)));});
  s.registerTool('site_connection_test',{description:'Test the currently stored webspace or Git deployment connection without changing configuration.',inputSchema:z.object({site:z.string()})},async({site})=>toolText(await testStoredConnection(await getSite(site))));
  s.registerTool('site_connection_update',{description:'Test and then save connection/deployment settings. Blank secret fields preserve existing secrets. Secrets are never returned.',inputSchema:z.object({
    site:z.string(),deploymentMode:z.enum(['webspace','hostinger_git']),
    protocol:z.enum(['sftp','ftps','ftp']).optional(),host:z.string().optional(),port:z.number().int().min(1).max(65535).optional(),username:z.string().optional(),password:z.string().optional(),privateKey:z.string().optional(),passphrase:z.string().optional(),remoteRoot:z.string().optional(),
    sourceRepository:z.string().optional(),sourceBranch:z.string().optional(),sourceRoot:z.string().optional(),gitToken:z.string().optional(),hostingerTargetDirectory:z.string().optional()
  })},async args=>{const {site,...changes}=args;return toolText(publicSite(await updateSiteConnection(site,changes)));});
  s.registerTool('deployment_info',{description:'Show current deployment mode and source state, including Git branch HEAD when available.',inputSchema:z.object({site:z.string()})},async({site})=>toolText(await deploymentInfo(site)));
  s.registerTool('monitor_history',{description:'List recent monitoring checks with detailed check results.',inputSchema:z.object({site:z.string(),limit:z.number().int().min(1).max(200).default(50)})},async({site,limit})=>toolText(await listMonitorChecks(site,limit)));
  s.registerTool('incidents_list',{description:'List recent incidents for a website.',inputSchema:z.object({site:z.string(),limit:z.number().int().min(1).max(100).default(30)})},async({site,limit})=>toolText(await listIncidents(site,limit)));
  s.registerTool('incident_get',{description:'Get an incident and its full event/alert/recovery timeline.',inputSchema:z.object({incident_id:z.string().uuid()})},async({incident_id})=>toolText(await getIncident(incident_id)));
  s.registerTool('files_list',{description:'List files/directories in the current source of truth. For Hostinger Git sites this is the source repository; otherwise the live webspace.',inputSchema:z.object({site:z.string(),path:z.string().default('')})},async({site,path})=>toolText(await listRemote(site,path)));
  s.registerTool('files_find',{description:'Recursively find files/directories by path/name substring, bounded by a result limit.',inputSchema:z.object({site:z.string(),query:z.string().min(1),limit:z.number().int().min(1).max(200).default(100)})},async({site,query,limit})=>toolText(await findFiles(site,query,limit)));
  s.registerTool('text_search',{description:'Search bounded text file contents in the current source of truth. Binary and large files are skipped.',inputSchema:z.object({site:z.string(),query:z.string().min(1),max_files:z.number().int().min(1).max(200).default(50),max_bytes:z.number().int().min(1024).max(2097152).default(524288)})},async({site,query,max_files,max_bytes})=>toolText(await searchText(site,query,{maxFiles:max_files,maxBytes:max_bytes})));
  s.registerTool('file_read',{description:'Read a text file from the current source of truth.',inputSchema:z.object({site:z.string(),path:z.string()})},async({site,path})=>toolText(await readRemoteText(site,path)));
  s.registerTool('change_preview',{description:'Prepare safe file changes. content=null deletes. No production/source write yet.',inputSchema:z.object({site:z.string(),description:z.string().min(3),files:z.array(z.object({path:z.string(),content:z.string().nullable()})).min(1)})},async({site,description,files})=>toolText(await createPreview(site,files,description)));
  s.registerTool('change_apply',{description:'Apply an approved preview with pre/post snapshots and health check. Git-deployed sites commit to their deployment branch.',inputSchema:z.object({preview_id:z.string().uuid()})},async({preview_id})=>toolText(await applyPreview(preview_id)));
  s.registerTool('history_list',{description:'List recent recorded changes.',inputSchema:z.object({site:z.string(),limit:z.number().int().min(1).max(100).default(30)})},async({site,limit})=>toolText(await listHistory(site,limit)));
  s.registerTool('history_diff',{description:'Get Git diff for a recorded SiteOps change.',inputSchema:z.object({change_id:z.string().uuid()})},async({change_id})=>toolText(await changeDiff(change_id)));
  s.registerTool('rollback_preview',{description:'Prepare rollback of a recorded change; does not write until change_apply.',inputSchema:z.object({change_id:z.string().uuid()})},async({change_id})=>toolText(await rollbackPreview(change_id)));
  s.registerTool('site_backup',{description:'Create a full Git-backed SiteOps snapshot from the current source of truth.',inputSchema:z.object({site:z.string()})},async({site})=>toolText(await fullBackup(await getSite(site))));
  s.registerTool('backup_status',{description:'Get scheduled backup state and the latest backup.',inputSchema:z.object({site:z.string()})},async({site})=>toolText(await backupStatus(site)));
  s.registerTool('backups_list',{description:'List full backups.',inputSchema:z.object({site:z.string(),limit:z.number().int().min(1).max(100).default(30)})},async({site,limit})=>toolText(await listBackups(await getSite(site),limit)));
  s.registerTool('backup_restore_preview',{description:'Create a safe restore preview from a full backup. A fresh safety backup is created first.',inputSchema:z.object({backup_id:z.string().uuid()})},async({backup_id})=>toolText(await backupRestorePreview(backup_id)));
  s.registerTool('seo_start',{description:'Start an asynchronous SEO crawl. Includes on-page checks, internal link graph, PageRank-style link strength and site-corpus WDF-IDF. Optional PageSpeed/Lighthouse requires a configured API key.',inputSchema:z.object({site:z.string(),max_pages:z.number().int().min(1).max(500).optional(),page_speed:z.enum(['none','homepage','all']).default('homepage'),page_speed_max_pages:z.number().int().min(1).max(50).default(10)})},async({site,max_pages,page_speed,page_speed_max_pages})=>toolText(await startSeoAudit(site,{maxPages:max_pages,pageSpeed:page_speed,pageSpeedMaxPages:page_speed_max_pages})));
  s.registerTool('seo_run_status',{description:'Get status and summary of an SEO audit run.',inputSchema:z.object({run_id:z.string().uuid()})},async({run_id})=>toolText(await seoRunGet(run_id)));
  s.registerTool('seo_latest',{description:'Get the latest SEO audit and page-level metrics for a website.',inputSchema:z.object({site:z.string()})},async({site})=>toolText(await seoLatest(site)));
  s.registerTool('seo_page',{description:'Get full SEO details, WDF-IDF terms, Lighthouse values and outgoing links for one crawled page.',inputSchema:z.object({page_id:z.number().int().positive()})},async({page_id})=>toolText(await seoPageGet(page_id)));
  s.registerTool('seo_graph',{description:'Get strongest pages and internal links from the latest completed crawl for graphing/site-structure analysis.',inputSchema:z.object({site:z.string(),limit:z.number().int().min(5).max(100).default(30)})},async({site,limit})=>toolText(await seoGraph(site,limit)));
  s.registerTool('seo_issues',{description:'List SEO issues from the latest crawl, optionally filtered by severity.',inputSchema:z.object({site:z.string(),level:z.enum(['error','warn','info']).optional(),limit:z.number().int().min(1).max(500).default(200)})},async({site,level,limit})=>toolText(await seoIssuesList(site,{level,limit})));s.registerTool('seo_compare',{description:'Compare the two latest completed SEO audits and return score delta, new/resolved issues, page changes and URL additions/removals.',inputSchema:z.object({site:z.string()})},async({site})=>toolText(await seoCompare(site)));s.registerTool('quality_overview',{description:'Return a combined SiteOps quality view with SEO health, regression, uptime, incidents and backup state.',inputSchema:z.object({site:z.string()})},async({site})=>toolText(await qualityOverview(site)));
  s.registerTool('synthetics_list',{description:'List synthetic browser journeys for a managed website with latest run state. Secrets and screenshot bytes are never returned.',inputSchema:z.object({site:z.string()})},async({site})=>toolText(await syntheticTestsList(site)));
  s.registerTool('synthetic_create',{description:'Create a scheduled Playwright journey. Use {{secret.NAME}} placeholders in fill values and pass the secret map separately.',inputSchema:z.object({site:z.string(),name:z.string().min(1),start_url:z.string().url().optional(),steps:z.array(z.any()),secrets:z.record(z.string(),z.string()).optional(),interval_seconds:z.number().int().min(300).max(2592000).default(3600),timeout_ms:z.number().int().min(3000).max(120000).default(30000),viewport_width:z.number().int().min(320).max(2560).default(1440),viewport_height:z.number().int().min(320).max(2000).default(1000),visual_enabled:z.boolean().default(false),visual_threshold:z.number().min(0).max(1).default(.01)})},async x=>toolText(await syntheticCreate(x.site,{name:x.name,startUrl:x.start_url,steps:x.steps,secrets:x.secrets,intervalSeconds:x.interval_seconds,timeoutMs:x.timeout_ms,viewportWidth:x.viewport_width,viewportHeight:x.viewport_height,visualEnabled:x.visual_enabled,visualThreshold:x.visual_threshold})));
  s.registerTool('synthetic_update',{description:'Update a synthetic journey. Omitted secrets stay unchanged; clear_secrets removes them.',inputSchema:z.object({test_id:z.string().uuid(),name:z.string().min(1).optional(),enabled:z.boolean().optional(),start_url:z.string().url().optional(),steps:z.array(z.any()).optional(),secrets:z.record(z.string(),z.string()).optional(),clear_secrets:z.boolean().optional(),interval_seconds:z.number().int().min(300).max(2592000).optional(),timeout_ms:z.number().int().min(3000).max(120000).optional(),viewport_width:z.number().int().min(320).max(2560).optional(),viewport_height:z.number().int().min(320).max(2000).optional(),visual_enabled:z.boolean().optional(),visual_threshold:z.number().min(0).max(1).optional()})},async x=>{const {test_id,...v}=x;return toolText(await syntheticUpdate(test_id,{name:v.name,enabled:v.enabled,startUrl:v.start_url,steps:v.steps,secrets:v.secrets,clearSecrets:v.clear_secrets,intervalSeconds:v.interval_seconds,timeoutMs:v.timeout_ms,viewportWidth:v.viewport_width,viewportHeight:v.viewport_height,visualEnabled:v.visual_enabled,visualThreshold:v.visual_threshold}));});
  s.registerTool('synthetic_run',{description:'Run a synthetic browser journey now. save_baseline stores the successful screenshot as the visual baseline.',inputSchema:z.object({test_id:z.string().uuid(),save_baseline:z.boolean().default(false)})},async({test_id,save_baseline})=>toolText(await runSyntheticTest(test_id,{saveBaseline:save_baseline,actor:'mcp'})));
  s.registerTool('synthetic_run_get',{description:'Get one synthetic run result without screenshot bytes.',inputSchema:z.object({run_id:z.string().uuid()})},async({run_id})=>toolText(await syntheticRunGet(run_id)));
  s.registerTool('fix_prompt',{description:'Generate a ready-to-copy repair prompt for ChatGPT/Claude from a SiteOps finding. The prompt instructs the agent to diagnose with MCP and create a preview without applying it.',inputSchema:z.object({kind:z.enum(['seo_page','seo_site','incident','synthetic']),site:z.string().optional(),id:z.union([z.string(),z.number()]).optional(),issue_code:z.string().optional()})},async({kind,site,id,issue_code})=>toolText(await buildFixPrompt({kind,site,id,issueCode:issue_code})));
  s.registerTool('settings_get',{description:'Get redacted global SiteOps settings. Secrets are never returned.',inputSchema:z.object({})},async()=>toolText(publicSettings()));
  return s;
}

function dashboardAuth(req,reply){if(!cfg.dashboardUser||!cfg.dashboardPassword){reply.code(503).send('SiteOps dashboard authentication is not configured');return false;}const h=req.headers.authorization||'';if(!h.startsWith('Basic ')){reply.header('WWW-Authenticate','Basic realm="SiteOps"');reply.code(401).send('Authentication required');return false;}const decoded=Buffer.from(h.slice(6),'base64').toString(),i=decoded.indexOf(':'),u=i>=0?decoded.slice(0,i):'',p=i>=0?decoded.slice(i+1):'';if(!safeEqual(u,cfg.dashboardUser)||!safeEqual(p,cfg.dashboardPassword)){reply.header('WWW-Authenticate','Basic realm="SiteOps"');reply.code(401).send('Authentication required');return false;}return true;}
function mcpAuth(req,reply){if(!cfg.mcpToken){reply.code(503).send({error:'MCP_API_TOKEN is not configured'});return false;}const h=req.headers.authorization||'',t=h.startsWith('Bearer ')?h.slice(7):'';if(!safeEqual(t,cfg.mcpToken)){reply.code(401).send({error:'unauthorized'});return false;}return true;}
function page(title,body){return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · SiteOps</title><link rel="stylesheet" href="/assets/app.css?v=1.0.0"></head><body><nav class="topnav"><div class="navinner"><a class="brand" href="/">SiteOps</a><div class="navlinks"><a href="/">Übersicht</a><a href="/setup">Website hinzufügen</a><a href="/mcp-info">MCP</a><a href="/settings">Einstellungen</a></div></div></nav><main>${body}</main><script>
async function siteOpsCopyPrompt(payload,button){
  const old=button?.textContent||'Prompt';
  try{
    if(button)button.textContent='Erzeuge…';
    const r=await fetch('/api/fix-prompt',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}),x=await r.json();
    if(!r.ok)throw new Error(x.message||x.error||JSON.stringify(x));
    try{await navigator.clipboard.writeText(x.prompt);}catch{const ta=document.createElement('textarea');ta.value=x.prompt;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();}
    if(button){button.textContent='✓ Prompt kopiert';setTimeout(()=>button.textContent=old,1800);}
  }catch(e){if(button)button.textContent='✗ '+String(e.message||e).slice(0,80);}
}
</script></body></html>`;}

function mcpInfoPage(){
  const base=String(cfg.publicBaseUrl||'https://siteops.lorzen.cloud').replace(/\/$/,'');
  const endpoint=base+'/mcp',health=base+'/health';
  const groups=[
    ['Kontext','sites_list, site_get, site_overview, deployment_info, settings_get'],
    ['Monitoring','site_status, monitor_history, incidents_list, incident_get'],
    ['SEO & Quality','seo_start, seo_run_status, seo_latest, seo_page, seo_graph, seo_issues, seo_compare, quality_overview'],
    ['Browser Tests','synthetics_list, synthetic_create, synthetic_update, synthetic_run, synthetic_run_get, fix_prompt'],
    ['Konfiguration','site_update, site_connection_test, site_connection_update'],
    ['Dateien','files_list, files_find, text_search, file_read'],
    ['Änderungen','change_preview, change_apply, history_list, history_diff, rollback_preview'],
    ['Backups','site_backup, backup_status, backups_list, backup_restore_preview']
  ];
  let tools='';for(const g of groups)tools+='<div class="tool-card"><strong>'+esc(g[0])+'</strong><p>'+g[1].split(', ').map(t=>'<code>'+esc(t)+'</code>').join(' ')+'</p></div>';
  const ps='$bytes = New-Object byte[] 32\n$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()\n$rng.GetBytes($bytes)\n($bytes | ForEach-Object { $_.ToString("x2") }) -join ""';
  const claude='mcp_servers: [{\n  type: "url",\n  url: "'+endpoint+'",\n  name: "siteops",\n  authorization_token: "DEIN_MCP_API_TOKEN"\n}]';
  let html='<header><div><span class="eyebrow">AI / AUTOMATION</span><h1>MCP einrichten</h1><p>SiteOps als Remote-MCP für Website-Betrieb, Backups, SEO, Monitoring und freigegebene Änderungen.</p></div><span class="pill '+(cfg.mcpToken?'ok':'bad')+'">'+(cfg.mcpToken?'AUTH KONFIGURIERT':'TOKEN FEHLT')+'</span></header>';
  html+='<div class="metrics big mcp-metrics"><span>Streamable HTTP<em>Transport</em></span><span>'+(cfg.mcpToken?'aktiv':'fehlt')+'<em>Bearer Auth</em></span><span>'+groups.reduce((n,g)=>n+g[1].split(', ').length,0)+'<em>Tools</em></span><span>1.0.0<em>SiteOps MCP</em></span></div>';
  html+='<section><div class="sectionhead"><div><span class="eyebrow">1 · SiteOps</span><h2>Server vorbereiten</h2></div></div><ol class="setup-steps"><li><strong>MCP_API_TOKEN in Hostinger setzen.</strong><span>Environment Variable der Node.js-App. Der Wert sollte lang und zufällig sein.</span></li><li><strong>PUBLIC_BASE_URL prüfen.</strong><span>Bei dir: <code>'+esc(base)+'</code></span></li><li><strong>Neu deployen.</strong><span>Danach muss <code>'+esc(health)+'</code> bei <code>missingConfig</code> keinen MCP_API_TOKEN mehr melden.</span></li><li><strong>MCP-Endpunkt verwenden.</strong><span><code>'+esc(endpoint)+'</code></span></li></ol><h3>Token unter Windows erzeugen</h3><pre class="codeblock"><code>'+esc(ps)+'</code></pre><div class="notice"><strong>Token nicht in Git speichern.</strong><span>Der MCP_API_TOKEN bleibt als Hostinger-Environment-Variable. SiteOps zeigt ihn absichtlich nirgendwo wieder an.</span></div></section>';
  html+='<section><div class="sectionhead"><div><span class="eyebrow">2 · Test</span><h2>MCP Inspector</h2></div></div><ol class="setup-steps"><li><strong>Inspector starten:</strong><span><code>npx @modelcontextprotocol/inspector</code></span></li><li><strong>Transport wählen:</strong><span>Streamable HTTP</span></li><li><strong>URL:</strong><span><code>'+esc(endpoint)+'</code></span></li><li><strong>Authorization Header:</strong><span><code>Bearer DEIN_MCP_API_TOKEN</code></span></li><li><strong>Verbinden und Tools prüfen.</strong><span>Mindestens <code>sites_list</code>, <code>site_overview</code>, <code>change_preview</code>, <code>seo_start</code> und <code>site_backup</code> sollten sichtbar sein.</span></li></ol></section>';
  html+='<div class="twocol ops-grid"><section><div class="sectionhead"><div><span class="eyebrow">3 · ChatGPT</span><h2>Custom MCP App</h2></div></div><ol class="setup-steps"><li>Entwicklermodus für Custom Apps/MCP aktivieren.</li><li>Unter <strong>Apps → Create</strong> eine neue App anlegen.</li><li>Remote-Endpunkt <code>'+esc(endpoint)+'</code> eintragen.</li><li>Authentifizierung auswählen und anschließend <strong>Scan Tools</strong> ausführen.</li><li>Die App als Draft testen und bei Schreibaktionen die Freigabe kontrollieren.</li></ol><div class="callout"><strong>Aktueller ChatGPT-Stand:</strong> Vollständige MCP-Schreib-/Änderungsaktionen werden derzeit für Business, Enterprise und Edu bereitgestellt; Pro kann Custom MCP im Entwicklermodus für Read/Fetch nutzen. Die genaue UI kann sich ändern.</div><div class="notice"><strong>Bearer-Hinweis</strong><span>SiteOps nutzt derzeit statischen Bearer-Token. Falls die ChatGPT-App-Erstellung in deinem Workspace dafür keine passende Auth-Option anbietet, ist für die native Verbindung ein OAuth-Flow die nächste SiteOps-Ausbaustufe.</span></div></section>';
  html+='<section><div class="sectionhead"><div><span class="eyebrow">4 · Claude</span><h2>Remote MCP</h2></div></div><p class="lead">Claude unterstützt Remote-MCP-Konnektoren. In Claude Web/Desktop werden Custom Connectors unter <strong>Customize → Connectors → Add custom connector</strong> angelegt. Für API-Nutzung kann der SiteOps-Bearer-Token direkt als <code>authorization_token</code> übergeben werden.</p><pre class="codeblock"><code>'+esc(claude)+'</code></pre><div class="notice"><strong>Claude Web/Auth</strong><span>Die native Connector-Oberfläche ist auf OAuth-orientierte Authentifizierung ausgelegt. Für den aktuellen statischen SiteOps-Bearer ist die Claude-API-Konfiguration eindeutig unterstützt; für die Web-Verbindung ist OAuth die sauberste nächste Ausbaustufe.</span></div></section></div>';
  html+='<section><div class="sectionhead"><div><span class="eyebrow">5 · Workflow</span><h2>So soll ein Agent mit SiteOps arbeiten</h2></div></div><ol class="workflow"><li><code>site_overview</code> für Status und Kontext</li><li><code>files_find</code> / <code>text_search</code> zur Orientierung</li><li><code>file_read</code> für relevante Dateien</li><li><code>change_preview</code> für den Änderungsvorschlag</li><li>Freigabe durch den Nutzer</li><li><code>change_apply</code> für die Ausführung</li><li><code>site_status</code> für die Nachkontrolle</li><li>Bei SEO: <code>seo_start</code> → <code>seo_latest</code> → <code>seo_page</code></li></ol></section>';
  html+='<section><div class="sectionhead"><div><span class="eyebrow">Tools</span><h2>Verfügbare Bereiche</h2></div></div><div class="tool-grid">'+tools+'</div></section>';
  html+='<div class="notice"><strong>Sicherheitsmodell</strong><span>Secrets werden nie über MCP zurückgegeben. Dateiänderungen bleiben zweistufig: Preview zuerst, Apply erst nach Freigabe. Verbindungsänderungen werden vor dem Speichern getestet. Backups und Rollbacks bleiben nachvollziehbar versioniert.</span></div>';
  return page('MCP einrichten',html);
}
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

      <section class="form-card"><div class="sectionhead"><div><span class="eyebrow">SEO / Lighthouse</span><h2>SEO-Audits</h2></div><span class="pill ${s.pageSpeedApiKeyConfigured?'ok':''}">${s.pageSpeedApiKeyConfigured?'PAGESPEED AKTIV':'OHNE PAGESPEED'}</span></div>
        <p class="lead">Der normale SEO-Crawl funktioniert ohne externe API. Für echte Lighthouse-/PageSpeed-Werte kann optional ein Google PageSpeed Insights API-Key hinterlegt werden.</p>
        <div class="formgrid">
          <label>Standard: maximale Seiten pro Crawl <small>Schützt große Websites vor sehr langen Crawls. Pro Lauf kann der Wert angepasst werden.</small><input name="seoMaxPages" type="number" min="1" max="500" value="${s.seoMaxPages||100}"></label>
          <label class="span2">Google PageSpeed Insights API-Key <small>${s.pageSpeedApiKeyConfigured?'API-Key gespeichert – leer lassen für unverändert.':'Optional. Benötigt für Lighthouse Performance, Accessibility, Best Practices und SEO.'}</small><input name="pageSpeedApiKey" type="password" autocomplete="new-password" placeholder="${s.pageSpeedApiKeyConfigured?'API-Key bereits gespeichert':'AIza…'}"></label>
          <label class="span2">Öffentliche Test-URL <small>Muss ohne Login öffentlich als HTML erreichbar sein. SiteOps selbst ist wegen Basic Auth kein geeignetes Testziel.</small><input name="pageSpeedTestUrl" type="url" value="https://example.com/" placeholder="https://deine-website.de/"></label>
        </div>
        <div class="buttonrow"><button type="button" class="ghost" id="testPageSpeed">PageSpeed API testen</button><span class="inline-status" id="pageSpeedStatus"></span></div>
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
        smtpPassword:fd.get('smtpPassword'),smtpFrom:fd.get('smtpFrom').trim(),
        seoMaxPages:Number(fd.get('seoMaxPages')),pageSpeedApiKey:fd.get('pageSpeedApiKey')
      };
    }
    form.onsubmit=async e=>{e.preventDefault();configStatus.textContent='Speichere…';const r=await fetch('/api/settings',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(payload())});const x=await r.json();configStatus.textContent=r.ok?'Gespeichert.':'Fehler: '+(x.message||x.error||JSON.stringify(x));if(r.ok)setTimeout(()=>location.reload(),500);};
    testGitHub.onclick=async()=>{githubStatus.textContent='Prüfe…';const p=payload();const r=await fetch('/api/settings/github-test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({githubBackupRepo:p.githubBackupRepo,githubBackupToken:p.githubBackupToken,backupBranch:p.backupBranch})}),x=await r.json();githubStatus.textContent=r.ok?'✓ '+x.repository+' erreichbar und privat':'✗ '+(x.message||x.error||JSON.stringify(x));};
    testAlert.onclick=async()=>{alertStatus.textContent='Sende…';const r=await fetch('/api/settings/alert-test',{method:'POST'}),x=await r.json();alertStatus.textContent=r.ok?'✓ Test ausgelöst':'✗ '+(x.message||x.error||JSON.stringify(x));};
    testPageSpeed.onclick=async()=>{pageSpeedStatus.textContent='Prüfe…';const p=payload(),url=String(form.elements.namedItem('pageSpeedTestUrl')?.value||'').trim();const r=await fetch('/api/settings/pagespeed-test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pageSpeedApiKey:p.pageSpeedApiKey,url})}),x=await r.json();pageSpeedStatus.textContent=r.ok?'✓ '+x.url+' · Performance '+(x.result?.scores?.performance??'–')+' · SEO '+(x.result?.scores?.seo??'–'):'✗ '+(x.message||x.error||JSON.stringify(x));};
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

function seoScoreValue(value){return value==null?'–':Math.round(Number(value));}
function seoMetricMs(value){return value==null?'–':Math.round(Number(value))+' ms';}
function seoGraphSvg(graph){
  const nodes=(graph.nodes||[]).slice(0,24);
  if(!nodes.length)return '<div class="empty-state">Noch keine Linkdaten.</div>';
  const nodeSet=new Set(nodes.map(n=>n.url));
  const depths=[...new Set(nodes.map(n=>n.depth==null?'Sitemap':String(Math.min(5,n.depth))))];
  depths.sort((a,b)=>a==='Sitemap'?1:b==='Sitemap'?-1:Number(a)-Number(b));
  const width=1120,height=520,padX=80,padY=52,colGap=depths.length>1?(width-padX*2)/(depths.length-1):0,pos=new Map();
  for(let di=0;di<depths.length;di++){
    const d=depths[di],group=nodes.filter(n=>(n.depth==null?'Sitemap':String(Math.min(5,n.depth)))===d),gap=(height-padY*2)/(group.length+1);
    group.forEach((n,i)=>pos.set(n.url,{x:padX+di*colGap,y:padY+(i+1)*gap}));
  }
  const maxRank=Math.max(...nodes.map(n=>Number(n.pagerank||0)),0.000001);
  let svg='<div class="seo-graph-wrap"><svg class="seo-graph" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Interne Seitenstruktur">';
  depths.forEach((d,i)=>svg+='<text class="seo-depth-label" x="'+(padX+i*colGap)+'" y="24" text-anchor="middle">'+esc(d==='Sitemap'?'Sitemap / nicht erreicht':'Tiefe '+d)+'</text>');
  for(const e of (graph.edges||[]).filter(e=>nodeSet.has(e.source_url)&&nodeSet.has(e.target_url)).slice(0,220)){
    const a=pos.get(e.source_url),b=pos.get(e.target_url);if(a&&b)svg+='<line x1="'+a.x+'" y1="'+a.y+'" x2="'+b.x+'" y2="'+b.y+'" class="seo-edge"/>';
  }
  for(const n of nodes){
    const p=pos.get(n.url),strength=Math.max(0,Number(n.pagerank||0)/maxRank),r=8+Math.sqrt(strength)*15,label=String(n.title||n.path||n.url).replace(/\s+/g,' ').slice(0,28);
    svg+='<g class="seo-node"><a href="/seo/pages/'+n.id+'"><circle cx="'+p.x+'" cy="'+p.y+'" r="'+r.toFixed(1)+'"/><text x="'+p.x+'" y="'+(p.y+r+15)+'" text-anchor="middle">'+esc(label)+'</text><title>'+esc(n.url)+' · Stärke '+(strength*100).toFixed(1)+'%</title></a></g>';
  }
  return svg+'</svg></div>';
}
async function seoDashboardPage(slug){
  const site=await getSite(slug),latest=await seoLatest(site.id),graph=await seoGraph(site.id,24),run=latest.run,summary=run?.summary||{},pages=latest.pages||[];
  const statusClass=run?.status==='completed'?'ok':run?.status==='failed'?'bad':'',statusLabel=run?String(run.status).toUpperCase():'NO DATA';
  const top=pages.slice().sort((a,b)=>Number(b.pagerank||0)-Number(a.pagerank||0)).slice(0,10),maxRank=Math.max(...top.map(p=>Number(p.pagerank||0)),0.000001);
  let strength='';
  top.forEach((p,i)=>{strength+='<a class="strength-row" href="/seo/pages/'+p.id+'"><span class="strength-rank">'+(i+1)+'</span><span class="strength-label"><strong>'+esc(p.title||p.path)+'</strong><small>'+esc(p.path)+'</small></span><span class="strength-bar"><i style="width:'+Math.max(3,Number(p.pagerank||0)/maxRank*100).toFixed(1)+'%"></i></span><span class="strength-num">'+(p.incoming_links||0)+' in</span></a>';});
  if(!strength)strength='<div class="empty-state">Noch keine Daten.</div>';
  let rows='';
  for(const p of pages){
    const issues=Array.isArray(p.issues)?p.issues:[],err=issues.filter(x=>x.level==='error').length,warn=issues.filter(x=>x.level==='warn').length,mob=p.lighthouse_mobile||{};
    rows+='<tr><td><a href="/seo/pages/'+p.id+'"><strong>'+esc(p.title||'(ohne Title)')+'</strong><small class="table-sub">'+esc(p.path)+'</small></a></td><td><span class="pill '+(p.status_code===200?'ok':'bad')+'">'+(p.status_code??'–')+'</span></td><td>'+(p.depth??'Sitemap')+'</td><td>'+p.incoming_links+'</td><td>'+p.internal_links+'</td><td>'+p.word_count+'</td><td>'+p.response_ms+' ms</td><td>'+(err?'<span class="issue-count error">'+err+'</span>':'')+(warn?' <span class="issue-count warn">'+warn+'</span>':'')+(!err&&!warn?'–':'')+'</td><td>'+(mob.scores?.performance??'–')+'</td><td>'+(mob.scores?.seo??'–')+'</td></tr>';
  }
  if(!rows)rows='<tr><td colspan="10">Noch kein abgeschlossener Crawl.</td></tr>';
  let html='<a class="backlink" href="/sites/'+esc(site.slug)+'">← '+esc(site.name)+'</a>';
  html+='<header><div><span class="eyebrow">WEBSITE QUALITY SUITE</span><h1>SEO · '+esc(site.name)+'</h1><p>Technischer SEO-Crawl, Duplicate-/Linkanalyse, Accessibility, Security-Header, Social Metadata, interne Seitenstärke, WDF×IDF und Lighthouse/PageSpeed.</p></div><div class="actions"><a class="button ghost" href="/sites/'+esc(site.slug)+'/report">Report</a><span class="pill '+statusClass+'">'+statusLabel+'</span></div></header>';
  html+='<section class="seo-run-panel"><form id="seoRunForm" class="seo-run-form"><label>Max. Seiten<input name="maxPages" type="number" min="1" max="500" value="'+(run?.max_pages||cfg.seoMaxPages||100)+'"></label><label>PageSpeed / Lighthouse<select name="pageSpeed"><option value="homepage">Startseite</option><option value="all">Mehrere Seiten</option><option value="none">Nicht abrufen</option></select></label><label>Max. Lighthouse-Seiten<input name="pageSpeedMaxPages" type="number" min="1" max="50" value="10"></label><button type="submit">SEO-Check starten</button><span id="seoRunState"></span></form><p class="lead">Der Crawl folgt internen Links, robots.txt und Sitemaps. Lighthouse läuft nur mit hinterlegtem PageSpeed API-Key.</p></section>';
  if(run?.status==='running')html+='<div class="notice"><strong>Crawl läuft</strong><span>Gestartet '+new Date(run.started_at).toLocaleString('de-DE')+'. Die Seite aktualisiert sich automatisch.</span></div>';
  if(run?.status==='failed')html+='<div class="notice bad"><strong>SEO-Crawl fehlgeschlagen</strong><span>'+esc(run.error||'Unbekannter Fehler')+'</span></div>';
  if(run?.status==='completed'){
    html+='<div class="metrics big seo-metrics"><span>'+(summary.healthScore??'–')+'<em>Health Score</em></span><span>'+(summary.pages??pages.length)+'<em>Seiten</em></span><span>'+(summary.issues?.error??0)+'<em>Fehler</em></span><span>'+(summary.brokenInternalLinks??0)+'<em>Defekte Links</em></span><span>'+(summary.duplicateContent??0)+'<em>Duplicate Content</em></span><span>'+(summary.brokenResources??0)+'<em>Defekte Assets</em></span><span>'+(summary.avgResponseMs??'–')+' ms<em>Ø Response</em></span></div>';
    html+='<div class="twocol ops-grid"><section><div class="sectionhead"><div><span class="eyebrow">Linkgraph</span><h2>Seitenstruktur</h2></div><small>Kreisgröße = relative interne Linkstärke.</small></div>'+seoGraphSvg(graph)+'</section><section><div class="sectionhead"><div><span class="eyebrow">Interne Autorität</span><h2>Stärkste Seiten</h2></div><small>PageRank-artige Berechnung aus internen Links.</small></div><div class="strength-list">'+strength+'</div></section></div>';
    html+='<section><div class="sectionhead"><div><span class="eyebrow">Onpage</span><h2>Alle gecrawlten Seiten</h2></div><small>'+pages.length+' URLs · Detailansicht mit WDF×IDF, Headings, Links und Lighthouse.</small></div><div class="tablewrap"><table><thead><tr><th>Seite</th><th>HTTP</th><th>Tiefe</th><th>In</th><th>Out</th><th>Wörter</th><th>Response</th><th>Issues</th><th>Perf. M</th><th>SEO M</th></tr></thead><tbody>'+rows+'</tbody></table></div></section>';
  }else if(!run)html+='<section><div class="empty-state"><strong>Noch kein SEO-Audit vorhanden.</strong><p>Starte oben den ersten Crawl.</p></div></section>';
  html+='<script>const seoForm=document.getElementById("seoRunForm"),seoState=document.getElementById("seoRunState");seoForm.addEventListener("submit",async e=>{e.preventDefault();const fd=new FormData(seoForm),data={maxPages:Number(fd.get("maxPages")),pageSpeed:fd.get("pageSpeed"),pageSpeedMaxPages:Number(fd.get("pageSpeedMaxPages"))};seoState.textContent="Starte…";const r=await fetch("/api/sites/'+encodeURIComponent(site.slug)+'/seo-runs",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data)}),x=await r.json();seoState.textContent=r.ok?"✓ Crawl gestartet":"✗ "+(x.message||x.error||JSON.stringify(x));if(r.ok)setTimeout(()=>location.reload(),800);});'+(run?.status==='running'?'setTimeout(()=>location.reload(),4000);':'')+'</script>';
  return page('SEO · '+site.name,html);
}
async function seoPageDetailPage(id){
  const p=await seoPageGet(Number(id)),site=await getSite(p.site_id),issues=Array.isArray(p.issues)?p.issues:[],terms=Array.isArray(p.wdfidf)?p.wdfidf:[],h1=Array.isArray(p.h1)?p.h1:[],h2=Array.isArray(p.h2)?p.h2:[],links=p.links||[],mobile=p.lighthouse_mobile||null,desktop=p.lighthouse_desktop||null;
  let issueRows='';issues.forEach(i=>issueRows+='<li class="seo-issue '+esc(i.level)+'"><strong>'+esc(i.code)+'</strong><span>'+esc(i.text)+'</span></li>');if(!issueRows)issueRows='<li class="seo-issue ok"><span>Keine Standardprobleme erkannt.</span></li>';
  let termRows='';terms.forEach(t=>termRows+='<tr><td><strong>'+esc(t.term)+'</strong></td><td>'+t.freq+'</td><td>'+t.wdf+'</td><td>'+t.idf+'</td><td>'+t.score+'</td></tr>');if(!termRows)termRows='<tr><td colspan="5">Keine ausreichenden Textdaten.</td></tr>';
  let linkRows='';links.slice(0,150).forEach(l=>linkRows+='<tr><td>'+(l.internal_link?'intern':'extern')+'</td><td><a href="'+esc(l.target_url)+'" target="_blank" rel="noopener">'+esc(l.target_url)+'</a></td><td>'+esc(l.anchor_text||'–')+'</td><td>'+(l.nofollow?'nofollow':'follow')+'</td></tr>');if(!linkRows)linkRows='<tr><td colspan="4">Keine Links.</td></tr>';
  function lh(data,label){if(!data)return '<div class="lh-card muted"><strong>'+label+'</strong><p>Keine Lighthouse-Daten für diese URL.</p></div>';return '<div class="lh-card"><strong>'+label+'</strong><div class="lh-scores"><span>'+seoScoreValue(data.scores?.performance)+'<em>Performance</em></span><span>'+seoScoreValue(data.scores?.accessibility)+'<em>Accessibility</em></span><span>'+seoScoreValue(data.scores?.bestPractices)+'<em>Best Practices</em></span><span>'+seoScoreValue(data.scores?.seo)+'<em>SEO</em></span></div><dl class="facts compact-facts"><div><dt>FCP</dt><dd>'+seoMetricMs(data.metrics?.fcp)+'</dd></div><div><dt>LCP</dt><dd>'+seoMetricMs(data.metrics?.lcp)+'</dd></div><div><dt>TBT</dt><dd>'+seoMetricMs(data.metrics?.tbt)+'</dd></div><div><dt>CLS</dt><dd>'+(data.metrics?.cls==null?'–':Number(data.metrics.cls).toFixed(3))+'</dd></div><div><dt>Speed Index</dt><dd>'+seoMetricMs(data.metrics?.speedIndex)+'</dd></div></dl></div>';}
  let html='<a class="backlink" href="/sites/'+esc(site.slug)+'/seo">← SEO · '+esc(site.name)+'</a><header><div><span class="eyebrow">SEO PAGE</span><h1>'+esc(p.title||p.path)+'</h1><p><a href="'+esc(p.url)+'" target="_blank" rel="noopener">'+esc(p.url)+'</a></p></div><span class="pill '+(p.status_code===200?'ok':'bad')+'">HTTP '+p.status_code+'</span></header>';
  html+='<div class="metrics big seo-metrics"><span>'+p.word_count+'<em>Wörter</em></span><span>'+p.incoming_links+'<em>Interne Links rein</em></span><span>'+p.internal_links+'<em>Interne Links raus</em></span><span>'+p.response_ms+' ms<em>Response</em></span><span>'+p.images_missing_alt+'/'+p.images_total+'<em>Bilder ohne Alt</em></span></div>';
  html+='<div class="twocol ops-grid"><section><div class="sectionhead"><div><span class="eyebrow">Meta</span><h2>Onpage-Daten</h2></div></div><dl class="facts"><div><dt>Title</dt><dd>'+esc(p.title||'–')+'</dd></div><div><dt>Meta Description</dt><dd>'+esc(p.meta_description||'–')+'</dd></div><div><dt>Canonical</dt><dd>'+esc(p.canonical||'–')+'</dd></div><div><dt>Robots</dt><dd>'+esc(p.robots||'–')+'</dd></div><div><dt>H1</dt><dd>'+esc(h1.join(' · ')||'–')+'</dd></div><div><dt>H2</dt><dd>'+esc(h2.slice(0,12).join(' · ')||'–')+'</dd></div><div><dt>Crawl-Tiefe</dt><dd>'+(p.depth??'Sitemap / nicht über Links erreicht')+'</dd></div><div><dt>Interne Stärke</dt><dd>'+Number(p.pagerank||0).toFixed(6)+'</dd></div></dl></section><section><div class="sectionhead"><div><span class="eyebrow">Issues</span><h2>Hinweise</h2></div></div><ul class="seo-issues">'+issueRows+'</ul></section></div>';
  html+='<section><div class="sectionhead"><div><span class="eyebrow">Lighthouse / PSI</span><h2>Performance & Qualität</h2></div></div><div class="lh-grid">'+lh(mobile,'Mobile')+lh(desktop,'Desktop')+'</div></section>';
  html+='<section><div class="sectionhead"><div><span class="eyebrow">Content</span><h2>Siteinterne WDF×IDF</h2></div><small>Gewichtung relativ zum Korpus der gecrawlten Website – keine Wettbewerberanalyse.</small></div><div class="tablewrap"><table><thead><tr><th>Term</th><th>Häufigkeit</th><th>WDF</th><th>IDF</th><th>WDF×IDF</th></tr></thead><tbody>'+termRows+'</tbody></table></div></section>';
  html+='<section><div class="sectionhead"><div><span class="eyebrow">Interne Verlinkung</span><h2>Ausgehende Links</h2></div><small>Maximal 150 Links.</small></div><div class="tablewrap"><table><thead><tr><th>Typ</th><th>Ziel</th><th>Ankertext</th><th>Rel</th></tr></thead><tbody>'+linkRows+'</tbody></table></div></section>';
  return page('SEO · '+(p.title||p.path),html);
}

async function siteOperationsPage(slug){
  const site=await getSite(slug),hist=await listHistory(site.id,30),backups=await listBackups(site,30),checks=await listMonitorChecks(site.id,50),incidents=await listIncidents(site.id,30),backupState=(await q('select * from backup_state where site_id=?',[site.id])).rows[0]||null,monitorState=(await q('select * from monitor_state where site_id=?',[site.id])).rows[0]||null;
  const latest=checks[0]||null,latestDetails=latest?.details||{},uptime=checks.length?Math.round(checks.filter(x=>x.ok).length/checks.length*10000)/100:'–';
  const mode=site.deployment_mode||'webspace',isGit=mode==='hostinger_git',openIncidents=incidents.filter(x=>x.status==='open');
  const checkRows=checks.slice(0,20).map(x=>{const d=x.details||{};return `<tr><td>${new Date(x.created_at).toLocaleString('de-DE')}</td><td><span class="pill ${x.ok?'ok':'bad'}">${x.ok?'OK':'FEHLER'}</span></td><td>${x.http_status??'–'}</td><td>${x.response_ms??'–'} ms</td><td>${x.ssl_days??'–'} d</td><td>${esc(d.finalUrl||'–')}</td><td>${Array.isArray(d.redirects)?d.redirects.length:0}</td></tr>`}).join('')||'<tr><td colspan="7">Noch keine Prüfungen.</td></tr>';
  const incidentRows=incidents.map(i=>{const ended=i.resolved_at?new Date(i.resolved_at):null,started=new Date(i.created_at),duration=ended?Math.max(0,Math.round((ended-started)/60000))+' min':'laufend';return `<tr><td><a href="/incidents/${i.id}">${esc(i.title)}</a></td><td><span class="pill ${i.status==='open'?'bad':'ok'}">${esc(i.status.toUpperCase())}</span></td><td>${started.toLocaleString('de-DE')}</td><td>${ended?ended.toLocaleString('de-DE'):'–'}</td><td>${duration}</td></tr>`}).join('')||'<tr><td colspan="5">Keine Incidents.</td></tr>';
  const backupRows=backups.map(b=>`<tr><td>${new Date(b.created_at).toLocaleString('de-DE')}</td><td><code>${esc(String(b.git_commit).slice(0,8))}</code></td><td>${b.file_count??'–'}</td><td>${b.changed?'geändert':'identisch'}</td><td><button class="ghost" onclick="restoreBackup('${b.id}')">Restore</button></td></tr>`).join('')||'<tr><td colspan="5">Noch keine Backups.</td></tr>';
  const historyRows=hist.map(h=>`<tr><td>${new Date(h.created_at).toLocaleString('de-DE')}</td><td>${esc(h.description)}</td><td>${esc(h.actor)}</td><td><span class="pill">${esc(h.status)}</span></td><td><button class="ghost" onclick="rollback('${h.id}')">Rollback</button></td></tr>`).join('')||'<tr><td colspan="5">Noch keine Änderungen.</td></tr>';
  return page(site.name,`
    <a class="backlink" href="/">← Übersicht</a>
    <header><div><span class="eyebrow">${isGit?'HOSTINGER GIT':esc(site.protocol.toUpperCase())} · ${site.enabled?'AKTIV':'PAUSIERT'}</span><h1>${esc(site.name)}</h1><p>${esc(site.domain)} · ${isGit?esc(site.source_repository+' @ '+(site.source_branch||'main')):esc(site.remote_root)}</p></div><div class="actions"><a class="button ghost" href="/sites/${esc(site.slug)}/seo">Quality / SEO</a><a class="button ghost" href="/sites/${esc(site.slug)}/report">Report</a><button class="ghost" id="checkNow">Jetzt prüfen</button><button id="backupNow">Backup jetzt</button></div></header>
    ${openIncidents.length?`<div class="notice bad"><strong>${openIncidents.length} offener Incident</strong><span>${esc(openIncidents[0].title)} · seit ${new Date(openIncidents[0].created_at).toLocaleString('de-DE')}</span></div>`:''}
    ${backupState?.last_error?`<div class="notice bad"><strong>Backupfehler</strong><span>${esc(backupState.last_error)}</span></div>`:''}
    <div class="metrics big ops-metrics"><span>${uptime}%<em>Uptime letzte ${checks.length} Checks</em></span><span>${latest?.response_ms??'–'} ms<em>Response</em></span><span>${latest?.ssl_days??'–'} d<em>SSL</em></span><span>${latest?.http_status??'–'}<em>HTTP</em></span><span>${backups[0]?.created_at?new Date(backups[0].created_at).toLocaleString('de-DE'):'–'}<em>Letztes Backup</em></span></div>

    <div class="twocol ops-grid">
      <section>
        <div class="sectionhead"><div><span class="eyebrow">Zugriff</span><h2>Verbindung & Deployment</h2></div><span class="pill ${isGit?'ok':''}">${isGit?'GIT SOURCE':'WEBSPACE'}</span></div>
        <p class="lead">Änderungen an Zugangsdaten werden vor dem Speichern getestet. Leere Secret-Felder behalten das bisher gespeicherte Secret.</p>
        <form id="connectionForm" class="inner-form">
          <label>Deployment-Methode<select name="deploymentMode"><option value="webspace" ${!isGit?'selected':''}>Direkter Webspace</option><option value="hostinger_git" ${isGit?'selected':''}>Hostinger Git Deploy</option></select></label>
          <div id="connWeb" ${isGit?'hidden':''}>
            <div class="formgrid">
              <label>Protokoll<select name="protocol"><option value="sftp" ${site.protocol==='sftp'?'selected':''}>SFTP</option><option value="ftps" ${site.protocol==='ftps'?'selected':''}>FTPS</option><option value="ftp" ${site.protocol==='ftp'?'selected':''}>FTP</option></select></label>
              <label>Port<input name="port" type="number" value="${site.port||22}"></label>
              <label class="span2">Host<input name="host" value="${esc(isGit?'':site.host||'')}"></label>
              <label>Benutzer<input name="username" value="${esc(isGit?'':site.username||'')}"></label>
              <label>Neues Passwort <small>${site.encrypted_credentials?'Zugangsdaten gespeichert. Leer lassen = unverändert.':'Noch keine Zugangsdaten.'}</small><input name="password" type="password" autocomplete="new-password"></label>
              <label class="span2">Remote Root<input name="remoteRoot" value="${esc(isGit?'/':site.remote_root||'/')}"></label>
            </div>
          </div>
          <div id="connGit" ${!isGit?'hidden':''}>
            <div class="formgrid">
              <label class="span2">Repository<input name="sourceRepository" value="${esc(site.source_repository||'')}" placeholder="owner/repository"></label>
              <label>Branch<input name="sourceBranch" value="${esc(site.source_branch||'main')}"></label>
              <label>Repository-Unterordner<input name="sourceRoot" value="${esc(site.source_root||'')}"></label>
              <label class="span2">Neuer GitHub PAT <small>${site.git_credentials?'Token gespeichert. Leer lassen = unverändert.':'Noch kein Token gespeichert.'}</small><input name="gitToken" type="password" autocomplete="new-password"></label>
              <label class="span2">Hostinger Zielverzeichnis<input name="hostingerTargetDirectory" value="${esc(site.hostinger_target_directory||'public_html')}"></label>
            </div>
          </div>
          <div class="buttonrow"><button type="button" class="ghost" id="testStoredConnection">Aktuelle Verbindung testen</button><button type="submit">Testen & speichern</button><span id="connectionState" class="inline-status"></span></div>
        </form>
      </section>

      <section>
        <div class="sectionhead"><div><span class="eyebrow">Betrieb</span><h2>Monitoring & Alarmierung</h2></div><span class="pill ${latest?.ok?'ok':latest?'bad':''}">${latest?latest.ok?'HEALTHY':'UNHEALTHY':'NO DATA'}</span></div>
        <form id="monitorForm" class="inner-form">
          <label class="check"><input type="checkbox" name="enabled" ${site.enabled?'checked':''}> Website aktiv verwalten</label>
          <label class="check"><input type="checkbox" name="monitor_enabled" ${site.monitor_enabled?'checked':''}> Monitoring aktiv</label>
          <label>Monitor-URL<input name="monitor_url" value="${esc(site.monitor_url||'https://'+site.domain)}"></label>
          <div class="formgrid">
            <label>Erwarteter HTTP-Status<input name="monitor_expected_status" type="number" value="${site.monitor_expected_status}"></label>
            <label>Prüfintervall (Sek.)<input name="monitor_interval_seconds" type="number" min="30" value="${site.monitor_interval_seconds}"></label>
            <label>Erwarteter Seitentitel <small>Leer = nicht prüfen.</small><input name="monitor_expected_title" value="${esc(site.monitor_expected_title||'')}"></label>
            <label>Erwarteter Text <small>Leer = nicht prüfen.</small><input name="monitor_content" value="${esc(site.monitor_content||'')}"></label>
            <label>Timeout (ms)<input name="monitor_timeout_ms" type="number" min="1000" value="${site.monitor_timeout_ms}"></label>
            <label>Response-Warnung (ms)<input name="response_warn_ms" type="number" min="1" value="${site.response_warn_ms??''}" placeholder="optional"></label>
            <label>Fehler bis Alarm<input name="monitor_failure_threshold" type="number" min="1" value="${site.monitor_failure_threshold}"></label>
            <label>Alarm wiederholen (Min.)<input name="alert_repeat_minutes" type="number" min="1" value="${site.alert_repeat_minutes||60}"></label>
            <label>SSL-Warnung (Tage)<input name="ssl_warn_days" type="number" min="1" value="${site.ssl_warn_days}"></label>
          </div>
          <label class="check"><input type="checkbox" name="monitor_check_dns" ${site.monitor_check_dns?'checked':''}> DNS-Auflösung prüfen</label>
          <label class="check"><input type="checkbox" name="monitor_check_wordpress" ${site.monitor_check_wordpress?'checked':''}> WordPress REST API unter <code>/wp-json/</code> prüfen</label>
          <button>Monitoring speichern</button><span id="monitorState" class="inline-status"></span>
        </form>
      </section>
    </div>

    <div class="twocol ops-grid">
      <section>
        <div class="sectionhead"><div><span class="eyebrow">Sicherung</span><h2>Backup</h2></div></div>
        <form id="backupForm" class="inner-form">
          <label class="check"><input type="checkbox" name="backup_enabled" ${site.backup_enabled?'checked':''}> Automatische Backups</label>
          <label>Backup-Intervall (Sek.)<input name="backup_interval_seconds" type="number" min="900" value="${site.backup_interval_seconds}"></label>
          <label>Max. Dateien<input name="backup_max_files" type="number" min="100" value="${site.backup_max_files}"></label>
          <label>Ausschlüsse <small>Eine Zeile pro Muster. Standardmäßig u. a. Cache und Uploads.</small><textarea name="exclude_patterns" rows="6">${esc((Array.isArray(site.exclude_patterns)?site.exclude_patterns:[]).join('\n'))}</textarea></label>
          <button>Backup-Einstellungen speichern</button><span id="backupState" class="inline-status"></span>
        </form>
        <dl class="facts compact-facts"><div><dt>Letzter Versuch</dt><dd>${backupState?.last_attempt_at?new Date(backupState.last_attempt_at).toLocaleString('de-DE'):'–'}</dd></div><div><dt>Letzter Erfolg</dt><dd>${backupState?.last_success_at?new Date(backupState.last_success_at).toLocaleString('de-DE'):'–'}</dd></div><div><dt>Backup-Pfad</dt><dd><code>sites/${esc(site.slug)}/public</code></dd></div></dl>
      </section>
      <section>
        <div class="sectionhead"><div><span class="eyebrow">Letzter Check</span><h2>Diagnose</h2></div></div>
        <dl class="facts compact-facts">
          <div><dt>Finale URL</dt><dd>${esc(latestDetails.finalUrl||'–')}</dd></div>
          <div><dt>Titel</dt><dd>${esc(latestDetails.title||'–')}</dd></div>
          <div><dt>DNS</dt><dd>${Array.isArray(latestDetails.dns)?esc(latestDetails.dns.join(', ')):'–'}</dd></div>
          <div><dt>Redirects</dt><dd>${Array.isArray(latestDetails.redirects)?latestDetails.redirects.length:0}</dd></div>
          <div><dt>WordPress</dt><dd>${latestDetails.wordpress?latestDetails.wordpress.ok?'OK':'Fehler':'nicht geprüft'}</dd></div><div><dt>Domain-Ablauf</dt><dd>${latestDetails.domainExpiryDays??'–'} Tage</dd></div>
          <div><dt>Fehler in Folge</dt><dd>${monitorState?.consecutive_failures||0}</dd></div>
          <div><dt>Alerts im Incident</dt><dd>${monitorState?.alert_count||0}</dd></div>
        </dl>
      </section>
    </div>

    <section><div class="sectionhead"><div><span class="eyebrow">Verfügbarkeit</span><h2>Monitoring-Verlauf</h2></div><small>Letzte 20 von ${checks.length} geladenen Prüfungen.</small></div><div class="tablewrap"><table><thead><tr><th>Zeit</th><th>Status</th><th>HTTP</th><th>Response</th><th>SSL</th><th>Finale URL</th><th>Redirects</th></tr></thead><tbody>${checkRows}</tbody></table></div></section>
    <section><div class="sectionhead"><div><span class="eyebrow">Alarmierung</span><h2>Incidents</h2></div><small>Öffnen für vollständige Ereignis- und Alert-Timeline.</small></div><div class="tablewrap"><table><thead><tr><th>Incident</th><th>Status</th><th>Start</th><th>Ende</th><th>Dauer</th></tr></thead><tbody>${incidentRows}</tbody></table></div></section>
    <section><div class="sectionhead"><div><span class="eyebrow">Versionen</span><h2>Backups</h2></div><small>Restore erstellt zuerst automatisch einen Safety-Snapshot.</small></div><div class="tablewrap"><table><thead><tr><th>Zeit</th><th>Commit</th><th>Dateien</th><th>Stand</th><th></th></tr></thead><tbody>${backupRows}</tbody></table></div></section>
    <section><div class="sectionhead"><div><span class="eyebrow">Audit</span><h2>Änderungen</h2></div></div><div class="tablewrap"><table><thead><tr><th>Zeit</th><th>Änderung</th><th>Quelle</th><th>Status</th><th></th></tr></thead><tbody>${historyRows}</tbody></table></div></section>

    <script>
    const slug=${JSON.stringify(site.slug)};
    const byId=id=>document.getElementById(id);
    const connectionForm=byId('connectionForm'),monitorForm=byId('monitorForm'),backupForm=byId('backupForm');
    const cfield=name=>connectionForm.elements.namedItem(name);
    function syncConnectionMode(){const git=cfield('deploymentMode').value==='hostinger_git';byId('connWeb').hidden=git;byId('connGit').hidden=!git;}
    cfield('deploymentMode').addEventListener('change',syncConnectionMode);syncConnectionMode();
    byId('testStoredConnection').addEventListener('click',async()=>{byId('connectionState').textContent='Prüfe…';const r=await fetch('/api/sites/'+encodeURIComponent(slug)+'/connection-test',{method:'POST'}),x=await r.json();byId('connectionState').textContent=r.ok?'✓ Verbindung OK':'✗ '+(x.message||x.error||JSON.stringify(x));});
    connectionForm.addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(connectionForm),git=fd.get('deploymentMode')==='hostinger_git',data={deploymentMode:fd.get('deploymentMode')};if(git){data.sourceRepository=String(fd.get('sourceRepository')||'').trim();data.sourceBranch=String(fd.get('sourceBranch')||'main').trim();data.sourceRoot=String(fd.get('sourceRoot')||'').trim();data.gitToken=String(fd.get('gitToken')||'');data.hostingerTargetDirectory=String(fd.get('hostingerTargetDirectory')||'public_html').trim();}else{data.protocol=fd.get('protocol');data.host=String(fd.get('host')||'').trim();data.port=Number(fd.get('port'));data.username=String(fd.get('username')||'').trim();data.password=String(fd.get('password')||'');data.remoteRoot=String(fd.get('remoteRoot')||'/').trim();}byId('connectionState').textContent='Teste & speichere…';const r=await fetch('/api/sites/'+encodeURIComponent(slug)+'/connection',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(data)}),x=await r.json();byId('connectionState').textContent=r.ok?'✓ Verbindung geprüft und gespeichert':'✗ '+(x.message||x.error||JSON.stringify(x));if(r.ok)setTimeout(()=>location.reload(),500);});
    monitorForm.addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(monitorForm),warn=String(fd.get('response_warn_ms')||'').trim();const data={enabled:cbox(monitorForm,'enabled'),monitor_enabled:cbox(monitorForm,'monitor_enabled'),monitor_url:String(fd.get('monitor_url')||''),monitor_expected_status:Number(fd.get('monitor_expected_status')),monitor_interval_seconds:Number(fd.get('monitor_interval_seconds')),monitor_expected_title:String(fd.get('monitor_expected_title')||'').trim()||null,monitor_content:String(fd.get('monitor_content')||'').trim()||null,monitor_check_dns:cbox(monitorForm,'monitor_check_dns'),monitor_check_wordpress:cbox(monitorForm,'monitor_check_wordpress'),monitor_timeout_ms:Number(fd.get('monitor_timeout_ms')),response_warn_ms:warn?Number(warn):null,monitor_failure_threshold:Number(fd.get('monitor_failure_threshold')),alert_repeat_minutes:Number(fd.get('alert_repeat_minutes')),ssl_warn_days:Number(fd.get('ssl_warn_days'))};byId('monitorState').textContent='Speichere…';const r=await fetch('/api/sites/'+encodeURIComponent(slug),{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(data)}),x=await r.json();byId('monitorState').textContent=r.ok?'✓ Gespeichert':'✗ '+(x.message||x.error||JSON.stringify(x));});
    backupForm.addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(backupForm),patterns=String(fd.get('exclude_patterns')||'').split('\\n').map(x=>x.trim()).filter(Boolean),data={backup_enabled:cbox(backupForm,'backup_enabled'),backup_interval_seconds:Number(fd.get('backup_interval_seconds')),backup_max_files:Number(fd.get('backup_max_files')),exclude_patterns:patterns};byId('backupState').textContent='Speichere…';const r=await fetch('/api/sites/'+encodeURIComponent(slug),{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(data)}),x=await r.json();byId('backupState').textContent=r.ok?'✓ Gespeichert':'✗ '+(x.message||x.error||JSON.stringify(x));});
    function cbox(form,name){return Boolean(form.elements.namedItem(name)?.checked);}
    byId('backupNow').addEventListener('click',async()=>{const r=await fetch('/api/sites/'+encodeURIComponent(slug)+'/backup',{method:'POST'}),x=await r.json();alert(r.ok?'Backup erstellt: '+String(x.commit||'').slice(0,8):JSON.stringify(x));if(r.ok)location.reload();});
    byId('checkNow').addEventListener('click',async()=>{const r=await fetch('/api/sites/'+encodeURIComponent(slug)+'/check',{method:'POST'}),x=await r.json();alert(x.ok?'Website ist erreichbar':'Prüfung fehlgeschlagen: '+JSON.stringify(x));location.reload();});
    async function rollback(id){const r=await fetch('/api/changes/'+id+'/rollback-preview',{method:'POST'}),p=await r.json();if(!r.ok)return alert(JSON.stringify(p));if(confirm('Rollback-Preview '+p.previewId+' anwenden?')){const a=await fetch('/api/previews/'+p.previewId+'/apply',{method:'POST'});alert(JSON.stringify(await a.json()));location.reload();}}
    async function restoreBackup(id){if(!confirm('Diesen Backup-Stand vorbereiten? Vorher wird automatisch ein aktueller Safety-Snapshot erstellt.'))return;const r=await fetch('/api/backups/'+id+'/restore-preview',{method:'POST'}),p=await r.json();if(!r.ok)return alert(JSON.stringify(p));if(p.noChanges)return alert(p.message);if(confirm('Restore-Preview '+p.previewId+' jetzt anwenden?')){const a=await fetch('/api/previews/'+p.previewId+'/apply',{method:'POST'});alert(JSON.stringify(await a.json()));location.reload();}}
    </script>`);
}
async function incidentPage(id){
  const incident=await getIncident(id);
  const eventRows=incident.events.map(e=>`<tr><td>${new Date(e.created_at).toLocaleString('de-DE')}</td><td><span class="pill">${esc(e.event_type)}</span></td><td><pre class="event-json">${esc(e.details?JSON.stringify(e.details,null,2):'–')}</pre></td></tr>`).join('')||'<tr><td colspan="3">Keine Events.</td></tr>';
  return page('Incident',`<a class="backlink" href="/sites/${esc(incident.slug)}">← ${esc(incident.domain)}</a><header><div><span class="eyebrow">INCIDENT · ${esc(incident.status.toUpperCase())}</span><h1>${esc(incident.title)}</h1><p>Gestartet ${new Date(incident.created_at).toLocaleString('de-DE')}${incident.resolved_at?' · beendet '+new Date(incident.resolved_at).toLocaleString('de-DE'):''}</p></div></header><section><div class="sectionhead"><div><span class="eyebrow">Timeline</span><h2>Ereignisse & Alerts</h2></div></div><div class="tablewrap"><table><thead><tr><th>Zeit</th><th>Typ</th><th>Details</th></tr></thead><tbody>${eventRows}</tbody></table></div></section>`);
}
async function dashboard(){const sites=await listSites(),checks=(await q('select mc.site_id,mc.ok,mc.http_status,mc.response_ms,mc.ssl_days,mc.created_at from monitor_checks mc join (select site_id,max(created_at) created_at from monitor_checks group by site_id) latest on latest.site_id=mc.site_id and latest.created_at=mc.created_at')).rows,checkMap=new Map(checks.map(x=>[x.site_id,x])),backups=(await q('select b.site_id,b.git_commit,b.file_count,b.created_at from backups b join (select site_id,max(created_at) created_at from backups group by site_id) latest on latest.site_id=b.site_id and latest.created_at=b.created_at')).rows,backupMap=new Map(backups.map(x=>[x.site_id,x])),incidents=(await q("select i.*,s.domain from incidents i join sites s on s.id=i.site_id where i.status='open' order by i.created_at desc")).rows,changes=(await q('select c.*,s.domain from changes c join sites s on s.id=c.site_id order by c.created_at desc limit 20')).rows;const cards=sites.map(s=>{const c=checkMap.get(s.id),b=backupMap.get(s.id),deploy=s.deployment_mode==='hostinger_git'?'HOSTINGER GIT':s.protocol.toUpperCase();return `<a class="card" href="/sites/${esc(s.slug)}"><div class="row"><strong>${esc(s.name)}</strong><span class="pill ${c?.ok?'ok':'bad'}">${c?c.ok?'ONLINE':'ALARM':'NO DATA'}</span></div><small>${esc(s.domain)} · ${esc(deploy)}</small><div class="metrics"><span>${c?.response_ms??'–'} ms<em>Response</em></span><span>${c?.ssl_days??'–'} d<em>SSL</em></span><span>${s.monitor_enabled?'ON':'OFF'}<em>Monitor</em></span><span>${b?.created_at?new Date(b.created_at).toLocaleDateString('de-DE'):'–'}<em>Backup</em></span></div></a>`}).join('');const inc=incidents.length?incidents.map(i=>`<li><b>${esc(i.domain)}</b> ${esc(i.title)}<small>${new Date(i.created_at).toLocaleString('de-DE')}</small></li>`).join(''):'<li>Keine offenen Incidents.</li>',hist=changes.map(c=>`<li><b>${esc(c.domain)}</b> ${esc(c.description)} <span class="pill">${esc(c.status)}</span><small>${new Date(c.created_at).toLocaleString('de-DE')} · ${esc(c.actor)}</small></li>`).join('')||'<li>Noch keine Änderungen.</li>';return page('SiteOps',`<header><div><span class="eyebrow">Lorzen</span><h1>SiteOps</h1><p>Websites, Backups, Monitoring und Rollbacks.</p></div><div class="actions"><a class="ghost btn" href="/settings">Einstellungen</a><a class="btn" href="/setup">+ Website</a></div></header><section><h2>Websites</h2><div class="grid">${cards}</div></section><div class="twocol"><section><h2>Offene Incidents</h2><ul>${inc}</ul></section><section><h2>Letzte Änderungen</h2><ul>${hist}</ul></section></div>`);}

async function start(){let databaseReady=false,databaseError=null;try{await migrate();await loadSavedConfig();databaseReady=true;}catch(e){databaseError=String(e?.message||e);console.error('database startup',e);}const app=Fastify({logger:true,bodyLimit:8*1024*1024});const missingConfig=()=>[['SITEOPS_MASTER_KEY',cfg.masterKey],['MCP_API_TOKEN',cfg.mcpToken],['DASHBOARD_USER',cfg.dashboardUser],['DASHBOARD_PASSWORD',cfg.dashboardPassword],['DB_USER',cfg.databaseUrl||cfg.dbUser],['DB_NAME',cfg.databaseUrl||cfg.dbName]].filter(([,v])=>!v).map(([k])=>k);app.get('/health',async(_req,reply)=>{const missing=missingConfig(),ok=databaseReady&&missing.length===0;return reply.code(ok?200:503).send({status:ok?'ok':'degraded',version:'0.9.0',port:cfg.port,database:{engine:'mysql',ready:databaseReady,error:databaseError},backup:{configured:Boolean(cfg.githubBackupRepo&&cfg.githubBackupToken),repository:cfg.githubBackupRepo||null},baseUrl:cfg.publicBaseUrl,missingConfig:missing,worker:databaseReady?'ok':'paused',time:new Date().toISOString()});});app.get('/assets/app.css',async(_r,reply)=>reply.header('Cache-Control','no-store, max-age=0').type('text/css').send(await readFile(new URL('./public/app.css',import.meta.url),'utf8')));app.addHook('onRequest',async(req,reply)=>{const path=req.url.split('?')[0];if(path==='/health'||path.startsWith('/assets/'))return;if(path==='/mcp'){if(!mcpAuth(req,reply))return reply;}else if(!dashboardAuth(req,reply))return reply;});const handler=createMcpHandler(()=>mcpServer()),nodeHandler=toNodeHandler(handler);app.all('/mcp',async(req,reply)=>nodeHandler(req.raw,reply.raw,req.body));app.get('/',async(_r,reply)=>reply.type('text/html').send(await dashboard()));app.get('/api/sites',async()=>listSites());
app.get('/api/sites/:site',async req=>publicSite(await getSite(req.params.site)));
app.get('/api/sites/:site/overview',async req=>siteOverview(req.params.site));
app.post('/api/sites/:site/connection-test',async req=>testStoredConnection(await getSite(req.params.site)));
app.patch('/api/sites/:site/connection',async req=>{
  const schema=z.object({deploymentMode:z.enum(['webspace','hostinger_git']),protocol:z.enum(['sftp','ftps','ftp']).optional(),host:z.string().optional(),port:z.coerce.number().int().min(1).max(65535).optional(),username:z.string().optional(),password:z.string().optional(),privateKey:z.string().optional(),passphrase:z.string().optional(),remoteRoot:z.string().optional(),sourceRepository:z.string().optional(),sourceBranch:z.string().optional(),sourceRoot:z.string().optional(),gitToken:z.string().optional(),hostingerTargetDirectory:z.string().optional()});
  return{ok:true,site:publicSite(await updateSiteConnection(req.params.site,schema.parse(req.body)))};
});
app.get('/api/sites/:site/monitor-checks',async req=>listMonitorChecks(req.params.site,Math.min(200,Math.max(1,Number(req.query?.limit||50)))));
app.get('/api/sites/:site/incidents',async req=>listIncidents(req.params.site,Math.min(100,Math.max(1,Number(req.query?.limit||30)))));
app.get('/api/incidents/:id',async req=>getIncident(req.params.id));
app.get('/api/sites/:site/deployment',async req=>deploymentInfo(req.params.site));
app.get('/api/sites/:site/backup-status',async req=>backupStatus(req.params.site));
app.post('/api/sites/:site/seo-runs',async req=>{const schema=z.object({maxPages:z.coerce.number().int().min(1).max(500).optional(),pageSpeed:z.enum(['none','homepage','all']).default('homepage'),pageSpeedMaxPages:z.coerce.number().int().min(1).max(50).default(10)});return startSeoAudit(req.params.site,schema.parse(req.body||{}));});
app.get('/api/sites/:site/seo/latest',async req=>seoLatest(req.params.site));
app.get('/api/sites/:site/seo/graph',async req=>seoGraph(req.params.site,Math.min(100,Math.max(5,Number(req.query?.limit||30)))));
app.get('/api/sites/:site/seo/issues',async req=>seoIssuesList(req.params.site,{level:req.query?.level||undefined,limit:Math.min(500,Math.max(1,Number(req.query?.limit||200)))}));app.get('/api/sites/:site/seo/compare',async req=>seoCompare(req.params.site));app.get('/api/sites/:site/quality',async req=>qualityOverview(req.params.site));
app.get('/api/seo-runs/:id',async req=>seoRunGet(req.params.id));
app.get('/api/seo-pages/:id',async req=>seoPageGet(Number(req.params.id)));
const siteCommonSchema=z.object({slug:z.string().regex(/^[a-z0-9-]+$/),name:z.string().min(1),domain:z.string().min(1),siteType:z.enum(['wordpress','php','static','node']).default('php'),monitorUrl:z.string().url().optional(),backupEnabled:z.boolean().optional(),backupIntervalSeconds:z.coerce.number().int().min(900).max(2592000).optional(),backupMaxFiles:z.coerce.number().int().min(100).max(200000).optional(),monitorEnabled:z.boolean().optional(),monitorIntervalSeconds:z.coerce.number().int().min(30).max(86400).optional(),monitorFailureThreshold:z.coerce.number().int().min(1).max(20).optional(),sslWarnDays:z.coerce.number().int().min(1).max(365).optional()});
const webspaceSiteSchema=siteCommonSchema.extend({deploymentMode:z.literal('webspace'),protocol:z.enum(['sftp','ftps','ftp']),host:z.string().min(1),port:z.coerce.number().int().min(1).max(65535),username:z.string().min(1),password:z.string().optional(),privateKey:z.string().optional(),passphrase:z.string().optional(),remoteRoot:z.string().min(1),sourceRepository:z.string().optional(),sourceBranch:z.string().optional(),sourceRoot:z.string().optional(),gitToken:z.string().optional(),hostingerTargetDirectory:z.string().optional()});
const hostingerGitSiteSchema=siteCommonSchema.extend({deploymentMode:z.literal('hostinger_git'),sourceRepository:z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),sourceBranch:z.string().min(1),sourceRoot:z.string().optional(),gitToken:z.string().min(1),hostingerTargetDirectory:z.string().optional(),protocol:z.enum(['sftp','ftps','ftp']).optional(),host:z.string().optional(),port:z.coerce.number().optional(),username:z.string().optional(),password:z.string().optional(),remoteRoot:z.string().optional()});
const siteCreateSchema=z.discriminatedUnion('deploymentMode',[webspaceSiteSchema,hostingerGitSiteSchema]);
app.post('/api/sites',async(req,reply)=>{const site=await createSite(siteCreateSchema.parse(req.body));return reply.code(201).send({id:site.id,slug:site.slug});});
app.post('/api/site-connection-test',async req=>testSiteConnection(siteCreateSchema.parse(req.body)));
app.get('/api/settings',async()=>publicSettings());
app.patch('/api/settings',async req=>{const schema=z.object({publicBaseUrl:z.string().url(),githubBackupRepo:z.string().max(255),githubBackupToken:z.string().max(500).optional(),backupBranch:z.string().min(1).max(191),backupMaxFileBytes:z.coerce.number().int().min(1048576).max(94371840),defaultBackupIntervalSeconds:z.coerce.number().int().min(900).max(2592000),defaultBackupMaxFiles:z.coerce.number().int().min(100).max(200000),defaultMonitorIntervalSeconds:z.coerce.number().int().min(30).max(86400),defaultMonitorFailureThreshold:z.coerce.number().int().min(1).max(20),defaultSslWarnDays:z.coerce.number().int().min(1).max(365),alertEmail:z.string().max(320),webhook:z.string().max(2000),smtpHost:z.string().max(255),smtpPort:z.coerce.number().int().min(1).max(65535),smtpSecure:z.boolean(),smtpUser:z.string().max(255),smtpPassword:z.string().max(1000).optional(),smtpFrom:z.string().max(500),seoMaxPages:z.coerce.number().int().min(1).max(500),pageSpeedApiKey:z.string().max(1000).optional()});return{ok:true,settings:await saveAppSettings(schema.parse(req.body))};});
app.post('/api/settings/github-test',async req=>{const schema=z.object({githubBackupRepo:z.string().max(255).optional(),githubBackupToken:z.string().max(500).optional(),backupBranch:z.string().max(191).optional()}),x=schema.parse(req.body||{}),previous={repo:cfg.githubBackupRepo,token:cfg.githubBackupToken,branch:cfg.backupBranch};try{if(x.githubBackupRepo!==undefined)cfg.githubBackupRepo=x.githubBackupRepo.trim().replace(/^\/+|\/+$/g,'');if(x.githubBackupToken)cfg.githubBackupToken=x.githubBackupToken;if(x.backupBranch)cfg.backupBranch=x.backupBranch.trim();backupRepoChecked=false;backupRepoMeta=null;await ensureBackupRepository();const r=await gh('');return{ok:true,repository:r.full_name,private:r.private,defaultBranch:r.default_branch,branch:cfg.backupBranch};}finally{cfg.githubBackupRepo=previous.repo;cfg.githubBackupToken=previous.token;cfg.backupBranch=previous.branch;backupRepoChecked=false;backupRepoMeta=null;}});
app.post('/api/settings/alert-test',async()=>{if(!(cfg.webhook||(cfg.alertEmail&&cfg.smtpHost)))throw new Error('Configure an alert email with SMTP or a webhook first');await sendAlert('TEST','SiteOps test notification from '+cfg.publicBaseUrl);return{ok:true};});app.post('/api/settings/pagespeed-test',async req=>{const schema=z.object({pageSpeedApiKey:z.string().max(1000).optional(),url:z.string().url()}),x=schema.parse(req.body||{}),previous=cfg.pageSpeedApiKey;try{
  if(x.pageSpeedApiKey)cfg.pageSpeedApiKey=x.pageSpeedApiKey;
  if(!cfg.pageSpeedApiKey)throw new Error('Kein PageSpeed API-Key konfiguriert');
  const probe=await fetch(x.url,{redirect:'follow',signal:AbortSignal.timeout(15000),headers:{'User-Agent':cfg.seoUserAgent,accept:'text/html,application/xhtml+xml'}});
  const type=(probe.headers.get('content-type')||'').toLowerCase();
  if(!probe.ok)throw new Error('Test-URL ist öffentlich nicht erfolgreich erreichbar: HTTP '+probe.status);
  if(!type.includes('text/html')&&!type.includes('application/xhtml+xml'))throw new Error('Test-URL liefert kein HTML, sondern '+(type||'unbekannten MIME-Typ')+'. Verwende eine öffentliche Website ohne Login.');
  return{ok:true,url:probe.url,result:await pageSpeedAudit(probe.url,'mobile')};
}finally{cfg.pageSpeedApiKey=previous;}});app.post('/api/sites/:site/backup',async req=>{const site=await getSite(req.params.site);return fullBackup(site,site.backup_max_files||10000);});app.post('/api/sites/:site/check',async req=>processMonitor(await getSite(req.params.site)));app.patch('/api/sites/:site',async req=>{const schema=z.object({
  name:z.string().min(1).optional(),domain:z.string().min(1).optional(),enabled:z.boolean().optional(),
  backup_enabled:z.boolean().optional(),backup_interval_seconds:z.coerce.number().int().min(900).max(2592000).optional(),backup_max_files:z.coerce.number().int().min(100).max(200000).optional(),
  monitor_enabled:z.boolean().optional(),monitor_url:z.string().url().optional(),monitor_interval_seconds:z.coerce.number().int().min(30).max(86400).optional(),
  monitor_expected_status:z.coerce.number().int().min(100).max(599).optional(),monitor_content:z.string().nullable().optional(),monitor_expected_title:z.string().nullable().optional(),
  monitor_check_dns:z.boolean().optional(),monitor_check_wordpress:z.boolean().optional(),monitor_timeout_ms:z.coerce.number().int().min(1000).max(60000).optional(),
  monitor_failure_threshold:z.coerce.number().int().min(1).max(20).optional(),alert_repeat_minutes:z.coerce.number().int().min(1).max(1440).optional(),
  response_warn_ms:z.coerce.number().int().min(1).max(60000).nullable().optional(),ssl_warn_days:z.coerce.number().int().min(1).max(365).optional(),
  exclude_patterns:z.array(z.string()).optional()
});const site=await updateSite(req.params.site,schema.parse(req.body));return{ok:true,site:publicSite(site)};});app.post('/api/backups/:id/restore-preview',async req=>backupRestorePreview(req.params.id,'dashboard'));app.post('/api/changes/:id/rollback-preview',async req=>rollbackPreview(req.params.id,'dashboard'));app.post('/api/previews/:id/apply',async req=>applyPreview(req.params.id));app.get('/mcp-info',async(_r,reply)=>reply.type('text/html').send(mcpInfoPage()));app.get('/settings',async(_r,reply)=>reply.type('text/html').send(settingsPage()));app.get('/setup',async(_r,reply)=>reply.type('text/html').send(setupPage()));app.get('/sites/:slug/seo',async(req,reply)=>reply.type('text/html').send(await seoDashboardPage(req.params.slug)));app.get('/sites/:slug/report',async(req,reply)=>reply.type('text/html').send(await clientReportPage(req.params.slug)));app.get('/seo/pages/:id',async(req,reply)=>reply.type('text/html').send(await seoPageDetailPage(req.params.id)));app.get('/sites/:slug',async(req,reply)=>reply.type('text/html').send(await siteOperationsPage(req.params.slug)));app.get('/incidents/:id',async(req,reply)=>reply.type('text/html').send(await incidentPage(req.params.id)));if(databaseReady){startMonitor();startBackupWorker();}await app.listen({host:cfg.host,port:cfg.port});app.log.info({port:cfg.port,host:cfg.host,databaseReady},'SiteOps listening');}

if(process.argv.includes('--check-runtime')){phpParser.parseCode('<?php echo 1;','smoke.php');await db.end();console.log('Runtime imports OK.');}else if(process.argv.includes('--migrate')){await migrate();await db.end();console.log('Database schema applied.');}else{start().catch(e=>{console.error(e);process.exit(1);});}
