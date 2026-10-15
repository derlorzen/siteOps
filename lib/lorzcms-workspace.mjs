/** Dedicated LorzCMS views, never a stacked one-page administration screen. */
const sections = [
  ['sites', 'Websites', 'globe'],
  ['new', 'Neue Website', 'plus'],
  ['connect', 'Bestehende anschließen', 'link'],
  ['updates', 'Updates', 'refresh'],
  ['releases', 'Versionen', 'package'],
  ['jobs', 'Aufträge', 'history']
];
const stateText = {
  pending: 'Anschluss offen',
  ready: 'Betriebsbereit',
  queued: 'Eingeplant',
  running: 'Wird ausgeführt',
  needs_attention: 'Prüfung nötig',
  succeeded: 'Abgeschlossen',
  rolled_back: 'Zurückgerollt',
  cancelled: 'Abgebrochen'
};
const kindText = { install: 'Installation', adopt: 'Anschluss', update: 'Update', rollback: 'Rollback' };
const phaseText = {
  queued: 'Wartet',
  connection: 'Verbindung',
  preparing: 'Vorbereitung',
  preflight: 'Voraussetzungen',
  activating: 'Aktivierung',
  checking: 'Website-Prüfung',
  rolling_back: 'Rückfall',
  done: 'Fertig'
};
function lastJob(data, installationId) {
  return data.jobs.find(job => job.installationId === installationId);
}
function dateTime(value) {
  if (!value) return '–';
  const time = new Date(value);
  return Number.isFinite(time.getTime()) ? time.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }) : '–';
}
export function renderCmsWorkspace(data, esc, view = 'sites', installationId = null) {
  const current = view === 'installation' ? 'sites' : view;
  const projects = data.projects || [];
  const projectsOptions = (value = '') =>
    '<option value="">Eigenständige Website ohne Projekt</option>' +
    projects
      .map(
        p =>
          '<option value="' +
          esc(p.id) +
          '"' +
          (value === p.id ? ' selected' : '') +
          '>' +
          esc((p.customer_name || 'Kunde') + ' / ' + p.name) +
          '</option>'
      )
      .join('');
  const releaseOptions = data.releases
    .map(r => '<option value="' + esc(r.version) + '">' + esc(r.version) + '</option>')
    .join('');
  const ready = data.installations.filter(i => i.state === 'ready' && i.version);
  const issues = data.installations.filter(i => i.state !== 'ready').length;
  const active = data.installations.find(i => i.id === installationId);
  const title =
    view === 'installation'
      ? active?.name || 'Installation'
      : {
          sites: 'Websites verwalten',
          new: 'Neue CMS-Website',
          connect: 'Bestehendes CMS anschließen',
          updates: 'Core-Updates',
          releases: 'Core-Versionen',
          jobs: 'Aufträge & Verlauf'
        }[view] || 'LorzCMS';
  const nav =
    '<nav class="cms-workspace-nav" aria-label="LorzCMS Bereiche">' +
    sections
      .map(
        ([key, label]) =>
          '<a href="/lorzcms' +
          (key === 'sites' ? '' : '/' + key) +
          '"' +
          (key === current ? ' aria-current="page"' : '') +
          '>' +
          esc(label) +
          (key === 'jobs' && data.jobs.some(j => j.state === 'needs_attention')
            ? ' <span class="cms-nav-alert" aria-label="Offene Probleme">!</span>'
            : '') +
          '</a>'
      )
      .join('') +
    '</nav>';
  const header =
    '<header class="cms-workspace-header"><div><span class="eyebrow">SITEOPS / LORZCMS</span>' +
    '<h1>' +
    esc(title) +
    '</h1><p>Websites und deren CMS-Core zentral steuern – ohne lange Sammelseiten.</p></div>' +
    '<a href="/billing" class="cms-wk-btn cms-wk-outline">Projekte ↗</a></header>';
  const stateBadge = state =>
    '<span class="cms-status ' +
    (state === 'ready' || state === 'succeeded' ? 'cms-ok' : state === 'needs_attention' ? 'cms-warning' : '') +
    '">' +
    esc(stateText[state] || state || 'Unbekannt') +
    '</span>';
  const jobMeta = job =>
    !job
      ? 'Noch kein Auftrag vorhanden.'
      : '<strong>' +
        esc(kindText[job.kind] || job.kind) +
        '</strong> · ' +
        stateBadge(job.state) +
        ' · ' +
        esc(phaseText[job.phase] || job.phase || '') +
        ' · ' +
        esc(dateTime(job.runAt));
  const problem = job => (job?.error ? '<p class="cms-error" role="status">' + esc(job.error) + '</p>' : '');
  const heading = (label, desc) =>
    '<div class="cms-content-heading"><h2>' + esc(label) + '</h2><p>' + esc(desc) + '</p></div>';
  const installationsSet = new Set(data.installations.map(i => i.siteId));
  const availableSites = data.existingSites.filter(
    s => !installationsSet.has(s.id) && s.deploymentMode !== 'hostinger_git'
  );
  const projectBySite = new Map((data.siteLinks || []).map(link => [link.site_id, link]));
  const renderCard = inst => {
    const job = lastJob(data, inst.id),
      project = projectBySite.get(inst.siteId);
    return (
      '<article class="cms-site-card' +
      (inst.state === 'needs_attention' || (!inst.version && job?.state === 'needs_attention')
        ? ' needs-attention'
        : '') +
      '">' +
      '<div class="cms-site-top"><div class="cms-site-avatar">◈</div><div class="cms-site-heading">' +
      '<h3><a href="/lorzcms/installations/' +
      esc(inst.id) +
      '">' +
      esc(inst.name) +
      '</a></h3>' +
      '<span>' +
      esc(inst.baseUrl) +
      '</span></div>' +
      stateBadge(inst.state) +
      '</div>' +
      '<div class="cms-site-facts"><span>Core: <strong>' +
      esc(inst.version || 'Noch nicht aktiviert') +
      '</strong></span>' +
      '<span>Projekt: <strong>' +
      esc(project?.project_name || 'Eigenständig') +
      '</strong></span></div>' +
      (!inst.version
        ? '<p class="cms-inline-warning">Das CMS ist registriert, aber noch nicht fertig angeschlossen.' +
          (job?.error ? ' Letzter Fehler: ' + esc(job.error) : '') +
          '</p>'
        : '') +
      '<div class="cms-site-actions"><a class="cms-wk-btn cms-wk-outline" href="/lorzcms/installations/' +
      esc(inst.id) +
      '">' +
      (!inst.version ? 'Anschluss reparieren' : 'Verwalten') +
      '</a>' +
      '<a class="cms-wk-btn cms-wk-outline" target="_blank" rel="noopener" href="' +
      esc(inst.baseUrl) +
      '">Website ↗</a>' +
      (inst.version ? '<a class="cms-wk-btn cms-wk-outline" href="/sites/' + esc(inst.slug) + '/seo">SEO-Audit →</a>' : '') +
      '</div></article>'
    );
  };
  const sitesView =
    heading('Alle LorzCMS-Websites', 'Wähle eine Installation zum Prüfen, Reparieren oder Zuordnen.') +
    '<div class="cms-summary-grid"><div><strong>' +
    data.installations.length +
    '</strong><small>Installationen</small></div>' +
    '<div><strong>' +
    ready.length +
    '</strong><small>Betriebsbereit</small></div>' +
    '<div><strong>' +
    issues +
    '</strong><small>Noch nicht bereit</small></div></div>' +
    (issues
      ? '<div class="cms-info-strip" role="status">Bei unvollständigen Anschlüssen über „Anschluss reparieren“ fortsetzen. „Zustand prüfen“ ist keine Installation.</div>'
      : '') +
    '<div class="cms-site-grid">' +
    (data.installations.map(renderCard).join('') ||
      '<div class="cms-empty">Noch keine LorzCMS-Installation. <a href="/lorzcms/connect">Bestehende Website anschließen</a> oder <a href="/lorzcms/new">neue Website erstellen</a>.</div>') +
    '</div>';
  const detailView = active
    ? (() => {
        const job = lastJob(data, active.id),
          site = data.existingSites.find(s => s.id === active.siteId);
        const linked = projectBySite.get(active.siteId);
        const canResume =
          !active.version &&
          (!job ||
            (job.kind === 'adopt' && !['queued', 'running'].includes(job.state)) ||
            job.state === 'needs_attention');
        const needsSetup =
          !active.version && job?.kind === 'install' && ['cancelled', 'succeeded', 'rolled_back'].includes(job.state);
        return (
          '<div class="cms-detail-back"><a href="/lorzcms">← Zurück zu Websites</a></div>' +
          '<div class="cms-detail-hero">' +
          stateBadge(active.state) +
          '<h2>' +
          esc(active.name) +
          '</h2>' +
          '<a href="' +
          esc(active.baseUrl) +
          '" rel="noopener" target="_blank">' +
          esc(active.baseUrl) +
          ' ↗</a>' +
          '<div class="cms-detail-kpis"><span>Core-Version: <strong>' +
          esc(active.version || 'Nicht aktiviert') +
          '</strong></span>' +
          '<span>Letzte Prüfung: <strong>' +
          esc(dateTime(active.lastCheckedAt)) +
          '</strong></span></div></div>' +
          '<div class="cms-detail-grid"><section class="cms-workspace-panel">' +
          heading(
            'Anschluss & Zustand',
            'Den tatsächlichen CMS-Status prüfen oder einen unterbrochenen Anschluss fortsetzen.'
          ) +
          '<div class="cms-job-summary">' +
          jobMeta(job) +
          '</div>' +
          problem(job) +
          (!active.version
            ? '<div class="cms-info-strip">Die Website ist vorhanden. Es muss nur der CMS-Anschluss abgeschlossen werden – keine Neuinstallation.</div>'
            : '') +
          '<div class="cms-actions"><button class="cms-wk-btn cms-wk-outline" type="button" data-cms-inspect="' +
          esc(active.id) +
          '">Zustand prüfen</button>' +
          (canResume
            ? '<button class="cms-wk-btn cms-wk-primary" type="button" data-cms-resume="' +
              esc(active.id) +
              '">Anschluss fortsetzen</button>'
            : '') +
          (needsSetup
            ? '<a class="cms-wk-btn cms-wk-primary" href="/lorzcms/new?resume=' +
              esc(active.id) +
              '">Einrichtung mit bisherigen Daten fortsetzen</a>'
            : '') +
          '</div><p class="cms-help">Ist ein Auftrag bereits eingeplant oder läuft, wird kein zweiter Auftrag gestartet.</p></section>' +
          '<section class="cms-workspace-panel">' +
          heading('Projektzuordnung', 'Diese Website einem Kundenprojekt zuordnen oder eigenständig lassen.') +
          '<form id="cmsProjectAssignment" data-site-id="' +
          esc(active.siteId) +
          '">' +
          '<label>Kundenprojekt<select name="projectId">' +
          projectsOptions(linked?.project_id || '') +
          '</select></label>' +
          '<button class="cms-wk-btn cms-wk-primary" type="submit">Zuordnung speichern</button></form>' +
          '<div class="cms-actions"><a class="cms-wk-btn cms-wk-outline" href="/sites/' +
          esc(active.slug) +
          '">Website & Verbindung bearbeiten ↗</a>' +
          '<a class="cms-wk-btn cms-wk-outline" href="' +
          esc(active.baseUrl) +
          '/admin/" target="_blank" rel="noopener">CMS-Redaktion ↗</a>' +
          '<a class="cms-wk-btn cms-wk-outline" href="/sites/' +
          esc(active.slug) +
          '/seo">SEO-Audit & Empfehlungen →</a></div>' +
          (site
            ? '<p class="cms-help">Hosting: ' +
              esc(site.protocol || '') +
              ' · ' +
              esc(site.host || '') +
              ' · ' +
              esc(site.remoteRoot || '') +
              '</p>'
            : '') +
          '</section></div>' +
          '<section class="cms-workspace-panel">' +
          heading('Letzte Aufträge', 'Ereignisse und Meldungen zu dieser Installation.') +
          renderJobRows(data.jobs.filter(j => j.installationId === active.id).slice(0, 8), esc, stateBadge, problem) +
          '</section>'
        );
      })()
    : '<div class="cms-empty">Installation nicht gefunden. <a href="/lorzcms">Zurück zur Übersicht</a></div>';

  const newView =
    heading(
      'Neue Website anlegen',
      'Im leeren Hosting-Verzeichnis installieren und optional sofort einem Projekt zuordnen.'
    ) +
    '<form id="cmsCreate" class="cms-workspace-form">' +
    '<section class="cms-workspace-panel"><h3>1. Website & Projekt</h3><div class="cms-form-grid">' +
    '<label>Website-Name<input name="name" required maxlength="190"></label>' +
    '<label>Kurzname<input name="slug" required pattern="[a-z0-9-]+" placeholder="meine-seite"></label>' +
    '<label>Website-Adresse<input name="baseUrl" type="url" placeholder="https://www.beispiel.de" required></label>' +
    '<label>Core-Version<select name="version" required>' +
    releaseOptions +
    '</select></label>' +
    '<label class="cms-span-full">Kundenprojekt<select name="projectId">' +
    projectsOptions() +
    '</select></label>' +
    '</div></section><section class="cms-workspace-panel"><h3>2. Hosting-Verbindung</h3>' +
    '<div class="cms-form-grid"><label class="cms-span-full">Gespeicherter Zugang<select name="savedConnection"><option value="">Manuell eingeben</option></select></label>' +
    '<p class="cms-help cms-span-full" id="cmsSavedConnectionHint">Wähle ein Serverprofil oder übernimm die Verbindung einer vorhandenen Website.</p>' +
    '<label>Protokoll<select name="protocol"><option value="sftp">SFTP</option><option value="ftps">FTPS</option><option value="ftp">FTP</option></select></label>' +
    '<label>Server<input name="host" autocomplete="off" required></label>' +
    '<label>Port<input name="port" type="number" min="1" max="65535" value="22" required></label>' +
    '<label>Benutzername<input name="username" autocomplete="off" required></label>' +
    '<label>Passwort<input name="password" type="password" autocomplete="new-password"></label>' +
    '<label>Zielverzeichnis (leer)<input name="remoteRoot" placeholder="/www/meine-website" required></label>' +
    '</div></section><section class="cms-workspace-panel"><h3>3. Datenbank & Administration</h3><div class="cms-form-grid">' +
    '<label>Datenbank<select name="databaseEngine"><option value="sqlite">SQLite (automatisch)</option><option value="mysql">MySQL / MariaDB</option></select></label>' +
    '<div id="cmsMysql" class="cms-span-full" hidden><div class="cms-form-grid">' +
    '<label>DB-Server<input name="databaseHost" value="localhost"></label><label>DB-Name<input name="databaseName"></label>' +
    '<label>DB-Benutzer<input name="databaseUser"></label><label>DB-Passwort<input type="password" name="databasePassword"></label></div></div>' +
    '<label>Admin-Name<input name="adminName" required></label>' +
    '<label>Admin-E-Mail<input name="adminEmail" type="email" required></label>' +
    '<label>Admin-Passwort<input name="adminPassword" type="password" minlength="12" required></label>' +
    '<label>Zeitpunkt (optional)<input name="runAt" type="datetime-local"><small data-cms-timezone></small></label>' +
    '</div></section><section class="cms-workspace-panel">' +
    '<label class="cms-check"><input type="checkbox" name="publicRootReady" required>HTTPS ist aktiv und die Domain zeigt auf den public/-Unterordner des Zielverzeichnisses.</label>' +
    '<div class="cms-actions"><button class="cms-wk-btn cms-wk-primary" type="submit"' +
    (releaseOptions ? '' : ' disabled') +
    '>CMS installieren</button></div></section></form>';

  const attachView =
    heading(
      'Bestehende CMS-Website anschließen',
      'Vorhandenes CMS übernehmen. Inhalte und projektindividuelle Dateien bleiben erhalten.'
    ) +
    '<section class="cms-workspace-panel"><form id="cmsAttach" class="cms-workspace-form">' +
    '<div class="cms-form-grid"><label>Vorhandene Website<select name="site" required>' +
    availableSites
      .map(
        s =>
          '<option value="' +
          esc(s.id) +
          '" data-url="https://' +
          esc(s.domain) +
          '">' +
          esc(s.name) +
          ' · ' +
          esc(s.domain) +
          '</option>'
      )
      .join('') +
    '</select></label><label>Website-Adresse<input name="baseUrl" type="url" required placeholder="https://www.beispiel.de"></label>' +
    '<label class="cms-span-full">Kundenprojekt<select name="projectId">' +
    projectsOptions() +
    '</select></label>' +
    '</div><label class="cms-check"><input type="checkbox" name="publicRootReady" required>Domain zeigt auf den public/-Unterordner, Hosting-Zugang auf den CMS-Projektordner.</label>' +
    '<div class="cms-actions"><button class="cms-wk-btn cms-wk-primary" type="submit"' +
    (availableSites.length ? '' : ' disabled') +
    '>Bestehendes CMS anschließen</button></div>' +
    '</form>' +
    (!availableSites.length
      ? '<p class="cms-help">Keine weiteren geeigneten Websites. Unvollständige Anschlüsse reparierst du unter „Websites“.</p>'
      : '') +
    '</section>';

  const updateView =
    heading(
      'Versionen gezielt ausrollen',
      'Nur betriebsbereite CMS-Websites können einen Core-Updateauftrag erhalten.'
    ) +
    '<section class="cms-workspace-panel"><form id="cmsSchedule" class="cms-workspace-form">' +
    '<fieldset><legend>Websites auswählen</legend><div class="cms-check-list">' +
    (ready
      .map(
        i =>
          '<label class="cms-check"><input type="checkbox" name="installation" value="' +
          esc(i.id) +
          '">' +
          esc(i.name) +
          ' · ' +
          esc(i.version) +
          '</label>'
      )
      .join('') || 'Keine betriebsbereiten Websites.') +
    '</div></fieldset>' +
    '<div class="cms-form-grid"><label>Zielversion<select name="version" required>' +
    releaseOptions +
    '</select></label>' +
    '<label>Zeitpunkt<input name="runAt" type="datetime-local"><small data-cms-timezone></small></label></div>' +
    '<div class="cms-actions"><button class="cms-wk-btn cms-wk-primary" type="submit"' +
    (ready.length && data.releases.length ? '' : ' disabled') +
    '>Update planen</button></div></form></section>';

  const releaseView =
    heading(
      'Freigegebene CMS-Versionen',
      'Core-Releases verwalten. Freigeben bedeutet nicht automatisch installieren.'
    ) +
    '<section class="cms-workspace-panel"><div class="cms-actions">' +
    '<button type="button" id="cmsBundled" class="cms-wk-btn cms-wk-primary">Mitgelieferten Core freigeben</button>' +
    '<label>Release-Datei importieren<input id="cmsReleaseFile" type="file" accept=".json,application/json"></label></div>' +
    '<div class="cms-release-list">' +
    (data.releases
      .map(
        r =>
          '<article><strong>LorzCMS ' +
          esc(r.version) +
          '</strong><p>' +
          esc(r.notes) +
          '</p>' +
          '<small>Prüfsumme ' +
          esc(r.digest) +
          '</small></article>'
      )
      .join('') || '<p>Noch kein Core-Release freigegeben.</p>') +
    '</div></section>';

  const jobsView =
    heading(
      'CMS-Aufträge und Reparaturen',
      'Fehlgeschlagene Aufträge prüfen, erneut starten oder die betroffene Website öffnen.'
    ) +
    '<section class="cms-workspace-panel">' +
    renderJobRows(data.jobs, esc, stateBadge, problem) +
    '</section>';
  const content =
    {
      sites: sitesView,
      new: newView,
      connect: attachView,
      updates: updateView,
      releases: releaseView,
      jobs: jobsView,
      installation: detailView
    }[view] || sitesView;
  return (
    '<div class="cms-workspace">' +
    header +
    nav +
    '<div id="cmsNotice" class="cms-message" role="status" hidden></div>' +
    '<main class="cms-workspace-content">' +
    content +
    '</main></div>' +
    '<script src="/assets/lorzcms.js" defer></script>'
  );
}
function renderJobRows(jobs, esc, badge, problem) {
  if (!jobs.length) return '<div class="cms-empty">Noch keine CMS-Aufträge vorhanden.</div>';
  return (
    '<div class="cms-jobs-list">' +
    jobs
      .map(j => {
        const failed = j.state === 'needs_attention';
        let action = '';
        if (j.state === 'needs_attention')
          action =
            '<button type="button" class="cms-wk-btn cms-wk-primary" data-cms-action="retry" data-job="' +
            esc(j.id) +
            '">Erneut starten</button>';
        else if (j.state === 'queued')
          action =
            '<button type="button" class="cms-wk-btn cms-wk-outline" data-cms-action="cancel" data-job="' +
            esc(j.id) +
            '">Abbrechen</button>';
        else if (j.state === 'succeeded' && j.previousVersion)
          action =
            '<button type="button" class="cms-wk-btn cms-wk-outline" data-cms-action="rollback" data-job="' +
            esc(j.id) +
            '">Core zurückrollen</button>';
        return (
          '<article class="cms-job-row' +
          (failed ? ' needs-attention' : '') +
          '"><div><strong>' +
          esc(j.name) +
          '</strong>' +
          '<p>' +
          esc(kindText[j.kind] || j.kind) +
          ' · ' +
          esc(j.version || 'Bisheriger CMS-Core') +
          ' · ' +
          esc(dateTime(j.runAt)) +
          '</p></div><div>' +
          badge(j.state) +
          '<small>Phase: ' +
          esc(phaseText[j.phase] || j.phase || '–') +
          '</small>' +
          problem(j) +
          '</div>' +
          '<div class="cms-actions">' +
          action +
          '<a class="cms-wk-btn cms-wk-outline" href="/lorzcms/installations/' +
          esc(j.installationId) +
          '">Installation →</a></div></article>'
        );
      })
      .join('') +
    '</div>'
  );
}
