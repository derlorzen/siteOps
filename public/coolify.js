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
  const saveStatus = $('coolifySaveStatus');
  const connectionRows = $('coolifyConnectionsRows');
  const account = $('coolifyConnection');
  const server = $('coolifyServer');
  const project = $('coolifyProject');
  let savedConnections = [];
  let editingConnectionId = null;
  function editMode(connection = null) {
    editingConnectionId = connection?.id || null;
    $('coolifyConnectHeading').textContent = connection ? 'Coolify-Verbindung bearbeiten' : 'Coolify verbinden';
    $('coolifySave').textContent = connection ? 'Änderungen speichern' : 'Verbindung speichern';
    $('coolifyCancelEdit').hidden = !connection;
    const tokenField = connect.elements.namedItem('token');
    tokenField.required = !connection;
    tokenField.value = '';
    $('coolifyTokenHint').textContent = connection
      ? '(leer lassen, um das gespeicherte Token beizubehalten)'
      : '(wird verschlüsselt gespeichert)';
    if (connection) {
      connect.elements.namedItem('name').value = connection.name;
      connect.elements.namedItem('baseUrl').value = connection.baseUrl;
      connect.elements.namedItem('defaultServerUuid').value = connection.defaultServerUuid || '';
    }
  }
  $('coolifyCancelEdit')?.addEventListener('click', () => {
    connect.reset();
    editMode();
    saveStatus.textContent = '';
  });
  async function refreshConnections(preferredId = null) {
    const records = await api('/api/coolify/connections');
    savedConnections = records;
    const selection = preferredId || account.value;
    connectionRows.replaceChildren();
    account.replaceChildren(new Option('Verbindung wählen', ''));
    for (const item of records) {
      account.add(new Option(item.name + ' · ' + item.baseUrl, item.id));
      const tr = document.createElement('tr');
      for (const [label, value] of [
        ['Bezeichnung', item.name],
        ['API-Adresse', item.baseUrl],
        ['Server-UUID', item.defaultServerUuid || 'Automatisch']
      ]) {
        const td = document.createElement('td');
        td.dataset.label = label;
        td.textContent = value;
        tr.append(td);
      }
      const actions = document.createElement('td');
      actions.dataset.label = 'Aktionen';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'ghost';
      edit.textContent = 'Bearbeiten';
      edit.addEventListener('click', () => {
        editMode(item);
        saveStatus.textContent = 'Verbindung ' + item.name + ' ausgewählt. Gespeichertes Token bleibt erhalten.';
        connect.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
      const check = document.createElement('button');
      check.type = 'button';
      check.className = 'ghost';
      check.textContent = 'Verbindung prüfen';
      check.addEventListener('click', async () => {
        check.disabled = true;
        try {
          const info = await api('/api/coolify/connections/' + encodeURIComponent(item.id) + '/info');
          show('Coolify-Verbindung „' + item.name + '“ erreichbar: ' + info.servers.length + ' Server.');
        } catch (error) {
          show('Coolify-Verbindung „' + item.name + '“ ist gespeichert, aber die API-Prüfung scheitert: ' + error.message, true);
        } finally {
          check.disabled = false;
        }
      });
      actions.append(edit, check);
      tr.append(actions);
      connectionRows.append(tr);
    }
    if (!records.length) {
      const tr = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 4;
      cell.textContent = 'Noch keine Coolify-Verbindung gespeichert.';
      tr.append(cell);
      connectionRows.append(tr);
    }
    if (selection && records.some(record => record.id === selection)) account.value = selection;
    else if (records.length === 1) account.value = records[0].id;
    await updateTargets();
  }
  connect?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = connect.querySelector('[type=submit]');
    button.disabled = true;
    saveStatus.textContent = 'Speichere Coolify-Verbindung …';
    try {
      const body = Object.fromEntries(new FormData(connect));
      if (!body.defaultServerUuid) {
        if (editingConnectionId) body.defaultServerUuid = null;
        else delete body.defaultServerUuid;
      }
      if (!body.token) delete body.token;
      const isEdit = Boolean(editingConnectionId);
      const endpoint = isEdit
        ? '/api/coolify/connections/' + encodeURIComponent(editingConnectionId)
        : '/api/coolify/connections';
      const saved = await api(endpoint, {
        method: isEdit ? 'PUT' : 'POST',
        body: JSON.stringify(body)
      });
      // Do not reset or reload: the user should see which connection persisted.
      editMode(saved);
      saveStatus.textContent = 'Verbindung „' + saved.name + '“ erfolgreich gespeichert.';
      show('Coolify-Verbindung „' + saved.name + '“ wurde gespeichert. API-Erreichbarkeit wird separat geprüft.');
      try {
        await refreshConnections(saved.id);
      } catch (error) {
        show('Gespeichert, aber die Verbindungsliste konnte nicht aktualisiert werden: ' + error.message, true);
      }
    } catch (error) {
      saveStatus.textContent = 'Speichern fehlgeschlagen: ' + error.message;
      show(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
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
      $('coolifyInfo').textContent = 'Gespeicherte Verbindung derzeit nicht erreichbar: ' + error.message;
    }
  }
  account?.addEventListener('change', () => void updateTargets());
  void refreshConnections().catch(error => {
    show('Gespeicherte Coolify-Verbindungen konnten nicht geladen werden: ' + error.message, true);
  });
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
      if (!body.destinationUuid) delete body.destinationUuid;
      if (!body.siteopsProjectId) delete body.siteopsProjectId;
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
