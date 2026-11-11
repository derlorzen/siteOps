(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const form = $('#calendar-form');
  if (!form) return;
  const notice = $('#calendar-notice');
  const textFields = ['replacement_title', 'exclude_prefix', 'office_address', 'office_label', 'calendar_name'];
  const numberFields = ['past_days', 'refresh_minutes'];
  const checkFields = ['keep_all_day_titles', 'enabled'];
  let noticeTimer;

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: options.method && options.method !== 'GET' ? { 'content-type': 'application/json' } : undefined,
      body: options.method && options.method !== 'GET' ? JSON.stringify(options.body || {}) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.message || data.error || 'HTTP ' + response.status);
    return data;
  }
  function announce(message, isError = false) {
    notice.textContent = message;
    notice.className = isError ? 'tools-notice error' : 'tools-notice';
    notice.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice.hidden = true), 6000);
  }
  function stat(label, value, wide = false) {
    const box = document.createElement('div');
    if (wide) box.className = 'calendar-wide';
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    box.append(dt, dd);
    return box;
  }
  function render(status, fillForm) {
    $('#calendar-feed-url').value = status.feed_url || '';
    const state = $('#calendar-state');
    state.className = 'tools-badge';
    if (!status.source_configured) state.textContent = 'Quelle fehlt';
    else if (status.last_error) {
      state.textContent = 'Abruffehler';
      state.classList.add('calendar-error');
    } else if (!status.enabled) state.textContent = 'Pausiert';
    else {
      state.textContent = 'Aktiv';
      state.classList.add('calendar-ok');
    }
    const stats = $('#calendar-stats');
    stats.replaceChildren();
    const s = status.stats;
    if (s) {
      stats.append(
        stat('Übernommen', String(s.included)),
        stat('davon anonymisiert', String(s.anonymized)),
        stat('mit Originaltitel', String(s.original_titles)),
        stat('Ausgeschlossen (Präfix)', String(s.excluded_prefix)),
        stat('Abgesagt / zu alt', s.excluded_cancelled + ' / ' + s.excluded_past)
      );
    }
    stats.append(
      stat(
        'Letzter Abgleich',
        status.last_sync_at ? new Date(status.last_sync_at).toLocaleString('de-DE') : 'noch keiner',
        true
      )
    );
    if (status.last_error) stats.append(stat('Letzter Fehler', status.last_error, true));
    $('#calendar-source-hint').textContent = status.source_configured
      ? 'Hinterlegt (' + (status.source_host || 'Adresse gespeichert') + '). Leer lassen, um sie zu behalten.'
      : 'Google Kalender → Einstellungen des Kalenders → „Privatadresse im iCal-Format“.';
    const body = $('#calendar-preview');
    body.replaceChildren();
    const rows = status.preview || [];
    if (!rows.length) {
      const row = body.insertRow();
      const cell = row.insertCell();
      cell.colSpan = 3;
      cell.textContent = status.source_configured
        ? 'Keine anstehenden Einzeltermine.'
        : 'Hinterlege zuerst die Quelladresse.';
    }
    for (const entry of rows) {
      const row = body.insertRow();
      row.insertCell().textContent = entry.start + (entry.all_day ? ' (ganztägig)' : '');
      row.insertCell().textContent = entry.title;
      row.insertCell().textContent = entry.location || '–';
    }
    if (!fillForm) return;
    for (const name of textFields) form.elements[name].value = status[name] ?? '';
    for (const name of numberFields) form.elements[name].value = status[name];
    for (const name of checkFields) form.elements[name].checked = Boolean(status[name]);
    form.elements.source_url.value = '';
  }
  async function busy(button, label, task) {
    const old = button.textContent;
    button.disabled = true;
    button.textContent = label;
    try {
      await task();
    } catch (error) {
      announce(String(error.message || error), true);
    } finally {
      button.disabled = false;
      button.textContent = old;
    }
  }
  const reload = async fillForm => render(await api('/api/calendar-bridge'), fillForm);

  form.addEventListener('submit', event => {
    event.preventDefault();
    const body = { source_url: form.elements.source_url.value.trim() };
    for (const name of textFields) body[name] = form.elements[name].value;
    for (const name of numberFields) body[name] = Number(form.elements[name].value);
    for (const name of checkFields) body[name] = form.elements[name].checked;
    busy($('#calendar-save'), 'Speichert …', async () => {
      const status = await api('/api/calendar-bridge', { method: 'PUT', body });
      render(status, true);
      if (status.last_error) announce('Gespeichert, aber der Abruf schlug fehl: ' + status.last_error, true);
      else announce('Gespeichert und Regeln angewendet.');
    });
  });
  $('#calendar-refresh').addEventListener('click', event =>
    busy(event.currentTarget, 'Gleicht ab …', async () => {
      try {
        await api('/api/calendar-bridge/refresh', { method: 'POST' });
        announce('Abgleich abgeschlossen.');
      } finally {
        await reload(false);
      }
    })
  );
  $('#calendar-rotate').addEventListener('click', event => {
    if (!confirm('Neue Abo-Adresse erzeugen? Die bisherige Adresse funktioniert danach nicht mehr.')) return;
    busy(event.currentTarget, 'Erzeugt …', async () => {
      render(await api('/api/calendar-bridge/token', { method: 'POST' }), false);
      announce('Neue Adresse erzeugt. Bitte im Familienkalender neu abonnieren.');
    });
  });
  $('#calendar-copy').addEventListener('click', async event => {
    const input = $('#calendar-feed-url');
    try {
      await navigator.clipboard.writeText(input.value);
    } catch {
      input.select();
      document.execCommand('copy');
    }
    const button = event.currentTarget;
    button.textContent = '✓ Kopiert';
    setTimeout(() => (button.textContent = 'Kopieren'), 1800);
  });
  reload(true).catch(error => announce(String(error.message || error), true));
})();
