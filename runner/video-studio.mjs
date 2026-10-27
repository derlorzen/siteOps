import crypto from 'node:crypto';
import {outroSettings,validateOutroScenes,outroPage,outroDuration} from './video-outro.mjs';
import { promises as fs, createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { captureMode, requireCapturePlan } from './video-capture.mjs';
import { recordDemoScene, createDemoContext, demoBrowserArgs, validatedDemoSteps, validatedDemoUrl } from './video-demo.mjs';
import { DEMO_POLICY_VERSION, demoPolicy, environmentDemoPolicy } from './video-policy.mjs';
import { authenticateDemo, validateDemoLogin } from './video-login.mjs';
import { narrateWithOpenAI } from './openai-audio.mjs';
import { videoFileRange } from './video-file-range.mjs';

const ROOT=process.env.VIDEO_OUTPUT_DIR||path.join(os.tmpdir(),'siteops-video-studio');
const KOKORO_VOICES=new Set(['am_michael','am_adam','af_heart','bf_emma','bm_george']);
const PIPER_VOICES=new Set(['de_DE-thorsten-medium']);
const OPENAI_VOICES=new Set(['alloy','ash','ballad','coral','echo','fable','nova','onyx','sage','shimmer','verse','marin','cedar']);
const MAX_JOBS=Number(process.env.VIDEO_MAX_JOBS||30);
const MODEL_DIR=process.env.VIDEO_MODEL_DIR||path.join(ROOT,'models');
const modelInstallers=new Map();
async function ensureOfflineModels(provider){
  if(process.env.VIDEO_TTS_MODE==='silent')return;
  if(!modelInstallers.has(provider)){
    const action=exec(process.env.VIDEO_PYTHON||'python3',[
      new URL('./ensure-voice-models.py',import.meta.url).pathname,
      '--provider',provider,'--directory',MODEL_DIR],{timeoutMs:900000});
    modelInstallers.set(provider,action);
    action.catch(()=>modelInstallers.delete(provider));
  }
  await modelInstallers.get(provider);
}
let active=0;
const queue=[];
const statuses=new Map();
// Credentials and browser sessions are kept in RAM only, never in job status or files.
const jobLogins=new Map();
const jobOpenAIKeys=new Map();
const esc=v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const uuid=x=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(x||''));
async function exec(command,args,{cwd,timeoutMs=600000}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd,stdio:['ignore','pipe','pipe'],shell:false});
    let err='';
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error(command+' exceeded time limit'));},timeoutMs);
    child.stderr.on('data',chunk=>{err+=chunk.toString().slice(0,4000);if(err.length>12000)err=err.slice(-12000);});
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(command+' exited '+code+': '+err.slice(-1500)));});
  });
}
function safeDemoUrl(value, hosts){
  return value ? validatedDemoUrl(value, hosts) : null;
}
function validate(payload){
  const policy=Object.hasOwn(payload || {},'demoPolicy') ? demoPolicy(payload.demoPolicy) : environmentDemoPolicy();
  if(!uuid(payload?.id))throw new Error('Valid UUID required.');
  if(!Array.isArray(payload.scenes)||!payload.scenes.length||payload.scenes.length>24)
    throw new Error('1–24 scenes required.');
  const voiceProvider=payload.voiceProvider || 'kokoro';
  if(!['kokoro','piper','openai'].includes(voiceProvider))throw new Error('Unsupported voice provider.');
  const voiceSet=voiceProvider==='kokoro'?KOKORO_VOICES:voiceProvider==='piper'?PIPER_VOICES:OPENAI_VOICES;
  if(!voiceSet.has(payload.voice))throw new Error('Unsupported voice for '+voiceProvider+'.');
  if ((payload.language==='de' && voiceProvider==='kokoro') ||
      (payload.language==='en' && voiceProvider==='piper'))
    throw new Error('Language does not match offline voice provider.');
  if(!['en','de'].includes(payload.language)||!['landscape','portrait'].includes(payload.format))
    throw new Error('Unsupported language or format.');
  if(payload.openaiApiKey!==undefined && (voiceProvider!=='openai' || typeof payload.openaiApiKey!=='string' || !payload.openaiApiKey.trim() || payload.openaiApiKey.length>500))throw Error('Invalid per-job OpenAI credential.');
  const scenes=payload.scenes.map((s,i)=>{
    const narration=String(s.narration||'').trim(),headline=String(s.headline||'').trim();
    if(narration.length<5||narration.length>1400||headline.length>160)throw new Error('Invalid scene '+(i+1));
    const demoUrl=safeDemoUrl(s.demoUrl,policy.hosts);
    if(s.login_profile_id && (!uuid(s.login_profile_id) || !demoUrl || s.test_data_only!==true))throw Error('Authenticated demos require a valid profile and confirmed test data.');
    return {narration,headline,outro:outroSettings(s.outro),demoUrl,capture_mode:s.capture_mode,test_data_only:s.test_data_only,login_profile_id:s.login_profile_id,demoSteps:validatedDemoSteps(s.demoSteps||[],demoUrl,policy.hosts)};
  });
  validateOutroScenes(scenes);
  requireCapturePlan(scenes);
  if(payload.demoLogins!==undefined && (!Array.isArray(payload.demoLogins)||payload.demoLogins.length>10))throw Error('Invalid demo login profiles.');
  const logins=(payload.demoLogins||[]).map(profile=>validateDemoLogin(profile,policy.hosts));
  for(const scene of scenes.filter(s=>s.login_profile_id)){
    const login=logins.find(x=>x.id===scene.login_profile_id);
    if(!login || new URL(login.login_url).origin!==new URL(scene.demoUrl).origin)throw Error('Matching demo login profile required.');
  }
  return {id:payload.id,title:String(payload.title||'').slice(0,200),voice:payload.voice,
    voiceProvider,language:payload.language,format:payload.format,scenes,demoPolicy:policy};
}
async function persist(job){
  await fs.mkdir(path.join(ROOT,job.id),{recursive:true});
  await fs.writeFile(path.join(ROOT,job.id,'status.json'),JSON.stringify(job,null,2));
  statuses.set(job.id,job);
}
async function load(id){
  if(statuses.has(id))return statuses.get(id);
  try{
    const data=JSON.parse(await fs.readFile(path.join(ROOT,id,'status.json'),'utf8'));
    if(['queued','running'].includes(data.status)){
      data.status='failed';data.error='Renderer interrupted. Retry by creating a new job.';
      await persist(data);
    }
    return data;
  }catch{return null;}
}
const scenePage=(scene,title,index,total,orientation)=>{
  const vertical=orientation==='portrait';
  return '<!doctype html><html><head><meta charset="utf-8"><style>'+
    '*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#eef7ff;'+
    'background:radial-gradient(circle at 78% 22%,#155aa0 0%,#0c1c39 46%,#071126 100%);overflow:hidden}'+
    '.frame{height:100vh;display:flex;flex-direction:column;justify-content:center;padding:'+(vertical?'110px 68px':'140px 145px')+'}'+
    '.brand{position:absolute;top:64px;left:'+(vertical?'68px':'145px')+';font-size:26px;letter-spacing:3px;opacity:.75}'+
    '.tag{font-weight:700;color:#43c4f3;letter-spacing:4px;font-size:'+(vertical?'25px':'24px')+'}'+
    'h1{font-size:'+(vertical?'75px':'90px')+';line-height:1.1;letter-spacing:-2px;max-width:1450px;margin:30px 0}'+
    'p{font-size:'+(vertical?'34px':'38px')+';line-height:1.43;max-width:1430px;color:#c2d5e5}'+
    '.rule{height:8px;width:175px;background:#46c7f2;border-radius:8px;margin:14px 0 22px}'+
    '.foot{position:absolute;bottom:63px;left:'+(vertical?'68px':'145px')+';opacity:.65;font-size:23px}'+
    '.orb{position:absolute;right:-190px;bottom:-300px;border:2px solid #389dd633;border-radius:50%;width:730px;height:730px}'+
    '</style></head><body><div class="brand">LORZEN · VIDEO STUDIO</div><div class="orb"></div><div class="frame">'+
    '<span class="tag">'+(scene.language==='de'?'SZENE ':'SCENE ')+String(index+1).padStart(2,'0')+'</span>'+
    '<h1>'+esc(scene.headline||title)+'</h1><div class="rule"></div>'+
    '<p>'+esc(scene.narration.slice(0,230))+'</p></div>'+
    '<div class="foot">'+esc(title)+' · '+(index+1)+' / '+total+'</div></body></html>';
};
export async function captureSceneScreenshot(browser,scene,job,i,dir,proxyFactory,storageState){
  const guarded=await createDemoContext(browser,{...(storageState?{storageState}:{}),viewport:job.format==='portrait'?{width:1080,height:1920}:{width:1920,height:1080}},job.demoPolicy.hosts,proxyFactory);
  try {
  const page=await guarded.context.newPage();
  const target=path.join(dir,'scene-'+String(i).padStart(2,'0')+'.png');
  if(scene.demoUrl){
    const response=await page.goto(scene.demoUrl,{waitUntil:'domcontentloaded',timeout:30000});
    if(!response?.ok())throw Error('Demo-Zielseite hat einen HTTP-Fehler geliefert.');
    validatedDemoUrl(page.url(),job.demoPolicy.hosts);
    if(await page.locator('input[type="password"]').first().isVisible())throw Error('Demo-Sitzung nicht gültig: Login-Seite statt Aufnahmeziel.');
    await page.waitForTimeout(1200);
  }else await page.setContent(scene.outro?outroPage(scene,job.format):scenePage(scene,job.title,i,job.scenes.length,job.format),{waitUntil:'load'});
  await page.screenshot({path:target,type:'png',animations:'disabled'});
  return target;
  } finally { await guarded.close(); }
}
async function voice(scene,job,i,dir){
  const target=path.join(dir,'voice-'+String(i).padStart(2,'0')+'.wav');
  const narration=path.join(dir,'text-'+String(i).padStart(2,'0')+'.txt');
  await fs.writeFile(narration,scene.narration);
  const voiceProvider=job.voiceProvider || 'kokoro';
  if(process.env.VIDEO_TTS_MODE==='silent'){
    await exec('ffmpeg',['-y','-f','lavfi','-i','anullsrc=r=24000:cl=mono','-t',
      String(Math.min(120,Math.max(4,scene.narration.split(/\s+/).length/2.3))),
      '-c:a','pcm_s16le',target],{timeoutMs:30000});
  }else if(voiceProvider==='openai'){
    await narrateWithOpenAI(scene.narration,target,{voice:job.voice,language:job.language,apiKey:jobOpenAIKeys.get(job.id) || process.env.OPENAI_API_KEY});
  }else if(voiceProvider==='kokoro'){
    await ensureOfflineModels('kokoro');
    await exec(process.env.VIDEO_PYTHON||'python3',
      [new URL('./kokoro-voice.py',import.meta.url).pathname,
        '--model',process.env.KOKORO_MODEL_PATH||path.join(MODEL_DIR,'kokoro-v1.0.onnx'),
        '--voices',process.env.KOKORO_VOICES_PATH||path.join(MODEL_DIR,'voices-v1.0.bin'),
        '--text',narration,'--output',target,'--voice',job.voice,'--language',job.language],
      {timeoutMs:240000});
  }else if(voiceProvider==='piper'){
    await ensureOfflineModels('piper');
    await exec(process.env.VIDEO_PYTHON||'python3',
      [new URL('./piper-voice.py',import.meta.url).pathname,
        '--model',path.join(MODEL_DIR,'de_DE-thorsten-medium.onnx'),
        '--text',narration,'--output',target],{timeoutMs:240000});
  }else{
    throw new Error('Unsupported VIDEO_TTS_PROVIDER: '+voiceProvider);
  }
  return target;
}
async function duration(wav){
  const {stdout}=await new Promise((resolve,reject)=>{
    const child=spawn('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',wav]);
    let out='',err='';
    child.stdout.on('data',x=>out+=x);
    child.stderr.on('data',x=>err+=x);
    child.on('error',reject);
    child.on('close',c=>c===0?resolve({stdout:out}):reject(Error(err)));
  });
  const n=Number(stdout.trim());
  if(!Number.isFinite(n)||n<=0)throw Error('Invalid narration duration');
  return n;
}
export async function verifyVideoDimensions(filename,width,height) {
  const actual=await new Promise((resolve,reject)=>{
    const child=spawn('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','csv=p=0',filename]);
    let output=''; const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Video quality check timed out.'));},30000);
    child.stdout.on('data',chunk=>{output+=chunk.toString().slice(0,100);});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',code=>{clearTimeout(timer);code===0?resolve(output.trim()):reject(Error('Video quality check failed.'));});
  });
  if(actual!==width+','+height)throw Error('Full-HD-Prüfung fehlgeschlagen: erwartet '+width+'×'+height+', erhalten '+actual+'.');
  return {width,height};
}
function srtTime(seconds){
  const ms=Math.round(seconds*1000),h=Math.floor(ms/3600000),m=Math.floor(ms/60000)%60,s=Math.floor(ms/1000)%60,n=ms%1000;
  return [h,m,s].map(x=>String(x).padStart(2,'0')).join(':')+','+String(n).padStart(3,'0');
}
async function render(job){
  const dir=path.join(ROOT,job.id);
  const portrait=job.format==='portrait';
  const width=portrait?1080:1920,height=portrait?1920:1080;
  let browser=null;
  const parts=[],subtitles=[];
  const sessions=new Map();
  let current=0;
  try{
    browser=await chromium.launch({headless:true,args:demoBrowserArgs});
    requireCapturePlan(job.scenes);
    job.captures=[];
    for(let i=0;i<job.scenes.length;i++){
      const scene={...job.scenes[i],language:job.language};
      job.progress=Math.round(i/job.scenes.length*30);
      await persist(job);
      try {
      const profile=(jobLogins.get(job.id)||[]).find(x=>x.id===scene.login_profile_id);
      if(scene.login_profile_id && !sessions.has(scene.login_profile_id)) sessions.set(scene.login_profile_id,await authenticateDemo(browser,profile,job.demoPolicy.hosts));
      const storageState=sessions.get(scene.login_profile_id);
      const recording = captureMode(scene)==='recording';
      const png = path.join(dir,'scene-'+String(i).padStart(2,'0')+'.png');
      const webm = path.join(dir,'scene-'+String(i).padStart(2,'0')+'.webm');
      if (recording) {
        await recordDemoScene(browser,scene,webm,{width,height},job.demoPolicy.hosts,png,undefined,storageState);
      } else {
        await captureSceneScreenshot(browser,scene,job,i,dir,undefined,storageState);
      }
      if(recording)await verifyVideoDimensions(webm,width,height);
      job.captures.push({scene:i+1,mode:captureMode(scene),status:'captured',resolution:{width,height}});
      }catch(error){throw Error('Szene '+(i+1)+' – Aufnahme fehlgeschlagen: '+error.message);}
    }
    await persist(job);
    for(let i=0;i<job.scenes.length;i++){
      const scene={...job.scenes[i],language:job.language};
      job.progress=30+Math.round(i/job.scenes.length*55);await persist(job);
      const recording=captureMode(scene)==='recording';
      const png=path.join(dir,'scene-'+String(i).padStart(2,'0')+'.png');
      const webm=path.join(dir,'scene-'+String(i).padStart(2,'0')+'.webm');
      const wav=await voice(scene,job,i,dir);
      const audioLen=await duration(wav),len=outroDuration(scene,audioLen),out=path.join(dir,'part-'+String(i).padStart(2,'0')+'.mp4');
      if (recording) {
        await exec('ffmpeg',['-y','-i',webm,'-i',wav,
          '-vf','scale='+width+':'+height+',setsar=1,fps=25,tpad=stop_mode=clone:stop_duration=125',
          '-t',String(len),'-c:v','libx264','-preset','veryfast',
          '-pix_fmt','yuv420p','-r','25','-c:a','aac','-b:a','128k',
          '-movflags','+faststart',out]);
      } else {
        await exec('ffmpeg',['-y','-loop','1','-framerate','25','-i',png,'-i',wav,
          '-c:v','libx264','-preset','veryfast','-tune','stillimage','-pix_fmt','yuv420p',
          '-r','25','-c:a','aac','-b:a','128k',...(scene.outro?['-af','apad','-t',String(len)]:[]),'-shortest','-movflags','+faststart',out]);
      }
      parts.push(out);
      subtitles.push(String(i+1)+'\n'+srtTime(current)+' --> '+srtTime(current+audioLen)+'\n'+scene.narration+'\n');
      if(scene.outro)job.outro={start_seconds:current,duration_seconds:len,channel:scene.outro.channel,website:scene.outro.website};
      current+=len;
    }
    await browser.close();browser=null;
    await fs.writeFile(path.join(dir,'concat.txt'),parts.map(p=>"file '"+p.replace(/'/g,"'\\''")+"'").join('\n'));
    await fs.writeFile(path.join(dir,'subtitles.srt'),subtitles.join('\n'));
    await exec('ffmpeg',['-y','-f','concat','-safe','0','-i',path.join(dir,'concat.txt'),
      '-c','copy','-movflags','+faststart',path.join(dir,'video.mp4')]);
    await exec('ffmpeg',['-y','-i',path.join(dir,'video.mp4'),'-t','59','-vf',
      'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x071126',
      '-c:v','libx264','-preset','veryfast','-c:a','aac','-movflags','+faststart',path.join(dir,'short.mp4')]);
    await fs.copyFile(path.join(dir,'scene-00.png'),path.join(dir,'thumbnail.png'));
    await verifyVideoDimensions(path.join(dir,'video.mp4'),width,height);
    await verifyVideoDimensions(path.join(dir,'short.mp4'),1080,1920);
    job.resolution={width,height};
    job.status='done';job.progress=100;job.duration=Math.round(current);
    job.files=['video','short','subtitles','thumbnail'];
  }catch(error){
    job.status='failed';job.error=String(error.message||error).slice(0,1000);
  }finally{
    jobLogins.delete(job.id); jobOpenAIKeys.delete(job.id); sessions.clear();
    if(browser)await browser.close().catch(()=>{});
    await persist(job);
    active=Math.max(0,active-1);
    dispatch();
  }
}
function dispatch(){
  while(active<1 && queue.length){
    const job=queue.shift();
    active++;
    job.status='running';job.progress=0;
    persist(job).then(()=>render(job)).catch(async error=>{
      jobLogins.delete(job.id); jobOpenAIKeys.delete(job.id);
      job.status='failed';job.error=String(error.message||error);await persist(job);
      active=Math.max(0,active-1);dispatch();
    });
  }
}
export function registerVideoRunner(app,auth,{narrate=narrateWithOpenAI,dispatchJobs=dispatch}={}){
  app.get('/video/capabilities',async(req,reply)=>{
    if(!auth(req,reply))return;
    const exists=async file=>fs.access(file).then(()=>true).catch(()=>false);
    const kokoroFiles=await Promise.all(['kokoro-v1.0.onnx','voices-v1.0.bin'].map(n=>exists(path.join(MODEL_DIR,n))));
    const piperFiles=await Promise.all(['de_DE-thorsten-medium.onnx','de_DE-thorsten-medium.onnx.json'].map(n=>exists(path.join(MODEL_DIR,n))));
    let demoEnvironmentPolicy=null,demoEnvironmentError=null;
    try {demoEnvironmentPolicy=environmentDemoPolicy();}catch{demoEnvironmentError='VIDEO_ALLOWED_HOSTS enthält ungültige Regeln. Demos bleiben gesperrt, bis die Konfiguration korrigiert oder in SiteOps überschrieben wird.';}
    return {
      outroVersion:1,capturePreflightVersion:1,openaiKeyForwardingVersion:1,
      demoLoginVersion:1,outputResolution:{landscape:{width:1920,height:1080},portrait:{width:1080,height:1920}},
      demoPolicyVersion:DEMO_POLICY_VERSION,demoEnvironmentPolicy,demoEnvironmentError,artifactRanges:true,
      languages:['en','de'], providers:{en:['kokoro','openai'],de:['piper','openai']},
      offlineModels:{kokoro:kokoroFiles.every(Boolean),piper:piperFiles.every(Boolean)},
      modelAutoinstall:true, openaiConfigured:Boolean(process.env.OPENAI_API_KEY),
      ffmpegRequired:true,queued:queue.length,running:active
    };
  });
  app.post('/video/openai-audio-test',{config:{rateLimit:{max:3,timeWindow:'1 minute'}}},async(req,reply)=>{
    if(!auth(req,reply))return;
    const apiKey=req.body?.apiKey || process.env.OPENAI_API_KEY;
    if(typeof apiKey!=='string' || !apiKey.trim() || apiKey.length>500)return reply.code(422).send({error:'OpenAI-Schlüssel für die Sprachausgabe fehlt.'});
    if(req.body)delete req.body.apiKey;
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'siteops-audio-test-'));
    try{await narrate('This is a short SiteOps audio connection test.',path.join(dir,'test.wav'),{apiKey,voice:'alloy',language:'en'});return {ok:true,model:'gpt-audio-1.5'};}
    catch(error){return reply.code(422).send({error:String(error.message||error).replaceAll(apiKey,'[REDACTED]').replace(/sk-[A-Za-z0-9_-]+/g,'[REDACTED]').slice(0,1000)});}
    finally{await fs.rm(dir,{recursive:true,force:true});}
  });
  app.post('/video/capture-test',{config:{rateLimit:{max:3,timeWindow:'1 minute'}}},async(req,reply)=>{
    if(!auth(req,reply))return;
    let scene,policy,profile;
    try{
      policy=demoPolicy(req.body?.demoPolicy);scene=req.body?.scene;
      requireCapturePlan([scene || {}]);
      if(captureMode(scene)==='text')throw Error('Keine Browser-Aufnahme geplant.');
      validatedDemoUrl(scene.demoUrl,policy.hosts);validatedDemoSteps(scene.demoSteps||[],scene.demoUrl,policy.hosts);
      if(!['landscape','portrait'].includes(req.body?.format))throw Error('Ungültiges Videoformat.');
      if(scene.login_profile_id){profile=validateDemoLogin(req.body.profile,policy.hosts);if(profile.id!==scene.login_profile_id || new URL(profile.login_url).origin!==new URL(scene.demoUrl).origin)throw Error('Passendes Loginprofil fehlt.');}
    }catch(error){return reply.code(422).send({error:error.message});}
    let browser,dir;
    try{
      browser=await chromium.launch({headless:true,args:demoBrowserArgs});
      dir=await fs.mkdtemp(path.join(os.tmpdir(),'siteops-capture-test-'));
      const storageState=profile?await authenticateDemo(browser,profile,policy.hosts):undefined;
      const width=req.body.format==='portrait'?1080:1920,height=req.body.format==='portrait'?1920:1080;
      const mode=captureMode(scene);
      if(mode==='recording'){
        const target=path.join(dir,'test.webm');
        await recordDemoScene(browser,scene,target,{width,height},policy.hosts,path.join(dir,'test.png'),undefined,storageState);
        await verifyVideoDimensions(target,width,height);
      }else await captureSceneScreenshot(browser,scene,{demoPolicy:policy,format:req.body.format},0,dir,undefined,storageState);
      return {ok:true,resolution:{width,height},actions_executed:scene.demoSteps?.length || 0,message:mode==='recording'?'Bildschirmaufnahme erfolgreich getestet: Zielseite, Anmeldung falls nötig, alle Aktionen und Full HD.':'Browser-Standbild erfolgreich getestet. Keine bewegte Bildschirmaufnahme.'};
    }catch(error){
      const detail=/^(Demo-|Only explicitly|Full-HD)/.test(error.message || '')?error.message:'Zielseite, Domainfreigabe, Demo-Login und Aktions-Selektoren prüfen.';
      return reply.code(422).send({error:('Aufnahme fehlgeschlagen: '+detail+' Es wird keine Texttafel als Ersatz erstellt.').slice(0,900)});
    }finally{await browser?.close().catch(()=>{});if(dir)await fs.rm(dir,{recursive:true,force:true});}
  });
  app.post('/video/demo-login/test',{config:{rateLimit:{max:3,timeWindow:'1 minute'}}},async(req,reply)=>{
    if(!auth(req,reply))return;
    let policy,profile;
    try{policy=demoPolicy(req.body?.demoPolicy);profile=validateDemoLogin(req.body?.profile,policy.hosts);}catch{return reply.code(422).send({error:'Ungültiges Demo-Loginprofil oder nicht freigegebene Domain.'});}
    let browser;
    try{browser=await chromium.launch({headless:true,args:demoBrowserArgs});await authenticateDemo(browser,profile,policy.hosts);return {ok:true};}
    catch(error){return reply.code(422).send({error:error.message});}
    finally{await browser?.close().catch(()=>{});}
  });
  app.post('/video/jobs',async(req,reply)=>{
    if(!auth(req,reply))return;
    let parsed;
    try{parsed=validate(req.body);}
    catch(error){return reply.code(422).send({error:String(error.message||error)});}
    const old=await load(parsed.id);
    if(old) return reply.code(409).send({error:'Job already exists.'});
    if(queue.length+active>=MAX_JOBS)return reply.code(429).send({error:'Video queue full.'});
    if(parsed.voiceProvider==='openai' && !req.body.openaiApiKey && !process.env.OPENAI_API_KEY)return reply.code(422).send({error:'Für OpenAI-Sprachausgabe fehlt der Schlüssel. In den Suite-Einstellungen speichern oder OPENAI_API_KEY auf dem Runner setzen.'});
    const job={...parsed,status:'queued',progress:0,files:[],error:null,createdAt:new Date().toISOString()};
    const profiles=(req.body.demoLogins||[]).map(x=>validateDemoLogin(x,parsed.demoPolicy.hosts));
    if(profiles.length)jobLogins.set(job.id,profiles);
    if(req.body.openaiApiKey){jobOpenAIKeys.set(job.id,req.body.openaiApiKey);delete req.body.openaiApiKey;}
    try{await persist(job);}catch(error){jobLogins.delete(job.id);jobOpenAIKeys.delete(job.id);throw error;}
    queue.push(job);dispatchJobs();
    return reply.code(202).send({id:job.id,status:'queued'});
  });
  app.get('/video/jobs/:id',async(req,reply)=>{
    if(!auth(req,reply))return;
    if(!uuid(req.params.id))return reply.code(400).send({error:'Invalid job ID'});
    const job=await load(req.params.id);
    if(!job)return reply.code(404).send({error:'Job not found'});
    return {id:job.id,status:job.status,progress:job.progress,files:job.files,error:job.error,duration:job.duration,resolution:job.resolution,captures:job.captures || [],outro:job.outro || null};
  });
  app.get('/video/jobs/:id/file',async(req,reply)=>{
    if(!auth(req,reply))return;
    const id=req.params.id,kind=String(req.query?.kind||'video');
    if(!uuid(id)||!['video','short','subtitles','thumbnail'].includes(kind))
      return reply.code(400).send({error:'Invalid file request'});
    const job=await load(id);
    if(!job||job.status!=='done')return reply.code(404).send({error:'Video not ready'});
    const names={video:'video.mp4',short:'short.mp4',subtitles:'subtitles.srt',thumbnail:'thumbnail.png'};
    const types={video:'video/mp4',short:'video/mp4',subtitles:'text/plain; charset=utf-8',thumbnail:'image/png'};
    const filename=path.join(ROOT,id,names[kind]);
    const size=(await fs.stat(filename)).size;
    let range;
    try{range=videoFileRange(req.headers.range,size);}catch{return reply.code(416).header('Content-Range','bytes */'+size).send({error:'Invalid byte range.'});}
    reply.code(range.status).type(types[kind]).header('Cache-Control','private, no-store').header('Accept-Ranges','bytes').header('Content-Length',range.length);
    if(range.status===206)reply.header('Content-Range','bytes '+range.start+'-'+range.end+'/'+size);
    return reply.send(createReadStream(filename,{start:range.start,end:range.end}));
  });
}
