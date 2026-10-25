export function renderVideoStudio() {
  return (
    '<header><div><span class="eyebrow">TOOLS · PRODUKTION</span><h1>Video Studio</h1>' +
    '<p>Gesichtslose YouTube-Videos mit KI-Stimme, echten Browser-Aufnahmen und automatischem Schnitt. Rendern auf dem SiteOps Runner.</p></div></header>' +
    '<div class="vs-wrap">' +
    '<section class="vs-panel"><h2>1. Kanal / Projekt</h2><div class="vs-row">' +
    '<select id="vs-project" aria-label="Projekt wählen"><option value="">Lade Projekte…</option></select>' +
    '<input id="vs-project-name" placeholder="Neues Projekt (z. B. Bagisto Tutorials)" maxlength="120">' +
    '<button id="vs-project-add" type="button">Projekt anlegen</button></div>' +
    '<p class="vs-note">Projekte verwalten Kanal, Sprache und einheitliche Sprecherstimme.</p></section>' +
    '<section class="vs-panel"><h2>2. Video planen</h2>' +
    '<form id="vs-form"><label for="vs-title">Titel</label>' +
    '<input id="vs-title" required minlength="3" maxlength="200" placeholder="How to manage Bagisto with ChatGPT & Claude">' +
    '<label for="vs-topic">Thema / Recherchehinweis (optional)</label>' +
    '<input id="vs-topic" maxlength="500" placeholder="Bagisto MCP Connector: admin actions, safe approvals">' +
    '<label for="vs-script">Sprechertext (Englisch)</label>' +
    '<textarea id="vs-script" required minlength="30" rows="13" placeholder="Each paragraph becomes a video scene. Paste a complete script created with ChatGPT."></textarea>' +
    '<div class="vs-row"><label>Videoformat <select id="vs-format"><option value="landscape">16:9 (YouTube)</option><option value="portrait">9:16 (Shorts)</option></select></label>' +
    '<button id="vs-create" type="submit">Entwurf speichern</button></div>' +
    '<p class="vs-note">Jeder durch eine Leerzeile getrennte Absatz wird zur Szene. Maximal 24 Szenen, 1.400 Zeichen pro Szene. Für reale Website-Bilder verwende die Szenen-API mit freigegebenen Demo-URLs.</p></form></section>' +
    '<section class="vs-panel"><div class="vs-row vs-between"><h2>3. Aufträge und Ergebnisse</h2><button type="button" id="vs-refresh" class="ghost">Aktualisieren</button></div>' +
    '<p id="vs-message" class="vs-note" role="status"></p><div id="vs-jobs" class="vs-jobs">Lade Aufträge…</div></section>' +
    '</div><link rel="stylesheet" href="/assets/video-studio.css"><script defer src="/assets/video-studio.js"></script>'
  );
}
