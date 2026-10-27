import {promises as fs,createReadStream} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {videoFileRange} from './video-file-range.mjs';
const execute=promisify(execFile),CHUNK=1024*1024,MAX=50*CHUNK;
const root=()=>path.join(process.env.VIDEO_OUTPUT_DIR || path.join(os.tmpdir(),'siteops-video-studio'),'intros');
const uuid=id=>typeof id==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id);
const fail=(statusCode,message)=>{throw Object.assign(Error(message),{statusCode});};
export async function introAsset(id){
  if(!uuid(id))fail(422,'Ungültiges Intro.');
  const dir=path.join(root(),id);
  const metadata=await fs.readFile(path.join(dir,'ready.json'),'utf8').then(JSON.parse).catch(()=>null);
  if(!metadata)fail(404,'Intro noch nicht hochgeladen oder nicht verfügbar.');
  return {...metadata,filename:path.join(dir,'source')};
}
export async function probeIntro(filename){
  const {stdout}=await execute('ffprobe',['-v','error','-protocol_whitelist','file','-format_whitelist','mov,matroska,webm','-show_entries','format=duration:stream=codec_type,width,height,duration','-of','json',filename],{timeout:20000,maxBuffer:1024*1024});
  const data=JSON.parse(stdout),video=data.streams?.find(s=>s.codec_type==='video'),duration=Number(data.format?.duration || video?.duration);
  if(!video || !Number.isFinite(duration) || duration<0.5 || duration>60)fail(422,'Intro muss ein Video zwischen 0,5 und 60 Sekunden sein.');
  if(Math.min(video.width,video.height)<720 || Math.max(video.width,video.height)>4096 || video.width*video.height>4096*2160)fail(422,'Intro benötigt mindestens HD (720p) und darf höchstens 4K groß sein.');
  return {duration,width:video.width,height:video.height,has_audio:data.streams.some(s=>s.codec_type==='audio')};
}
export function registerIntroRunner(app,auth,{probe=probeIntro}={}){
  const locks=new Set();
  const locked=async(id,fn)=>{if(!uuid(id))fail(422,'Ungültige Upload-ID.');if(locks.has(id))fail(409,'Intro-Upload wird gerade verarbeitet.');locks.add(id);try{return await fn(path.join(root(),id));}finally{locks.delete(id);}};
  app.post('/video/intros/:id/chunks',{bodyLimit:1500000},async(req,reply)=>{
    if(!auth(req,reply))return;
    return locked(req.params.id,async dir=>{
      const {index,data}=req.body || {};
      if(!Number.isInteger(index)||index<0||index>=50||typeof data!=='string'||data.length>1398104||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))fail(422,'Ungültiger Intro-Dateiblock.');
      const bytes=Buffer.from(data,'base64');if(!bytes.length||bytes.length>CHUNK||bytes.toString('base64')!==data)fail(422,'Ungültige Intro-Dateikodierung.');
      await fs.mkdir(dir,{recursive:true});
      if(await fs.access(path.join(dir,'ready.json')).then(()=>true).catch(()=>false))fail(409,'Dieses Intro ist bereits fertig hochgeladen.');
      const stats=await fs.statfs(dir);if(Number(stats.bavail)*Number(stats.bsize)<512*CHUNK+2*MAX)fail(507,'Zu wenig freier Speicher für einen sicheren Intro-Upload.');
      const name=String(index).padStart(2,'0')+'.chunk',hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
      const old=await fs.readFile(path.join(dir,name)).catch(()=>null);
      if(old){if(hash(old)!==hash(bytes))fail(409,'Der erneut gesendete Dateiblock stimmt nicht überein.');return {ok:true,index};}
      const chunks=(await fs.readdir(dir)).filter(n=>/^\d\d\.chunk$/.test(n));if(chunks.length!==index)fail(409,'Intro-Dateiblöcke bitte der Reihe nach senden.');
      await fs.writeFile(path.join(dir,name),bytes,{flag:'wx'});return {ok:true,index};
    });
  });
  app.post('/video/intros/:id/complete',{config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async(req,reply)=>{
    if(!auth(req,reply))return;
    return locked(req.params.id,async dir=>{
      const existing=await introAsset(req.params.id).catch(()=>null);if(existing){const {filename:_file,...metadata}=existing;return metadata;}
      const chunks=await fs.readdir(dir).then(names=>names.filter(n=>/^\d\d\.chunk$/.test(n)).sort()).catch(()=>[]);
      if(!chunks.length)fail(422,'Intro-Datei fehlt.');
      const filename=path.join(dir,'source');await fs.writeFile(filename,Buffer.alloc(0));
      let size=0;
      for(const name of chunks){const bytes=await fs.readFile(path.join(dir,name));size+=bytes.length;if(size>MAX)fail(413,'Intro ist größer als 50 MB.');await fs.appendFile(filename,bytes);}
      let info;try{info=await probe(filename);}catch(error){await fs.rm(dir,{recursive:true,force:true});fail(422,error.statusCode?error.message:'Intro konnte nicht gelesen werden. Bitte MP4, MOV oder WebM verwenden.');}
      const metadata={id:req.params.id,...info,size};
      await fs.writeFile(path.join(dir,'ready.tmp'),JSON.stringify(metadata));await fs.rename(path.join(dir,'ready.tmp'),path.join(dir,'ready.json'));
      await Promise.all(chunks.map(n=>fs.unlink(path.join(dir,n))));return metadata;
    });
  });
  app.post('/video/intros/:id/cancel',async(req,reply)=>{if(!auth(req,reply))return;return locked(req.params.id,async dir=>{if(await introAsset(req.params.id).catch(()=>null))fail(409,'Ein fertiges Intro bleibt für bestehende Produktionen erhalten.');await fs.rm(dir,{recursive:true,force:true});return {ok:true};});});
  app.get('/video/intros/:id/file',async(req,reply)=>{
    if(!auth(req,reply))return;const asset=await introAsset(req.params.id),size=(await fs.stat(asset.filename)).size;
    // Serve the validated source using byte ranges; browser decoders determine the container.
    let range;try{range=videoFileRange(req.headers.range,size);}catch{return reply.code(416).header('Content-Range','bytes */'+size).send();}
    const head=await fs.open(asset.filename,'r');const header=Buffer.alloc(12);await head.read(header,0,12,0);await head.close();
    reply.code(range.status).type(header.subarray(4,8).toString()==='ftyp'?'video/mp4':'video/webm').header('Cache-Control','private, no-store').header('Accept-Ranges','bytes').header('Content-Length',range.length);
    if(range.status===206)reply.header('Content-Range','bytes '+range.start+'-'+range.end+'/'+size);
    return req.method==='HEAD'?reply.send():reply.send(createReadStream(asset.filename,{start:range.start,end:range.end}));
  });
}
