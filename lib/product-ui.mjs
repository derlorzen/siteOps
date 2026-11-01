export const escapeHtml = value =>
  String(value ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
const esc = escapeHtml;
export const statusLabel = state =>
  `<span class="ui-status" data-tone="${esc(state.tone || 'neutral')}">${esc(state.label)}</span>`;
export const emptyState = (title, description, action = '') =>
  `<div class="ui-empty"><strong>${esc(title)}</strong><p>${esc(description)}</p>${action}</div>`;
export const unavailableState = title =>
  `<div class="ui-feedback" role="status"><strong>${esc(title)}</strong><p>Die Daten sind gerade nicht verfügbar. Prüfe die Verbindung und lade die Ansicht erneut.</p><button type="button" class="ghost" data-reload>Erneut laden</button></div>`;
export const pageHeading = (title, description, actions = '') =>
  `<header class="ui-page-heading"><div><h1>${esc(title)}</h1><p>${esc(description)}</p></div><div class="actions">${actions}</div></header>`;
const day = value =>
  value && Number.isFinite(new Date(value).getTime())
    ? new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short' }).format(new Date(value))
    : 'Termin offen';
const siteUrl = site => '/sites/' + encodeURIComponent(site.slug);
const time = value =>
  value
    ? new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' }).format(
        new Date(value)
      )
    : 'Noch keine Prüfung';

export function websiteRows(items) {
  return items
    .map(
      site =>
        `<tr><td data-label="Website"><a class="ui-identity" href="${siteUrl(site)}">${esc(site.name)}</a><small>${esc(site.domain)}</small></td><td data-label="Status">${statusLabel(site.status)}<small>${esc(time(site.last_checked_at))}</small></td><td data-label="Kunde / Projekt">${site.project_id ? `<a href="/billing/projects/${encodeURIComponent(site.project_id)}">${esc(site.project_name)}</a><small>${esc(site.customer_name)}</small>` : '<span class="ui-muted">Eigenständige Website</span>'}</td><td data-label="Nächster Schritt"><a class="ui-row-action" href="${siteUrl(site)}">${site.status.code === 'attention' ? 'Problem prüfen' : site.status.code === 'unknown' ? 'Status prüfen' : 'Website öffnen'} <span aria-hidden="true">→</span></a></td></tr>`
    )
    .join('');
}

export function renderWebsiteList(data) {
  return (
    pageHeading(
      'Websites',
      'Zustand prüfen, Probleme bearbeiten und im Projekt weiterarbeiten.',
      '<a class="btn" href="/setup">Website hinzufügen</a>'
    ) +
    `<section class="ui-collection" id="websiteCollection"><form class="ui-toolbar" id="websiteFilters" role="search"><label>Websites durchsuchen<input name="query" type="search" maxlength="90" placeholder="Name, Domain, Kunde oder Projekt …" value="${esc(data.filters.query)}"></label><label>Status<select name="status">${[
      ['all', 'Alle Zustände'],
      ['attention', 'Handlungsbedarf'],
      ['online', 'Erreichbar'],
      ['unknown', 'Status unbekannt'],
      ['paused', 'Überwachung aus']
    ]
      .map(
        ([key, label]) => `<option value="${key}"${data.filters.status === key ? ' selected' : ''}>${label}</option>`
      )
      .join('')}</select></label><label>Sortierung<select name="sort">${[
      ['name', 'Name'],
      ['status', 'Dringlichkeit'],
      ['checked', 'Letzte Prüfung']
    ]
      .map(([key, label]) => `<option value="${key}"${data.filters.sort === key ? ' selected' : ''}>${label}</option>`)
      .join(
        ''
      )}</select></label><button class="ghost" type="submit">Anwenden</button></form><p class="ui-meta" id="websiteResultCount" role="status" aria-live="polite">${data.total} von ${data.total_sites} Websites</p><div id="websiteLoadError" hidden></div><div class="tablewrap"><table class="ui-data-table"><caption class="ui-sr-only">Verwaltete Websites mit Betriebszustand und Projektzuordnung</caption><thead><tr><th scope="col">Website</th><th scope="col">Letzte Prüfung</th><th scope="col">Kunde / Projekt</th><th scope="col">Nächster Schritt</th></tr></thead><tbody id="websiteRows">${websiteRows(data.items)}</tbody></table></div><div id="websiteEmpty"${data.items.length ? ' hidden' : ''}>${emptyState(data.total_sites ? 'Keine passenden Websites' : 'Die erste Website hinzufügen', data.total_sites ? 'Ändere den Suchbegriff oder setze den Statusfilter zurück.' : 'Verbinde eine bestehende Website oder bereite eine neue vor.', '<a href="/setup">Website hinzufügen</a>')}</div><div class="ui-pagination"><button type="button" class="ghost" id="websitePrevious"${data.filters.offset ? '' : ' disabled'}>Zurück</button><span id="websiteRange">${data.total ? data.filters.offset + 1 : 0}–${Math.min(data.filters.offset + data.items.length, data.total)} von ${data.total}</span><button type="button" class="ghost" id="websiteNext"${data.next_offset == null ? ' disabled' : ''}>Weitere Websites</button></div></section><script type="application/json" id="websiteInitialData">${JSON.stringify(data).replace(/</g, '\\u003c')}</script><script defer src="/assets/product-workspace.js"></script>`
  );
}

export function renderWorkHome(data) {
  const portfolio = data.websites;
  const attention = portfolio?.items.filter(site => ['attention', 'unknown'].includes(site.status.code)) || [];
  const tasks = Array.isArray(data.tasks) ? data.tasks : data.tasks?.tasks || [];
  return (
    pageHeading(
      'Arbeitszentrale',
      'Was Aufmerksamkeit braucht und wo du weiterarbeiten kannst.',
      '<a class="btn ghost" href="/websites">Alle Websites</a>'
    ) +
    (portfolio
      ? `<dl class="ui-summary"><div><dt>Websites</dt><dd>${portfolio.total_sites}</dd></div><div><dt>Erreichbar</dt><dd>${portfolio.counts.online}</dd></div><div><dt>Handlungsbedarf</dt><dd>${portfolio.counts.attention}</dd></div><div><dt>Status unbekannt</dt><dd>${portfolio.counts.unknown}</dd></div></dl>`
      : unavailableState('Website-Zustand nicht verfügbar')) +
    `<div class="ui-work-grid"><section class="ui-panel"><div class="sectionhead"><h2>Websites prüfen</h2><a href="/websites?status=attention">Alle Probleme</a></div>${!portfolio ? unavailableState('Websites konnten nicht geladen werden') : attention.length ? '<ul class="ui-action-list">' + attention.map(site => `<li><div><a class="ui-identity" href="${siteUrl(site)}">${esc(site.name)}</a><p>${esc(site.domain)} · ${esc(site.status.label)}</p></div><a class="ui-row-action" href="${siteUrl(site)}">Prüfen <span aria-hidden="true">→</span></a></li>`).join('') + '</ul>' : emptyState('Keine aktuellen Fehlermeldungen', portfolio.counts.paused ? `${portfolio.counts.paused} Websites werden nicht überwacht. Aktiviere bei Bedarf das Monitoring.` : 'Die vorhandenen aktuellen Prüfungen sind unauffällig.')}<p class="ui-meta">Der Zustand stammt aus gespeicherten Prüfungen. Eine veraltete Prüfung gilt als unbekannt.</p></section><section class="ui-panel"><div class="sectionhead"><h2>Demnächst fällige Aufgaben</h2><a href="/billing">Projekte öffnen</a></div>${
      data.sources.tasks.status !== 'available'
        ? unavailableState('Aufgaben konnten nicht geladen werden')
        : tasks.length
          ? '<ul class="ui-action-list">' +
            tasks
              .slice(0, 6)
              .map(
                task =>
                  `<li><div><a class="ui-identity" href="/billing/projects/${encodeURIComponent(task.project_id)}?task=${encodeURIComponent(task.id)}">${esc(task.name)}</a><p>${esc(task.customer_name)} / ${esc(task.project_name)}</p></div><span class="ui-meta">${esc(day(task.due_date))}</span></li>`
              )
              .join('') +
            '</ul>'
          : emptyState('Keine fälligen Aufgaben', 'Plane die nächsten Schritte direkt im Kundenprojekt.')
    }</section></div>` +
    `<section class="ui-panel"><div class="sectionhead"><h2>Letzte Aktivitäten</h2><a href="/billing/activity">Verlauf öffnen</a></div>${
      data.sources.activity.status !== 'available'
        ? unavailableState('Aktivitäten konnten nicht geladen werden')
        : data.activity?.entries.length
          ? '<ol class="ui-activity">' +
            data.activity.entries
              .slice(0, 6)
              .map(
                entry =>
                  `<li><div><a href="${esc(entry.url)}">${esc(entry.title)}</a><p>${esc(entry.description)}</p></div><time datetime="${esc(entry.occurred_at)}">${esc(time(entry.occurred_at))}</time></li>`
              )
              .join('') +
            '</ol>'
          : emptyState(
              'Noch keine Aktivitäten',
              'Änderungen, Aufgaben und Sicherungen erscheinen hier, sobald sie vorliegen.'
            )
    }</section><script defer src="/assets/product-workspace.js"></script>`
  );
}
