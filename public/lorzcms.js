(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const notice = byId('cmsNotice');
  if (!notice) return;
  const show = (message, isError = false) => {
    notice.hidden = false;
    notice.classList.toggle('cms-message-error', isError);
    notice.textContent = message;
    notice.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  const send = async (path, body = {}, method = 'POST') => {
    const response = await fetch('/api/lorzcms/' + path, {
      method, credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(payload.message || payload.error || 'HTTP ' + response.status);
    return payload;
  };
  const action = async (button, task, { reload = true } = {}) => {
    button.disabled = true;
    show('Anfrage wird verarbeitet …');
    try {
      const result = await task();
      if (result?.ok === false) {
        show((result.message || 'Die Installation ist noch nicht betriebsbereit.') +
          (result.jobError ? '\nLetzter Fehler: ' + result.jobError : '') +
          (result.canResume ? '\nDu kannst diesen Anschluss über „Anschluss fortsetzen“ reparieren.' : ''), false);
      } else if (reload) window.location.reload();
      else show(result?.message || 'Die Prüfung wurde abgeschlossen.', false);
    } catch (error) {
      show(error.message, true);
    } finally {
      button.disabled = false;
    }
  };
  document.querySelectorAll('[data-cms-timezone]').forEach(el => {
    el.textContent = 'Zeitzone dieses Geräts: ' + Intl.DateTimeFormat().resolvedOptions().timeZone;
  });
  const runAt = formData => formData.get('runAt') ? new Date(formData.get('runAt')).toISOString() : undefined;

  // Dedicated installation detail page: no "CMS noch nicht eingerichtet" dead end.
  document.querySelectorAll('[data-cms-inspect]').forEach(button => {
    button.addEventListener('click', () => action(button,
      () => send('installations/' + encodeURIComponent(button.dataset.cmsInspect) + '/inspect'),
      { reload: false }));
  });
  document.querySelectorAll('[data-cms-resume]').forEach(button => {
    button.addEventListener('click', () => {
      if (!window.confirm('Den bestehenden CMS-Anschluss fortsetzen? Die vorhandene Website wird nicht neu installiert.')) return;
      action(button, () => send('installations/' + encodeURIComponent(button.dataset.cmsResume) + '/resume'));
    });
  });

  // Changing customer project is independent of CMS installation and preserves site data.
  const assignment = byId('cmsProjectAssignment');
  assignment?.addEventListener('submit', event => {
    event.preventDefault();
    const button = assignment.querySelector('[type=submit]');
    const siteId = assignment.dataset.siteId;
    const projectId = assignment.elements.namedItem('projectId').value || null;
    action(button, async () => {
      const response = await fetch('/api/sites/' + encodeURIComponent(siteId) + '/project', {
        method: 'PUT', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project_id: projectId })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(result.message || result.error || 'Projektverknüpfung fehlgeschlagen.');
      return result;
    });
  });

  document.querySelectorAll('[data-cms-action]').forEach(button => {
    button.addEventListener('click', () => {
      const kind = button.dataset.cmsAction;
      if (kind === 'rollback' &&
          !window.confirm('Vorherige Core-Version aktivieren? Aktuelle Inhalte und Medien bleiben erhalten.')) return;
      action(button, () => send('jobs/' + encodeURIComponent(button.dataset.job) + '/' + kind));
    });
  });

  byId('cmsBundled')?.addEventListener('click', event =>
    action(event.currentTarget, () => send('releases/bundled')));
  byId('cmsReleaseFile')?.addEventListener('change', event => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    action(event.currentTarget, async () => {
      if (file.size > 18 * 1024 * 1024) throw Error('Versionspaket ist zu groß.');
      return send('releases', JSON.parse(await file.text()));
    });
  });

  const schedule = byId('cmsSchedule');
  schedule?.addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(schedule);
    action(schedule.querySelector('[type=submit]'), () =>
      send('updates', { installations: form.getAll('installation'),
        version: form.get('version'), runAt: runAt(form) }));
  });

  const attach = byId('cmsAttach');
  if (attach) {
    const selection = attach.elements.namedItem('site');
    const updateAddress = () => {
      const url = selection.selectedOptions?.[0]?.dataset?.url;
      if (url) attach.elements.namedItem('baseUrl').value = url;
    };
    selection.addEventListener('change', updateAddress);
    updateAddress();
    attach.addEventListener('submit', event => {
      event.preventDefault();
      const form = new FormData(attach);
      action(attach.querySelector('[type=submit]'), () => send('installations/attach', {
        site: form.get('site'), baseUrl: form.get('baseUrl'),
        publicRootReady: form.has('publicRootReady'),
        ...(form.get('projectId') ? { projectId: form.get('projectId') } : {})
      }));
    });
  }

  const create = byId('cmsCreate');
  if (!create) return;
  const stored = create.elements.namedItem('savedConnection');
  const allinkl = create.elements.namedItem('allinklAccountId');
  const publicRootCheckbox = create.elements.namedItem('publicRootReady');
  const hint = byId('cmsSavedConnectionHint');
  const fields = ['protocol', 'host', 'port', 'username', 'password'];
  let connections = [];

  async function fetchConnections() {
    const [profilesResponse,sitesResponse] = await Promise.all([
      fetch('/api/server-profiles', { credentials: 'same-origin' }),
      fetch('/api/sites', { credentials: 'same-origin' })
    ]);
    if (!profilesResponse.ok || !sitesResponse.ok) throw Error('Serverprofile konnten nicht geladen werden.');
    const [profiles,sites] = await Promise.all([profilesResponse.json(),sitesResponse.json()]);
    connections = [
      ...profiles.map(item => ({ kind:'profile',id:item.id,label:'Serverprofil · '+item.name,
        protocol:item.protocol,host:item.host,port:item.port,username:item.username })),
      ...sites.filter(item => item.deployment_mode === 'webspace').map(item => ({
        kind:'site',id:item.id,label:'Website · '+item.name,
        protocol:item.protocol,host:item.host,port:item.port,username:item.username }))
    ];
    for (const item of connections) stored.add(new Option(item.label, item.kind + ':' + item.id));
  }
  function syncConnection() {
    const selected = connections.find(item => item.kind + ':' + item.id === stored.value);
    for (const key of fields) {
      const field = create.elements.namedItem(key);
      field.readOnly = !!selected && key !== 'protocol';
      if (key === 'protocol') field.disabled = !!selected;
      field.required = key === 'password' ? !selected : true;
    }
    if (selected) {
      for (const key of fields.filter(key => key !== 'password'))
        create.elements.namedItem(key).value = selected[key];
      create.elements.namedItem('password').value = '';
    }
    hint.textContent = selected
      ? 'Zugangsdaten werden ausschließlich auf dem Server übernommen. Gib nur das Zielverzeichnis ein.'
      : 'Hosting-Daten eingeben oder eine gespeicherte Verbindung auswählen.';
  }
  function syncAllInkl() {
    const option = allinkl.selectedOptions?.[0];
    if (allinkl.value && option?.dataset.profile) {
      stored.value='profile:'+option.dataset.profile;
      stored.disabled=true;
    } else {
      stored.disabled=false;
    }
    publicRootCheckbox.required=!allinkl.value;
    publicRootCheckbox.checked=!!allinkl.value;
    document.getElementById('cmsAllInklHint').textContent=allinkl.value
      ? 'SiteOps legt beim Start das leere Projektverzeichnis und die ALL-INKL-Subdomain automatisch an. Das CMS startet erst bei verfügbarer HTTPS-Verbindung; bei fehlendem Zertifikat kann ein erneuter Start nötig sein.'
      : 'ALL-INKL kann Webverzeichnis und Subdomain automatisch anlegen. Hinterlege den KAS-Zugang unter Hosting & DNS.';
    syncConnection();
  }
  allinkl.addEventListener('change',syncAllInkl);
  stored.addEventListener('change', syncConnection);
  fetchConnections().then(syncAllInkl).catch(error => hint.textContent = error.message);
  create.elements.namedItem('protocol').addEventListener('change', () => {
    create.elements.namedItem('port').value = create.elements.namedItem('protocol').value === 'sftp' ? 22 : 21;
  });
  create.elements.namedItem('databaseEngine').addEventListener('change', () => {
    byId('cmsMysql').hidden = create.elements.namedItem('databaseEngine').value !== 'mysql';
  });

  // Cancelled initial installations have discarded setup passwords. Restore only public site
  // metadata; require the operator to re-enter credentials and administrator password.
  const resumeId = new URLSearchParams(window.location.search).get('resume');
  if (resumeId) {
    Promise.all([
      fetch('/api/lorzcms/overview').then(r=>r.ok?r.json():Promise.reject(Error('CMS-Übersicht nicht verfügbar'))),
      fetch('/api/sites').then(r=>r.ok?r.json():Promise.reject(Error('Website-Liste nicht verfügbar')))
    ]).then(([overview,sites]) => {
      const installation = overview.installations.find(i=>i.id===resumeId);
      const job = overview.jobs.find(j=>j.installationId===resumeId);
      const site = sites.find(i=>i.id===installation?.siteId);
      if (!installation || !site || installation.version || job?.kind!=='install' || job.state!=='cancelled') return;
      for (const [name,value] of Object.entries({
        name:site.name,slug:site.slug,baseUrl:installation.baseUrl,version:job.version,
        protocol:site.protocol,host:site.host,port:site.port,username:site.username,
        remoteRoot:site.remote_root
      })) {
        const field=create.elements.namedItem(name);
        if (field && value != null) field.value=String(value);
      }
      show('Bisherige Einrichtungsdaten wurden übernommen. Bitte Hosting-Passwort, Datenbank und Administratorzugang erneut angeben.');
    }).catch(error=>show(error.message,true));
  }

  create.addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(create);
    const values = Object.fromEntries(form.entries());
    const selection = stored.value;
    const useAllInkl = !!allinkl.value;
    delete values.savedConnection;
    if (useAllInkl) values.allinklAccountId=allinkl.value;
    if (selection && !useAllInkl) {
      const [kind,id] = String(selection).split(':');
      if (kind === 'profile') values.profileId=id;
      if (kind === 'site') values.existingSiteId=id;
      // Disabled protocol select does not appear in FormData, but the server supplies it.
    } else if (!useAllInkl && !values.password) {
      show('Bitte ein Hosting-Passwort eingeben oder eine gespeicherte Verbindung auswählen.', true);
      return;
    }
    if (!values.projectId) delete values.projectId;
    values.port = Number(form.get('port'));
    values.publicRootReady = useAllInkl || form.has('publicRootReady');
    values.runAt = runAt(form);
    values.database = form.get('databaseEngine')==='sqlite' ? {engine:'sqlite'} : {
      engine:'mysql',host:form.get('databaseHost'),
      name:form.get('databaseName'),user:form.get('databaseUser'),
      password:form.get('databasePassword')
    };
    for (const name of ['databaseEngine','databaseHost','databaseName','databaseUser','databasePassword'])
      delete values[name];
    action(create.querySelector('[type=submit]'), () => send('installations', values));
  });
})();
