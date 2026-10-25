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
  en:{
    kokoro:[['am_michael','Michael – US'],['am_adam','Adam – US'],['af_heart','Heart – US'],['bf_emma','Emma – UK'],['bm_george','George – UK']],
    openai:[['alloy','Alloy'],['coral','Coral'],['nova','Nova'],['onyx','Onyx'],['shimmer','Shimmer'],['marin','Marin'],['cedar','Cedar']]
  },
  de:{
    piper:[['de_DE-thorsten-medium','Thorsten – Deutsch'],['de_DE-kerstin-low','Kerstin – Deutsch']],
    openai:[['alloy','Alloy'],['coral','Coral'],['nova','Nova'],['onyx','Onyx'],['shimmer','Shimmer'],['marin','Marin'],['cedar','Cedar']]
  }
};
function updateVoiceChoices(){
  const language=$('#vs-language').value;
  const providerEl=$('#vs-voice-provider');
  const provider=providerEl.value;
  providerEl.innerHTML=Object.keys(voiceChoices[language]).map(p=>
    '<option value="'+p+'">'+(p==='kokoro'?'Kokoro – lokal, kostenlos':p==='piper'?'Piper – lokal, kostenlos':'OpenAI – API-Kosten')+'</option>').join('');
  if(voiceChoices[language][provider])providerEl.value=provider;
  const voices=voiceChoices[language][providerEl.value];
  const old=$('#vs-voice').value;
  $('#vs-voice').innerHTML=voices.map(([value,label])=>
    '<option value="'+value+'">'+label+'</option>').join('');
  if(voices.some(v=>v[0]===old))$('#vs-voice').value=old;
}
function applyProjectSettings(){
  const project=projects.find(p=>p.id===$('#vs-project').value);
  if(!project)return;
  $('#vs-language').value=project.language||'en';
  updateVoiceChoices();
  $('#vs-voice-provider').value=project.voice_provider||(project.language==='de'?'piper':'kokoro');
  updateVoiceChoices();
  $('#vs-voice').value=project.voice;
}
$('#vs-language').addEventListener('change',updateVoiceChoices);
$('#vs-voice-provider').addEventListener('change',updateVoiceChoices);
$('#vs-project').addEventListener('change',applyProjectSettings);
async function loadReadiness(){
  const el=$('#vs-readiness');
  try{
    const status=await api('/api/video-studio/capabilities');
    if(!status.connected){el.textContent='Nicht bereit: '+(status.error||'Runner nicht erreichbar.');return;}
    el.innerHTML=['en','de'].map(lang=>{
      const providers=status.voices?.[lang]||{};
      const items=Object.entries(providers).map(([provider,info])=>
        '<span style="margin-right:14px">'+(info.ready?'✓':'✗')+' '+
        escapeHtml(provider==='piper'?'Piper':provider==='kokoro'?'Kokoro':'OpenAI')+'</span>').join('');
      return '<p><strong>'+(lang==='de'?'Deutsch':'Englisch')+': </strong>'+items+'</p>';
    }).join('')+'<p>Aktive Aufträge: '+Number(status.activeJobs||0)+', wartend: '+Number(status.queuedJobs||0)+'</p>';
  }catch(err){el.textContent='Runner-Status nicht verfügbar: '+err.message;}
}
$('#vs-status-refresh').addEventListener('click',loadReadiness);
$('#vs-project-save').addEventListener('click',async()=>{
  const id=$('#vs-project').value;
  if(!id)return msg('Bitte zuerst ein Projekt auswählen.',true);
  try{
    await api('/api/video-studio/projects/'+encodeURIComponent(id),'PATCH',{
      language:$('#vs-language').value,
      voice_provider:$('#vs-voice-provider').value,
      voice:$('#vs-voice').value
    });
    await reload();
    msg('Sprach- und Stimmeneinstellungen gespeichert.');
  }catch(error){msg(error.message,true);}
});
async function reload(){
  try{
    [projects,jobs]=await Promise.all([api('/api/video-studio/projects'),api('/api/video-studio/jobs')]);
    const el=$('#vs-project'),old=el.value;
    el.innerHTML='<option value="">Projekt auswählen</option>'+
      projects.map(p=>'<option value="'+escapeHtml(p.id)+'">'+escapeHtml(p.name)+' · '+escapeHtml(p.channel)+'</option>').join('');
    if(projects.some(p=>p.id===old))el.value=old;
    else if(projects.length)el.value=projects[0].id;
    applyProjectSettings();
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
      name,channel:'Bagisto',language:$('#vs-language').value,voice_provider:$('#vs-voice-provider').value,voice:$('#vs-voice').value
    });
    await reload();$('#vs-project').value=created.id;applyProjectSettings();$('#vs-project-name').value='';
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
reload();loadReadiness();
setInterval(()=>{if(document.visibilityState==='visible'&&jobs.some(j=>['running','queued'].includes(j.status))){
  Promise.all(jobs.filter(j=>['running','queued'].includes(j.status)).map(j=>
    api('/api/video-studio/jobs/'+encodeURIComponent(j.id)).catch(()=>null))).then(reload);
}},12000);
})();