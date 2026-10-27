(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const api = async (path, data) => {
    const r = await fetch('/api/video-suite/' + path, { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: data === undefined ? {} : { 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
    const result = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(result.message || result.error || 'Anfrage fehlgeschlagen.');
    return result;
  };
  function view(id) {
    if (!['overview', 'agent', 'ideas', 'storyboard', 'editing', 'script', 'production', 'assets', 'review', 'publish', 'repurpose', 'settings'].includes(id)) id = 'overview';
    const paneId=['ideas','storyboard','editing'].includes(id)?'agent':id;
    for (const pane of document.querySelectorAll('[data-suite-pane]')) pane.hidden = pane.dataset.suitePane !== paneId;
    for (const item of document.querySelectorAll('[data-suite-nav]')) {
      if (item.dataset.suiteNav === id) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
    }
    document.querySelector('.suite').dataset.suitePage = id;
    if (id === 'assets') loadSeo();
  }
  document.addEventListener('click', event => {
    const link = event.target.closest('[data-suite-nav],[data-suite-go]');
    if (!link) return;
    event.preventDefault();
    location.hash = link.dataset.suiteNav || link.dataset.suiteGo;
  });
  window.addEventListener('hashchange', () => view(location.hash.slice(1)));
  view(location.hash.slice(1));
  let projectId = '', conversationId, latest, scenes = [], saveTimer, dirty = false, loading = false, sending = false, uploadingImages = false, chatAttachments = [];
  const draftFields = ['vs-title', 'vs-topic', 'vs-script', 'vs-scene-json', 'vs-youtube-json', 'vs-format'];
  const snapshot = () => ({ title: $('vs-title').value, topic: $('vs-topic').value, script: $('vs-script').value, scene_json: $('vs-scene-json').value, youtube_json: $('vs-youtube-json').value, format: $('vs-format').value });
  function fillDraft(draft) {
    $('vs-title').value = draft?.title || ''; $('vs-topic').value = draft?.topic || '';
    $('vs-script').value = draft?.script || ''; $('vs-scene-json').value = draft?.scene_json || '';
    $('vs-youtube-json').value = draft?.youtube_json || ''; $('vs-format').value = draft?.format || 'landscape';
    syncScenes(); loadSeo();
  }
  let saveChain = Promise.resolve();
  function saveCurrent() {
    clearTimeout(saveTimer);
    if (!projectId || !dirty || loading) return saveChain;
    const id = projectId, content = snapshot(); dirty = false;
    $('suite-draft-state').textContent = 'Speichert …';
    saveChain = saveChain.catch(() => {}).then(() => api('drafts/' + id, content)).then(() => {
      if (id === projectId) $('suite-draft-state').textContent = 'Entwurf online gespeichert';
    }).catch(e => { if (id === projectId) { dirty = true; $('suite-draft-state').textContent = 'Nicht gespeichert: ' + e.message; } throw e; });
    return saveChain;
  }
  function changed() {
    if (loading) return;
    dirty = true; $('suite-draft-state').textContent = 'Ungespeicherte Änderungen';
    clearTimeout(saveTimer); saveTimer = setTimeout(() => saveCurrent().catch(() => {}), 900);
  }
  for (const id of draftFields) $(id).addEventListener('input', changed);
  window.addEventListener('beforeunload', event => { if (dirty || sending) { event.preventDefault(); event.returnValue = ''; } });
  $('vs-script').addEventListener('input', () => {
    // Keep text-only scenes and manual narration in agreement. Preserve verified demo actions by index.
    const blocks = $('vs-script').value.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
    scenes = blocks.map((narration, i) => ({ ...(scenes[i] || {}), headline: scenes[i]?.headline || 'Szene ' + (i + 1), narration }));
    $('vs-scene-json').value = JSON.stringify(scenes, null, 2); drawScenes();
  });
  $('vs-scene-json').addEventListener('change', () => { syncScenes(); if (scenes.length) $('vs-script').value = scenes.map(s => s.narration).join('\n\n'); changed(); });
  function syncScenes() {
    try { scenes = $('vs-scene-json').value.trim() ? JSON.parse($('vs-scene-json').value) : $('vs-script').value.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean).map((narration, i) => ({ headline: 'Szene ' + (i + 1), narration })); if (!Array.isArray(scenes)) scenes = []; }
    catch { scenes = []; }
    drawScenes();
  }
  function commitScenes() {
    $('vs-scene-json').value = JSON.stringify(scenes, null, 2);
    $('vs-script').value = scenes.map(s => s.narration).join('\n\n'); changed();
  }
  let availableTemplates=[];
  const captureTests=new WeakMap();
  const captureMode=scene=>scene.capture_mode || (scene.demoUrl ? (scene.demoSteps?.length ? 'recording' : 'screenshot') : scene.template_id ? 'recording' : 'text');
  const captureLabel=scene=>({text:'Texttafel',screenshot:'Browser-Standbild',recording:'Bildschirmaufnahme'})[captureMode(scene)] || 'Unbekannte Aufnahmeart';
  const captureSignature=scene=>JSON.stringify({scene,template:availableTemplates.find(t=>t.id===scene.template_id)?.scene,project:projectId,format:$('vs-format').value,language:$('vs-language').value});
  document.addEventListener('suite-templates-loaded',event=>{availableTemplates=event.detail || [];drawScenes();});
  function drawScenes() {
    const container = $('suite-scene-list'); container.replaceChildren();
    const count=mode=>scenes.filter(s=>captureMode(s)===mode).length;
    $('suite-capture-summary').textContent=scenes.length?count('recording')+' Bildschirmaufnahmen · '+count('screenshot')+' Browser-Standbilder · '+count('text')+' Texttafeln. '+(count('recording')?'Aufnahmen vor dem Rendern einzeln testen.':'Es ist keine bewegte Bildschirmaufnahme geplant.'):'Noch keine Szenen geplant.';
    let elapsed=0;
    scenes.forEach((scene, i) => {
      const card = document.createElement('div'); card.className = 'suite-scene-card';
      const head = document.createElement('div'); head.className = 'suite-scene-head';
      const stamp=n=>Math.floor(n/60)+':'+String(n%60).padStart(2,'0');
      const start=elapsed;elapsed+=Math.max(4,Math.ceil((scene.narration || '').split(/\s+/).length/2.5));
      const title = document.createElement('strong'); title.textContent = 'Szene ' + (i + 1) + ' · '+stamp(start)+'–'+stamp(elapsed)+' (ca.) · '+captureLabel(scene); head.append(title);
      for (const [text, label, action] of [
        ['↑', 'Szene nach oben', () => { if (i) [scenes[i-1], scenes[i]] = [scenes[i], scenes[i-1]]; }],
        ['↓', 'Szene nach unten', () => { if (i < scenes.length-1) [scenes[i+1], scenes[i]] = [scenes[i], scenes[i+1]]; }],
        ['Entfernen', 'Szene entfernen', () => scenes.splice(i, 1)]
      ]) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'ghost'; b.textContent = text; b.setAttribute('aria-label', label);
        b.addEventListener('click', () => { action(); commitScenes(); drawScenes(); }); head.append(b);
      }
      card.append(head);
      for (const [key, label, multiline, max] of [['headline','Szenentitel',false,160],['narration','Sprechertext',true,1400],['visual_directions','Aufnahme-Regie: Was ist während dieses Sprechertexts zu sehen?',true,1200]]) {
        const l = document.createElement('label'); l.textContent = label; const field = document.createElement(multiline ? 'textarea' : 'input'); field.value = scene[key] || ''; field.maxLength = max;
        if (multiline) field.rows = key === 'narration' ? 3 : 2;
        field.addEventListener('input', () => { scene[key] = field.value; commitScenes(); }); l.append(field); card.append(l);
      }
      const modeLabel=document.createElement('label');modeLabel.textContent='Geplantes Bild';
      const modeSelect=document.createElement('select');modeSelect.setAttribute('aria-label','Geplantes Bild');
      for(const [value,label] of [['text','Texttafel'],['screenshot','Browser-Standbild'],['recording','Bildschirmaufnahme erforderlich']])modeSelect.append(new Option(label,value));
      modeSelect.value=captureMode(scene);
      modeSelect.addEventListener('change',()=>{scene.capture_mode=modeSelect.value;if(modeSelect.value==='screenshot' && !scene.template_id)delete scene.demoSteps;if(modeSelect.value==='text')for(const key of ['template_id','demoUrl','demoSteps','login_profile_id','test_data_only'])delete scene[key];commitScenes();drawScenes();});
      modeLabel.append(modeSelect);card.append(modeLabel);
      const demoLabel=document.createElement('label'); demoLabel.textContent='Ausführbarer Browser-Ablauf';
      const demoSelect=document.createElement('select'); demoSelect.append(new Option('Noch kein Ablauf zugeordnet',''));
      for(const template of availableTemplates.filter(t=>t.language===$('vs-language').value)) demoSelect.append(new Option(template.name+(template.scene.login_profile_id?' · angemeldete Demo':''),template.id));
      demoSelect.value=scene.template_id || '';
      if(scene.demoUrl && !scene.template_id){const custom=new Option('Individueller Browser-Ablauf','custom');demoSelect.append(custom);demoSelect.value='custom';}
      demoSelect.addEventListener('change',()=>{
        const template=availableTemplates.find(t=>t.id===demoSelect.value);
        for(const key of ['template_id','demoUrl','demoSteps','login_profile_id','test_data_only'])delete scene[key];
        if(template)Object.assign(scene,template.scene,{template_id:template.id,narration:scene.narration,headline:scene.headline,capture_mode:template.scene.capture_mode || (template.scene.demoSteps?.length ? 'recording' : 'screenshot')});
        commitScenes();drawScenes();
      });
      if(captureMode(scene)!=='text'){
        demoLabel.append(demoSelect);card.append(demoLabel);
        if(!scene.template_id){
          const urlLabel=document.createElement('label');urlLabel.textContent='Aufnahmeseite';
          const url=document.createElement('input');url.type='url';url.placeholder='https://dein-demo-shop.de/admin/...';url.value=scene.demoUrl || '';url.maxLength=2048;
          url.addEventListener('input',()=>{if(url.value.trim())scene.demoUrl=url.value.trim();else delete scene.demoUrl;commitScenes();});urlLabel.append(url);card.append(urlLabel);
          const loginLabel=document.createElement('label');loginLabel.textContent='Demo-Konto für diese Aufnahme';const login=document.createElement('select');login.setAttribute('aria-label','Demo-Konto für diese Aufnahme');login.append(new Option('Öffentliche Seite / ohne Anmeldung',''));
          for(const profile of demoLoginProfiles)login.append(new Option(profile.name,profile.id));login.value=scene.login_profile_id || '';
          login.addEventListener('change',()=>{if(login.value)scene.login_profile_id=login.value;else delete scene.login_profile_id;commitScenes();});loginLabel.append(login);card.append(loginLabel);
          if(captureMode(scene)==='recording'){
            const motionLabel=document.createElement('label');motionLabel.textContent='Bewegung während der Aufnahme';const motion=document.createElement('select');motion.setAttribute('aria-label','Bewegung während der Aufnahme');
            const presets={still:[{action:'wait',ms:3000}],scroll:[{action:'wait',ms:1500},{action:'scroll',pixels:650},{action:'wait',ms:1500}]};
            motion.append(new Option('Aufnahme-Ablauf auswählen',''),new Option('Seite ruhig zeigen','still'),new Option('Seite zeigen und nach unten scrollen','scroll'));
            const preset=Object.keys(presets).find(key=>JSON.stringify(presets[key])===JSON.stringify(scene.demoSteps));
            if(scene.demoSteps?.length && !preset){motion.append(new Option('Individueller gespeicherter Ablauf','custom'));motion.value='custom';}else motion.value=preset || '';
            motion.addEventListener('change',()=>{if(presets[motion.value])scene.demoSteps=presets[motion.value];else if(motion.value!=='custom')delete scene.demoSteps;commitScenes();});motionLabel.append(motion);card.append(motionLabel);
          }
          const consentLabel=document.createElement('label'),consent=document.createElement('input');consent.type='checkbox';consent.checked=scene.test_data_only===true;
          consent.addEventListener('change',()=>{if(consent.checked)scene.test_data_only=true;else delete scene.test_data_only;commitScenes();});consentLabel.append(consent,document.createTextNode(' Diese Aufnahmeseite enthält ausschließlich Testdaten.'));card.append(consentLabel);
          const help=document.createElement('small');help.textContent='Für einen angemeldeten Bereich ein gespeichertes Demo-Konto wählen. Weitere Klickfolgen lassen sich als wiederverwendbare Demoszene hinterlegen.';card.append(help);
        }
      }
      const hint=document.createElement('p');hint.className='vs-note';hint.setAttribute('role','status');
      const refreshStatus=()=>{
        const checked=captureTests.get(scene),current=checked?.signature===captureSignature(scene);
        const configured={...scene,...(availableTemplates.find(t=>t.id===scene.template_id)?.scene || {})};
        hint.textContent=captureMode(scene)==='text'?'Diese Szene wird als Texttafel gerendert.':current?checked.message:!configured.demoUrl && !scene.template_id?'Aufnahme blockiert: Aufnahmeseite eingeben oder eine Demoszene auswählen.':captureMode(scene)==='recording'&&!configured.demoSteps?.length?'Aufnahme blockiert: Aufnahme-Ablauf auswählen.':configured.test_data_only!==true?'Aufnahme blockiert: Testdaten bestätigen.':'Noch nicht getestet · '+(configured.demoUrl || 'Gespeicherte Demoszene')+' · '+(configured.login_profile_id?'Anmeldung vor der Aufnahme':'ohne gespeicherten Login')+' · '+(configured.demoSteps?.length || 0)+' Aktionen.';
      };
      card.addEventListener('input',refreshStatus);card.addEventListener('change',refreshStatus);refreshStatus();card.append(hint);
      if(captureMode(scene)!=='text'){
        const test=document.createElement('button');test.type='button';test.className='ghost';test.textContent='Aufnahme dieser Szene testen';
        const note=document.createElement('small');note.textContent='Führt den hinterlegten Ablauf mit Testdaten aus, einschließlich seiner Aktionen. Prüft echte Aufnahme und Full HD, ohne Sprachausgabe. Testergebnisse gelten nur für diese Konfiguration.';
        test.addEventListener('click',async()=>{
          const signature=captureSignature(scene);test.disabled=true;hint.textContent='Runner prüft Zielseite, Anmeldung und Aufnahme …';
          try{
            const response=await fetch('/api/video-studio/capture-test',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({project_id:projectId,scene,format:$('vs-format').value})});
            const result=await response.json().catch(()=>({}));
            const message=response.ok?(result.ok?'Aufnahme geprüft: ':'Aufnahme blockiert: ')+result.message:'Aufnahme blockiert: '+(result.message || result.error || 'Test fehlgeschlagen.');
            if(signature===captureSignature(scene))captureTests.set(scene,{signature,message});
          }catch{if(signature===captureSignature(scene))captureTests.set(scene,{signature,message:'Aufnahme blockiert: Runner nicht erreichbar.'});}
          finally{test.disabled=false;refreshStatus();}
        });card.append(test,note);
      }
      container.append(card);
    });
  }
  $('suite-add-scene').addEventListener('click', () => { if (scenes.length >= 24) return; scenes.push({ headline: 'Neue Szene', narration: '' }); commitScenes(); drawScenes(); });
  // Existing demo-template insertion updates the JSON editor; reflect it in the visual scene editor.
  $('vs-template-use').addEventListener('click', () => { syncScenes(); if (scenes.length) commitScenes(); location.hash = 'script'; });
  async function selectProject() {
    const next = $('vs-project').value;
    if (!next || next === projectId || loading || sending || uploadingImages) return;
    try { await saveCurrent(); }
    catch { $('vs-project').value = projectId; return; }
    const previous = projectId; projectId = next; loading = true;
    $('vs-project').disabled = true;
    try {
      const draft = await api('drafts/' + next);
      chatAttachments=[]; drawAttachments();
      fillDraft(draft); conversationId = undefined; latest = undefined;
      $('suite-chat-log').replaceChildren();
      $('suite-thumbnail-canvas').hidden = true; $('suite-thumbnail-download').hidden = true;
      $('suite-thumbnail-prompt').value = ''; $('suite-social-posts').textContent = 'Lass den Creative Agent passende Posts erstellen.';
      dirty = false; $('suite-draft-state').textContent = draft ? 'Entwurf online geladen' : 'Neuer Entwurf';
      await loadConversations(); await loadAssets();
    } catch (e) { projectId = previous; $('vs-project').value = previous; $('suite-draft-state').textContent = e.message; }
    finally { loading = false; $('vs-project').disabled = false; }
  }
  $('vs-project').addEventListener('change', selectProject);
  new MutationObserver(() => { selectProject(); }).observe($('vs-project'), { childList: true });
  async function loadConversations() {
    const items = await api('conversations?project_id=' + encodeURIComponent(projectId));
    $('suite-conversation').replaceChildren(new Option('Neue Unterhaltung', ''), ...items.map(x => new Option(x.title, x.id)));
    if (conversationId) $('suite-conversation').value = conversationId;
  }
  function appendMessage(role, text, result, attachments=[]) {
    $('suite-chat-log').querySelector('.suite-chat-empty')?.remove();
    const item = document.createElement('div'); item.className = 'suite-chat-message'; item.dataset.role = role;
    const label = document.createElement('strong'); label.textContent = role === 'user' ? 'Du' : 'Creative Agent';
    const content = document.createElement('div'); content.textContent = text; item.append(label, content);
    for(const attachment of attachments){const link=document.createElement('a');link.href=attachment.url;link.target='_blank';link.rel='noopener';const img=document.createElement('img');img.src=attachment.url;img.alt=attachment.name;img.loading='lazy';img.className='suite-chat-image';link.append(img);item.append(link);}
    if (result?.draft) {
      const b = document.createElement('button'); b.type = 'button';
      const packaging=$('suite-agent-mode').value==='seo' && $('suite-production-id').value;
      b.textContent=packaging?'SEO für diese Produktion übernehmen':'Vorschlag ansehen & übernehmen';
      b.addEventListener('click',()=>{if(packaging)document.dispatchEvent(new CustomEvent('suite-seo-proposal',{detail:result.draft.youtube}));else reviewDraft(result.draft);});item.append(b);
    }
    if (result?.thumbnail_prompt) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ghost'; b.textContent = 'Motiv im Thumbnail Studio öffnen';
      b.addEventListener('click', () => { $('suite-thumbnail-prompt').value = result.thumbnail_prompt;document.dispatchEvent(new CustomEvent('suite-thumbnail-prompt',{detail:result.thumbnail_prompt})); location.hash = 'assets'; }); item.append(b);
    }
    if (result?.social_posts?.length) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ghost'; b.textContent = 'Social Posts öffnen';
      b.addEventListener('click', () => { showPosts(result.social_posts); location.hash = 'repurpose'; }); item.append(b);
    }
    $('suite-chat-log').append(item); item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function reviewDraft(draft) {
    let dialog = $('suite-draft-review'); if (dialog) dialog.remove();
    dialog = document.createElement('dialog'); dialog.id = 'suite-draft-review'; dialog.style.cssText = 'max-width:760px;width:90%;max-height:85vh;border:1px solid #dbe2ed;border-radius:14px;padding:25px;';
    const title = document.createElement('h2'); title.textContent = 'Produktionsvorschlag prüfen';
    const note = document.createElement('p'); note.textContent = 'Übernehmen ersetzt Titel, Sprechertext, Szenen und SEO des aktuellen Entwurfs. Bereits gespeicherte Produktionen bleiben erhalten.';
    const preview = document.createElement('pre'); preview.style.cssText = 'white-space:pre-wrap;max-height:50vh;overflow:auto;font:13px/1.7 sans-serif;';
    preview.textContent = draft.title + '\n\n' + draft.scenes.map((s,i) => (i+1) + '. [' + captureLabel(s) + '] ' + s.headline + '\n' + s.narration + (s.visual_directions ? '\nBild: ' + s.visual_directions : '')).join('\n\n') + '\n\nSEO\n' + draft.youtube.title + '\n' + draft.youtube.description;
    const originStage=location.hash.slice(1);
    const apply = document.createElement('button'); apply.textContent = 'In aktuellen Entwurf übernehmen';
    apply.addEventListener('click', () => {
      $('vs-title').value = draft.title; $('vs-script').value = draft.script;
      $('vs-scene-json').value = JSON.stringify(draft.scenes, null, 2); $('vs-youtube-json').value = JSON.stringify(draft.youtube, null, 2);
      syncScenes(); loadSeo(); changed(); dialog.close(); location.hash = ({ideas:'storyboard',storyboard:'editing',editing:'script'}[originStage] || 'script');
    });
    const cancel = document.createElement('button'); cancel.textContent = 'Zurück'; cancel.addEventListener('click', () => dialog.close()); dialog.append(title,note,preview,apply,cancel); document.body.append(dialog); dialog.showModal();
  }
  function showPosts(posts) {
    $('suite-social-posts').replaceChildren();
    for (const post of posts) { const article = document.createElement('article'); const h = document.createElement('h3'); h.textContent = post.platform; const p = document.createElement('p'); p.style.whiteSpace = 'pre-wrap'; p.textContent = post.text; const b = document.createElement('button'); b.type='button'; b.className='ghost'; b.textContent='Text kopieren'; b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(post.text); b.textContent='Kopiert'; } catch { b.textContent='Bitte Text markieren und kopieren'; } }); article.append(h,p,b); $('suite-social-posts').append(article); }
  }
  $('suite-new-chat').addEventListener('click', () => { if (sending || uploadingImages) return; conversationId = undefined; latest = undefined; chatAttachments=[]; drawAttachments(); $('suite-conversation').value = ''; $('suite-chat-log').replaceChildren(); });
  $('suite-conversation').addEventListener('change', async () => {
    if (sending || uploadingImages) return;
    conversationId = $('suite-conversation').value || undefined; $('suite-chat-log').replaceChildren();
    if (!conversationId) return;
    try { const data = await api('conversations/' + conversationId + '?project_id=' + projectId); for (const m of data.messages) appendMessage(m.role, m.text || m.result.reply, m.result, m.attachments || []); latest = data.messages.at(-1)?.result; if (latest?.social_posts) showPosts(latest.social_posts); }
    catch (e) { $('suite-agent-status').textContent = e.message; }
  });
  const presets = {
    script: 'Erstelle aus meinem Thema ein vollständiges, etwa vierminütiges Tutorial mit Hook, Sprechertext, Szenenplan, Bildanweisungen und YouTube-Metadaten. Nutze die Projektsprache und erfinde keine Produktfunktionen.',
    edit: 'Prüfe mein vorhandenes Skript auf Einstieg, Tempo und Verständlichkeit. Straffe es und schlage eine bessere Szenenfolge vor. Erhalte bestätigte Demo-Aktionen.',
    seo: 'Optimiere das Packaging meines vorhandenen Videos: drei ehrliche Titel, Beschreibung, Keywords, drei Hashtags und Kapitel. Verändere den Sprechertext nicht.',
    thumbnail: 'Entwickle drei deutlich verschiedene Titelbild-Konzepte passend zu meinem Video und einen fertigen Bildprompt. Dunkelblau, Blau und Orange. Keine erfundenen Screenshots oder Funktionen.',
    social: 'Leite aus meinem Skript einen LinkedIn-Beitrag, einen kurzen WhatsApp-Kanalbeitrag und eine Idee für einen YouTube Short ab. Keine neuen unbelegten Behauptungen.'
  };
  document.querySelectorAll('[data-agent-preset]').forEach(b => b.addEventListener('click', () => { $('suite-agent-mode').value = b.dataset.agentPreset; $('suite-prompt').value = presets[b.dataset.agentPreset]; $('suite-prompt').focus(); }));
  function drawAttachments(){
    $('suite-chat-attachments').replaceChildren();
    for(const attachment of chatAttachments){
      const card=document.createElement('div'), img=document.createElement('img'), name=document.createElement('span'), remove=document.createElement('button');
      img.src=attachment.url;img.alt=attachment.name;img.className='suite-chat-image';name.textContent=attachment.name;
      remove.type='button';remove.className='ghost';remove.textContent='Entfernen';remove.setAttribute('aria-label','Bild entfernen: '+attachment.name);remove.disabled=sending || uploadingImages;
      remove.addEventListener('click',()=>{chatAttachments=chatAttachments.filter(x=>x.id!==attachment.id);drawAttachments();});
      card.append(img,name,remove);$('suite-chat-attachments').append(card);
    }
  }
  async function attachImages(files){
    if(sending || uploadingImages)return;
    if(!projectId){$('suite-agent-status').textContent='Zuerst ein Projekt auswählen.';return;}
    if(chatAttachments.length+files.length>3){$('suite-agent-status').textContent='Maximal drei Bilder pro Nachricht.';return;}
    uploadingImages=true;$('vs-project').disabled=true;$('suite-conversation').disabled=true;$('suite-send').disabled=true;$('suite-chat-images').disabled=true;drawAttachments();
    try{
      for(const file of files){
        if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Bitte PNG, JPG oder WebP auswählen.');
        if(file.size>10*1024*1024)throw Error('Originalbild ist zu groß (maximal 10 MB).');
        $('suite-agent-status').textContent='Bild vorbereiten und hochladen …';
        const objectUrl=URL.createObjectURL(file),img=new Image();
        try{
          img.src=objectUrl;await img.decode();
          const ratio=Math.min(1,2048/Math.max(img.naturalWidth,img.naturalHeight)),canvas=document.createElement('canvas');
          canvas.width=Math.max(1,Math.round(img.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(img.naturalHeight*ratio));
          const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
          const data=canvas.toDataURL('image/jpeg',.88).split(',')[1];
          if(data.length>2796204)throw Error('Bild bleibt nach Aufbereitung zu groß. Bitte kleiner zuschneiden.');
          chatAttachments.push(await api('chat-images',{project_id:projectId,name:(file.name || 'Screenshot').slice(0,160),mime_type:'image/jpeg',data}));
        }finally{URL.revokeObjectURL(objectUrl);}
      }
      $('suite-agent-status').textContent=chatAttachments.length+' Bilder angehängt. Beim Absenden werden sie vom Agenten berücksichtigt.';
    }catch(e){$('suite-agent-status').textContent=e.message;}finally{uploadingImages=false;$('vs-project').disabled=false;$('suite-conversation').disabled=false;$('suite-send').disabled=false;$('suite-chat-images').disabled=false;$('suite-chat-images').value='';drawAttachments();}
  }
  $('suite-chat-images').addEventListener('change',event=>attachImages(Array.from(event.target.files || [])));
  $('suite-prompt').addEventListener('paste',event=>{
    const files=Array.from(event.clipboardData?.items || []).filter(x=>x.kind==='file' && x.type.startsWith('image/')).map(x=>x.getAsFile()).filter(Boolean);
    if(files.length){event.preventDefault();attachImages(files);}
  });
  $('suite-agent-form').addEventListener('keydown',event=>{
    if(event.key==='Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing){event.preventDefault();if(!sending && !uploadingImages)$('suite-agent-form').requestSubmit($('suite-send'));}
  });
  $('suite-agent-form').addEventListener('submit', async event => {
    event.preventDefault(); if (sending || uploadingImages) return;
    if (!projectId) { $('suite-agent-status').textContent = 'Bitte zuerst unter Einstellungen ein Projekt anlegen.'; return; }
    const text = $('suite-prompt').value.trim(); if (text.length < 2) return;
    sending = true; $('suite-chat-images').disabled=true; drawAttachments(); $('suite-send').disabled = true; $('vs-project').disabled = true; $('suite-conversation').disabled = true;
    $('suite-agent-status').textContent = 'Der Agent arbeitet an deiner Anfrage …';
    try {
      const data = snapshot();
      const result = await api('chat', { project_id: projectId, conversation_id: conversationId, message: text, image_ids:chatAttachments.map(x=>x.id), mode: $('suite-agent-mode').value, context: { title: data.title, topic: data.topic, script: data.script, format: data.format, ...(data.scene_json ? { scenes: JSON.parse(data.scene_json) } : {}), ...(data.youtube_json ? { youtube: JSON.parse(data.youtube_json) } : {}) } });
      appendMessage('user', text, undefined, result.attachments || chatAttachments); chatAttachments=[];drawAttachments(); appendMessage('assistant', result.reply, result); conversationId = result.conversation_id; latest = result;
      $('suite-prompt').value = ''; if (result.social_posts.length) showPosts(result.social_posts);
      $('suite-agent-status').textContent = 'Antwort gespeichert' + (result.usage?.total_tokens ? ' · ' + result.usage.total_tokens + ' Tokens' : '');
      await loadConversations();
    } catch (e) { $('suite-agent-status').textContent = e.message; }
    finally { sending = false; $('suite-chat-images').disabled=false;drawAttachments(); $('suite-send').disabled = false; $('vs-project').disabled = false; $('suite-conversation').disabled = false; }
  });
  function loadSeo() {
    try {
      const meta = JSON.parse($('vs-youtube-json').value || '{}');
      $('suite-seo-title').value = meta.title || $('vs-title').value;
      $('suite-seo-description').value = meta.description || '';
      $('suite-seo-keywords').value = (meta.keywords || []).join(', ');
      $('suite-seo-hashtags').value = (meta.hashtags || []).join(' ');
      $('suite-seo-chapters').value = (meta.chapters || []).map(c => Math.floor(c.start_seconds/60).toString().padStart(2,'0') + ':' + (c.start_seconds%60).toString().padStart(2,'0') + ' ' + c.title).join('\n');
      if (!$('suite-thumbnail-prompt').value && meta.thumbnail_concept) $('suite-thumbnail-prompt').value = meta.thumbnail_concept;
    } catch { $('suite-seo-status').textContent = 'Metadaten-JSON im Skriptbereich prüfen.'; }
  }
  $('suite-seo-save').addEventListener('click', () => {
    try {
      const meta = JSON.parse($('vs-youtube-json').value || '{}');
      const chapters = $('suite-seo-chapters').value.split('\n').filter(x => x.trim()).map(line => { const m = /^(\d{1,4}):([0-5]\d)\s+(.+)$/.exec(line.trim()); if (!m) throw Error('Kapitel im Format MM:SS Titel eingeben.'); return { start_seconds: Number(m[1])*60 + Number(m[2]), title: m[3] }; });
      if (chapters.some((c,i) => i === 0 ? c.start_seconds !== 0 : c.start_seconds <= chapters[i-1].start_seconds)) throw Error('Kapitel müssen bei 00:00 beginnen und aufsteigen.');
      $('vs-youtube-json').value = JSON.stringify({ ...meta, title: $('suite-seo-title').value, description: $('suite-seo-description').value, keywords: $('suite-seo-keywords').value.split(',').map(x=>x.trim()).filter(Boolean), hashtags: $('suite-seo-hashtags').value.split(/\s+/).filter(Boolean), chapters, thumbnail_concept: $('suite-thumbnail-prompt').value || meta.thumbnail_concept || 'Klares Hauptmotiv passend zum Video.', sources: meta.sources || [] },null,2);
      changed(); $('suite-seo-status').textContent = 'Texte im Arbeitsentwurf gespeichert.'; document.dispatchEvent(new CustomEvent('suite-save-package'));
    } catch (e) { $('suite-seo-status').textContent = e.message; }
  });
  let demoLoginProfiles=[];
  async function loadDemoLogins(selected='') {
    const response=await fetch('/api/video-studio/demo-logins',{credentials:'same-origin'}), data=await response.json();
    if(!response.ok) throw Error(data.message || 'Demo-Konten konnten nicht geladen werden.');
    demoLoginProfiles=data;
    const select=$('suite-demo-login-id'); select.replaceChildren(new Option('Neues Demo-Konto',''));
    for(const profile of data) select.append(new Option(profile.name,profile.id));
    select.value=selected;drawScenes();
  }
  $('suite-demo-login-id').addEventListener('change',()=>{
    const profile=demoLoginProfiles.find(x=>x.id===$('suite-demo-login-id').value);
    const mapping={'suite-demo-login-name':'name','suite-demo-login-url':'login_url','suite-demo-landing-url':'landing_url','suite-demo-login-user':'username','suite-demo-user-selector':'username_selector','suite-demo-password-selector':'password_selector','suite-demo-submit-selector':'submit_selector','suite-demo-ready-selector':'ready_selector'};
    const defaults={username_selector:"input[name='email']",password_selector:"input[name='password']",submit_selector:"form button",ready_selector:"body"};
    for(const [id,key] of Object.entries(mapping)) $(id).value=profile?.[key] || defaults[key] || '';
    $('suite-demo-login-password').value=''; $('suite-demo-test-data').checked=profile?.test_data_only===true;
    $('suite-demo-login-status').textContent=profile ? 'Profil-ID: '+profile.id+' · Passwort ist gespeichert.' : '';
  });
  $('suite-demo-login-form').addEventListener('submit', async event=>{
    event.preventDefault();const button=event.submitter;button.disabled=true;
    try {
      const payload={name:$('suite-demo-login-name').value,login_url:$('suite-demo-login-url').value,landing_url:$('suite-demo-landing-url').value,username:$('suite-demo-login-user').value,password:$('suite-demo-login-password').value,username_selector:$('suite-demo-user-selector').value,password_selector:$('suite-demo-password-selector').value,submit_selector:$('suite-demo-submit-selector').value,ready_selector:$('suite-demo-ready-selector').value,test_data_only:$('suite-demo-test-data').checked};
      if($('suite-demo-login-id').value) payload.id=$('suite-demo-login-id').value;
      const response=await fetch('/api/video-studio/demo-logins',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}), result=await response.json();
      if(!response.ok)throw Error(result.message || result.error || 'Speichern fehlgeschlagen.');
      $('suite-demo-login-password').value=''; await loadDemoLogins(result.id);
      $('suite-demo-login-status').textContent='Verschlüsselt gespeichert. Profil-ID: '+result.id+'. Jetzt Anmeldung testen und mit einer Demoszene verknüpfen.';
    } catch(e){$('suite-demo-login-status').textContent=e.message;} finally{button.disabled=false;}
  });
  $('suite-demo-test-login').addEventListener('click',async event=>{
    const button=event.currentTarget,id=$('suite-demo-login-id').value;
    if(!id){$('suite-demo-login-status').textContent='Demo-Konto zuerst speichern oder auswählen.';return;}
    button.disabled=true;$('suite-demo-login-status').textContent='Anmeldung ohne Bildschirmaufnahme prüfen …';
    try{
      const response=await fetch('/api/video-studio/demo-logins/'+encodeURIComponent(id)+'/test',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:'{}'}), result=await response.json();
      if(!response.ok)throw Error(result.message || result.error || 'Anmeldung fehlgeschlagen.');
      $('suite-demo-login-status').textContent=result.message;
    }catch(e){$('suite-demo-login-status').textContent=e.message;}finally{button.disabled=false;}
  });
  loadDemoLogins().catch(e=>{$('suite-demo-login-status').textContent=e.message;});
  $('suite-settings-form').addEventListener('submit', async event => {
    event.preventDefault(); const b = event.submitter; b.disabled = true;
    try { const result = await api('settings', { api_key: $('suite-api-key').value, model: $('suite-model').value, image_model: $('suite-image-model').value }); $('suite-api-key').value = ''; $('suite-settings-status').textContent = 'Verschlüsselt gespeichert. Die nächste Anfrage verwendet diese Verbindung.'; setAiState(result); }
    catch (e) { $('suite-settings-status').textContent = e.message; } finally { b.disabled = false; }
  });
  function setAiState(data) { $('suite-ai-state').textContent = data.configured ? 'OpenAI eingerichtet · ' + data.model : 'OpenAI noch nicht verbunden'; $('suite-model').value = data.model; $('suite-image-model').value = data.image_model; }
  api('settings').then(setAiState).catch(e => { $('suite-ai-state').textContent = e.message; });
  $('suite-test-connection').addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true;
    $('suite-settings-status').textContent = 'Teste gespeichertes Modell und Agent-Ausgabeformat …';
    try {
      const result = await api('test-connection', {});
      $('suite-settings-status').textContent = result.message;
      $('suite-diagnostics').hidden = !result.diagnostic;
      $('suite-diagnostics').textContent = result.diagnostic ? JSON.stringify(result.diagnostic, null, 2) : '';
      $('suite-ai-state').textContent = result.ok ? 'Verbindung geprüft · ' + result.model : 'OpenAI-Test fehlgeschlagen · ' + result.model;
    } catch(e) { $('suite-settings-status').textContent = e.message; } finally { button.disabled = false; }
  });
  $('suite-test-audio').addEventListener('click',async event=>{
    const button=event.currentTarget;button.disabled=true;$('suite-settings-status').textContent='Prüfe OpenAI-Sprachausgabe über den Browser Runner …';
    try{const response=await fetch('/api/video-studio/openai-audio-test',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:'{}'}),result=await response.json();if(!response.ok)throw Error(result.message || result.error || 'Audio-Test fehlgeschlagen.');$('suite-settings-status').textContent=result.message;}
    catch(e){$('suite-settings-status').textContent=e.message;}finally{button.disabled=false;}
  });
  $('suite-load-models').addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true;
    try {
      const result = await api('models'); $('suite-model-options').replaceChildren();
      for (const model of result.models) { const option = document.createElement('option'); option.value = model; $('suite-model-options').append(option); }
      $('suite-settings-status').textContent = result.models.length + ' Modelle geladen. Die Auswahl bleibt unverändert. Der Verbindungstest prüft die konkrete Responses-Anfrage.';
    } catch(e) { $('suite-settings-status').textContent = e.message; } finally { button.disabled = false; }
  });
  function showKnowledge(data) {
    const plugins = data.plugins || [];
    $('suite-knowledge-json').value = JSON.stringify({plugins}, null, 2);
    $('suite-knowledge-count').textContent = plugins.length + ' Plugins im Agent-Kontext';
    $('suite-knowledge-list').replaceChildren();
    for(const plugin of plugins) {
      const item = document.createElement('article'), title = document.createElement('h3'), text = document.createElement('p'), source = document.createElement('small');
      title.textContent = plugin.name + (plugin.version ? ' · ' + plugin.version : ''); text.textContent = plugin.summary;
      source.textContent = ({published:'Veröffentlicht',internal:'Intern',demo:'Demo',unknown:'Verfügbarkeit ungeprüft'}[plugin.availability] || 'Ungeprüft') + ' · Stand ' + plugin.verified_at + ' · ' + plugin.source;
      item.append(title,text,source); $('suite-knowledge-list').append(item);
    }
  }
  api('knowledge').then(showKnowledge).catch(e => { $('suite-knowledge-count').textContent = e.message; });
  $('suite-knowledge-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.submitter; button.disabled = true;
    try {
      let data; try { data = JSON.parse($('suite-knowledge-json').value); } catch { throw Error('Bitte gültiges JSON eingeben.'); }
      const result = await api('knowledge',data); showKnowledge(await api('knowledge'));
      $('suite-knowledge-status').textContent = result.count + ' Plugins gespeichert. Der Agent verwendet sie ab der nächsten Anfrage.';
    } catch(e) { $('suite-knowledge-status').textContent = e.message; } finally { button.disabled = false; }
  });

  async function previewAsset(url,expectedProject=projectId) {
    const img = new Image(); img.src = url; await img.decode();
    if(projectId!==expectedProject)throw Error('Projekt wurde gewechselt. Titelbild bitte im ursprünglichen Projekt auswählen.');
    const canvas = $('suite-thumbnail-canvas'), ctx = canvas.getContext('2d');
    const width=Math.min(img.width,img.height*16/9),height=width*9/16;
    ctx.drawImage(img, (img.width-width)/2, (img.height-height)/2, width, height, 0, 0, 1280, 720); canvas.hidden = false;
    $('suite-thumbnail-download').href = canvas.toDataURL('image/jpeg', .9); $('suite-thumbnail-download').hidden = false;
    document.dispatchEvent(new CustomEvent('suite-thumbnail-selected',{detail:canvas.toDataURL('image/jpeg',.9).split(',')[1]}));
  }
  async function loadAssets() {
    const items = await api('assets?project_id=' + projectId);
    $('suite-thumbnail-gallery').replaceChildren();
    for (const item of items) {
      const box = document.createElement('div'); const img = document.createElement('img'); img.src = item.url; img.alt = 'Gespeichertes Titelbild'; img.loading = 'lazy';
      const link = document.createElement('button'); link.type='button';link.className='ghost';link.textContent='Als Titelbild auswählen';link.addEventListener('click',()=>previewAsset(item.url).catch(e=>{$('suite-thumbnail-status').textContent=e.message;}));
      box.append(img,link); $('suite-thumbnail-gallery').append(box);
    }
  }
  $('suite-thumbnail-generate').addEventListener('click', async () => {
    const expectedProject=projectId;
    const b = $('suite-thumbnail-generate'); b.disabled = true; $('suite-thumbnail-status').textContent = 'Titelbild wird generiert. Das kann einige Minuten dauern …';
    try {
      if (!projectId) throw Error('Bitte zuerst ein Projekt auswählen.');
      const result = await api('thumbnails', { project_id: projectId, prompt: $('suite-thumbnail-prompt').value });
      await previewAsset(result.url,expectedProject); await loadAssets();
      $('suite-thumbnail-status').textContent = 'Titelbild erstellt. Prüfe Motiv und Text in der 16:9-Vorschau. Das Motiv ist online gespeichert.';
    } catch (e) { $('suite-thumbnail-status').textContent = e.message; } finally { b.disabled = false; }
  });
  async function metrics() {
    try { const [projects,jobs] = await Promise.all([fetch('/api/video-studio/projects').then(r=>r.json()),fetch('/api/video-studio/jobs').then(r=>r.json())]); $('suite-project-count').textContent=projects.length; $('suite-running-count').textContent=jobs.filter(j=>['queued','running'].includes(j.status)).length; $('suite-done-count').textContent=jobs.filter(j=>j.status==='done').length; }
    catch { /* The production panel provides actionable load errors. */ }
  }
  document.addEventListener('suite-open-production', async event => {
    const job = event.detail;
    if (dirty && !window.confirm('Den aktuellen Arbeitsentwurf durch diese Produktion ersetzen?')) return;
    if (job.project_id !== projectId) { $('vs-project').value = job.project_id; await selectProject(); if (job.project_id !== projectId) return; }
    document.dispatchEvent(new CustomEvent('suite-production-selected',{detail:job}));
    fillDraft({ title:job.title, topic:job.topic, script:job.script, scene_json:JSON.stringify(job.scenes || []), youtube_json:JSON.stringify(job.youtube || {}), format:job.format }); changed(); location.hash=event.detail.workflowTarget || 'script';
  });
  metrics(); $('vs-refresh').addEventListener('click', metrics);
  // A successful production save switches directly to the production queue.
  new MutationObserver(() => { if ($('vs-message').textContent.startsWith('Videoentwurf gespeichert')) location.hash='production'; }).observe($('vs-message'),{ childList:true });
})();

// Guided publishing: keep one production in context from packaging to upload.
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const stages=[['ideas','Strategie & Ideen','Finde Thema, Zielgruppe und Nutzen.','strategy'],['storyboard','Skript & Storyboard','Entwickle Sprechertext und passende Bilder für jede Szene.','script'],['editing','Schnitt & Dramaturgie','Prüfe Einstieg, Rhythmus, Übergänge und den roten Faden.','edit'],['script','Skript & Szenen','Lege fest, was aufgenommen wird, und teste deine Bildschirmaufnahmen.'],['production','Full-HD-Produktion','Speichere deinen Szenenplan und rendere das Video.'],['assets','SEO & Titelbild','Bereite die fertige Produktion für deinen Kanal vor.'],['review','Gesamtvorschau','Video, Titelbild und sämtliche Texte gemeinsam prüfen.'],['publish','YouTube-Upload','Übertrage dein geprüftes Video zuerst privat auf deinen Kanal.'],['repurpose','Shorts & Social Media','Entwickle aus deinem Video weitere Inhalte.']];
  let job=null, publication=null, thumbnail=null, packageDirty=false, pending=null, reviewed=null, requestNo=0, packageVersion=0, project='', saveChain=Promise.resolve();
  const endpoint=id=>'/api/video-studio/jobs/'+encodeURIComponent(id)+'/publication';
  const api=async(path,data)=>{
    const r=await fetch(path,{method:data===undefined?'GET':'POST',credentials:'same-origin',headers:data===undefined?{}:{'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
    const result=await r.json().catch(()=>({}));if(!r.ok)throw Error(result.message || result.error || 'Die Anfrage konnte nicht abgeschlossen werden.');return result;
  };
  const signature=p=>JSON.stringify({id:p?.job_id,youtube:p?.youtube,thumbnail:p?.thumbnail_url,resolution:p?.resolution});
  const stage=()=>location.hash.slice(1) || 'overview';
  const status=message=>{$('suite-package-state').textContent=message;};
  function invalidate(){pending=null;reviewed=null;$('suite-upload-confirm').hidden=true;}
  function metadata(){
    const base=publication?.youtube || JSON.parse($('vs-youtube-json').value || '{}');
    const chapters=$('suite-seo-chapters').value.split('\n').filter(x=>x.trim()).map(line=>{const m=/^(\d{1,4}):([0-5]\d)\s+(.+)$/.exec(line.trim());if(!m)throw Error('Kapitel bitte als MM:SS Titel eingeben.');return {start_seconds:Number(m[1])*60+Number(m[2]),title:m[3]};});
    return {...base,title:$('suite-seo-title').value.trim(),description:$('suite-seo-description').value.trim(),keywords:$('suite-seo-keywords').value.split(',').map(x=>x.trim()).filter(Boolean),hashtags:$('suite-seo-hashtags').value.split(/\s+/).filter(Boolean),chapters,thumbnail_concept:$('suite-thumbnail-prompt').value || base.thumbnail_concept || 'Titelbild passend zum Video.',sources:base.sources || []};
  }
  function fillMetadata(p,keepImage=false){
    const m=p.youtube || {};$('vs-youtube-json').value=JSON.stringify(m,null,2);
    $('suite-seo-title').value=m.title || job?.title || '';$('suite-seo-description').value=m.description || '';
    $('suite-seo-keywords').value=(m.keywords || []).join(', ');$('suite-seo-hashtags').value=(m.hashtags || []).join(' ');
    $('suite-seo-chapters').value=(m.chapters || []).map(c=>Math.floor(c.start_seconds/60)+':'+String(c.start_seconds%60).padStart(2,'0')+' '+c.title).join('\n');
    $('suite-thumbnail-prompt').value=m.thumbnail_concept || '';
    if(keepImage)return;
    const canvas=$('suite-thumbnail-canvas');canvas.hidden=true;$('suite-thumbnail-download').hidden=true;
    if(p.thumbnail_url){const img=new Image();img.onload=()=>{if(publication?.thumbnail_url!==p.thumbnail_url)return;canvas.getContext('2d').drawImage(img,0,0,1280,720);canvas.hidden=false;};img.src=p.thumbnail_url;}
  }
  function savePackage(){
    if(!job || job.status!=='done')return Promise.reject(Error('Bitte eine fertig gerenderte Produktion auswählen.'));
    const id=job.id,version=packageVersion,input={youtube:metadata(),...(thumbnail?{thumbnail}:{})};
    status('Veröffentlichungspaket wird gespeichert …');
    saveChain=saveChain.catch(()=>{}).then(()=>api(endpoint(id),input)).then(p=>{if(job?.id===id){publication=p;if(version===packageVersion){packageDirty=false;thumbnail=null;status('Texte und Titelbild für diese Produktion gespeichert.');}else status('Gespeichert. Neuere Änderungen sind noch offen.');}return p;});
    return saveChain;
  }
  async function selectProduction(id){
    if(packageDirty && job?.id!==id && !window.confirm('Ungespeicherte Texte oder das Titelbild verwerfen und die andere Produktion öffnen?'))return;
    const ticket=++requestNo;invalidate();
    const data=await api('/api/video-studio/jobs/'+encodeURIComponent(id));
    const p=await api(endpoint(id));
    if(ticket!==requestNo || data.project_id!==$('vs-project').value)return;
    job=data;publication=p;thumbnail=null;packageDirty=false;$('suite-production-id').value=id;$('suite-finished-production').value=id;
    sessionStorage.setItem('siteops-video-production:'+data.project_id,id);fillMetadata(p);status('Aktuelle Produktion: '+data.title);drawReview();
  }
  async function loadProductions(){
    const pid=$('vs-project').value;if(!pid)return;
    const rows=await api('/api/video-studio/jobs?project_id='+encodeURIComponent(pid));
    if(pid!==$('vs-project').value)return;
    const selector=$('suite-finished-production');selector.replaceChildren(new Option('Fertige Produktion auswählen',''));
    for(const row of rows.filter(x=>x.status==='done'))selector.append(new Option(row.title,row.id));
    const wanted=(job?.project_id===pid?job.id:null) || sessionStorage.getItem('siteops-video-production:'+pid);
    if(rows.some(x=>x.id===wanted && x.status==='done')){selector.value=wanted;if(job?.id!==wanted || !publication)await selectProduction(wanted);}
  }
  function drawReview(){
    const p=publication,ready=Boolean(job && p);$('suite-review-empty').hidden=ready;$('suite-review-content').hidden=!ready;
    if(!ready)return;
    const source='/api/video-suite/preview/'+encodeURIComponent(job.id),video=$('suite-review-video');if(video.getAttribute('src')!==source)video.src=source;
    $('suite-review-title').textContent=p.youtube?.title || 'Titel fehlt';$('suite-review-description').textContent=p.description || 'Beschreibung fehlt';
    $('suite-review-keywords').textContent=(p.youtube?.keywords || []).join(', ') || 'Keine Keywords hinterlegt';
    $('suite-review-format').textContent=(job.render_settings?.language==='de'?'Deutsch':'Englisch')+' · '+(job.format==='portrait'?'9:16 Hochformat':'16:9 YouTube');
    $('suite-review-script').textContent=job.script || '';
    $('suite-review-sources').replaceChildren();for(const s of p.youtube?.sources || []){const line=document.createElement('p');line.textContent=s.url+' — '+s.note;$('suite-review-sources').append(line);}
    const hd=p.resolution && Math.min(p.resolution.width,p.resolution.height)>=1080;
    $('suite-review-resolution').textContent=p.resolution?p.resolution.width+' × '+p.resolution.height+(hd?' · Full HD':' · Auflösung prüfen'):'Auflösung nicht bestätigt';
    const captures=p.captures || [];$('suite-review-captures').textContent=captures.length?captures.map(c=>'Szene '+c.scene+': '+({recording:'Bildschirmaufnahme',screenshot:'Browser-Standbild',text:'Texttafel'}[c.mode] || c.mode)).join(' · '):'Für diese ältere Produktion liegt kein Aufnahmeprotokoll vor. Prüfe das Video vollständig.';
    $('suite-review-thumbnail').hidden=!p.has_thumbnail;if(p.thumbnail_url)$('suite-review-thumbnail').src=p.thumbnail_url;
    $('suite-review-thumbnail-note').textContent=p.has_thumbnail?'Dieses Bild wird beim Upload übernommen.':'Titelbild fehlt. Wähle unter SEO & Titelbild ein Motiv aus.';
    const checks=[['Video fertig gerendert',job.status==='done'],['Full HD bestätigt',hd],['Titel und Beschreibung vorhanden',Boolean(p.youtube?.title && p.youtube?.description)],['Titelbild ausgewählt',p.has_thumbnail]];
    $('suite-review-checks').replaceChildren();for(const [label,ok] of checks){const li=document.createElement('li');li.textContent=(ok?'✓ ':'Noch offen: ')+label;$('suite-review-checks').append(li);}
    $('suite-review-continue').disabled=!checks.every(x=>x[1]);$('suite-review-note').textContent=checks.every(x=>x[1])?'Alles vollständig. Prüfe nun Inhalt, Schnitt und Texte.':'Ergänze die offenen Punkte, bevor du weitergehst.';
    const short=$('suite-short-preview');short.hidden=!job.result?.files?.includes('short');if(!short.hidden){short.src='/api/video-studio/jobs/'+job.id+'/file?kind=short';$('suite-short-download').href=short.src;$('suite-short-download').hidden=false;$('suite-short-upload').href='/youtube#upload?job='+job.id+'&kind=short';$('suite-short-upload').hidden=false;}
  }
  async function navigate(){
    const id=stage(),index=stages.findIndex(x=>x[0]===id),current=stages[index];
    document.querySelectorAll('[data-journey]').forEach(link=>{if(link.dataset.journey===id)link.setAttribute('aria-current','step');else link.removeAttribute('aria-current');});
    $('suite-stage-kicker').textContent=index>=0?'Schritt '+(index+1)+' von '+stages.length:'Dein Studio';
    $('suite-stage-title').textContent=current?.[1] || 'Ein Video, ein durchgängiger Ablauf.';$('suite-stage-help').textContent=current?.[2] || 'Beginne mit einer Idee oder setze eine Produktion fort.';
    const next=stages[Math.min(index+1,stages.length-1)] || stages[0],link=$('suite-stage-next');link.href='#'+next[0];link.dataset.suiteGo=next[0];link.textContent='Weiter: '+next[1]+' →';link.hidden=['assets','review','publish','repurpose'].includes(id);
    $('suite-production-context').hidden=!['assets','review','publish','repurpose'].includes(id);
    if(current?.[3]){$('suite-agent-mode').value=current[3];$('suite-agent-heading').textContent=current[1];}
    try{
      if(['assets','review','publish','repurpose'].includes(id))await loadProductions();
      if(id==='review'){if(packageDirty)await savePackage();if(job){publication=await api(endpoint(job.id));drawReview();}}
      if(id==='assets' && publication && !packageDirty)fillMetadata(publication);
      if(id==='publish'){
        if(!publication || reviewed!==signature(publication)){$('suite-upload-prepare').disabled=true;$('suite-upload-status').textContent='Bitte zuerst die Gesamtvorschau prüfen und dort fortfahren.';}
        else{$('suite-upload-prepare').disabled=false;$('suite-upload-status').textContent='Geprüftes Paket: '+publication.youtube.title;}
        await channels();await uploads();
      }
      if(id==='repurpose')drawReview();
    }catch(e){status(e.message);}
  }
  $('suite-finished-production').addEventListener('change',event=>{if(event.target.value)selectProduction(event.target.value).catch(e=>status(e.message));});
  document.addEventListener('suite-production-selected',event=>{const data=event.detail;$('suite-production-id').value=data.id;sessionStorage.setItem('siteops-video-production:'+data.project_id,data.id);if(data.status==='done')selectProduction(data.id).catch(e=>status(e.message));});
  document.addEventListener('suite-thumbnail-selected',event=>{thumbnail=event.detail;packageDirty=true;packageVersion++;invalidate();status('Titelbild ausgewählt. Mit „Gesamtvorschau öffnen“ für diese Produktion speichern.');});
  document.addEventListener('suite-save-package',()=>{if(job?.status==='done')savePackage().then(()=>$('suite-seo-status').textContent='Texte an der fertigen Produktion gespeichert. Kein erneutes Rendern erforderlich.').catch(e=>$('suite-seo-status').textContent=e.message);});
  ['suite-seo-title','suite-seo-description','suite-seo-keywords','suite-seo-hashtags','suite-seo-chapters','suite-thumbnail-prompt'].forEach(id=>$(id).addEventListener('input',()=>{packageDirty=true;packageVersion++;invalidate();}));
  $('suite-review-continue').addEventListener('click',()=>{reviewed=signature(publication);location.hash='publish';});
  const packageNext=document.createElement('button');packageNext.type='button';packageNext.className='suite-package-next';packageNext.textContent='Speichern & Gesamtvorschau öffnen →';packageNext.addEventListener('click',async()=>{packageNext.disabled=true;try{await savePackage();invalidate();location.hash='review';}catch(e){status(e.message);}finally{packageNext.disabled=false;}});document.querySelector('[data-suite-pane="assets"]').append(packageNext);
  $('suite-thumbnail-file').addEventListener('change',async event=>{
    const file=event.target.files[0];if(!file)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size>10*1024*1024){$('suite-thumbnail-status').textContent='Bitte PNG, JPG oder WebP bis 10 MB auswählen.';return;}
    const url=URL.createObjectURL(file),img=new Image();try{img.src=url;await img.decode();const canvas=$('suite-thumbnail-canvas'),width=Math.min(img.width,img.height*16/9),height=width*9/16;canvas.getContext('2d').drawImage(img,(img.width-width)/2,(img.height-height)/2,width,height,0,0,1280,720);canvas.hidden=false;const data=canvas.toDataURL('image/jpeg',.9);$('suite-thumbnail-download').href=data;$('suite-thumbnail-download').hidden=false;document.dispatchEvent(new CustomEvent('suite-thumbnail-selected',{detail:data.split(',')[1]}));}catch{$('suite-thumbnail-status').textContent='Bild konnte nicht geöffnet werden.';}finally{URL.revokeObjectURL(url);event.target.value='';}
  });
  async function channels(){const data=await api('/api/youtube/status'),select=$('suite-upload-account'),old=select.value;select.replaceChildren(new Option('YouTube-Kanal auswählen',''));for(const a of data.accounts || [])select.append(new Option(a.title,a.id));if(data.accounts?.some(a=>a.id===old))select.value=old;else if(data.accounts?.length===1)select.value=data.accounts[0].id;}
  const uploadSettings=()=>({account_id:$('suite-upload-account').value,job_id:job?.id,kind:'video',made_for_kids:$('suite-upload-kids').checked,contains_synthetic_media:$('suite-upload-synthetic').checked});
  async function uploads(){
    const account=$('suite-upload-account').value;if(!account)return [];
    const rows=await api('/api/youtube/uploads?account_id='+encodeURIComponent(account));$('suite-upload-list').replaceChildren();
    const relevant=rows.filter(r=>r.video_job_id===job?.id && r.kind==='video');
    if(!relevant.length)$('suite-upload-list').textContent='Für diese Produktion wurde noch kein Upload gestartet.';
    const labels={queued:'Upload wartet',uploading:'Video wird übertragen',retry:'Übertragung wird fortgesetzt',done:'Upload abgeschlossen',failed:'Übertragung benötigt deine Aufmerksamkeit'};
    for(const row of relevant){const p=document.createElement('p');p.textContent=(labels[row.status] || row.status)+(row.total_bytes?' · '+Math.round(Number(row.uploaded_bytes)/Number(row.total_bytes)*100)+' %':'')+(row.error?' · '+row.error:'');$('suite-upload-list').append(p);if(row.remote_video_id){const a=document.createElement('a');a.textContent='Privates Video auf YouTube prüfen →';a.href='https://www.youtube.com/watch?v='+encodeURIComponent(row.remote_video_id);a.target='_blank';a.rel='noopener noreferrer';$('suite-upload-list').append(a);}if(row.status==='done'){const a=document.createElement('a');a.href='#repurpose';a.dataset.suiteGo='repurpose';a.textContent='Weiter: Shorts & Social Media →';$('suite-upload-list').append(a);}}
    return relevant;
  }
  ['suite-upload-account','suite-upload-kids','suite-upload-synthetic'].forEach(id=>$(id).addEventListener('change',()=>{pending=null;$('suite-upload-confirm').hidden=true;}));
  $('suite-upload-prepare').addEventListener('click',async event=>{
    const b=event.currentTarget;b.disabled=true;try{
      if(!job || !publication || reviewed!==signature(publication))throw Error('Zuerst Gesamtvorschau prüfen.');
      if(!$('suite-upload-account').value)throw Error('YouTube-Kanal auswählen.');
      const fresh=await api(endpoint(job.id));if(signature(fresh)!==reviewed)throw Error('Das Paket wurde geändert. Gesamtvorschau erneut prüfen.');
      if((await uploads()).length)throw Error('Für diese Produktion existiert bereits ein Upload. Prüfe dessen Fortschritt, bevor du ein weiteres Video anlegst.');
      const settings=uploadSettings(),result=await api('/api/youtube/upload-preview',settings);pending={result,settings:JSON.stringify(settings),signature:reviewed};
      $('suite-upload-confirm-title').textContent=result.body.title;$('suite-upload-confirm-channel').textContent='Kanal: '+result.channel.title+' · Privat · Titelbild '+(result.body.has_thumbnail?'enthalten':'fehlt');$('suite-upload-confirm').hidden=false;$('suite-upload-status').textContent='Geprüft. Mit dem nächsten Klick startet der private Upload.';
    }catch(e){$('suite-upload-status').textContent=e.message;}finally{b.disabled=false;}
  });
  $('suite-upload-execute').addEventListener('click',async event=>{
    const b=event.currentTarget;b.disabled=true;try{if(!pending || pending.settings!==JSON.stringify(uploadSettings()) || pending.signature!==reviewed)throw Error('Upload bitte erneut prüfen.');const result=await api('/api/youtube/execute',{preview_token:pending.result.preview_token,approved:true});pending=null;$('suite-upload-confirm').hidden=true;$('suite-upload-status').textContent=result.status==='done'?'Upload freigegeben. Die Übertragung läuft im Hintergrund.':'Upload-Status prüfen.';await uploads();}catch(e){$('suite-upload-status').textContent=e.message;}finally{b.disabled=false;}
  });
  $('suite-upload-refresh').addEventListener('click',()=>uploads().catch(e=>$('suite-upload-status').textContent=e.message));
  document.addEventListener('suite-seo-proposal',event=>{if(!publication)return;fillMetadata({...publication,youtube:event.detail},true);packageDirty=true;packageVersion++;invalidate();location.hash='assets';status('SEO-Vorschlag übernommen. Prüfen und für diese Produktion speichern.');});
  document.addEventListener('suite-thumbnail-prompt',event=>{$('suite-thumbnail-prompt').value=event.detail;packageDirty=true;packageVersion++;invalidate();});
  document.querySelectorAll('[data-workflow-agent]').forEach(b=>b.addEventListener('click',()=>{
    const mode=b.dataset.workflowAgent;$('suite-agent-mode').value=mode;
    const task={seo:'Optimiere Titel, Beschreibung, Keywords, Hashtags und Kapitel für dieses fertige Video. Bewahre Sprechertext und Szenen. Liefere einen vollständigen Vorschlag mit youtube-Metadaten.',thumbnail:'Entwickle drei passende Titelbild-Konzepte und einen Bildprompt zu diesem fertigen Video.',social:'Erstelle aus dieser Produktion einen eigenständigen Short mit starkem Hook sowie passende Social-Media-Beiträge.'}[mode];
    $('suite-prompt').value=task+' Verwende nur belegte Aussagen. Die folgende ausgewählte Produktion ist maßgeblich. Video: '+(job?.title || $('vs-title').value)+'\nSprechertext:\n'+(job?.script || $('vs-script').value)+'\nMetadaten:\n'+JSON.stringify(publication?.youtube || {});location.hash='agent';
  }));
  window.addEventListener('hashchange',navigate);
  $('vs-project').addEventListener('change',()=>{if(project!==$('vs-project').value){project=$('vs-project').value;++requestNo;job=null;publication=null;thumbnail=null;packageDirty=false;invalidate();$('suite-production-id').value='';navigate();}});
  navigate();
})();
