// The primary monitoring action is available without searching through settings.
export function renderMonitorControl(site, esc) {
  const active = Boolean(site.enabled && site.monitor_enabled);
  return `<div class="site-monitor-control" data-monitor-control data-slug="${esc(site.slug)}"
    data-monitor-active="${active ? 'true' : 'false'}" data-site-enabled="${site.enabled ? 'true' : 'false'}">
    <div><strong>Automatische Überwachung: ${active ? 'aktiv' : 'aus'}</strong>
    <p>${active ? 'SiteOps prüft diese Website regelmäßig und meldet Störungen.' : 'Keine automatischen Website-Prüfungen oder neuen Monitoring-Alarme. Manuelle Tests bleiben möglich.'}</p>
    ${!site.enabled ? '<p>Beim Aktivieren wird auch die Website-Verwaltung wieder aktiviert. Gespeicherte Sicherungsregeln bleiben unverändert.</p>' : ''}
    <p data-monitor-feedback role="status" hidden></p></div>
    <button type="button" class="ghost" data-monitor-toggle>${active ? 'Überwachung pausieren' : site.enabled ? 'Überwachung aktivieren' : 'Website aktivieren und überwachen'}</button>
    </div>`;
}
