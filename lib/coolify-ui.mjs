/** Server-rendered Coolify integration workspace. All dynamic text escaped by caller. */
export function renderCoolifyWorkspace(connections, instances, esc, siteopsProjects = []) {
  const projectOptions = siteopsProjects
    .map(p => '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>')
    .join('');
  const accountOptions = connections
    .map(c => '<option value="' + esc(c.id) + '">' + esc(c.name + ' · ' + c.baseUrl) + '</option>')
    .join('');
  const connectionRows = connections
    .map(
      c =>
        '<tr><td data-label="Bezeichnung"><strong>' +
        esc(c.name) +
        '</strong></td><td data-label="API-Adresse">' +
        esc(c.baseUrl) +
        '</td><td data-label="Server-UUID">' +
        esc(c.defaultServerUuid || 'Automatisch') +
        '</td><td data-label="Aktionen"><button type="button" class="ghost" data-coolify-edit="' +
        esc(c.id) +
        '">Bearbeiten</button></td></tr>'
    )
    .join('');
  const rows = instances
    .map(
      item =>
        '<tr><td data-label="Projekt"><strong>' +
        esc(item.name) +
        '</strong><small>' +
        esc(item.projectKey) +
        '</small></td><td data-label="Status">' +
        esc(item.state) +
        (item.lastError ? '<p class="error">' + esc(item.lastError) + '</p>' : '') +
        '</td><td data-label="Service">' +
        (item.serviceUuid ? '<code>' + esc(item.serviceUuid) + '</code>' : '–') +
        '</td><td data-label="Aktion"><button type="button" class="ghost" data-coolify-status="' +
        esc(item.id) +
        '">Prüfen</button>' +
        (item.state === 'needs_attention'
          ? '<button type="button" class="ghost" data-coolify-retry="' + esc(item.id) + '">Erneut versuchen</button>'
          : '') +
        '</td></tr>'
    )
    .join('');
  return `
<style>
.coolify-layout{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(340px,100%),1fr));gap:18px}
.coolify-layout section{min-width:0}
.coolify-form,.coolify-form label{display:grid;gap:8px;min-width:0}
 .coolify-actions{display:flex;flex-wrap:wrap;gap:10px}.coolify-actions button{width:auto}
.coolify-form{gap:14px}.coolify-form input,.coolify-form select{width:100%;max-width:100%}
.coolify-wide{grid-column:1/-1}.coolify-hint{font-size:.91rem;color:var(--muted,#657386);line-height:1.55}
.coolify-table{max-width:100%;overflow-x:auto}.coolify-table td{overflow-wrap:anywhere}
.coolify-table small{display:block;opacity:.7}.coolify-table .error{color:#a11c28;max-width:42ch}
.coolify-form .coolify-toggle{display:flex;align-items:center;gap:9px}.coolify-toggle input{width:auto}
.coolify-form details label{margin:10px 0}.coolify-form details{border:1px solid #e5e8f0;border-radius:10px;padding:12px}
#coolifyNotice{white-space:pre-wrap;overflow-wrap:anywhere}
.coolify-form [hidden]{display:none!important}
@media(max-width:800px){.coolify-layout{grid-template-columns:minmax(0,1fr)}
  .coolify-wide{grid-column:auto}.coolify-table{overflow-x:visible}
  .coolify-table table,.coolify-table tbody{display:block;width:100%}
  .coolify-table thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
  .coolify-table tr{display:grid;border:1px solid #e5e8f0;border-radius:12px;padding:12px;margin-bottom:12px}
  .coolify-table td{display:grid;grid-template-columns:minmax(90px,30%) minmax(0,1fr);gap:8px;padding:8px 0!important}
  .coolify-table td[data-label]::before{content:attr(data-label);color:#687589;font-size:12px}
}
</style>
<header><span class="eyebrow">SITEOPS / INFRASTRUKTUR</span><h1>Coolify: Projekte, Git-Anwendungen & Supabase</h1>
<p>Projekte anlegen, Git-Repositories als Anwendungen bereitstellen und bei Bedarf isolierte Supabase-Instanzen starten.</p>
<p><a href="/mcp-info">→ MCP-Integration</a></p></header>
<div id="coolifyNotice" class="notice" role="status" hidden></div>
<div class="coolify-layout">
<section><h2 id="coolifyConnectHeading">Coolify verbinden</h2>
<form id="coolifyConnect" class="coolify-form">
  <label>Bezeichnung<input name="name" required maxlength="120" placeholder="Coolify Hauptserver"></label>
  <label>Coolify HTTPS-Adresse<input name="baseUrl" type="url" required placeholder="https://coolify.example.de"></label>
  <label>API-Token <small id="coolifyTokenHint">(wird verschlüsselt gespeichert)</small>
    <input name="token" type="password" required autocomplete="new-password" minlength="12"></label>
  <label>Standard-Server-UUID <small>(optional, bei mehreren Servern empfohlen)</small>
    <input name="defaultServerUuid" placeholder="Server-UUID"></label>
  <p class="coolify-hint">API-Zugriff in Coolify aktivieren und einen berechtigten Bearer-Token erstellen.
  SiteOps speichert den Token verschlüsselt. Die API-Verbindung wird danach separat geprüft.</p>
  <div class="coolify-actions"><button type="submit" id="coolifySave">Verbindung speichern</button>
  <button type="button" class="ghost" id="coolifyCancelEdit" hidden>Bearbeiten abbrechen</button></div>
  <p id="coolifySaveStatus" class="coolify-hint" role="status" aria-live="polite"></p>
</form></section>
<section><h2>Gespeicherte Coolify-Verbindungen</h2>
<p class="coolify-hint">Hier siehst du, welche Verbindungen wirklich gespeichert sind. API-Tokens werden niemals wieder angezeigt. Mit „Bearbeiten“ kannst du Name, Adresse und Standardserver ändern; das Token muss nur bei einem Wechsel neu eingegeben werden.</p>
<div class="coolify-table"><table><thead><tr><th>Bezeichnung</th><th>API-Adresse</th><th>Standardserver</th><th>Aktionen</th></tr></thead>
<tbody id="coolifyConnectionsRows">${connectionRows || '<tr><td colspan="4">Noch keine Coolify-Verbindung gespeichert.</td></tr>'}</tbody></table></div>
</section>

<section><h2>Neues Coolify-Projekt</h2>
<form id="coolifyProjectCreate" class="coolify-form">
<label>Coolify-Verbindung<select name="connectionId" id="coolifyProjectConnection" required>
<option value="">Verbindung wählen</option>${accountOptions}</select></label>
<label>Projektname<input name="name" required maxlength="190" placeholder="Meine Webanwendungen"></label>
<label>Eindeutige Kennung<input name="projectKey" required maxlength="50" pattern="[a-z0-9][a-z0-9-]+[a-z0-9]" placeholder="meine-webanwendungen"></label>
<p class="coolify-hint">Erstellt ein normales Coolify-Projekt mit der Standardumgebung production.
Ein erneuter Auftrag mit derselben Kennung erstellt keine weitere Ressource.</p>
<button type="submit">Coolify-Projekt anlegen</button></form></section>
<section><h2>Git-Repository als App</h2>
<form id="coolifyGitAppCreate" class="coolify-form">
<label>Coolify-Verbindung<select name="connectionId" id="coolifyAppConnection" required>
<option value="">Verbindung wählen</option>${accountOptions}</select></label>
<label>Coolify-Projekt<select name="projectUuid" id="coolifyAppProject" required><option value="">Projekt wählen</option></select></label>
<label>Coolify-Server<select name="serverUuid" id="coolifyAppServer"><option value="">Automatisch bei einem Server</option></select></label>
<label>App-Name<input name="name" required maxlength="190" placeholder="Meine Anwendung"></label>
<label>Eindeutige App-Kennung<input name="appKey" required maxlength="50" pattern="[a-z0-9][a-z0-9-]+[a-z0-9]" placeholder="meine-app"></label>
<label>Git-Repository<input name="gitRepository" required placeholder="https://github.com/organisation/repository"></label>
<label>Git-Branch<input name="gitBranch" required value="main" placeholder="main"></label>
<label>Git-Quelle<select name="sourceType" id="coolifyGitSource">
<option value="public">Öffentliches Repository</option>
<option value="private-deploy-key">Privat: vorhandener Deploy Key</option>
<option value="private-github-app">Privat: vorhandene GitHub-App</option></select></label>
<label id="coolifyGitCredentialLabel" hidden>Quellen-UUID in Coolify
<input name="sourceUuid" placeholder="UUID des Deploy Keys oder der GitHub-App" disabled>
<small>Schlüssel und GitHub-App werden direkt in Coolify verwaltet, nicht in SiteOps.</small></label>
<label>Build-Methode<select name="buildPack">
<option value="nixpacks">Nixpacks (automatisch)</option>
<option value="railpack">Railpack</option>
<option value="static">Statische Website</option>
<option value="dockerfile">Dockerfile</option>
<option value="dockercompose">Docker Compose</option></select></label>
<label>App-Port<input name="portsExposes" value="3000" placeholder="3000"></label>
<label>Umgebung<input name="environmentName" value="production" required></label>
<label>HTTPS-Domain (optional)<input name="domain" placeholder="https://app.example.de"></label>
<details><summary>Erweiterte Build-Einstellungen</summary>
<label>Docker-Destination-UUID<input name="destinationUuid" placeholder="optional"></label>
<label>Basisverzeichnis<input name="baseDirectory" placeholder="/"></label>
<label>Veröffentlichungsverzeichnis<input name="publishDirectory" placeholder="dist"></label>
<label>Dockerfile-Pfad<input name="dockerfileLocation" placeholder="/Dockerfile"></label>
<label>Compose-Datei (nur Docker Compose)<input name="dockerComposeLocation" placeholder="/docker-compose.yml"></label>
<label>Domains je Compose-Dienst (eine Zeile: dienst=https://domain:port)<textarea name="dockerComposeDomains" rows="2" placeholder="app=https://app.example.de:8080"></textarea></label>
<label>Umgebungsvariablen (eine Zeile: NAME=Wert)<textarea name="environment" rows="4" autocomplete="off" spellcheck="false" placeholder="APP_ENV=production"></textarea></label>
<p class="coolify-hint">Variablen gehen direkt an Coolify und werden vor dem ersten Deployment gesetzt. SiteOps speichert die Werte nicht.</p>
</details>
<label class="coolify-toggle"><input type="checkbox" name="autoDeploy" checked> Auto-Deploy bei Git-Push aktivieren</label>
<label class="coolify-toggle"><input type="checkbox" name="deployNow"> Nach dem Anlegen sofort deployen</label>
<p class="coolify-hint">Bestehende Apps bleiben unverändert. Domainkonflikte werden nicht überschrieben. Für private Repositories muss die Git-Quelle zuvor in Coolify eingerichtet sein.</p>
<button type="submit">Git-Anwendung anlegen</button>
</form><p id="coolifyGitInfo" class="coolify-hint" role="status"></p></section>
<section class="coolify-wide"><div class="sectionhead"><h2>Bestehende Git-Anwendungen</h2>
<button type="button" class="ghost" id="coolifyAppsRefresh">Anwendungen laden</button></div>
<p class="coolify-hint">Die Liste zeigt auch Anwendungen, die direkt in Coolify angelegt wurden. Ein Deployment wird nur ausdrücklich ausgelöst.</p>
<div class="coolify-table"><table><thead><tr><th>Anwendung</th><th>Git-Quelle</th><th>Status</th><th>Aktionen</th></tr></thead>
<tbody id="coolifyAppsRows"><tr><td colspan="4">Coolify-Verbindung wählen und Anwendungen laden.</td></tr></tbody></table></div></section>

<section><h2>Neue Supabase-Instanz</h2>
<form id="coolifySupabaseCreate" class="coolify-form">
  <label>Coolify-Verbindung<select name="connectionId" id="coolifyConnection" required>
    <option value="">Verbindung wählen</option>${accountOptions}</select></label>
  <label>Projektbezeichnung<input name="name" required maxlength="190" placeholder="Meine Kunden-App"></label>
  <label>Projektkennung<input name="projectKey" required maxlength="100" pattern="[a-z0-9][a-z0-9-]+[a-z0-9]" placeholder="kunden-app"></label>
  <label>SiteOps-Kundenprojekt<select name="siteopsProjectId">
    <option value="">Kein Kundenprojekt verknüpfen</option>${projectOptions}</select></label>
  <label>Coolify-Server<select name="serverUuid" id="coolifyServer">
    <option value="">Automatisch, falls nur ein Server vorhanden</option></select></label>
  <label>Coolify-Projekt<select name="coolifyProjectUuid" id="coolifyProject">
    <option value="">Eigenes Coolify-Projekt automatisch anlegen</option></select></label>
  <label>Docker-Destination-UUID <small>(optional, falls der Server mehrere Ziele hat)</small>
    <input name="destinationUuid" placeholder="Destination-UUID"></label>
  <label>Umgebung<input name="environmentName" maxlength="100" value="production" required></label>
  <p class="coolify-hint">Für jede Projektkennung erstellt SiteOps höchstens einen Supabase-Service
  (PostgreSQL, Auth, REST, Storage und Studio laut Coolify-Vorlage). Coolify verwaltet die
  generierten Anmeldedaten. Start und öffentliche Domains bitte nach der Bereitstellung prüfen.</p>
  <button type="submit">Eigenen Supabase-Stack erstellen</button>
</form>
<p id="coolifyInfo" class="coolify-hint" role="status"></p></section>
<section class="coolify-wide"><div class="sectionhead"><h2>Instanzen und Aufträge</h2>
<button type="button" class="ghost" id="coolifyRefresh">Aktualisieren</button></div>
<div class="coolify-table"><table><thead><tr><th>Projekt</th><th>Status</th><th>Coolify-Service</th><th>Aktionen</th></tr></thead>
<tbody id="coolifyRows">${rows || '<tr><td colspan="4">Noch keine Supabase-Instanzen.</td></tr>'}</tbody></table></div>
<p class="coolify-hint">Status „deployment_requested“ bedeutet: Coolify hat den Startauftrag
entgegengenommen. Das ist noch keine bestätigte Bereitschaft der Supabase-API.
Keine bestehende Instanz wird automatisch gelöscht oder überschrieben.</p></section>
</div>`;
}
