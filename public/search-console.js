(() => {
  const root = document.getElementById('gsc');
  if (!root) return;
  const site = root.dataset.site,
    $ = id => document.getElementById('gsc-' + id);
  let preview = null,
    offset = 0,
    next = null,
    dimension = 'query',
    sort = 'clicks',
    order = 'desc',
    selectedMetric = 'clicks',
    dailyRows = [],
    dailyFailed = false,
    cachedReport = null,
    reportController,
    tableTimer,
    setupState,
    userSelected = Boolean(location.hash && ['settings', 'inspection', 'performance'].includes(location.hash.slice(1)));
  const A = window.SiteOpsAnalytics,
    metricDefinitions = A.definitions($('metrics'));
  function selectTab(key, chosen = true) {
    if (chosen) userSelected = true;
    $('tab-settings').hidden = Boolean(setupState?.can_sync && key !== 'settings');
    root.querySelectorAll('[data-gsc-panel]').forEach(panel => (panel.hidden = panel.dataset.gscPanel !== key));
    root.querySelectorAll('[data-gsc-tab]').forEach(button => {
      const selected = button.dataset.gscTab === key;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    history.replaceState(null, '', '#' + key);
  }
  root.querySelectorAll('[data-gsc-tab]').forEach(button => (button.onclick = () => selectTab(button.dataset.gscTab)));
  root.querySelectorAll('[data-gsc-go]').forEach(button => (button.onclick = () => selectTab(button.dataset.gscGo)));
  root.querySelectorAll('[role=tablist]').forEach(list =>
    list.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const buttons = [...list.querySelectorAll('[role=tab]')].filter(button => !button.hidden),
        index = buttons.indexOf(document.activeElement);
      if (index < 0) return;
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : (index + (event.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next].focus();
      buttons[next].click();
    })
  );
  selectTab(
    ['performance', 'settings', 'inspection'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'performance',
    false
  );
  const domain = root.dataset.domain;
  const propertyInput = $('link').elements.property;
  const choice = $('choice');
  function setPropertyMode() {
    const mode = choice.value;
    $('existing-area').hidden = mode !== 'existing';
    $('manual-area').hidden = mode !== 'custom';
    $('proposed').hidden = !['domain', 'prefix'].includes(mode);
    if (mode === 'domain') propertyInput.value = 'sc-domain:' + domain;
    if (mode === 'prefix') propertyInput.value = 'https://' + domain + '/';
    if (mode === 'existing') propertyInput.value = $('existing').value;
    $('proposed').textContent =
      mode === 'domain'
        ? 'Gesamte Domain (einschließlich Subdomains): sc-domain:' + domain
        : 'Nur diese HTTPS-Website: https://' + domain + '/';
    propertyInput.required = mode === 'custom';
  }
  choice.addEventListener('change', setPropertyMode);
  const actionLabels = {
    configure: 'Google-Zugang einrichten',
    connect: 'Google-Konto verbinden',
    link: 'Website auswählen',
    activate: 'Websiteverwaltung öffnen',
    live: 'Freigabe vorbereiten',
    dns: 'DNS-Vorschau vorbereiten',
    verify: 'Google-Bestätigung prüfen',
    property: 'Google-Anmeldung vorbereiten',
    google: 'Google Search Console öffnen',
    sync: 'Suchdaten abrufen',
    sitemap: 'Sitemap-Vorschau vorbereiten'
  };
  const groupFor = id =>
    ['client', 'account'].includes(id) ? 'account-settings' : id === 'link' ? 'link-settings' : 'verification-settings';
  function startStep(step) {
    const group = $(groupFor(step.id));
    group.open = true;
    if (step.action === 'configure') {
      $('technical').open = true;
      $('config').elements.client_id.focus();
    } else if (step.action === 'connect') $('connect').click();
    else if (step.action === 'link') $('choice').focus();
    else if (step.action === 'sync') $('sync').click();
    else if (['live', 'dns', 'verify', 'property', 'sitemap'].includes(step.action))
      root.querySelector('[data-preview="' + step.action + '"]').click();
    group.scrollIntoView({ block: 'nearest' });
  }
  function renderProgress(status) {
    const link = status.linkage?.invalidated ? null : status.linkage;
    setupState = status.setup;
    $('connection').textContent = setupState?.connected ? 'Google-Verbindung eingerichtet' : 'Einrichtung noch offen';
    $('account-summary').textContent =
      status.accounts?.map(account => account.email).join(', ') || 'Noch kein Konto verbunden';
    $('link-summary').textContent = link?.property || 'Noch nicht zugeordnet';
    $('verification-summary').textContent =
      setupState?.steps.find(step => step.id === 'property')?.state === 'complete'
        ? 'Google-Zugriff vorhanden'
        : link?.verified_at
          ? 'Inhaberschaft bestätigt'
          : 'Freigaben prüfen';
    $('connect').disabled = !status.configured;
    $('connect').textContent = status.accounts?.length ? 'Weiteres Google-Konto verbinden' : 'Google-Konto verbinden';
    $('progress-list').replaceChildren();
    $('completed-steps').replaceChildren();
    $('next-step').replaceChildren();
    if (!setupState) {
      $('progress-title').textContent = 'Einrichtungsstatus nicht verfügbar';
      $('progress-help').textContent = 'Lade die Ansicht erneut, um die noch fehlenden Schritte zu ermitteln.';
      $('sync').disabled = true;
      return;
    }
    const missing = setupState.steps.filter(step => step.required && step.state !== 'complete'),
      next = setupState.steps.find(step => step.id === setupState.next_step);
    $('progress').hidden = setupState.complete;
    $('setup-complete').hidden = !setupState.complete;
    $('progress-title').textContent =
      missing.length === 1 ? 'Noch ein Schritt offen' : missing.length + ' Schritte sind noch offen';
    $('progress-help').textContent =
      'Diese Schritte fehlen für diese Website. Externe Änderungen werden erst nach eigener Vorschau und Freigabe ausgeführt.';
    for (const step of setupState.steps) {
      const li = document.createElement('li'),
        title = document.createElement('strong'),
        copy = document.createElement('p'),
        state = document.createElement('span');
      li.dataset.step = step.id;
      li.dataset.state = step.state;
      title.textContent = step.title;
      copy.textContent = step.description;
      state.className = 'gsc-step-state';
      state.textContent =
        step.state === 'complete'
          ? 'Erledigt'
          : step.state === 'not_required'
            ? 'Nicht erforderlich'
            : step.state === 'optional'
              ? 'Optional'
              : step.state === 'conditional'
                ? 'Je nach Website'
                : step.id === next?.id
                  ? 'Als Nächstes'
                  : step.can_start
                    ? 'Noch offen'
                    : 'Danach';
      li.append(title, state, copy);
      if (step.id === next?.id) li.setAttribute('aria-current', 'step');
      (step.required && step.state !== 'complete' ? $('progress-list') : $('completed-steps')).append(li);
    }
    if (next?.can_start) {
      const control = document.createElement(['activate', 'google'].includes(next.action) ? 'a' : 'button');
      control.textContent = actionLabels[next.action] || next.title;
      if (next.action === 'activate') control.href = '/sites/' + encodeURIComponent(site);
      else if (next.action === 'google') {
        control.href = 'https://search.google.com/search-console/';
        control.target = '_blank';
        control.rel = 'noopener noreferrer';
      } else {
        control.type = 'button';
        control.className = 'analytics-primary';
        control.onclick = () => startStep(next);
      }
      $('next-step').append(control);
    }
    root.querySelectorAll('[data-preview]').forEach(button => {
      const step = setupState.steps.find(row => row.id === button.dataset.preview);
      button.disabled = !step?.can_review || (step.id === 'property' && step.action !== 'property');
      button.classList.toggle('is-next', step?.id === next?.id);
      button.classList.toggle('is-done', step?.state === 'complete' || step?.state === 'not_required');
      button.title = button.disabled
        ? 'Für diese Einrichtung bereits erledigt, nicht erforderlich oder noch nicht freigegeben'
        : 'Erstellt zunächst eine prüfbare Vorschau';
    });
    $('sync').disabled = !setupState.can_sync;
    $('manage').textContent = link?.sync_error ? 'Abruf und Verbindung prüfen' : 'Verbindung verwalten';
    if ((!root.dataset.statusInitialized || !userSelected) && !setupState.complete && !link?.last_sync_at)
      selectTab('settings', false);
    else if (!userSelected) selectTab('performance', false);
    else
      $('tab-settings').hidden = Boolean(
        setupState.can_sync && $('tab-settings').getAttribute('aria-selected') !== 'true'
      );
    root.dataset.statusInitialized = 'true';
  }
  const message = (value, bad = false) => {
    $('message').textContent = value;
    $('message').className = bad ? 'analytics-banner' : 'ui-sr-only';
    $('message').setAttribute('role', bad ? 'alert' : 'status');
  };
  async function api(path, body, options = {}) {
    const response = await fetch(
      '/api/search-console/' + path,
      body === undefined
        ? options
        : { ...options, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || result.error || 'Anfrage fehlgeschlagen');
    return result;
  }
  function option(value, text) {
    const el = document.createElement('option');
    el.value = value;
    el.textContent = text;
    return el;
  }
  const action = (el, fn) =>
    el.addEventListener('click', async e => {
      e.preventDefault();
      el.disabled = true;
      try {
        await fn();
      } catch (error) {
        message(error.message, true);
      } finally {
        el.disabled = false;
      }
    });
  const form = (el, fn) =>
    el.addEventListener('submit', async e => {
      e.preventDefault();
      try {
        await fn(Object.fromEntries(new FormData(el)));
      } catch (error) {
        message(error.message, true);
      }
    });
  async function load() {
    const s = await api('status?site=' + encodeURIComponent(site));
    $('redirect').textContent = s.redirect_uri;
    $('oauth-source').textContent =
      s.oauth_source === 'youtube'
        ? 'YouTube OAuth-Client wird wiederverwendet. Redirect-URI in Google Cloud ergänzen.'
        : '';
    $('config').elements.client_id.value = s.client_id;
    $('hostinger').textContent = s.hostinger_configured
      ? 'Hostinger API-Token gespeichert.'
      : 'Kein Hostinger API-Token gespeichert.';
    const selected = $('account').value;
    $('account').replaceChildren(...s.accounts.map(a => option(a.id, a.email)));
    if (selected && s.accounts.some(a => a.id === selected)) $('account').value = selected;
    const l = s.linkage;
    renderProgress(s);
    const states = {
      Property: l?.property || 'Nicht verknüpft',
      Livegang: l?.live_approved_at || 'Nicht freigegeben',
      'Google-Eigentum': l?.verified_at || 'Nicht bestätigt',
      'Google-Berechtigung': l?.permission_level || 'Keine',
      Sitemap: l?.sitemap_status || 'Nicht eingereicht',
      'Letzter Sync': l?.last_sync_at || 'Noch nicht',
      'Letzter vollständiger Datentag': l?.last_complete_date || 'Keine Daten',
      Fehler: l?.reason || l?.sync_error || 'Keine'
    };
    $('states').replaceChildren(
      ...Object.entries(states).flatMap(([key, value]) => {
        const dt = document.createElement('dt'),
          dd = document.createElement('dd');
        dt.textContent = key;
        dd.textContent = value;
        return [dt, dd];
      })
    );
    if (l?.property) {
      choice.value = 'custom';
      propertyInput.value = l.property;
    }
    setPropertyMode();
    message('Verbindung geladen.');
    if (l?.property && !l.invalidated) await performance(true);
    else {
      cachedReport = null;
      dailyRows = [];
      $('report').hidden = true;
      $('empty').hidden = false;
      $('empty').querySelector('p').textContent =
        'Verbinde diese Website mit Google, um Klicks, Suchanfragen und ihre Entwicklung zu sehen.';
    }
  }
  function drawTrend() {
    const metric = metricDefinitions.find(item => item.key === selectedMetric) || metricDefinitions[0];
    $('chart-title').textContent = metric.label + ' im Zeitverlauf';
    if (dailyFailed) {
      A.chartState($('chart'), 'Tagesverlauf konnte nicht geladen werden. Kennzahlen und Tabelle bleiben verfügbar.');
      return;
    }
    A.chart($('chart'), dailyRows, metric, {
      dateKey: 'date',
      title: $('chart-title'),
      context: $('chart-context'),
      insight: $('chart-insight')
    });
  }
  async function performance(refresh = false) {
    reportController?.abort();
    const controller = new AbortController();
    reportController = controller;
    $('report').setAttribute('aria-busy', 'true');
    $('data-error').hidden = true;
    const params = new URLSearchParams({
        dimension,
        offset,
        limit: $('limit').value,
        query: $('search').value,
        sort,
        order
      }),
      base = 'sites/' + encodeURIComponent(site) + '/performance?';
    const results = await Promise.allSettled([
      api(base + params, undefined, { signal: controller.signal }),
      refresh || !dailyRows.length
        ? api(base + 'dimension=date&limit=500', undefined, { signal: controller.signal })
        : Promise.resolve({ available: true, rows: dailyRows.map(row => ({ ...row, keys: [row.date] })) })
    ]);
    if (controller.signal.aborted) return;
    $('report').removeAttribute('aria-busy');
    if (results[0].status === 'rejected') {
      $('data-error').hidden = false;
      $('data-error-text').textContent =
        (cachedReport ? 'Die zuletzt geladene Ansicht bleibt sichtbar. ' : '') +
        'Prüfe die Verbindung und versuche es erneut.';
      if (!cachedReport) {
        $('report').hidden = true;
        $('empty').hidden = false;
      }
      return;
    }
    const result = results[0].value;
    if (!result.available) {
      $('report').hidden = true;
      $('empty').hidden = false;
      $('empty').querySelector('p').textContent = result.reason || 'Noch keine abgeschlossene Synchronisierung.';
      return;
    }
    cachedReport = result;
    $('empty').hidden = true;
    $('report').hidden = false;
    next = result.next_offset ?? null;
    $('previous').disabled = offset === 0;
    $('next').disabled = next === null;
    $('period-label').textContent = A.date(result.range.startDate, true) + ' – ' + A.date(result.range.endDate, true);
    $('comparison-range').textContent = result.previous_range
      ? 'Vergleich: ' + A.date(result.previous_range.startDate) + ' – ' + A.date(result.previous_range.endDate, true)
      : 'Vorheriger Zeitraum nicht verfügbar';
    $('range').textContent =
      'Google Search Console · Sync: ' +
      A.date(result.synced_at, true) +
      ' · Zeitzone: Los Angeles' +
      (result.truncated ? ' · Google liefert eine begrenzte Auswahl an Zeilen' : '');
    A.metrics($('metrics'), metricDefinitions, result.totals, result.previous_totals, metric => {
      selectedMetric = metric.key;
      drawTrend();
    });
    if (results[1].status === 'fulfilled' && results[1].value.available) {
      dailyFailed = false;
      dailyRows = results[1].value.rows.map(row => ({ ...row, date: row.keys[0] }));
      drawTrend();
    } else {
      dailyFailed = true;
      dailyRows = [];
      A.chartState($('chart'), 'Tagesverlauf konnte nicht geladen werden. Kennzahlen und Tabelle bleiben verfügbar.');
      $('chart-insight').textContent = 'Keine fehlenden Tageswerte ergänzt.';
    }
    const labels = { query: 'Suchanfragen', page: 'Seiten', date: 'Tage' };
    $('name-heading').textContent = { query: 'Suchanfrage', page: 'Seite', date: 'Datum' }[dimension];
    $('search').placeholder = labels[dimension] + ' durchsuchen';
    $('table-panel').setAttribute('aria-labelledby', 'gsc-dimension-' + dimension);
    $('rows').replaceChildren();
    for (const row of result.rows) {
      const tr = document.createElement('tr'),
        identity = document.createElement('td'),
        value = row.keys.join(' · ');
      identity.textContent = dimension === 'date' ? A.date(value, true) : value;
      if (dimension === 'page') {
        try {
          const target = new URL(value);
          if (
            target.protocol === 'https:' &&
            !target.username &&
            !target.password &&
            (target.hostname === domain || target.hostname.endsWith('.' + domain))
          ) {
            const link = document.createElement('a');
            link.href = target.href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = target.pathname + target.search;
            link.title = target.href;
            identity.replaceChildren(link);
          }
        } catch {}
      }
      tr.append(identity);
      for (const [key, kind] of [
        ['clicks', 'count'],
        ['impressions', 'count'],
        ['ctr', 'percent'],
        ['position', 'decimal']
      ]) {
        const td = document.createElement('td');
        td.textContent = A.format(row[key], kind);
        tr.append(td);
      }
      $('rows').append(tr);
    }
    if (!result.rows.length) {
      const tr = document.createElement('tr'),
        td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = 'Keine passenden Ergebnisse. Ändere den Suchbegriff oder die Auswahl.';
      tr.append(td);
      $('rows').append(tr);
    }
    $('row-count').textContent =
      (result.total_rows ? offset + 1 : 0) +
      '–' +
      Math.min(offset + result.rows.length, result.total_rows) +
      ' von ' +
      result.total_rows +
      ' ' +
      labels[dimension];
    $('opportunities').replaceChildren();
    for (const item of result.opportunities || []) {
      const li = document.createElement('li'),
        title = document.createElement('strong'),
        copy = document.createElement('p'),
        link = document.createElement('a');
      title.textContent = item.value;
      copy.textContent = item.suggestion;
      link.href = '/sites/' + encodeURIComponent(site) + '/seo';
      link.textContent = 'SEO-Analyse öffnen';
      li.append(title, copy, link);
      $('opportunities').append(li);
    }
    if (!result.opportunities?.length) {
      const li = document.createElement('li');
      li.textContent = 'Aus den vorhandenen Daten ergibt sich gerade keine konkrete Empfehlung.';
      $('opportunities').append(li);
    }
  }
  form($('config'), async data => {
    await api('configure', data);
    $('config').elements.client_secret.value = '';
    $('config').elements.hostinger_token.value = '';
    await load();
  });
  action($('connect'), async () => {
    location.assign((await api('oauth/start', {})).url);
  });
  async function loadProperties() {
    if (!$('account').value) {
      $('existing').replaceChildren(option('', 'Zuerst Google-Konto verbinden'));
      return;
    }
    const rows = await api(
      'properties?site=' + encodeURIComponent(site) + '&account_id=' + encodeURIComponent($('account').value)
    );
    $('existing').replaceChildren(
      option('', rows.length ? 'Website auswählen' : 'Keine passende Website gefunden'),
      ...rows.map(p => option(p.siteUrl, p.siteUrl + ' (' + p.permissionLevel + ')'))
    );
  }
  action($('properties'), loadProperties);
  $('account').addEventListener('change', () => loadProperties().catch(e => message(e.message)));
  $('existing').addEventListener('change', setPropertyMode);
  form($('link'), async data => {
    setPropertyMode();
    if (!propertyInput.value) throw new Error('Bitte eine Website auswählen.');
    data.property = propertyInput.value;
    await api('link', { site, ...data });
    cachedReport = null;
    dailyRows = [];
    $('verification-settings').open = true;
    preview = null;
    $('preview').hidden = true;
    await load();
  });
  const feedback = $('action-feedback');
  const labels = {
    live: 'Öffentliche Website freigegeben',
    dns: 'DNS-Eintrag verarbeitet',
    verify: 'Domaininhaberschaft bestätigt',
    property: 'Website bei Google angemeldet',
    sitemap: 'Sitemap bei Google eingereicht'
  };
  function showFeedback(text, kind = 'info') {
    feedback.hidden = false;
    feedback.className = 'gsc-feedback gsc-feedback-' + kind;
    feedback.textContent = text;
    feedback.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  }
  function previewControls(active) {
    $('execute').hidden = !active;
    $('change-status').hidden = !active;
    $('confirmation').disabled = !active;
    $('approved').disabled = !active;
  }
  previewControls(false);
  function describeResult(result) {
    if (result?.live_approved) return 'Die Website ist für die nächsten Schritte freigegeben.';
    if (result?.google_verified) return 'Google hat bestätigt, dass du die Domain verwalten darfst.';
    if (result?.property_registered) return 'Die Website ist erfolgreich bei Google Search Console angemeldet.';
    if (result?.sitemap_submitted) return 'Die Sitemap wurde erfolgreich an Google übermittelt.';
    if (result?.status === 'done') return 'Der Vorgang wurde erfolgreich abgeschlossen.';
    return 'Der Schritt wurde verarbeitet. Die aktualisierten Angaben stehen oben im Status.';
  }
  root.querySelectorAll('[data-preview]').forEach(el =>
    action(el, async () => {
      const data = { site, action: el.dataset.preview };
      if (['dns', 'verify'].includes(data.action) && $('allinkl').value) data.allinkl_account_id = $('allinkl').value;
      if (data.action === 'sitemap') data.sitemap_url = $('sitemap').value;
      preview = null;
      previewControls(false);
      $('confirmation').value = '';
      $('approved').checked = false;
      $('expected-confirmation').textContent = '';
      $('preview-text').textContent = '';
      feedback.hidden = true;
      try {
        const prepared = await api('previews', data);
        preview = prepared;
        previewControls(true);
        $('preview-summary').textContent =
          el.textContent.trim() + ' für ' + domain + '. Bitte Angaben prüfen und bestätigen.';
        $('expected-confirmation').textContent = preview.confirmation;
        $('confirmation').value = '';
        $('approved').checked = false;
        $('preview-text').textContent = JSON.stringify(prepared, null, 2);
        $('preview').hidden = false;
        showFeedback(
          'Vorbereitung erfolgreich. Zum Ausführen bitte den angezeigten Bestätigungstext eingeben und die Freigabe aktivieren.'
        );
        $('preview').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (error) {
        preview = null;
        $('preview').hidden = false;
        $('preview-summary').textContent = 'Dieser Schritt konnte nicht vorbereitet werden.';
        const providerHint = /ALL-INKL-Konto auswählen/i.test(error.message)
          ? ' Bitte oberhalb der Schaltflächen das passende ALL-INKL-Konto auswählen. Falls die Domain bei Hostinger liegt, muss dort der API-Zugang eingerichtet sein.'
          : '';
        showFeedback(error.message + providerHint, 'error');
      }
    })
  );
  action($('execute'), async () => {
    if (!preview) {
      showFeedback('Bitte zuerst einen Schritt vorbereiten.', 'error');
      return;
    }
    if (!$('approved').checked) {
      showFeedback('Bitte die ausdrückliche Freigabe aktivieren.', 'error');
      return;
    }
    if ($('confirmation').value.trim() !== preview.confirmation) {
      showFeedback('Der Bestätigungstext stimmt nicht überein. Bitte exakt wie angezeigt eingeben.', 'error');
      return;
    }
    showFeedback('Der Schritt wird ausgeführt …');
    try {
      const result = await api('execute', {
        preview_token: preview.preview_token,
        approved: true,
        confirmation: $('confirmation').value
      });
      $('preview-text').textContent = JSON.stringify(result, null, 2);
      const actionName = preview.action;
      preview = null;
      previewControls(false);
      await load();
      showFeedback((labels[actionName] || 'Aktion abgeschlossen') + '. ' + describeResult(result), 'success');
    } catch (error) {
      showFeedback(
        'Aktion nicht abgeschlossen: ' +
          error.message +
          ' Bitte vor einem erneuten Versuch „Ergebnis prüfen“ verwenden.',
        'error'
      );
    }
  });
  action($('change-status'), async () => {
    if (!preview) {
      showFeedback('Noch kein vorbereiteter Vorgang vorhanden.', 'error');
      return;
    }
    try {
      const status = await api('change-status', { preview_token: preview.preview_token });
      $('preview-text').textContent = JSON.stringify(status, null, 2);
      if (status.status === 'done')
        showFeedback('Erfolgreich abgeschlossen. ' + describeResult(status.result), 'success');
      else if (status.status === 'failed')
        showFeedback(
          'Der Vorgang ist fehlgeschlagen: ' + (status.error || 'Keine Fehlerbeschreibung verfügbar.'),
          'error'
        );
      else if (status.status === 'running') showFeedback('Der Vorgang wird noch verarbeitet.');
      else showFeedback('Der Vorgang ist vorbereitet und wartet auf die Freigabe.');
    } catch (error) {
      showFeedback('Status konnte nicht geprüft werden: ' + error.message, 'error');
    }
  });
  action($('sync'), async () => {
    message('Google-Daten werden synchronisiert…');
    await api('sites/' + encodeURIComponent(site) + '/sync', {});
    await load();
    selectTab('performance');
  });
  action($('unlink'), async () => {
    if (confirm('Lokale Verknüpfung für ' + site + ' entfernen? Google und DNS bleiben bestehen.')) {
      await api('sites/' + encodeURIComponent(site) + '/unlink', {});
      await load();
    }
  });
  action($('disconnect'), async () => {
    if (confirm('Gewähltes Google-Konto und seine lokalen Projektverknüpfungen trennen?')) {
      await api('accounts/' + encodeURIComponent($('account').value) + '/disconnect', {});
      await load();
    }
  });
  form($('inspect'), async data => {
    const box = $('inspection-summary');
    box.textContent = 'Google prüft die URL …';
    try {
      const result = await api('sites/' + encodeURIComponent(site) + '/inspect', data);
      $('inspection').textContent = JSON.stringify(result, null, 2);
      const info = result.inspectionResult?.indexStatusResult || result.indexStatusResult || {},
        title = document.createElement('h3'),
        description = document.createElement('p'),
        facts = document.createElement('dl');
      title.textContent =
        info.verdict === 'PASS'
          ? 'Die URL ist bei Google indexiert'
          : info.verdict === 'FAIL'
            ? 'Google meldet ein Indexierungsproblem'
            : 'URL-Prüfung abgeschlossen';
      description.textContent =
        {
          'Submitted and indexed': 'Die Seite wurde eingereicht und ist im Google-Index.',
          'Crawled - currently not indexed': 'Google hat die Seite abgerufen, aber derzeit nicht indexiert.'
        }[info.coverageState] ||
        info.coverageState ||
        'Google hat keinen detaillierten Abdeckungsstatus geliefert.';
      for (const [label, value] of [
        ['Geprüfte URL', data.url],
        ['Letzter Google-Abruf', info.lastCrawlTime ? A.date(info.lastCrawlTime, true) : 'Nicht gemeldet'],
        ['Indexierung', info.indexingState === 'INDEXING_ALLOWED' ? 'Zulässig' : info.indexingState || 'Nicht gemeldet']
      ]) {
        const term = document.createElement('dt'),
          detail = document.createElement('dd');
        term.textContent = label;
        detail.textContent = value;
        facts.append(term, detail);
      }
      box.replaceChildren(title, description, facts);
    } catch (error) {
      box.textContent = 'Die URL konnte nicht geprüft werden. ' + error.message;
      throw error;
    }
  });
  root.querySelectorAll('[data-dimension]').forEach(
    button =>
      (button.onclick = () => {
        dimension = button.dataset.dimension;
        offset = 0;
        root.querySelectorAll('[data-dimension]').forEach(item => {
          const selected = item === button;
          item.setAttribute('aria-selected', String(selected));
          item.tabIndex = selected ? 0 : -1;
        });
        performance().catch(error => message(error.message, true));
      })
  );
  $('search').addEventListener('input', () => {
    clearTimeout(tableTimer);
    tableTimer = setTimeout(() => {
      offset = 0;
      performance().catch(error => message(error.message, true));
    }, 180);
  });
  $('limit').onchange = () => {
    offset = 0;
    performance().catch(error => message(error.message, true));
  };
  root.querySelectorAll('[data-sort]').forEach(
    button =>
      (button.onclick = () => {
        order =
          sort === button.dataset.sort
            ? order === 'desc'
              ? 'asc'
              : 'desc'
            : button.dataset.sort === 'name'
              ? 'asc'
              : 'desc';
        sort = button.dataset.sort;
        offset = 0;
        root.querySelectorAll('[data-sort]').forEach(item => {
          item.closest('th').removeAttribute('aria-sort');
        });
        button.closest('th').setAttribute('aria-sort', order === 'asc' ? 'ascending' : 'descending');
        performance().catch(error => message(error.message, true));
      })
  );
  action($('retry'), () => performance(true));
  action($('previous'), async () => {
    offset = Math.max(0, offset - Number($('limit').value));
    await performance();
  });
  action($('next'), async () => {
    if (next !== null) offset = next;
    await performance();
  });
  fetch('/api/hosting/allinkl/accounts')
    .then(r => (r.ok ? r.json() : []))
    .then(rows => {
      for (const a of rows) $('allinkl').append(option(a.id, a.name));
    })
    .catch(() => {});
  setPropertyMode();
  load()
    .then(loadProperties)
    .catch(e => {
      message(e.message, true);
      $('connection').textContent = 'Verbindung nicht verfügbar';
      $('report').hidden = true;
      $('empty').hidden = false;
    });
})();
