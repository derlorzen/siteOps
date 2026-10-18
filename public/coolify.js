(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const notice = $('coolifyNotice');
  if (!notice) return;
  function show(message, failed = false) {
    notice.hidden = false;
    notice.textContent = message;
    notice.style.color = failed ? '#a11c28' : 'inherit';
  }
  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || 'HTTP ' + response.status);
    return data;
  }
  const connect = $('coolifyConnect');
  connect?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = connect.querySelector('[type=submit]');
    button.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(connect));
      if (!body.defaultServerUuid) delete body.defaultServerUuid;
      await api('/api/coolify/connections', { method: 'POST', body: JSON.stringify(body) });
      connect.reset();
      window.location.reload();
    } catch (error) {
      show(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  const account = $('coolifyConnection');
  const server = $('coolifyServer');
  const project = $('coolifyProject');
  let requestNo = 0;
  async function updateTargets() {
    const seq = ++requestNo;
    server.replaceChildren(new Option('Automatisch bei nur einem Server', ''));
    project.replaceChildren(new Option('Eigenes Coolify-Projekt automatisch anlegen', ''));
    server.disabled = project.disabled = !account.value;
    if (!account.value) return;
    $('coolifyInfo').textContent = 'Prüfe Verbindung und lade verfügbare Server/Projekte …';
    try {
      const result = await api('/api/coolify/connections/' + encodeURIComponent(account.value) + '/info');
      if (requestNo !== seq) return;
      for (const item of result.servers) server.add(new Option(item.name + ' · ' + item.uuid, item.uuid));
      for (const item of result.projects) project.add(new Option(item.name + ' · ' + item.uuid, item.uuid));
      if (result.defaultServerUuid) server.value = result.defaultServerUuid;
      $('coolifyInfo').textContent =
        result.servers.length +
        ' Server, ' +
        result.projects.length +
        ' Coolify-Projekte gefunden. Neue Projektkennung = eigene Supabase-Instanz.';
    } catch (error) {
      $('coolifyInfo').textContent = 'Coolify-Verbindung konnte nicht geprüft werden: ' + error.message;
      show(error.message, true);
    }
  }
  account?.addEventListener('change', () => void updateTargets());
  if (account?.options.length === 2) {
    account.selectedIndex = 1;
    void updateTargets();
  }
  $('coolifySupabaseCreate')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget,
      button = form.querySelector('[type=submit]');
    if (!confirm('Für dieses Projekt eine eigene Supabase-Instanz auf Coolify anlegen und starten?')) return;
    button.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(form));
      if (!body.serverUuid) delete body.serverUuid;
      if (!body.coolifyProjectUuid) delete body.coolifyProjectUuid;
      const saved = await api('/api/coolify/supabase', { method: 'POST', body: JSON.stringify(body) });
      show('Supabase-Auftrag eingereiht: ' + saved.name + '. Status regelmäßig aktualisieren.');
      await refresh();
    } catch (error) {
      show(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  const tbody = $('coolifyRows');
  async function refresh() {
    try {
      const items = await api('/api/coolify/supabase');
      tbody.replaceChildren();
      for (const item of items) {
        const row = document.createElement('tr');
        for (const [label, value] of [
          ['Projekt', item.name + ' · ' + item.projectKey],
          ['Status', item.state + (item.lastError ? ' · ' + item.lastError : '')],
          ['Service', item.serviceUuid || '–']
        ]) {
          const td = document.createElement('td');
          td.dataset.label = label;
          td.textContent = value;
          row.append(td);
        }
        const cell = document.createElement('td');
        cell.dataset.label = 'Aktionen';
        const check = document.createElement('button');
        check.type = 'button';
        check.textContent = 'Prüfen';
        check.className = 'ghost';
        check.addEventListener('click', async () => {
          try {
            const status = await api('/api/coolify/supabase/' + encodeURIComponent(item.id));
            show(
              status.name +
                ': ' +
                status.state +
                (status.lastError ? ' · ' + status.lastError : '') +
                (status.serviceUuid ? ' · Service ' + status.serviceUuid : '')
            );
          } catch (error) {
            show(error.message, true);
          }
        });
        cell.append(check);
        if (item.state === 'needs_attention') {
          const retry = document.createElement('button');
          retry.type = 'button';
          retry.textContent = 'Erneut versuchen';
          retry.className = 'ghost';
          retry.addEventListener('click', async () => {
            if (!confirm('Coolify-Ressourcen vor einem erneuten Versuch abgleichen und den Auftrag fortsetzen?'))
              return;
            try {
              await api('/api/coolify/supabase/' + encodeURIComponent(item.id) + '/retry', {
                method: 'POST',
                body: '{}'
              });
              show('Erneuter Versuch eingereiht.');
              await refresh();
            } catch (error) {
              show(error.message, true);
            }
          });
          cell.append(retry);
        }
        row.append(cell);
        tbody.append(row);
      }
      if (!items.length) {
        const row = document.createElement('tr'),
          cell = document.createElement('td');
        cell.colSpan = 4;
        cell.textContent = 'Noch keine Supabase-Instanzen.';
        row.append(cell);
        tbody.append(row);
      }
    } catch (error) {
      show(error.message, true);
    }
  }
  $('coolifyRefresh')?.addEventListener('click', () => void refresh());
})();
