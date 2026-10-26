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
    if (!['overview', 'agent', 'script', 'production', 'assets', 'settings'].includes(id)) id = 'overview';
    for (const pane of document.querySelectorAll('[data-suite-pane]')) pane.hidden = pane.dataset.suitePane !== id;
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
  let projectId = '', conversationId, latest, scenes = [], saveTimer, dirty = false, loading = false, sending = false;
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
  function drawScenes() {
    const container = $('suite-scene-list'); container.replaceChildren();
    scenes.forEach((scene, i) => {
      const card = document.createElement('div'); card.className = 'suite-scene-card';
      const head = document.createElement('div'); head.className = 'suite-scene-head';
      const title = document.createElement('strong'); title.textContent = 'Szene ' + (i + 1) + (scene.demoUrl ? ' · Browser-Demo' : ''); head.append(title);
      for (const [text, label, action] of [
        ['↑', 'Szene nach oben', () => { if (i) [scenes[i-1], scenes[i]] = [scenes[i], scenes[i-1]]; }],
        ['↓', 'Szene nach unten', () => { if (i < scenes.length-1) [scenes[i+1], scenes[i]] = [scenes[i], scenes[i+1]]; }],
        ['Entfernen', 'Szene entfernen', () => scenes.splice(i, 1)]
      ]) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'ghost'; b.textContent = text; b.setAttribute('aria-label', label);
        b.addEventListener('click', () => { action(); commitScenes(); drawScenes(); }); head.append(b);
      }
      card.append(head);
      for (const [key, label, multiline, max] of [['headline','Szenentitel',false,160],['narration','Sprechertext',true,1400],['visual_directions','Bildidee / Produktionsnotiz',true,1200]]) {
        const l = document.createElement('label'); l.textContent = label; const field = document.createElement(multiline ? 'textarea' : 'input'); field.value = scene[key] || ''; field.maxLength = max;
        if (multiline) field.rows = key === 'narration' ? 3 : 2;
        field.addEventListener('input', () => { scene[key] = field.value; commitScenes(); }); l.append(field); card.append(l);
      }
      container.append(card);
    });
  }
  $('suite-add-scene').addEventListener('click', () => { if (scenes.length >= 24) return; scenes.push({ headline: 'Neue Szene', narration: '' }); commitScenes(); drawScenes(); });
  // Existing demo-template insertion updates the JSON editor; reflect it in the visual scene editor.
  $('vs-template-use').addEventListener('click', () => { syncScenes(); if (scenes.length) commitScenes(); location.hash = 'script'; });
  async function selectProject() {
    const next = $('vs-project').value;
    if (!next || next === projectId || loading || sending) return;
    try { await saveCurrent(); }
    catch { $('vs-project').value = projectId; return; }
    const previous = projectId; projectId = next; loading = true;
    $('vs-project').disabled = true;
    try {
      const draft = await api('drafts/' + next);
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
  function appendMessage(role, text, result) {
    $('suite-chat-log').querySelector('.suite-chat-empty')?.remove();
    const item = document.createElement('div'); item.className = 'suite-chat-message'; item.dataset.role = role;
    const label = document.createElement('strong'); label.textContent = role === 'user' ? 'Du' : 'Creative Agent';
    const content = document.createElement('div'); content.textContent = text; item.append(label, content);
    if (result?.draft) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Vorschlag ansehen & übernehmen'; b.addEventListener('click', () => reviewDraft(result.draft)); item.append(b);
    }
    if (result?.thumbnail_prompt) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ghost'; b.textContent = 'Motiv im Thumbnail Studio öffnen';
      b.addEventListener('click', () => { $('suite-thumbnail-prompt').value = result.thumbnail_prompt; location.hash = 'assets'; }); item.append(b);
    }
    if (result?.social_posts?.length) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ghost'; b.textContent = 'Social Posts öffnen';
      b.addEventListener('click', () => { showPosts(result.social_posts); location.hash = 'assets'; }); item.append(b);
    }
    $('suite-chat-log').append(item); item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function reviewDraft(draft) {
    let dialog = $('suite-draft-review'); if (dialog) dialog.remove();
    dialog = document.createElement('dialog'); dialog.id = 'suite-draft-review'; dialog.style.cssText = 'max-width:760px;width:90%;max-height:85vh;border:1px solid #dbe2ed;border-radius:14px;padding:25px;';
    const title = document.createElement('h2'); title.textContent = 'Produktionsvorschlag prüfen';
    const note = document.createElement('p'); note.textContent = 'Übernehmen ersetzt Titel, Sprechertext, Szenen und SEO des aktuellen Entwurfs. Bereits gespeicherte Produktionen bleiben erhalten.';
    const preview = document.createElement('pre'); preview.style.cssText = 'white-space:pre-wrap;max-height:50vh;overflow:auto;font:13px/1.7 sans-serif;';
    preview.textContent = draft.title + '\n\n' + draft.scenes.map((s,i) => (i+1) + '. ' + s.headline + '\n' + s.narration + (s.visual_directions ? '\nBild: ' + s.visual_directions : '')).join('\n\n') + '\n\nSEO\n' + draft.youtube.title + '\n' + draft.youtube.description;
    const apply = document.createElement('button'); apply.textContent = 'In aktuellen Entwurf übernehmen';
    apply.addEventListener('click', () => {
      $('vs-title').value = draft.title; $('vs-script').value = draft.script;
      $('vs-scene-json').value = JSON.stringify(draft.scenes, null, 2); $('vs-youtube-json').value = JSON.stringify(draft.youtube, null, 2);
      syncScenes(); loadSeo(); changed(); dialog.close(); location.hash = 'script';
    });
    const cancel = document.createElement('button'); cancel.textContent = 'Zurück'; cancel.addEventListener('click', () => dialog.close()); dialog.append(title,note,preview,apply,cancel); document.body.append(dialog); dialog.showModal();
  }
  function showPosts(posts) {
    $('suite-social-posts').replaceChildren();
    for (const post of posts) { const article = document.createElement('article'); const h = document.createElement('h3'); h.textContent = post.platform; const p = document.createElement('p'); p.style.whiteSpace = 'pre-wrap'; p.textContent = post.text; const b = document.createElement('button'); b.type='button'; b.className='ghost'; b.textContent='Text kopieren'; b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(post.text); b.textContent='Kopiert'; } catch { b.textContent='Bitte Text markieren und kopieren'; } }); article.append(h,p,b); $('suite-social-posts').append(article); }
  }
  $('suite-new-chat').addEventListener('click', () => { if (sending) return; conversationId = undefined; latest = undefined; $('suite-conversation').value = ''; $('suite-chat-log').replaceChildren(); });
  $('suite-conversation').addEventListener('change', async () => {
    if (sending) return;
    conversationId = $('suite-conversation').value || undefined; $('suite-chat-log').replaceChildren();
    if (!conversationId) return;
    try { const data = await api('conversations/' + conversationId + '?project_id=' + projectId); for (const m of data.messages) appendMessage(m.role, m.text || m.result.reply, m.result); latest = data.messages.at(-1)?.result; if (latest?.social_posts) showPosts(latest.social_posts); }
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
  $('suite-agent-form').addEventListener('submit', async event => {
    event.preventDefault(); if (sending) return;
    if (!projectId) { $('suite-agent-status').textContent = 'Bitte zuerst unter Einstellungen ein Projekt anlegen.'; return; }
    const text = $('suite-prompt').value.trim(); if (text.length < 2) return;
    sending = true; $('suite-send').disabled = true; $('vs-project').disabled = true; $('suite-conversation').disabled = true;
    $('suite-agent-status').textContent = 'Der Agent arbeitet an deiner Anfrage …';
    try {
      const data = snapshot();
      const result = await api('chat', { project_id: projectId, conversation_id: conversationId, message: text, mode: $('suite-agent-mode').value, context: { title: data.title, topic: data.topic, script: data.script, format: data.format, ...(data.scene_json ? { scenes: JSON.parse(data.scene_json) } : {}), ...(data.youtube_json ? { youtube: JSON.parse(data.youtube_json) } : {}) } });
      appendMessage('user', text); appendMessage('assistant', result.reply, result); conversationId = result.conversation_id; latest = result;
      $('suite-prompt').value = ''; if (result.social_posts.length) showPosts(result.social_posts);
      $('suite-agent-status').textContent = 'Antwort gespeichert' + (result.usage?.total_tokens ? ' · ' + result.usage.total_tokens + ' Tokens' : '');
      await loadConversations();
    } catch (e) { $('suite-agent-status').textContent = e.message; }
    finally { sending = false; $('suite-send').disabled = false; $('vs-project').disabled = false; $('suite-conversation').disabled = false; }
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
      changed(); $('suite-seo-status').textContent = 'SEO in den Arbeitsentwurf übernommen. Für die Produktion den Entwurf unter Skript & Szenen speichern.';
    } catch (e) { $('suite-seo-status').textContent = e.message; }
  });
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

  async function previewAsset(url) {
    const img = new Image(); img.src = url; await img.decode();
    const canvas = $('suite-thumbnail-canvas'), ctx = canvas.getContext('2d');
    const height = img.width * 9 / 16;
    ctx.drawImage(img, 0, (img.height-height)/2, img.width, height, 0, 0, 1280, 720); canvas.hidden = false;
    $('suite-thumbnail-download').href = canvas.toDataURL('image/jpeg', .9); $('suite-thumbnail-download').hidden = false;
  }
  async function loadAssets() {
    const items = await api('assets?project_id=' + projectId);
    $('suite-thumbnail-gallery').replaceChildren();
    for (const item of items) {
      const box = document.createElement('div'); const img = document.createElement('img'); img.src = item.url; img.alt = 'Gespeichertes Titelbild'; img.loading = 'lazy';
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ghost'; b.textContent = 'Vorschau'; b.addEventListener('click', () => previewAsset(item.url).catch(e => { $('suite-thumbnail-status').textContent=e.message; }));
      const link = document.createElement('a'); link.href = '/youtube#captions?asset=' + encodeURIComponent(item.id); link.textContent = 'Für YouTube verwenden →';
      box.append(img,b,link); $('suite-thumbnail-gallery').append(box);
    }
  }
  $('suite-thumbnail-generate').addEventListener('click', async () => {
    const b = $('suite-thumbnail-generate'); b.disabled = true; $('suite-thumbnail-status').textContent = 'Titelbild wird generiert. Das kann einige Minuten dauern …';
    try {
      if (!projectId) throw Error('Bitte zuerst ein Projekt auswählen.');
      const result = await api('thumbnails', { project_id: projectId, prompt: $('suite-thumbnail-prompt').value });
      await previewAsset(result.url); await loadAssets();
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
    fillDraft({ title:job.title, topic:job.topic, script:job.script, scene_json:JSON.stringify(job.scenes || []), youtube_json:JSON.stringify(job.youtube || {}), format:job.format }); changed(); location.hash='script';
  });
  metrics(); $('vs-refresh').addEventListener('click', metrics);
  // A successful production save switches directly to the production queue.
  new MutationObserver(() => { if ($('vs-message').textContent.startsWith('Videoentwurf gespeichert')) location.hash='production'; }).observe($('vs-message'),{ childList:true });
})();
