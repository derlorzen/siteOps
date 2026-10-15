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
        '<tr><td><strong>' +
        esc(a.name) +
        '</strong></td><td>' +
        esc(a.login) +
        '</td><td>' +
        esc(profiles.find(p => p.id === a.profileId)?.name || 'Profil fehlt') +
        '</td><td><button type="button" class="ghost" data-allinkl-remove="' +
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
    .hosting-table{overflow-x:auto} .hosting-result{white-space:pre-wrap;overflow-wrap:anywhere;padding:14px}
    .hosting-actions{display:flex;gap:12px;flex-wrap:wrap} .hosting-actions button{width:auto}
    .hosting-wide{grid-column:1/-1}
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
      <div class="hosting-table"><table><thead><tr><th>Konto</th><th>KAS-Login</th><th>FTP-Profil</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">Noch keine ALL-INKL-Konten.</td></tr>'}</tbody></table></div>
      <p class="hosting-note">Das Entfernen eines Kontos löscht keine Subdomain und keine Website. Bereits zugewiesene Serverprofile bleiben erhalten.</p>
    </section>
    <section class="hosting-wide"><h2>DNS-Einstellungen</h2>
      <div class="hosting-layout">
        <form id="allinklDnsLoad" class="hosting-form">
          <label>Hosting-Konto<select name="accountId" required><option value="">Wählen</option>${accountOptions}</select></label>
          <label>Domain-Zone<input name="zone" required placeholder="meine-domain.de"></label>
          <div class="hosting-actions"><button type="submit">DNS laden</button></div>
          <p class="hosting-note">Nur Zonen im ausgewählten ALL-INKL-Konto. MX-, NS- und SOA-Einträge werden angezeigt, aber durch SiteOps nicht verändert.</p>
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
  </div>`;
}
