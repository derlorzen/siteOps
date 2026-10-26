(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const escapeHtml = v =>
    String(v ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]
    );
  const msg = (v, bad = false) => {
    const el = $('#vs-message');
    el.textContent = v;
    el.classList.toggle('vs-error', bad);
  };
  const api = async (url, method = 'GET', data) => {
    const r = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: data ? { 'content-type': 'application/json' } : {},
      body: data ? JSON.stringify(data) : undefined
    });
    const x = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(x.message || x.error || 'HTTP ' + r.status);
    return x;
  };
  const formatDate = x => new Date(x).toLocaleString('de-DE');
  let templates = [];
  let projects = [],
    jobs = [];
  let policyBusy = false,
    policySupported = false;
  const policyStatus = (message, bad = false) => {
    const el = $('#vs-policy-status');
    el.textContent = message;
    el.classList.toggle('vs-error', bad);
  };
  function policyControls() {
    for (const id of ['hosts', 'save', 'suggest', 'reset'])
      $('#vs-policy-' + id).disabled = policyBusy || !policySupported;
    $('#vs-policy-reload').disabled = policyBusy;
  }
  function showPolicy(data) {
    policySupported = data.supported;
    const policy = data.policy || data.environmentPolicy;
    $('#vs-policy-hosts').value = policy?.hosts?.join('\n') || '';
    const source =
      data.source === 'siteops'
        ? 'SiteOps-Datenbank'
        : data.source === 'invalid'
          ? 'Ungültige SiteOps-Konfiguration'
          : 'VIDEO_ALLOWED_HOSTS auf dem Runner';
    const rules = policy?.hosts?.length ? policy.hosts.join(', ') : 'alle Demos gesperrt';
    const problems = [
      data.settingsError,
      data.runnerError,
      data.source === 'environment' ? data.environmentError : null,
      !data.supported ? 'Browser Runner aktualisieren, um Demo-Domains hier sicher verwalten zu können.' : null
    ].filter(Boolean);
    policyStatus(
      'Quelle: ' + source + ' · ' + rules + (problems.length ? ' · ' + problems.join(' ') : ''),
      problems.length > 0
    );
  }
  async function loadPolicy() {
    policyBusy = true;
    policyControls();
    try {
      showPolicy(await api('/api/video-studio/demo-policy'));
    } catch (e) {
      policySupported = false;
      policyStatus('Freigaben konnten nicht geladen werden: ' + e.message, true);
    } finally {
      policyBusy = false;
      policyControls();
    }
  }
  async function savePolicy(policy) {
    policyBusy = true;
    policyControls();
    try {
      showPolicy(await api('/api/video-studio/demo-policy', 'POST', { policy }));
      // A successful write only changes new requests; queued jobs retain their snapshot.
      msg('Demo-Domainfreigaben für neue Renderaufträge gespeichert. Laufende Aufträge behalten ihre Freigaben.');
    } catch (e) {
      policyStatus('Nicht gespeichert: ' + e.message, true);
    } finally {
      policyBusy = false;
      policyControls();
    }
  }
  $('#vs-policy-form').addEventListener('submit', event => {
    event.preventDefault();
    const text = $('#vs-policy-hosts').value.trim();
    savePolicy({ version: 1, hosts: text ? text.split(/\r?\n/).map(s => s.trim()) : [] });
  });
  $('#vs-policy-suggest').addEventListener('click', () => {
    $('#vs-policy-hosts').value = '*.lorzen.de\nshop.lorzen.link';
    policyStatus('Vorschlag eingetragen. Erst Speichern aktiviert diese Freigaben.');
  });
  $('#vs-policy-reset').addEventListener('click', () => savePolicy(null));
  $('#vs-policy-reload').addEventListener('click', loadPolicy);
  const voiceChoices = {
    kokoro: [
      ['am_adam', 'Adam – US English'],
      ['am_michael', 'Michael – US English'],
      ['af_heart', 'Heart – US English'],
      ['bf_emma', 'Emma – British English'],
      ['bm_george', 'George – British English']
    ],
    piper: [['de_DE-thorsten-medium', 'Thorsten – Hochdeutsch']],
    openai: [
      ['alloy', 'Alloy'],
      ['coral', 'Coral'],
      ['nova', 'Nova'],
      ['onyx', 'Onyx'],
      ['shimmer', 'Shimmer'],
      ['marin', 'Marin'],
      ['cedar', 'Cedar']
    ]
  };
  function updateVoiceChoices() {
    const provider = $('#vs-voice-provider').value;
    const el = $('#vs-voice');
    const old = el.value;
    el.innerHTML = voiceChoices[provider]
      .map(([value, label]) => '<option value="' + value + '">' + label + '</option>')
      .join('');
    if (voiceChoices[provider].some(([key]) => key === old)) el.value = old;
  }
  function syncLanguage() {
    const language = $('#vs-language').value;
    const provider = $('#vs-voice-provider').value;
    if (language === 'de' && provider === 'kokoro') $('#vs-voice-provider').value = 'piper';
    if (language === 'en' && provider === 'piper') $('#vs-voice-provider').value = 'kokoro';
    updateVoiceChoices();
  }
  $('#vs-language').addEventListener('change', syncLanguage);
  $('#vs-voice-provider').addEventListener('change', () => {
    const p = $('#vs-voice-provider').value;
    if (p === 'piper') $('#vs-language').value = 'de';
    else if (p === 'kokoro') $('#vs-language').value = 'en';
    updateVoiceChoices();
  });
  syncLanguage();
  async function reload() {
    try {
      [projects, jobs] = await Promise.all([api('/api/video-studio/projects'), api('/api/video-studio/jobs')]);
      const el = $('#vs-project'),
        old = el.value;
      el.innerHTML =
        '<option value="">Projekt auswählen</option>' +
        projects
          .map(
            p =>
              '<option value="' +
              escapeHtml(p.id) +
              '">' +
              escapeHtml(p.name) +
              ' · ' +
              escapeHtml(p.channel) +
              '</option>'
          )
          .join('');
      if (projects.some(p => p.id === old)) el.value = old;
      else if (projects.length) el.value = projects[0].id;
      if (el.value !== old) el.dispatchEvent(new Event('change'));
      const selected = projects.find(p => p.id === el.value);
      if (selected) { $('#vs-project-name').value = selected.name; $('#vs-channel').value = selected.channel; $('#vs-language').value = selected.language; $('#vs-voice-provider').value = selected.voice_provider || (selected.language === 'de' ? 'piper' : 'kokoro'); syncLanguage(); $('#vs-voice').value = selected.voice; }
      $('#vs-jobs').innerHTML = jobs.length
        ? jobs
            .map(j => {
              const status = escapeHtml(j.status);
              const available = j.status === 'done';
              const fileLink = (kind, label) =>
                '<a href="/api/video-studio/jobs/' +
                encodeURIComponent(j.id) +
                '/file?kind=' +
                kind +
                '">' +
                label +
                '</a>';
              return (
                '<article class="vs-job" data-id="' +
                escapeHtml(j.id) +
                '"><div class="vs-job-head"><strong>' +
                escapeHtml(j.title) +
                '</strong><span class="vs-status">' +
                status +
                '</span></div>' +
                '<small>' +
                escapeHtml(formatDate(j.created_at)) +
                '</small>' +
                (j.error ? '<p class="vs-error">' + escapeHtml(j.error) + '</p>' : '') +
                (available ? '<video class="suite-result-video" controls preload="none" src="/api/video-suite/preview/' + encodeURIComponent(j.id) + '" aria-label="Videovorschau"></video>' : '') +
                '<div class="vs-row">' +
                '<button type="button" class="ghost" data-edit="' + escapeHtml(j.id) + '">Als Entwurf öffnen</button>' +
                (['draft', 'failed'].includes(j.status)
                  ? '<button type="button" data-render="' + escapeHtml(j.id) + '">Video rendern</button>'
                  : '') +
                (['running', 'queued'].includes(j.status)
                  ? '<button type="button" data-check="' + escapeHtml(j.id) + '">Status prüfen</button>'
                  : '') +
                (available
                  ? fileLink('video', 'MP4 herunterladen') +
                    fileLink('short', 'Short 9:16') +
                    fileLink('subtitles', 'Untertitel') +
                    fileLink('thumbnail', 'Thumbnail') +
                    fileLink('metadata', 'YouTube-Metadaten') + '<a href="/youtube#upload?job=' + encodeURIComponent(j.id) + '">An YouTube übergeben →</a>'
                  : '') +
                '</div></article>'
              );
            })
            .join('')
        : '<p class="vs-note">Noch keine Videoprojekte erstellt.</p>';
    } catch (e) {
      msg('Daten konnten nicht geladen werden: ' + e.message, true);
    }
  }
  $('#vs-project-save').addEventListener('click', async () => {
    if (!$('#vs-project').value) return msg('Bitte Projekt auswählen.', true);
    try {
      await api('/api/video-studio/projects/' + $('#vs-project').value, 'POST', {
        name: $('#vs-project-name').value.trim() || projects.find(p => p.id === $('#vs-project').value).name,
        channel: $('#vs-channel').value,
        language: $('#vs-language').value,
        voice_provider: $('#vs-voice-provider').value,
        voice: $('#vs-voice').value
      });
      await reload();
      msg('Projekteinstellungen gespeichert.');
    } catch (e) {
      msg(e.message, true);
    }
  });
  $('#vs-project').addEventListener('change', () => {
    const p = projects.find(x => x.id === $('#vs-project').value);
    if (!p) return;
    $('#vs-project-name').value = p.name;
    $('#vs-channel').value = p.channel;
    $('#vs-language').value = p.language;
    $('#vs-voice-provider').value = p.voice_provider;
    syncLanguage();
    $('#vs-voice').value = p.voice;
  });
  async function loadTemplates() {
    try {
      templates = await api('/api/video-studio/demo-templates');
      $('#vs-template').innerHTML =
        '<option value="">Neue Demoszene</option>' +
        templates.map(t => '<option value="' + escapeHtml(t.id) + '">' + escapeHtml(t.name) + '</option>').join('');
    } catch (e) {
      $('#vs-template-status').textContent = e.message;
    }
  }
  $('#vs-template').addEventListener('change', () => {
    const x = templates.find(t => t.id === $('#vs-template').value);
    $('#vs-template-name').value = x?.name || '';
    $('#vs-template-json').value = x ? JSON.stringify(x.scene, null, 2) : '';
  });
  $('#vs-template-save').addEventListener('click', async () => {
    const b = $('#vs-template-save');
    b.disabled = true;
    try {
      await api(
        '/api/video-studio/demo-templates' + ($('#vs-template').value ? '/' + $('#vs-template').value : ''),
        'POST',
        {
          name: $('#vs-template-name').value,
          language: $('#vs-language').value,
          scene: JSON.parse($('#vs-template-json').value)
        }
      );
      await loadTemplates();
      $('#vs-template-status').textContent = 'Demoszene gespeichert.';
    } catch (e) {
      $('#vs-template-status').textContent = 'Nicht gespeichert: ' + e.message;
    } finally {
      b.disabled = false;
    }
  });
  $('#vs-template-use').addEventListener('click', () => {
    try {
      const scene = JSON.parse($('#vs-template-json').value),
        current = JSON.parse($('#vs-scene-json').value || '[]');
      current.push(scene);
      $('#vs-scene-json').value = JSON.stringify(current, null, 2);
      msg('Demoszene zum Szenenplan hinzugefügt.');
    } catch (e) {
      $('#vs-template-status').textContent = 'Szenenplan oder Demoszene enthält ungültiges JSON.';
    }
  });
  loadTemplates();
  $('#vs-project-add').addEventListener('click', async () => {
    const name = $('#vs-project-name').value.trim();
    if (name.length < 2) return msg('Projektname benötigt mindestens zwei Zeichen.', true);
    try {
      const created = await api('/api/video-studio/projects', 'POST', {
        name,
        channel: $('#vs-channel').value,
        language: $('#vs-language').value,
        voice_provider: $('#vs-voice-provider').value,
        voice: $('#vs-voice').value
      });
      await reload();
      $('#vs-project').value = created.id;
      $('#vs-project').dispatchEvent(new Event('change'));
      $('#vs-project-name').value = '';
      msg('Projekt wurde erstellt.');
    } catch (e) {
      msg(e.message, true);
    }
  });
  $('#vs-form').addEventListener('submit', async event => {
    event.preventDefault();
    const project_id = $('#vs-project').value;
    if (!project_id) return msg('Bitte zuerst ein Projekt erstellen.', true);
    const title = $('#vs-title').value.trim();
    const raw = $('#vs-scene-json').value.trim();
    let scenes,
      script = $('#vs-script').value.trim();
    if (raw) {
      try {
        scenes = JSON.parse(raw);
      } catch {
        return msg('Der strukturierte Szenenplan enthält ungültiges JSON.', true);
      }
      if (
        !Array.isArray(scenes) ||
        !scenes.length ||
        scenes.length > 24 ||
        scenes.some(s => !s || typeof s.narration !== 'string' || s.narration.length < 5 || s.narration.length > 1400)
      )
        return msg('Szenenplan: 1–24 Szenen mit jeweils 5–1.400 Zeichen Sprechertext angeben.', true);
      if (!script) script = scenes.map(s => s.narration).join('\n\n');
    } else {
      const paragraphs = script
        .split(/\n\s*\n/)
        .map(s => s.trim())
        .filter(Boolean);
      if (!paragraphs.length || paragraphs.length > 24 || paragraphs.some(s => s.length < 5 || s.length > 1400))
        return msg('Skript muss 1–24 Absätze mit jeweils 5–1.400 Zeichen enthalten.', true);
    }
    if (script.length < 30) return msg('Mindestens 30 Zeichen Sprechertext erforderlich.', true);
    const button = $('#vs-create');
    button.disabled = true;
    try {
      const job = await api('/api/video-studio/jobs', 'POST', {
        project_id,
        title,
        topic: $('#vs-topic').value.trim(),
        script,
        scenes,
        youtube: $('#vs-youtube-json').value.trim() ? JSON.parse($('#vs-youtube-json').value) : undefined,
        format: $('#vs-format').value
      });
      msg('Videoentwurf gespeichert. Klicke auf „Video rendern“, um den Runner zu starten.');
      await reload();
      document.querySelector('[data-id="' + job.id + '"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) {
      msg(e.message, true);
    } finally {
      button.disabled = false;
    }
  });
  $('#vs-jobs').addEventListener('click', async event => {
    const edit = event.target.closest('[data-edit]');
    if (edit) {
      try { const r = await api('/api/video-studio/jobs/' + edit.dataset.edit); document.dispatchEvent(new CustomEvent('suite-open-production', { detail: r })); } catch (e) { msg(e.message, true); }
      return;
    }
    const render = event.target.closest('[data-render]'),
      check = event.target.closest('[data-check]');
    if (!render && !check) return;
    const target = render || check;
    target.disabled = true;
    try {
      const id = target.dataset.render || target.dataset.check;
      const result = await api(
        '/api/video-studio/jobs/' + encodeURIComponent(id) + (render ? '/render' : ''),
        render ? 'POST' : 'GET',
        render ? {} : undefined
      );
      msg(
        render
          ? 'Renderauftrag übergeben. Der Renderer verarbeitet das Video im Hintergrund.'
          : 'Status: ' + result.status + (result.runner_warning ? ' · ' + result.runner_warning : '')
      );
      await reload();
    } catch (e) {
      msg(e.message, true);
    } finally {
      target.disabled = false;
    }
  });
  async function checkRenderer() {
    try {
      const data = await api('/api/video-studio/capabilities');
      $('#vs-capabilities').textContent =
        'Runner verbunden · Englisch/Kokoro: ' +
        (data.offlineModels?.kokoro ? 'Modell bereit' : 'automatischer Download bei erster Nutzung') +
        ' · Deutsch/Piper: ' +
        (data.offlineModels?.piper ? 'Modell bereit' : 'automatischer Download bei erster Nutzung') +
        ' · OpenAI: ' +
        (data.openaiConfigured ? 'API konfiguriert' : 'API-Schlüssel fehlt');
    } catch (e) {
      $('#vs-capabilities').textContent = 'Runner noch nicht bereit: ' + e.message;
    }
  }
  $('#vs-refresh').addEventListener('click', () => {
    reload();
    checkRenderer();
  });
  checkRenderer();
  loadPolicy();
  reload();
  setInterval(() => {
    if (document.visibilityState === 'visible' && jobs.some(j => ['running', 'queued'].includes(j.status))) {
      Promise.all(
        jobs
          .filter(j => ['running', 'queued'].includes(j.status))
          .map(j => api('/api/video-studio/jobs/' + encodeURIComponent(j.id)).catch(() => null))
      ).then(reload);
    }
  }, 12000);
})();
