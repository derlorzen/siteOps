import { suiteStart, suiteEnd, suiteOverview, suiteAgent, suiteAssets, suiteSettings } from './video-suite-ui.mjs';

function renderLegacyVideoStudio() {
  return (
    '<header><div><span class="eyebrow">TOOLS · PRODUKTION</span><h1>Video Studio</h1>' +
    '<p>Gesichtslose YouTube-Videos mit KI-Stimme, echten Browser-Aufnahmen und automatischem Schnitt. Rendern auf dem SiteOps Runner.</p></div></header>' +
    '<div class="vs-wrap">' +
    '<section class="vs-panel"><h2>Demo-Domains</h2>' +
    '<p class="vs-note">Freigaben für neue Renderaufträge. Nur HTTPS auf Port 443. *.lorzen.de erlaubt echte Subdomains, aber nicht lorzen.de. Externe Assets benötigen ebenfalls eine Freigabe. Allow-all ist nicht möglich.</p>' +
    '<form id="vs-policy-form"><label for="vs-policy-hosts">Eine Domain oder Wildcard pro Zeile (leer = alle Demos sperren)</label>' +
    '<textarea id="vs-policy-hosts" rows="4" maxlength="25600" spellcheck="false" disabled placeholder="*.lorzen.de&#10;shop.lorzen.link"></textarea>' +
    '<div class="vs-row"><button id="vs-policy-save" type="submit" disabled>Demo-Domains speichern</button>' +
    '<button id="vs-policy-suggest" type="button" class="ghost" disabled>Gewünschte Regeln eintragen</button>' +
    '<button id="vs-policy-reset" type="button" class="ghost" disabled>Runner-Umgebung verwenden</button>' +
    '<button id="vs-policy-reload" type="button" class="ghost">Freigaben neu laden</button></div></form>' +
    '<p id="vs-policy-status" class="vs-note" role="status" aria-live="polite">Lade Freigaben …</p></section>' +
    '<section class="vs-panel"><h2>1. Kanal / Projekt</h2><div class="vs-row">' +
    '<select id="vs-project" aria-label="Projekt wählen"><option value="">Lade Projekte…</option></select>' +
    '<input id="vs-project-name" placeholder="Neues Projekt (z. B. Bagisto Tutorials)" maxlength="120">' +
    '<label>Kanal <input id="vs-channel" value="Bagisto" minlength="2" maxlength="120"></label>' +
    '<label>Sprache <select id="vs-language"><option value="en">Englisch</option><option value="de">Deutsch</option></select></label>' +
    '<label>Sprecher-Anbieter <select id="vs-voice-provider"><option value="kokoro">Kokoro (Englisch, lokal)</option><option value="piper">Piper (Deutsch, lokal)</option><option value="openai">OpenAI API (Deutsch &amp; Englisch)</option></select></label>' +
    '<label>Stimme <select id="vs-voice"><option value="am_adam">Adam – English (Kokoro)</option><option value="am_michael">Michael – English (Kokoro)</option><option value="af_heart">Heart – English (Kokoro)</option><option value="bf_emma">Emma – British (Kokoro)</option><option value="bm_george">George – British (Kokoro)</option></select></label>' +
    '<button id="vs-project-add" type="button">Projekt anlegen</button><button id="vs-project-save" type="button" class="ghost">Projekt ändern</button></div>' +
    '<p class="vs-note">Kokoro (EN) und Piper (DE) sind lokal und ohne Sprach-API-Kosten. Die Modelle werden bei erster Verwendung auf dem Runner geladen. OpenAI ist optional und benötigt einen API-Schlüssel auf dem Runner.</p>' +
    '<p id="vs-capabilities" class="vs-note" role="status">Prüfe Render-Server …</p></section>' +
    '<section class="vs-panel"><h2>Wiederverwendbare Demoszenen</h2><p class="vs-note">Nur Demo-Domains, Testkonten und Testdaten. Aufträge übernehmen eine feste Kopie der Szene.</p><label for="vs-template">Gespeicherte Demoszene</label><select id="vs-template"><option value="">Neue Demoszene</option></select><label for="vs-template-name">Name</label><input id="vs-template-name" maxlength="120"><label for="vs-template-login">Demo-Konto für diese Szene</label><select id="vs-template-login"><option value="">Ohne Anmeldung</option></select><label for="vs-template-json">Szene (JSON mit Sprechertext, Demo-URL und Aktionen)</label><textarea id="vs-template-json" rows="5" spellcheck="false"></textarea><div class="vs-row"><button id="vs-template-save" type="button">Demoszene speichern</button><button id="vs-template-use" type="button" class="ghost">Zum Szenenplan hinzufügen</button></div><p id="vs-template-status" role="status"></p></section>' +
    '<section class="vs-panel"><h2>2. Video planen</h2>' +
    '<form id="vs-form"><label for="vs-title">Titel</label>' +
    '<input id="vs-title" required minlength="3" maxlength="200" placeholder="How to manage Bagisto with ChatGPT & Claude">' +
    '<label for="vs-topic">Thema / Recherchehinweis (optional)</label>' +
    '<input id="vs-topic" maxlength="500" placeholder="Bagisto MCP Connector: admin actions, safe approvals">' +
    '<label for="vs-script">Sprechertext (in der gewählten Projektsprache)</label>' +
    '<textarea id="vs-script" rows="13" placeholder="Each paragraph becomes a video scene. Paste a complete script created with ChatGPT."></textarea>' +
    '<details class="vs-advanced"><summary>Erweiterter Szenenplan (JSON / echte Browser-Demos)</summary>' +
    '<p class="vs-note">Full HD ist fest eingestellt: 1920 × 1080 (16:9), 1080 × 1920 (9:16). Browser-Demos benötigen eine freigegebene Domain und eine Demoszene. Bildideen allein erzeugen keine Bildschirmaufnahme.</p><p class="vs-note">Optional: Liste mit headline, narration, demoUrl und demoSteps. Nur erlaubte HTTPS-Demo-Domains verwenden und test_data_only auf true setzen. Keine echten Kundendaten.</p>' +
    '<label for="vs-scene-json">Strukturierter Szenenplan</label>' +
    '<textarea id="vs-scene-json" rows="9" spellcheck="false" placeholder="[{&quot;headline&quot;:&quot;Create product&quot;,&quot;narration&quot;:&quot;Create a test product.&quot;,&quot;demoUrl&quot;:&quot;https://demo.example.com&quot;,&quot;test_data_only&quot;:true,&quot;demoSteps&quot;:[{&quot;action&quot;:&quot;click&quot;,&quot;selector&quot;:&quot;#products&quot;}]}]"></textarea></details>' +
    '<details><summary>YouTube-Vorbereitung</summary><p class="vs-note">SEO-Titel, Beschreibung, Keywords, Hashtags, Kapitel und Thumbnail-Konzept. Der Creative Agent kann Vorschläge für diese Felder erstellen. Ohne Angaben wird ein bearbeitbarer Vorschlag erstellt.</p><label for="vs-youtube-json">Metadaten (JSON, optional)</label><textarea id="vs-youtube-json" rows="8" spellcheck="false"></textarea></details>' +
    '<div class="vs-row"><label>Videoformat <select id="vs-format"><option value="landscape">16:9 (YouTube)</option><option value="portrait">9:16 (Shorts)</option></select></label>' +
    '<button id="vs-create" type="submit">Entwurf speichern</button></div>' +
    '<p class="vs-note">Jeder durch eine Leerzeile getrennte Absatz wird zur Szene. Maximal 24 Szenen, 1.400 Zeichen pro Szene. Für echte Bildschirmaufnahmen den erweiterten Szenenplan mit erlaubten Demo-URLs und Aktionen verwenden.</p></form></section>' +
    '<section class="vs-panel"><div class="vs-row vs-between"><h2>3. Aufträge und Ergebnisse</h2><button type="button" id="vs-trash-toggle" class="ghost" aria-pressed="false">Papierkorb</button><button type="button" id="vs-refresh" class="ghost">Aktualisieren</button></div>' +
    '<p id="vs-message" class="vs-note" role="status"></p><div id="vs-jobs" class="vs-jobs">Lade Aufträge…</div></section>' +
    '</div><link rel="stylesheet" href="/assets/video-studio.css"><script defer src="/assets/video-studio.js"></script>'
  );
}

export function renderVideoStudio() {
  let body = renderLegacyVideoStudio();
  body = body.slice(body.indexOf('<div class="vs-wrap">'));
  body = body.replace(
    '<section class="vs-panel"><h2>Demo-Domains',
    '<section class="vs-panel" data-suite-pane="settings" hidden><h2>Demo-Domains'
  );
  body = body.replace(
    '<section class="vs-panel"><h2>1. Kanal / Projekt',
    '<section class="vs-panel" data-suite-pane="settings" hidden><h2>Projekt & Stimme'
  );
  body = body.replace(
    '<section class="vs-panel"><h2>Wiederverwendbare',
    '<section class="vs-panel" data-suite-pane="settings" hidden><h2>Wiederverwendbare'
  );
  body = body.replace(
    '<section class="vs-panel"><h2>2. Video planen',
    '<section class="vs-panel" data-suite-pane="script" hidden><span class="suite-label">DIE GESCHICHTE DEINES VIDEOS</span><h1>Skript & Szenen</h1><h2>Video planen'
  );
  body = body.replace(
    '<section class="vs-panel"><div class="vs-row vs-between"><h2>3. Aufträge und Ergebnisse',
    '<section class="vs-panel" data-suite-pane="production" hidden><span class="suite-label">PRODUCTION DESK</span><div class="vs-row vs-between"><h1>Deine Produktionen'
  );
  body = body.replace('Deine Produktionen</h2>', 'Deine Produktionen</h1>');
  const picker =
    '<select id="vs-project" aria-label="Projekt wählen"><option value="">Lade Projekte…</option></select>';
  body = body.replace(picker, '');
  body = body.replace('<p id="vs-message" class="vs-note" role="status"></p>', '');
  body = body.replace(
    '<details class="vs-advanced">',
    '<div class="suite-scene-toolbar"><h2>Szenen & Schnittplanung</h2><button id="suite-add-scene" type="button" class="ghost">+ Szene</button></div><div id="suite-scene-list"></div><p class="vs-note">Reihenfolge, Sprechertext und Bildanweisungen bearbeiten. Der Renderer schneidet Texttafeln und konfigurierte Browser-Demos zusammen. Bildideen bleiben Produktionsnotizen.</p><details class="vs-advanced">'
  );
  return (
    suiteStart() +
    '<div class="suite-context"><label for="vs-project">Aktuelles Projekt</label>' +
    picker +
    '<a href="#settings" data-suite-go="settings">Projekt verwalten ↗</a><span id="suite-draft-state" role="status"></span></div><p id="vs-message" class="vs-note" role="status" aria-live="polite"></p>' +
    suiteOverview() +
    suiteAgent() +
    suiteAssets() +
    suiteSettings() +
    body +
    '<script defer src="/assets/video-suite.js?v=2"></script>' +
    suiteEnd()
  );
}
