export function cmsDashboardBody(data, esc) {
  const statuses = {
    pending: 'Vorbereitet',
    ready: 'Bereit',
    queued: 'Geplant',
    running: 'Läuft',
    succeeded: 'Abgeschlossen',
    needs_attention: 'Prüfung nötig',
    rolled_back: 'Zurückgerollt',
    cancelled: 'Abgebrochen'
  };
  const releaseOptions = data.releases
    .map(r => `<option value="${esc(r.version)}">LorzCMS ${esc(r.version)}</option>`)
    .join('');
  const ready = data.installations.filter(x => x.state === 'ready');
  const managedSites = new Set(data.installations.map(x => x.siteId));
  const existing = data.existingSites.filter(x => !managedSites.has(x.id) && x.deploymentMode !== 'hostinger_git');
  const installations = data.installations
    .map(
      x =>
        `<tr><td><strong>${esc(x.name)}</strong><br><a href="${esc(x.baseUrl)}" target="_blank" rel="noopener">${esc(x.baseUrl)}</a></td><td>${esc(x.version || '–')}</td><td><span class="pill ${x.state === 'ready' ? 'ok' : ''}">${esc(statuses[x.state] || x.state)}</span></td><td><a href="/sites/${esc(x.slug)}">Betrieb öffnen</a> <button class="ghost" data-cms-inspect="${esc(x.id)}">Zustand prüfen</button></td></tr>`
    )
    .join('');
  const jobs = data.jobs
    .map(x => {
      const time = new Date(x.runAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
      const controls =
        x.state === 'queued'
          ? `<button class="ghost" data-cms-action="cancel" data-job="${esc(x.id)}">Abbrechen</button>`
          : x.state === 'needs_attention'
            ? `<button class="ghost" data-cms-action="retry" data-job="${esc(x.id)}">Erneut starten</button> <button class="ghost" data-cms-action="cancel" data-job="${esc(x.id)}">Abbrechen</button>`
            : x.state === 'succeeded' && x.previousVersion
              ? `<button class="ghost" data-cms-action="rollback" data-job="${esc(x.id)}">Core zurückrollen</button>`
              : '';
      return `<tr><td>${esc(x.name)}<br><small>${esc({ install: 'Installation', adopt: 'Anschluss', update: 'Update', rollback: 'Rollback' }[x.kind] || x.kind)}</small></td><td>${esc(x.version || 'Bisheriger Core')}<br><small>${esc(time)}</small></td><td><span class="pill">${esc(statuses[x.state] || x.state)}</span><br><small>${esc({ queued: 'Wartet', connection: 'Verbindung', preparing: 'Vorbereitung', preflight: 'Voraussetzungen', activating: 'Aktivierung', checking: 'Website-Prüfung', rolling_back: 'Rückfall', done: 'Fertig' }[x.phase] || x.phase)}</small>${x.error ? `<p role="alert">${esc(x.error)}</p>` : ''}</td><td>${controls}</td></tr>`;
    })
    .join('');
  return `<header><div><span class="eyebrow">CMS-Zentrale</span><h1>LorzCMS</h1><p>Websites installieren, Versionen gezielt verteilen und den Core zurückrollen.</p></div><a class="button ghost" href="/lorzcms">Aktualisieren</a></header>
  <div id="cmsNotice" class="notice" role="status" hidden></div>
  <section><div class="sectionhead"><h2>Installationen</h2><small>${data.installations.length} Websites</small></div><div class="tablewrap"><table><thead><tr><th>Website</th><th>Core-Version</th><th>Zustand</th><th></th></tr></thead><tbody>${installations || '<tr><td colspan="4">Noch keine LorzCMS-Installation angeschlossen.</td></tr>'}</tbody></table></div></section>
  <section><div class="sectionhead"><h2>Versionen</h2><button id="cmsBundled" class="ghost">Mitgelieferten Core freigeben</button></div><p>Freigegebene Versionen bleiben unverändert. Eine Freigabe installiert noch kein Update.</p>${data.releases.map(r => `<details><summary><strong>LorzCMS ${esc(r.version)}</strong></summary><p>${esc(r.notes)}</p><small>Prüfsumme: ${esc(r.digest)}</small></details>`).join('') || '<p>Gib zuerst die mitgelieferte Basisversion frei.</p>'}<label>Neue Version importieren<input id="cmsReleaseFile" type="file" accept=".json,application/json"></label></section>
  <section><h2>Update planen</h2><form id="cmsSchedule" class="inner-form"><fieldset><legend>Websites auswählen</legend>${ready.map(x => `<label class="check"><input type="checkbox" name="installation" value="${esc(x.id)}">${esc(x.name)} · ${esc(x.version)}</label>`).join('') || '<p>Es ist noch keine Website für Updates bereit.</p>'}</fieldset><label>Version<select name="version" required>${releaseOptions}</select></label><label>Zeitpunkt <small>Leer lassen für sofort. <span data-cms-timezone></span></small><input name="runAt" type="datetime-local"></label><p>Ein fehlgeschlagenes Update fällt automatisch auf den vorherigen Core zurück. Inhalte und Medien bleiben erhalten.</p><button ${!ready.length || !data.releases.length ? 'disabled' : ''}>Update einplanen</button></form></section>
  <section><h2>Neue CMS-Website</h2><p>SiteOps lädt das Basis-CMS in ein leeres Hosting-Verzeichnis und richtet die Startseite und dein Administratorkonto ein.</p><form id="cmsCreate" class="inner-form">
  <label>Website-Name<input name="name" required maxlength="190"></label><label>Kurzname <small>Kleinbuchstaben, Ziffern und Bindestriche</small><input name="slug" required pattern="[a-z0-9-]+"></label><label>Website-Adresse<input name="baseUrl" type="url" placeholder="https://www.beispiel.de" required></label><label>Core-Version<select name="version" required>${releaseOptions}</select></label>
  <fieldset><legend>Hosting-Zugang</legend><label>Verbindung<select name="protocol"><option value="sftp">SFTP</option><option value="ftps">FTPS</option><option value="ftp">FTP</option></select></label><label>Server<input name="host" required autocomplete="off"></label><label>Port<input name="port" type="number" value="22" min="1" max="65535" required></label><label>Benutzername<input name="username" required autocomplete="off"></label><label>Passwort<input name="password" type="password" autocomplete="new-password" required></label><label>Leeres CMS-Verzeichnis<input name="remoteRoot" required placeholder="/websites/meine-website"></label></fieldset>
  <fieldset><legend>Datenbank</legend><label>Typ<select name="databaseEngine"><option value="sqlite">SQLite · wird automatisch angelegt</option><option value="mysql">MariaDB / MySQL · vorhandene leere Datenbank</option></select></label><div id="cmsMysql" hidden><label>Datenbank-Server<input name="databaseHost" value="localhost"></label><label>Datenbank-Name<input name="databaseName"></label><label>Datenbank-Benutzer<input name="databaseUser" autocomplete="off"></label><label>Datenbank-Passwort<input name="databasePassword" type="password" autocomplete="new-password"></label></div></fieldset>
  <fieldset><legend>Erstes Administratorkonto</legend><label>Name<input name="adminName" required></label><label>E-Mail<input name="adminEmail" type="email" required autocomplete="off"></label><label>Passwort<input name="adminPassword" type="password" minlength="12" required autocomplete="new-password"></label></fieldset>
  <label class="check"><input name="publicRootReady" type="checkbox" required>Ich habe beim Hoster das Domain-Ziel auf den public-Unterordner dieses CMS-Verzeichnisses eingestellt und HTTPS aktiviert.</label><label>Zeitpunkt <small>Leer lassen für sofort. <span data-cms-timezone></span></small><input name="runAt" type="datetime-local"></label><button ${!data.releases.length ? 'disabled' : ''}>Website anlegen und CMS installieren</button></form></section>
  <section><h2>Bestehendes LorzCMS anschließen</h2><p>Hosting-Daten hinterlegst du zunächst über „Website hinzufügen“. Der vorhandene Core wird als Rückfallstand gesichert. Projekt, Inhalte und Medien bleiben erhalten.</p><form id="cmsAttach" class="inner-form"><label>Website<select name="site" required>${existing.map(x => `<option value="${esc(x.id)}">${esc(x.name)} · ${esc(x.domain)}</option>`).join('')}</select></label><label>Website-Adresse<input name="baseUrl" type="url" required placeholder="https://www.beispiel.de"></label><label class="check"><input name="publicRootReady" type="checkbox" required>Der Hosting-Zugang zeigt auf das CMS-Hauptverzeichnis; die Domain zeigt auf dessen public-Unterordner.</label><button ${!existing.length ? 'disabled' : ''}>CMS anschließen</button></form></section>
  <section><div class="sectionhead"><h2>Aufträge und Rollbacks</h2><small>Zeiten in Europe/Berlin</small></div><div class="tablewrap"><table><thead><tr><th>Website</th><th>Version / Zeitpunkt</th><th>Fortschritt</th><th>Aktion</th></tr></thead><tbody>${jobs || '<tr><td colspan="4">Noch keine Aufträge.</td></tr>'}</tbody></table></div><p>Ein Core-Rollback wechselt die Programmversion. Eine Datenwiederherstellung ist ein separater Vorgang; sie wird hier nicht automatisch ausgeführt.</p></section>
  <script src="/assets/lorzcms.js" defer></script>`;
}
