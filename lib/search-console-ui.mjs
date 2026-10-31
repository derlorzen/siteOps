import { escapeHtml as esc } from './product-ui.mjs';
import { analyticsMetrics, analyticsTrend, analyticsEmpty, analyticsDataNote, searchMetrics } from './analytics-ui.mjs';

export function renderSearchConsole(site, assetVersion = 'analytics-20261031') {
  const assets = '?v=' + encodeURIComponent(assetVersion),
    url = '/sites/' + encodeURIComponent(site.slug);
  return `<link rel="stylesheet" href="/assets/analytics.css${assets}"><link rel="stylesheet" href="/assets/search-console.css${assets}">
 <div id="gsc" class="analytics-workspace" data-site="${esc(site.slug)}" data-domain="${esc(site.domain)}">
 <header class="analytics-header"><div class="analytics-identity"><span class="analytics-provider" aria-hidden="true">G</span><div><h1>Search Console</h1><p>${esc(site.name)} <span aria-hidden="true">/</span> ${esc(site.domain)}</p></div></div><div class="analytics-header-actions"><span id="gsc-connection" class="analytics-connection-state">Verbindung wird geprüft</span><a href="${url}/seo">SEO-Analyse öffnen</a></div></header>
 <div class="analytics-nav" role="tablist" aria-label="Search Console Bereiche">${[
   ['performance', 'Suchleistung'],
   ['inspection', 'URL-Prüfung'],
   ['settings', 'Verbindung & Einrichtung']
 ]
   .map(
     ([key, label], i) =>
       `<button type="button" id="gsc-tab-${key}" role="tab" data-gsc-tab="${key}" aria-controls="gsc-panel-${key}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${label}</button>`
   )
   .join('')}</div>
 <p id="gsc-message" class="ui-sr-only" role="status" aria-live="polite">Verbindung wird geladen …</p>
 <section id="gsc-panel-performance" role="tabpanel" aria-labelledby="gsc-tab-performance" data-gsc-panel="performance">
 <div class="analytics-period"><div><strong id="gsc-period-label">Letzte 28 vollständige Tage</strong><span class="analytics-meta" id="gsc-comparison-range">Vergleich mit den 28 Tagen davor</span></div><button type="button" id="gsc-sync">Jetzt synchronisieren</button></div>
 <div id="gsc-data-error" class="analytics-banner" data-tone="error" role="alert" hidden><div><strong>Suchleistung konnte nicht aktualisiert werden.</strong><p id="gsc-data-error-text"></p></div><button type="button" id="gsc-retry">Erneut versuchen</button></div>
 ${analyticsEmpty('gsc', 'Suchleistung ist noch nicht verfügbar', 'Verbinde diese Website mit Google, um Klicks, Suchanfragen und ihre Entwicklung zu sehen.', '<button type="button" class="analytics-primary" data-gsc-go="settings">Verbindung prüfen</button>')}
 <div id="gsc-report"><div class="analytics-measurement">${analyticsMetrics('gsc', searchMetrics)}${analyticsTrend('gsc')}</div><p id="gsc-range" class="analytics-data-note"></p>
 <div class="analytics-details"><div class="analytics-table-toolbar"><div id="gsc-dimension" class="analytics-table-tabs" role="tablist" aria-label="Suchleistung aufschlüsseln">${[
   ['query', 'Suchanfragen'],
   ['page', 'Seiten'],
   ['date', 'Tage']
 ]
   .map(
     ([key, label], i) =>
       `<button type="button" role="tab" data-dimension="${key}" id="gsc-dimension-${key}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" aria-controls="gsc-table-panel">${label}</button>`
   )
   .join(
     ''
   )}</div><label class="analytics-search"><span class="ui-sr-only">Gesamte Auswertung durchsuchen</span><input type="search" id="gsc-search" placeholder="Suchanfragen durchsuchen" maxlength="90"></label></div>
 <div id="gsc-table-panel" role="tabpanel" aria-labelledby="gsc-dimension-query"><p class="analytics-mobile-hint">Weitere Kennzahlen durch seitliches Scrollen anzeigen.</p><div class="analytics-scroll" tabindex="0" role="region" aria-label="Leistungsdaten, seitlich scrollbar"><table class="analytics-table"><caption class="ui-sr-only">Suchleistung der ausgewählten Website</caption><thead><tr>${[
   ['name', 'Suchanfrage'],
   ['clicks', 'Klicks'],
   ['impressions', 'Impressionen'],
   ['ctr', 'CTR'],
   ['position', 'Position']
 ]
   .map(
     ([key, label]) =>
       `<th scope="col"${key === 'clicks' ? ' aria-sort="descending"' : ''}><button type="button" data-sort="${key}"><span${key === 'name' ? ' id="gsc-name-heading"' : ''}>${label}</span></button></th>`
   )
   .join(
     ''
   )}</tr></thead><tbody id="gsc-rows"></tbody></table></div><div class="analytics-pagination"><span id="gsc-row-count" role="status" aria-live="polite"></span><div><label><span class="ui-sr-only">Zeilen pro Seite</span><select id="gsc-limit"><option value="10">10 pro Seite</option><option value="25">25 pro Seite</option><option value="50">50 pro Seite</option></select></label><button id="gsc-previous" type="button" disabled>Zurück</button><button id="gsc-next" type="button" disabled>Weiter</button></div></div></div></div>
 <div class="analytics-insights"><div class="analytics-section-head"><h2>Wo sich ein genauer Blick lohnt</h2><span class="analytics-meta">Aus den gemeldeten Suchdaten</span></div><ul id="gsc-opportunities"></ul></div></div>
 </section>
 <section id="gsc-panel-inspection" role="tabpanel" aria-labelledby="gsc-tab-inspection" data-gsc-panel="inspection" hidden><div class="gsc-inspection-header"><h2>Eine Seite bei Google prüfen</h2><p>Sieh nach, welchen Indexierungsstand Google für eine konkrete Adresse meldet.</p></div><form id="gsc-inspect" class="gsc-inspection-form"><label>Website-Adresse<input name="url" type="url" placeholder="https://${esc(site.domain)}/leistungen" required></label><button type="submit" class="analytics-primary">URL prüfen</button></form><div id="gsc-inspection-summary" class="gsc-inspection-result" role="status" aria-live="polite"><p>Noch keine URL geprüft. Die Prüfung verändert deine Website nicht.</p></div><details class="gsc-diagnostics"><summary>Technische Antwort von Google</summary><pre id="gsc-inspection"></pre></details>${analyticsDataNote('Einzelne URL-Prüfung, kein vollständiger Indexabdeckungsbericht. Bis zu 100 Prüfungen je Property und Tag. Eine Sitemap-Einreichung garantiert keine Indexierung.')}</section>
 <section id="gsc-panel-settings" role="tabpanel" aria-labelledby="gsc-tab-settings" data-gsc-panel="settings" hidden><div class="gsc-settings-heading"><h2>Verbindung & Einrichtung</h2><p>Konto, Website-Zuordnung und externe Änderungen getrennt verwalten.</p></div>
 <details id="gsc-progress" class="gsc-journey"><summary id="gsc-progress-title">Einrichtungsstatus wird geprüft …</summary><p id="gsc-progress-help"></p><ol id="gsc-progress-list"></ol></details>
 <details class="gsc-setup-group" id="gsc-account-settings"><summary><span>Google-Konto</span><small id="gsc-account-summary">Verbindung wird geprüft</small></summary><div class="gsc-setup-body"><p>Dein Google-Konto stellt die Leistungsdaten bereit.</p><button type="button" id="gsc-connect" class="analytics-primary">Google-Konto verbinden</button><details id="gsc-technical"><summary>Google-Zugang konfigurieren</summary><p>Search Console API und Site Verification API im Google-Cloud-Projekt aktivieren. Ein vorhandener YouTube-OAuth-Client kann weiterverwendet werden.</p><label>Weiterleitungsadresse<code id="gsc-redirect"></code></label><p id="gsc-oauth-source" role="status"></p><form id="gsc-config"><label>Google Client-ID<input name="client_id" required autocomplete="off"></label><label>Client-Secret<input name="client_secret" type="password" autocomplete="new-password" placeholder="Leer lassen zum Beibehalten"></label><label>Hostinger API-Token (optional)<input name="hostinger_token" type="password" autocomplete="new-password" placeholder="Leer lassen zum Beibehalten"></label><button>Verbindungseinstellungen speichern</button></form><p id="gsc-hostinger"></p></details></div></details>
 <details class="gsc-setup-group" id="gsc-link-settings"><summary><span>Website zuordnen</span><small id="gsc-link-summary">Noch nicht verknüpft</small></summary><div class="gsc-setup-body"><form id="gsc-link"><label>Google-Konto<select name="account_id" id="gsc-account" required></select></label><label>Welche Website möchtest du verbinden?<select id="gsc-choice"><option value="existing">Vorhandene Google-Website auswählen</option><option value="domain">Diese Domain neu anmelden</option><option value="prefix">Diese HTTPS-Adresse neu anmelden</option><option value="custom">Andere Property-Adresse eingeben</option></select></label><div id="gsc-existing-area"><label>Vorhandene Google-Website<select id="gsc-existing"><option value="">Websites werden geladen …</option></select></label><button type="button" id="gsc-properties">Google-Websites aktualisieren</button></div><div id="gsc-proposed" class="gsc-hint" hidden></div><label id="gsc-manual-area" hidden>Google-Property-Adresse<input name="property" required placeholder="sc-domain:example.com oder https://example.com/"></label><p class="gsc-hint">Die Zuordnung bleibt zunächst in SiteOps. Google- und DNS-Änderungen benötigen eine eigene Freigabe.</p><button class="analytics-primary">Website zuordnen</button></form><div class="gsc-secondary-actions"><button id="gsc-unlink" type="button">Website-Zuordnung entfernen</button><button type="button" id="gsc-disconnect">Google-Verbindung entfernen</button></div></div></details>
 <details class="gsc-setup-group" id="gsc-verification-settings"><summary><span>Freigaben & Sitemap</span><small id="gsc-verification-summary">Status wird geladen</small></summary><div class="gsc-setup-body"><dl id="gsc-states" class="gsc-connection-facts"></dl><details class="gsc-provider-settings"><summary>DNS-Anbieter und Sitemap-Adresse</summary><label>ALL-INKL-Konto<select id="gsc-allinkl"><option value="">Automatische Anbietererkennung / Hostinger</option></select></label><label>Kanonische Sitemap-URL<input id="gsc-sitemap" type="url" value="https://${esc(site.domain)}/sitemap.xml"></label></details><p>Jede externe Änderung beginnt mit einer Vorschau. Vorhandene Properties können direkt verknüpft werden.</p><div class="gsc-setup-actions"><button type="button" data-preview="live">1. Öffentliche Website freigeben</button><button type="button" data-preview="dns">2. DNS-Bestätigung vorbereiten</button><button type="button" data-preview="verify">3. Domaininhaberschaft bestätigen</button><button type="button" data-preview="property">4. Website bei Google anmelden</button><button type="button" data-preview="sitemap">5. Sitemap an Google senden</button></div>
 <div id="gsc-preview" hidden><h3>Änderung prüfen und bestätigen</h3><p id="gsc-preview-summary"></p><div id="gsc-action-feedback" class="gsc-feedback" role="status" aria-live="polite" hidden></div><details><summary>Technische Details anzeigen</summary><pre id="gsc-preview-text"></pre></details><label>Bestätigungstext <strong id="gsc-expected-confirmation"></strong><input id="gsc-confirmation" autocomplete="off" aria-describedby="gsc-expected-confirmation"></label><label class="gsc-approval-check"><input type="checkbox" id="gsc-approved"> Ich gebe genau diese Aktion für dieses Projekt frei.</label><div class="gsc-secondary-actions"><button id="gsc-execute" type="button" class="analytics-primary">Freigegebene Aktion ausführen</button><button id="gsc-change-status" type="button">Ergebnis prüfen</button></div></div></div></details></section>
 </div><script defer src="/assets/analytics.js${assets}"></script><script defer src="/assets/search-console.js${assets}"></script>`;
}
