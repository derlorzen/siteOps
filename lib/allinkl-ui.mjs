/** ALL-INKL account and DNS workspace. All output is HTML-escaped by the caller. */
export function renderAllInklWorkspace(accounts, profiles, esc) {
  const options = profiles
    .map(
      p =>
        '<option value="' +
        esc(p.id) +
        '">' +
        esc(p.name + ' · ' + p.protocol.toUpperCase() + ' · ' + p.host) +
        '</option>'
    )
    .join('');
  const accountOptions = accounts
    .map(a => '<option value="' + esc(a.id) + '">' + esc(a.name + ' (' + a.login + ')') + '</option>')
    .join('');
  const rows = accounts
    .map(
      a =>
        '<tr><td data-label="Konto"><strong>' +
        esc(a.name) +
        '</strong></td><td data-label="KAS-Login">' +
        esc(a.login) +
        '</td><td data-label="FTP-Profil">' +
        esc(profiles.find(p => p.id === a.profileId)?.name || 'Profil fehlt') +
        '</td><td data-label="Aktionen"><button type="button" class="ghost" data-allinkl-remove="' +
        esc(a.id) +
        '">Entfernen</button></td></tr>'
    )
    .join('');
  return `
  <style>
    .hosting-layout{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(360px,100%),1fr));gap:20px}
    .hosting-layout section{min-width:0} .hosting-form{display:grid;gap:14px}
    .hosting-form label{display:grid;gap:6px} .hosting-form input,.hosting-form select{width:100%;max-width:100%}
    .hosting-note{color:var(--muted,#64748b);font-size:.92rem;line-height:1.5}
    .hosting-table{max-width:100%;overflow-x:auto}
    .hosting-result{white-space:pre-wrap;overflow-wrap:anywhere;padding:14px}
    .hosting-actions{display:flex;gap:12px;flex-wrap:wrap} .hosting-actions button{width:auto}
    .hosting-wide{grid-column:1/-1}
    .hosting-domain-list{display:flex;gap:8px;flex-wrap:wrap}
.hosting-inline{display:flex!important;flex-direction:row;align-items:center;gap:10px}.hosting-inline input{width:auto!important} .hosting-domain-list button{width:auto;font-size:12px;min-height:33px;padding:7px 10px}
    @media (max-width:800px){
      .hosting-layout{grid-template-columns:minmax(0,1fr);gap:14px}
      .hosting-layout section{padding:16px;min-width:0}
      .hosting-wide{grid-column:auto}
      .hosting-form,.hosting-form label{min-width:0}
      .hosting-actions{display:grid;grid-template-columns:minmax(0,1fr);gap:8px}
      .hosting-actions>*{width:100%;min-width:0}
      .hosting-domain-list{display:grid;grid-template-columns:minmax(0,1fr)}
      .hosting-domain-list button{width:100%;min-width:0;text-align:left;overflow-wrap:anywhere}
      .hosting-table{overflow-x:visible;min-width:0}
      .hosting-table table,.hosting-table tbody{display:block;width:100%;min-width:0}
      .hosting-table thead{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
      .hosting-table tbody{display:grid;gap:12px}
      .hosting-table tr{display:grid;min-width:0;padding:12px 14px;border:1px solid #e5e8f0;border-radius:11px;background:#fff}
      .hosting-table td{display:grid;grid-template-columns:minmax(82px,34%) minmax(0,1fr);gap:10px;
        align-items:start;min-width:0;padding:9px 0!important;border:0!important;
        overflow-wrap:anywhere;word-break:break-word;font-size:12px}
      .hosting-table td:not(:last-child){border-bottom:1px solid #edf0f5!important}
      .hosting-table td[data-label]::before{content:attr(data-label);font-size:11px;font-weight:750;color:#788397}
      .hosting-table td[data-label="Aktionen"]{display:flex;flex-wrap:wrap;gap:8px}
      .hosting-table td[data-label="Aktionen"]::before{flex-basis:100%}
      .hosting-table td[data-label="Aktionen"] button{flex:1;min-width:110px;max-width:100%;overflow-wrap:anywhere}
      .hosting-table td.hosting-empty{display:block}
    }
  </style>
  <header><span class="eyebrow">SITEOPS / HOSTING</span><h1>Hosting & DNS</h1>
    <p>ALL-INKL-Konten zentral verwalten und mit gespeicherten FTP-/SFTP-Serverprofilen für LorzCMS verknüpfen.</p>
    <p><a href="/lorzcms/new">→ LorzCMS-Website erstellen</a></p></header>
  <div id="allinklNotice" class="hosting-result" role="status" hidden></div>
  <div class="hosting-layout">
    <section><h2>ALL-INKL-Konto hinzufügen</h2>
      <form id="allinklAddAccount" class="hosting-form">
        <label>Bezeichnung<input name="name" required maxlength="120" placeholder="Mein ALL-INKL-Hosting"></label>
        <label>KAS-Benutzername<input name="login" required placeholder="w0123456"></label>
        <label>KAS-Passwort<input type="password" name="password" autocomplete="new-password" required></label>
        <label>Gespeicherter FTP-/SFTP-Zugang<select name="profileId" required>
          <option value="">Serverprofil wählen</option>${options}</select></label>
        <p class="hosting-note">Die Zugangsdaten bleiben serverseitig verschlüsselt. Beim Speichern wird der KAS-Zugang über die offizielle API geprüft. Der FTP-Zugang muss auf denselben Webspace zugreifen.</p>
        <div class="hosting-actions"><button type="submit">Konto prüfen & speichern</button>
        <a class="ghost btn" href="/setup">Serverzugang einrichten</a></div>
      </form>
    </section>
    <section><h2>Gespeicherte Hosting-Konten</h2>
      <div class="hosting-table"><table><thead><tr><th>Konto</th><th>KAS-Login</th><th>FTP-Profil</th><th>Aktionen</th></tr></thead>
      <tbody>${rows || '<tr><td class="hosting-empty" colspan="4">Noch keine ALL-INKL-Konten.</td></tr>'}</tbody></table></div>
      <p class="hosting-note">Das Entfernen eines Kontos löscht keine Subdomain und keine Website. Bereits zugewiesene Serverprofile bleiben erhalten.</p>
    </section>
    <section class="hosting-wide"><h2>DNS-Einstellungen</h2>
      <div class="hosting-layout">
        <form id="allinklDnsLoad" class="hosting-form">
          <label>Hosting-Konto<select name="accountId" id="allinklAccountSelect" required><option value="">Wählen</option>${accountOptions}</select></label>
          <label>Domain aus dem KAS-Konto<select name="zone" id="allinklDomainSelect" required disabled>
            <option value="">Zuerst Hosting-Konto auswählen</option></select></label>
          <div class="hosting-actions">
            <button type="submit" id="allinklDnsLoadButton" disabled>DNS laden</button>
            <button type="button" class="ghost" id="allinklDomainRefresh" disabled>Domains aktualisieren</button>
            <button type="button" class="ghost" id="allinklConnectionCheck" disabled>Verbindung prüfen (nur lesen)</button>
          </div>
          <p id="allinklDomainStatus" class="hosting-note" role="status">Bitte zunächst das KAS-Konto auswählen. Die Domains werden automatisch geladen.</p>
          <div id="allinklDomainList" class="hosting-domain-list" aria-label="Domains des ausgewählten KAS-Kontos"></div>
          <p class="hosting-note">DNS-Zonen werden direkt über die ALL-INKL-API ermittelt. MX-, NS- und SOA-Einträge werden angezeigt, aber durch SiteOps nicht verändert.</p>
        </form>
        <form id="allinklDnsAdd" class="hosting-form" hidden>
          <h3>Eintrag hinzufügen</h3>
          <label>Typ<select name="type"><option>A</option><option>AAAA</option><option>CNAME</option><option>TXT</option></select></label>
          <label>Name (relativ zur Zone)<input name="name" required placeholder="test"></label>
          <label>Ziel / Wert<input name="value" required></label>
          <label>Priorität<input name="priority" type="number" min="0" max="65535" value="0"></label>
          <button type="submit">DNS-Eintrag erstellen</button>
        </form>
      </div>
      <div id="allinklDnsRecords" class="hosting-table"></div>
    </section>
    <section class="hosting-wide"><h2>SSL / Let's Encrypt</h2>
      <p class="hosting-note">SiteOps nutzt ACME DNS-01 und installiert das Zertifikat mit der KAS-API. Der private Schlüssel bleibt verschlüsselt in SiteOps. HTTPS kann nach der Einrichtung einige Minuten benötigen. Die automatische Verlängerung startet 30 Tage vor Ablauf.</p>
      <div class="hosting-layout">
        <form id="allinklSslEnable" class="hosting-form">
          <label>ALL-INKL-Konto<select name="accountId" required>
            <option value="">Konto wählen</option>${accountOptions}</select></label>
          <label>Vorhandene Subdomain<input name="hostname" required placeholder="container.lorzen.de" autocomplete="off"></label>
          <label>E-Mail für Let's Encrypt<input type="email" name="email" required placeholder="admin@example.de"></label>
          <label class="hosting-inline"><input type="checkbox" name="autoRenew" checked> Automatisch verlängern</label>
          <p class="hosting-note">Mit dem Start beauftragst du die Ausstellung eines echten Zertifikats und akzeptierst die Let's-Encrypt-Bedingungen. Nur bereits im gewählten ALL-INKL-Konto angelegte Subdomains sind zulässig.</p>
          <button type="submit">SSL ausstellen / aktivieren</button>
        </form>
        <div>
          <div class="hosting-actions"><button type="button" class="ghost" id="allinklSslRefresh">SSL-Status aktualisieren</button></div>
          <div class="hosting-table"><table><thead><tr><th>Subdomain</th><th>Status</th><th>Ablauf</th><th>Erneuerung</th></tr></thead>
            <tbody id="allinklSslRows"><tr><td colspan="4" class="hosting-empty">SSL-Status wird geladen …</td></tr></tbody></table></div>
          <p id="allinklSslStatus" class="hosting-note" role="status"></p>
        </div>
      </div>
    </section>
  </div>`;
}
