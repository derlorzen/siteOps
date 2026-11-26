import { renderMonitorControl } from './site-monitor-ui.mjs';
import { monitoringState } from './workspace-overview.mjs';
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

export function renderCoolifySite(site, checks, esc, incidents = []) {
  const latest = checks[0];
  const status = monitoringState({ ...site, last_check_ok: latest?.ok, last_checked_at: latest?.created_at });
  const checkRows = checks
    .slice(0, 50)
    .map(
      c =>
        `<tr><td>${esc(c.created_at)}</td><td>${c.ok ? 'OK' : 'Fehler'}</td><td>${esc(c.http_status ?? '–')}</td><td>${esc(c.ssl_days ?? '–')}</td></tr>`
    )
    .join('');
  const incidentRows = incidents
    .map(
      i =>
        `<tr><td><a href="/incidents/${esc(i.id)}">${esc(i.title)}</a></td><td>${i.status === 'open' ? 'Offen' : 'Beendet'}</td><td>${esc(i.created_at)}</td></tr>`
    )
    .join('');
  return `<header class="pagehead" data-site-kind="coolify"><div><span class="eyebrow">Coolify-Anwendung</span><h1>${esc(site.name)}</h1><p><a href="https://${esc(site.domain)}" target="_blank" rel="noopener noreferrer">${esc(site.domain)} ↗</a> · <span class="ui-status" data-tone="${esc(status.tone)}">${esc(status.label)}</span></p></div><div class="actions"><button type="button" class="ghost" id="coolifyCheckNow">Erreichbarkeit prüfen</button><a class="btn" href="/coolify#installation-${esc(site.coolify_deployment_id)}">Deployment verwalten</a></div></header>
  ${renderMonitorControl(site, esc)}
  <p id="coolifySiteCheck" role="status"></p>
  <div data-site-view="overview">
    <div class="metrics"><span>${esc(status.label)}<em>Überwachung</em></span><span>${latest?.ssl_days ?? '–'} d<em>SSL (letzte Prüfung)</em></span><span>${esc(site.coolify_build_method || '–')}<em>Build-Methode</em></span></div>
    <section><h2>Bereitstellung</h2><dl class="facts compact-facts"><div><dt>Letzter gespeicherter Deployment-Status</dt><dd>${esc(site.deployment_status || 'Unbekannt')}</dd></div><div><dt>Letzte erfolgreiche Bereitstellung</dt><dd>${esc(site.last_deployed_at || '–')}</dd></div></dl><p>Die tatsächliche Erreichbarkeit wird unabhängig vom gespeicherten Deployment-Status geprüft.</p><details><summary>Technische Kennungen</summary><dl class="facts"><div><dt>Coolify-Projekt</dt><dd>${esc(site.coolify_project_uuid || '–')}</dd></div><div><dt>Anwendung</dt><dd>${esc(site.coolify_application_uuid || '–')}</dd></div><div><dt>Server</dt><dd>${esc(site.coolify_server_uuid || '–')}</dd></div></dl></details></section>
  </div>
  <div data-site-view="history" hidden>
    <section><h2>Prüfverlauf</h2><p>Die letzten 50 gespeicherten Prüfungen. Pausieren löscht den Verlauf nicht.</p><div class="tablewrap"><table><thead><tr><th>Zeit</th><th>Status</th><th>HTTP</th><th>SSL-Tage</th></tr></thead><tbody>${checkRows || '<tr><td colspan="4">Noch keine Prüfungen.</td></tr>'}</tbody></table></div></section>
    <section><h2>Störungen</h2><p>Aufgetretene Probleme und ihre Auflösung.</p><div class="tablewrap"><table><thead><tr><th>Störung</th><th>Status</th><th>Beginn</th></tr></thead><tbody>${incidentRows || '<tr><td colspan="3">Keine Störungen.</td></tr>'}</tbody></table></div></section>
  </div>
  <div data-site-view="settings" hidden>
    <section><h2>Prüfregeln & Benachrichtigungen</h2><p>Die Überwachung lässt sich oben direkt ein- und ausschalten. Hier stellst du Intervall, Ziel und Alarmierung ein.</p>
    <form id="coolifyMonitorForm" class="inner-form" data-unsaved-guard>
    <label>Prüf-URL<input name="monitor_url" type="url" required value="${esc(site.monitor_url || 'https://' + site.domain)}"></label>
    <div class="formgrid"><label>Prüfintervall (Sekunden)<input type="number" min="30" max="86400" required name="monitor_interval_seconds" value="${site.monitor_interval_seconds || 60}"></label>
    <label>Erwarteter HTTP-Status<input type="number" min="100" max="599" required name="monitor_expected_status" value="${site.monitor_expected_status || 200}"></label>
    <label>Fehlversuche bis Alarm<input type="number" min="1" max="20" required name="monitor_failure_threshold" value="${site.monitor_failure_threshold || 3}"></label>
    <label>Alarm wiederholen (Minuten)<input type="number" min="1" max="1440" required name="alert_repeat_minutes" value="${site.alert_repeat_minutes || 60}"></label></div>
    <button type="submit">Prüfregeln speichern</button><p id="coolifyMonitorResult" role="status"></p></form></section>
    <section><h2>Hosting & Sicherungen</h2><p>Container, persistente Daten und Deployments werden in Coolify verwaltet. FTP-Sicherungen sind für diesen Website-Typ nicht verfügbar.</p><a class="button ghost" href="/coolify#installation-${esc(site.coolify_deployment_id)}">Coolify öffnen</a></section>
    <section class="site-danger"><h2>Website entfernen</h2><p>Entfernt den SiteOps-Eintrag und die Prüfverläufe. Der Container wird nicht automatisch gelöscht.</p><a class="button ghost" href="/sites/${esc(site.slug)}/delete">Website löschen</a></section>
  </div>
  <script>(()=>{const slug=${JSON.stringify(site.slug)},url='/api/sites/'+encodeURIComponent(slug);
    const show=()=>{const key=['history','settings'].includes(location.hash.slice(1))?location.hash.slice(1):'overview';for(const el of document.querySelectorAll('[data-site-view]'))el.hidden=el.dataset.siteView!==key;};
    window.addEventListener('hashchange',show);show();
    document.getElementById('coolifyCheckNow').onclick=async e=>{const btn=e.currentTarget,msg=document.getElementById('coolifySiteCheck');btn.disabled=true;msg.textContent='Prüfe …';try{const r=await fetch(url+'/status',{method:'POST'}),x=await r.json();if(!r.ok)throw Error(x.message||'Prüfung nicht möglich');msg.textContent=x.ok?'Website erreichbar. Keine Monitoring-Alarme ausgelöst.':'Website nicht erreichbar. Prüfe Deployment und URL.';}catch(error){msg.textContent=error.message;}finally{btn.disabled=false;}};
    const form=document.getElementById('coolifyMonitorForm');form.addEventListener('submit',async e=>{e.preventDefault();const btn=form.querySelector('button'),msg=document.getElementById('coolifyMonitorResult'),fd=new FormData(form),data={monitor_url:fd.get('monitor_url')};for(const key of ['monitor_interval_seconds','monitor_expected_status','monitor_failure_threshold','alert_repeat_minutes'])data[key]=Number(fd.get(key));btn.disabled=true;msg.textContent='Speichere …';try{const r=await fetch(url,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(data)}),x=await r.json();if(!r.ok)throw Error(x.message||'Speichern fehlgeschlagen');msg.textContent='Prüfregeln gespeichert.';document.dispatchEvent(new CustomEvent('siteops:form-saved',{detail:'coolifyMonitorForm'}));}catch(error){msg.textContent=error.message;}finally{btn.disabled=false;}});
  })();</script>`;
}
