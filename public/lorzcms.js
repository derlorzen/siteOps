(() => {
  const byId = id => document.getElementById(id);
  const notice = byId('cmsNotice');
  document.querySelectorAll('[data-cms-timezone]').forEach(x => {
    x.textContent = 'Zeit auf diesem Gerät: ' + Intl.DateTimeFormat().resolvedOptions().timeZone;
  });
  const runAt = form => (form.get('runAt') ? new Date(form.get('runAt')).toISOString() : undefined);
  async function send(path, body = {}) {
    const response = await fetch('/api/lorzcms/' + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || result.error || 'Auftrag konnte nicht gespeichert werden.');
    return result;
  }
  async function action(button, work) {
    button.disabled = true;
    notice.hidden = false;
    notice.textContent = 'Wird vorbereitet …';
    try {
      await work();
      location.reload();
    } catch (error) {
      notice.textContent = error.message;
      button.disabled = false;
      notice.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
  byId('cmsBundled').addEventListener('click', e => action(e.currentTarget, () => send('releases/bundled')));
  byId('cmsReleaseFile').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    await action(e.target, async () => {
      if (file.size > 18 * 1024 * 1024) throw new Error('Versionspaket zu groß.');
      return send('releases', JSON.parse(await file.text()));
    });
  });
  const create = byId('cmsCreate');
  document.querySelectorAll('[data-cms-restart]').forEach(button =>
    button.addEventListener('click', () => {
      create.reset();
      const values = JSON.parse(button.dataset.cmsRestart);
      Object.entries(values).forEach(([name, value]) => {
        const field = create.elements.namedItem(name);
        if (field) field.value = value;
      });
      byId('cmsMysql').hidden = true;
      notice.hidden = false;
      notice.textContent =
        'Einrichtung erneut planen: Hosting-Passwort, Datenbank und Administratorkonto wieder eintragen. Nach einer unterbrochenen Einrichtung die ursprünglichen Daten verwenden oder zuerst den CMS-Zustand prüfen.';
      create.scrollIntoView({ behavior: 'smooth', block: 'start' });
    })
  );
  create.elements.protocol.addEventListener('change', () => {
    create.elements.port.value = create.elements.protocol.value === 'sftp' ? 22 : 21;
  });
  create.elements.databaseEngine.addEventListener('change', () => {
    byId('cmsMysql').hidden = create.elements.databaseEngine.value !== 'mysql';
  });
  create.addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(create);
    const data = Object.fromEntries(f);
    data.port = Number(f.get('port'));
    data.runAt = runAt(f);
    data.publicRootReady = f.has('publicRootReady');
    data.database =
      f.get('databaseEngine') === 'sqlite'
        ? { engine: 'sqlite' }
        : {
            engine: 'mysql',
            host: f.get('databaseHost'),
            name: f.get('databaseName'),
            user: f.get('databaseUser'),
            password: f.get('databasePassword')
          };
    ['databaseEngine', 'databaseHost', 'databaseName', 'databaseUser', 'databasePassword'].forEach(
      key => delete data[key]
    );
    action(create.querySelector('button'), async () => {
      const result = await send('installations', data);
      create.reset();
      return result;
    });
  });
  const schedule = byId('cmsSchedule');
  schedule.addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(schedule);
    action(schedule.querySelector('button'), () =>
      send('updates', { installations: f.getAll('installation'), version: f.get('version'), runAt: runAt(f) })
    );
  });
  const attach = byId('cmsAttach');
  attach.addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(attach);
    action(attach.querySelector('button'), () =>
      send('installations/attach', {
        site: f.get('site'),
        baseUrl: f.get('baseUrl'),
        publicRootReady: f.has('publicRootReady')
      })
    );
  });
  document.querySelectorAll('[data-cms-action]').forEach(button =>
    button.addEventListener('click', () => {
      const kind = button.dataset.cmsAction;
      if (
        kind === 'rollback' &&
        !confirm('Den vorherigen Core aktivieren? Aktuelle Inhalte und Medien bleiben erhalten.')
      )
        return;
      action(button, () => send('jobs/' + encodeURIComponent(button.dataset.job) + '/' + kind));
    })
  );
  document
    .querySelectorAll('[data-cms-inspect]')
    .forEach(button =>
      button.addEventListener('click', () =>
        action(button, () => send('installations/' + encodeURIComponent(button.dataset.cmsInspect) + '/inspect'))
      )
    );
})();
