(()=>{'use strict';
const $=s=>document.querySelector(s);
const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const msg=(v,bad=false)=>{const el=$('#vs-message');el.textContent=v;el.classList.toggle('vs-error',bad);};
const api=async(url,method='GET',data)=>{
  const r=await fetch(url,{method,credentials:'same-origin',headers:data?{'content-type':'application/json'}:{},
    body:data?JSON.stringify(data):undefined});
  const x=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(x.error||x.message||'HTTP '+r.status);
  return x;
};
const formatDate=x=>new Date(x).toLocaleString('de-DE');
let projects=[],jobs=[];
const voiceChoices={
  kokoro:[['am_michael','Michael – English'],['am_adam','Adam – English'],['af_heart','Heart – English'],['bf_emma','Emma – British'],['bm_george','George – British']],
  openai:[['alloy','Alloy'],['coral','Coral'],['nova','Nova'],['onyx','Onyx'],['shimmer','Shimmer'],['marin','Marin'],['cedar','Cedar']]
};
function updateVoiceChoices(){
  const provider=$('#vs-voice-provider').value;
  $('#vs-voice').innerHTML=voiceChoices[provider].map(([value,label])=>
    '<option value="'+value+'">'+label+'</option>').join('');
}
$('#vs-voice-provider').addEventListener('change',updateVoiceChoices);
async function reload(){
  try{
    [projects,jobs]=await Promise.all([api('/api/video-studio/projects'),api('/api/video-studio/jobs')]);
    const el=$('#vs-project'),old=el.value;
    el.innerHTML='<option value="">Projekt auswählen</option>'+
      projects.map(p=>'<option value="'+escapeHtml(p.id)+'">'+escapeHtml(p.name)+' · '+escapeHtml(p.channel)+'</option>').join('');
    if(projects.some(p=>p.id===old))el.value=old;
    else if(projects.length)el.value=projects[0].id;
    $('#vs-jobs').innerHTML=jobs.length?jobs.map(j=>{
      const status=escapeHtml(j.status);
      const available=j.status==='done';
      const fileLink=(kind,label)=>'<a href="/api/video-studio/jobs/'+encodeURIComponent(j.id)+'/file?kind='+kind+'">'+label+'</a>';
      return '<article class="vs-job" data-id="'+escapeHtml(j.id)+'"><div class="vs-job-head"><strong>'+escapeHtml(j.title)+'</strong><span class="vs-status">'+status+'</span></div>'+
        '<small>'+escapeHtml(formatDate(j.created_at))+'</small>'+
        (j.error?'<p class="vs-error">'+escapeHtml(j.error)+'</p>':'')+
        '<div class="vs-row">'+
        (['draft','failed'].includes(j.status)?'<button type="button" data-render="'+escapeHtml(j.id)+'">Video rendern</button>':'')+
        (['running','queued'].includes(j.status)?'<button type="button" data-check="'+escapeHtml(j.id)+'">Status prüfen</button>':'')+
        (available?fileLink('video','MP4 herunterladen')+fileLink('short','Short 9:16')+
          fileLink('subtitles','Untertitel')+fileLink('thumbnail','Thumbnail'):'')+
        '</div></article>';
    }).join(''):'<p class="vs-note">Noch keine Videoprojekte erstellt.</p>';
  }catch(e){msg('Daten konnten nicht geladen werden: '+e.message,true);}
}
$('#vs-project-add').addEventListener('click',async()=>{
  const name=$('#vs-project-name').value.trim();
  if(name.length<2)return msg('Projektname benötigt mindestens zwei Zeichen.',true);
  try{
    const created=await api('/api/video-studio/projects','POST',{
      name,channel:'Bagisto',language:'en',voice_provider:$('#vs-voice-provider').value,voice:$('#vs-voice').value
    });
    await reload();$('#vs-project').value=created.id;$('#vs-project-name').value='';
    msg('Projekt wurde erstellt.');
  }catch(e){msg(e.message,true);}
});
$('#vs-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const project_id=$('#vs-project').value;
  if(!project_id)return msg('Bitte zuerst ein Projekt erstellen.',true);
  const title=$('#vs-title').value.trim();
  const raw=$('#vs-scene-json').value.trim();
  let scenes,script=$('#vs-script').value.trim();
  if(raw){
    try { scenes=JSON.parse(raw); }
    catch { return msg('Der strukturierte Szenenplan enthält ungültiges JSON.',true); }
    if(!Array.isArray(scenes)||!scenes.length||scenes.length>24||
       scenes.some(s=>!s||typeof s.narration!=='string'||s.narration.length<5||s.narration.length>1400))
      return msg('Szenenplan: 1–24 Szenen mit jeweils 5–1.400 Zeichen Sprechertext angeben.',true);
    if(!script) script=scenes.map(s=>s.narration).join('\n\n');
  }else{
    const paragraphs=script.split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean);
    if(!paragraphs.length||paragraphs.length>24||paragraphs.some(s=>s.length<5||s.length>1400))
      return msg('Skript muss 1–24 Absätze mit jeweils 5–1.400 Zeichen enthalten.',true);
  }
  if(script.length<30)return msg('Mindestens 30 Zeichen Sprechertext erforderlich.',true);
  const button=$('#vs-create');button.disabled=true;
  try{
    const job=await api('/api/video-studio/jobs','POST',{
      project_id,title,topic:$('#vs-topic').value.trim(),script,scenes,format:$('#vs-format').value
    });
    msg('Videoentwurf gespeichert. Klicke auf „Video rendern“, um den Runner zu starten.');
    await reload();
    document.querySelector('[data-id="'+job.id+'"]')?.scrollIntoView({behavior:'smooth',block:'center'});
  }catch(e){msg(e.message,true);}
  finally{button.disabled=false;}
});
$('#vs-jobs').addEventListener('click',async event=>{
  const render=event.target.closest('[data-render]'),check=event.target.closest('[data-check]');
  if(!render&&!check)return;
  const target=render||check;target.disabled=true;
  try{
    const id=target.dataset.render||target.dataset.check;
    const result=await api('/api/video-studio/jobs/'+encodeURIComponent(id)+(render?'/render':''),render?'POST':'GET',render?{}:undefined);
    msg(render?'Renderauftrag übergeben. Der Renderer verarbeitet das Video im Hintergrund.':'Status: '+result.status+(result.runner_warning?' · '+result.runner_warning:''));
    await reload();
  }catch(e){msg(e.message,true);}
  finally{target.disabled=false;}
});
$('#vs-refresh').addEventListener('click',reload);
reload();
setInterval(()=>{if(document.visibilityState==='visible'&&jobs.some(j=>['running','queued'].includes(j.status))){
  Promise.all(jobs.filter(j=>['running','queued'].includes(j.status)).map(j=>
    api('/api/video-studio/jobs/'+encodeURIComponent(j.id)).catch(()=>null))).then(reload);
}},12000);
})();