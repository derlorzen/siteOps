export function renderCoolifyDeployer(connections, projects, esc) {
  const opts = list => list.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
  return `<section id="applicationDeployer"><div class="sectionhead"><div><span class="eyebrow">Integrationen → Coolify</span><h1>Anwendungen installieren</h1></div><a class="btn" href="#installationList">Installierte Anwendungen</a></div>
  <p>Quelle prüfen, verbindlichen Plan ansehen und anschließend freigeben. Fortschritt und Fehler bleiben gespeichert.</p>
  <form id="installationForm" class="deployer-grid" style="max-width:none;width:100%">
    <label>Verbindung<select name="connectionId" required><option value="">Bitte wählen</option>${opts(connections)}</select></label>
    <label>Anwendungsname<input name="name" required maxlength="190"></label>
    <label>Quelle<select name="sourceKind"><option value="git">Website / Git-Repository</option><option value="image">Docker-Image</option><option value="dockerfile">Dockerfile ohne Git (experimentell)</option><option value="compose">Eigene Compose-Konfiguration</option></select></label>
    <label data-source-kind="git">Website / Repository-URL<input name="url" type="url" placeholder="https://github.com/owner/repo"></label>
    <details class="deployer-wide" data-source-kind="git"><summary>Git-Integration, Branch und Revision</summary><div class="deployer-grid">
    <label>Git-Quelle<select name="sourceType"><option value="public">Öffentlich</option><option value="private-github-app">Private GitHub-App</option><option value="private-deploy-key">Privater Deploy-Key</option></select></label>
    <label>Bestehende Git-Integration<select name="sourceUuid"><option value="">Keine</option></select></label>
    <label>Branch<input name="gitBranch" placeholder="Automatisch aus Repository"></label>
    <label>Geprüfter Commit (private/andere Quellen)<input name="gitCommit" pattern="[a-f0-9]{40}"></label>
    </div></details>
    <label data-source-kind="image" hidden>Docker-Image<input name="image" placeholder="registry.example.org/app"></label>
    <label data-source-kind="image" hidden>Image-Tag<input name="imageTag" value="latest"></label>
    <label>Zielserver<select name="serverUuid"><option value="">Standard / automatisch</option></select></label>
    <label>Coolify-Projekt<select name="coolifyProjectUuid"><option value="">Projektname suchen / erstellen</option></select></label>
    <label>Coolify-Projektname (optional)<input name="coolifyProjectName" placeholder="Wie SiteOps-Projekt"></label>
    <label>Umgebung<input name="environmentName" value="production" list="deployerEnvironments" required><datalist id="deployerEnvironments"></datalist></label>
    <label>SiteOps-Projekt<select name="siteopsProjectId"><option value="">Projektname suchen / erstellen</option>${opts(projects)}</select></label>
    <label>SiteOps-Projektname<input name="projectName" required placeholder="Tools"></label>
    <label>Zieldomain<input name="domain" required placeholder="app.example.de"></label>
    <label>Build-Methode<select name="buildPack"><option value="auto">Automatisch erkennen</option>${['dockerfile', 'dockercompose', 'nixpacks', 'railpack', 'static'].map(x => `<option>${x}</option>`).join('')}</select></label>
    <label>Interner Port<input name="containerPort" type="number" min="1" max="65535" placeholder="Aus Analyse übernehmen"></label>
    <label>Öffentlicher Compose-Dienst<input name="composeService" placeholder="app"></label>
    <details class="deployer-wide"><summary>Build-Pfade und Ausgabeverzeichnis</summary><div class="deployer-grid">
    <label>Repository-Unterverzeichnis<input name="baseDirectory" value="/"></label>
    <label>Static-Ausgabeverzeichnis<input name="publishDirectory" placeholder="dist"></label>
    <label>Dockerfile-Pfad im Repository<input name="dockerfileLocation" placeholder="/Dockerfile"></label>
    <label>Compose-Pfad im Repository<input name="dockerComposeLocation" placeholder="/compose.yml"></label>
    </div></details>
    <label class="deployer-wide" data-source-kind="dockerfile compose" hidden>Dockerfile / Compose-Inhalt<textarea name="definition" rows="7" spellcheck="false"></textarea></label>
    <details class="deployer-wide"><summary>Umgebungsvariablen und persistente Volumes</summary><div class="deployer-grid">
    <label class="deployer-wide">Umgebungsvariablen (NAME=WERT, nur Laufzeit)<textarea name="environmentText" rows="4" autocomplete="off" spellcheck="false"></textarea></label>
    <label class="deployer-wide">Persistente Volumes (Name=/Container/Pfad)<textarea name="volumesText" rows="3" placeholder="media=/app/media"></textarea></label>
    </div></details>
    <label>Zugriffsschutz<select name="access"><option value="basic">Coolify HTTP Basic Auth</option><option value="application">Geprüfte Anmeldung in Anwendung / Compose</option><option value="public-static">Öffentliche statische Dateien ohne Backend</option></select></label>
    <label>Nachweis der Anwendungsanmeldung<input name="applicationAuthEvidence" placeholder="Dokumentation / geprüfte API-Schutzmaßnahmen"></label>
    <label>Basic-Benutzer<input name="authUsername" autocomplete="off"></label>
    <label>Basic-Passwort (mind. 16 Zeichen)<input name="authPassword" type="password" autocomplete="new-password" minlength="16"></label>
    <details class="deployer-wide"><summary>Ressourcen und Health-Check</summary><div class="deployer-grid">
    <label>RAM-Limit je Dienst (MiB)<input name="memoryMb" type="number" min="128" value="1024"></label>
    <label>CPU-Limit<input name="cpus" type="number" min="0.1" step="0.1" value="1"></label>
    <label>Geschätzter Speicherbedarf (MiB)<input name="diskMb" type="number" min="256" value="2048"></label>
    <label>Health-Check-Pfad<input name="healthPath" value="/"></label>
    <label>Health-HTTP-Status<input name="healthStatus" type="number" min="200" max="299" value="200"></label>
    <label>Erwarteter Health-Text (optional)<input name="healthText"></label>
    </div></details>
    <label class="deployer-wide">Quellcode-/Image-Prüfung<textarea name="reviewEvidence" rows="3" placeholder="Geprüfte Lizenz, Installationsanleitung, Runtime, Authentifizierung, Persistenz und Ressourcen"></textarea></label>
    <div class="deployer-wide buttonrow"><button type="button" class="ghost" id="analyzeApplication">Quelle analysieren</button><button type="submit">Deployment planen</button></div>
  </form><p id="deployerNotice" role="status" aria-live="polite"></p><pre id="analysisResult" hidden></pre>
  <div id="deploymentPlan" hidden><h2>Gespeicherter Plan</h2><pre id="deploymentPlanText"></pre><label class="check"><input id="approveDeploymentRisks" type="checkbox"> Ich habe die aufgeführten Risiken geprüft und gebe diese ausdrücklich frei.</label><label>Geprüfte Schutzmaßnahmen<textarea id="deploymentRiskNote" rows="3"></textarea></label><button id="executeDeployment" type="button">Diesen Plan ausführen</button></div>
  <p id="deployerCapabilities"></p></section><section id="installationList"><div class="sectionhead"><h2>Anwendungen & Aufträge</h2><button id="refreshInstallations" type="button" class="ghost">Aktualisieren</button></div><div id="installationCards" class="deployer-cards"></div><pre id="installationLogs" hidden aria-live="polite"></pre></section>
  <style>.deployer-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.deployer-grid label{display:grid;gap:6px;min-width:0}.deployer-grid input,.deployer-grid select,.deployer-grid textarea{width:100%;min-width:0;box-sizing:border-box}.deployer-wide{grid-column:1/-1}.deployer-grid [hidden]{display:none!important}.deployer-grid details{padding:12px;border:1px solid #8885;border-radius:8px}.deployer-grid details summary{cursor:pointer}.deployer-grid details[open] summary{margin-bottom:16px}#applicationDeployer pre,#installationList pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:34rem;overflow:auto;padding:16px;border:1px solid #ffffff25;border-radius:8px}.deployer-cards{display:grid;gap:16px}.deployer-card{padding:16px;border:1px solid #8885;border-radius:10px;min-width:0;overflow-wrap:anywhere}.deployer-card ol{padding-left:24px}.deployer-card .buttonrow{flex-wrap:wrap}.deployer-card progress{width:100%}@media(max-width:700px){.deployer-grid{grid-template-columns:1fr}.deployer-wide{grid-column:auto}#applicationDeployer .buttonrow{display:grid}.deployer-card button,.deployer-card .btn{min-height:44px}}</style>`;
}

export function renderCoolifySite(site, checks, esc) {
  const latest = checks[0];
  return `<header class="pagehead"><div><span class="eyebrow">Coolify-Anwendung</span><h1>${esc(site.name)}</h1><p>${esc(site.domain)} · ${esc(site.deployment_status || 'Unbekannt')}</p></div><a class="btn" href="/coolify#installation-${esc(site.coolify_deployment_id)}">Deployment verwalten</a></header>
  <div class="metrics"><span>${latest?.ok ? 'OK' : latest ? 'ALARM' : '–'}<em>Letzte Prüfung</em></span><span>${latest?.ssl_days ?? '–'} d<em>SSL</em></span><span>${esc(site.coolify_build_method)}<em>Build-Methode</em></span></div>
  <section><h2>Bereitstellung</h2><p>Projekt: ${esc(site.coolify_project_uuid)} · Anwendung: ${esc(site.coolify_application_uuid)} · Server: ${esc(site.coolify_server_uuid)}</p><p>Letzte erfolgreiche Bereitstellung: ${esc(site.last_deployed_at || '–')}</p><p>Persistente Daten werden über Coolify gesichert. Dateiänderungen, FTP-Backups und ALL-INKL-Zertifikate stehen für diesen Deployment-Modus nicht zur Verfügung.</p><a class="btn" href="https://${esc(site.domain)}" target="_blank" rel="noopener">Anwendung öffnen</a> <a class="button ghost" href="/sites/${esc(site.slug)}/delete">Website löschen</a> <button id="coolifyCheckNow">Jetzt prüfen</button><p id="coolifySiteCheck" role="status"></p></section>
  <section><h2>Monitoring-Verlauf</h2><div class="tablewrap"><table><thead><tr><th>Zeit</th><th>Status</th><th>HTTP</th><th>SSL-Tage</th></tr></thead><tbody>${checks
    .slice(0, 50)
    .map(
      c =>
        `<tr><td>${esc(c.created_at)}</td><td>${c.ok ? 'OK' : 'Fehler'}</td><td>${esc(c.http_status)}</td><td>${esc(c.ssl_days)}</td></tr>`
    )
    .join('')}</tbody></table></div></section>
  <script>document.getElementById('coolifyCheckNow').onclick=async()=>{const e=document.getElementById('coolifySiteCheck');e.textContent='Prüfe …';try{const r=await fetch('/api/sites/'+${JSON.stringify(site.slug)}+'/check',{method:'POST'});const x=await r.json();e.textContent=x.ok?'Prüfung bestanden':JSON.stringify(x);}catch{e.textContent='Prüfung fehlgeschlagen';}};</script>`;
}
