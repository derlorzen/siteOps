import { suiteStart, suiteEnd } from './video-suite-ui.mjs';
const input = (id, label, type = 'text', extra = '') =>
  '<label for="' + id + '">' + label + '</label><input id="' + id + '" type="' + type + '" ' + extra + '>';
const area = (id, label, rows = 5) =>
  '<label for="' + id + '">' + label + '</label><textarea id="' + id + '" rows="' + rows + '"></textarea>';
const button = (id, label) => '<button type="button" id="' + id + '">' + label + '</button>';
export function renderYouTube(assetVersion = 'visual-v1') {
  const assets = '?v=' + encodeURIComponent(assetVersion);
  return (
    suiteStart('youtube') +
    '<header class="yt-heading"><div><span class="eyebrow">VIDEO SUITE · PUBLISH & ENGAGE</span><h1>YouTube & Kanäle</h1><p>Videos vorbereiten, den Kanal pflegen und jede Änderung vor dem Ausführen prüfen.</p></div><a href="/video-suite#production">Zu deinen Produktionen</a></header>' +
    '<div class="yt-workspace"><section class="yt-connection"><div class="yt-toolbar"><div class="yt-account-field"><label for="yt-account">Verbundener Kanal</label><select id="yt-account"><option value="">Noch kein Kanal verbunden</option></select></div>' +
    button('yt-refresh', 'Aktualisieren') +
    '</div><p id="yt-status" role="status" aria-live="polite">Verbindung wird geprüft …</p>' +
    '<details><summary>Google-Verbindung einrichten</summary><p>In Google Cloud die YouTube Data API v3 aktivieren und einen OAuth-Client vom Typ Webanwendung erstellen. Zugangsdaten bleiben verschlüsselt in SiteOps. Der Google-Dialog bestimmt, auf welchen Kanal du zugreifst.</p><p>Autorisierte Weiterleitungsadresse: <code id="yt-callback"></code></p>' +
    '<p>Zeigt Google „App wird gerade getestet“ oder „403: access_denied“? Im Google-Cloud-Projekt der hier verwendeten Client-ID unter <a href="https://console.cloud.google.com/auth/audience" target="_blank" rel="noopener noreferrer">Google Auth Platform → Zielgruppe</a> bei <strong>Testnutzer → Nutzer hinzufügen</strong> die Google-E-Mail-Adresse eintragen, die deinen YouTube-Kanal verwaltet, und speichern. Danach hier erneut „Mit Google verbinden“ wählen. Bei einem Brand-Kanal das verwaltende Google-Konto freigeben.</p>' +
    '<p>Im Google-Testmodus läuft die YouTube-Freigabe einschließlich Refresh-Token nach sieben Tagen ab. Für eine dauerhafte Verbindung den Produktionsstatus und die von Google gegebenenfalls verlangte App-Prüfung einrichten. <a href="https://support.google.com/cloud/answer/15549945" target="_blank" rel="noopener noreferrer">Google-Hilfe zum Testmodus</a></p>' +
    input('yt-client-id', 'Google Client-ID') +
    input(
      'yt-client-secret',
      'Google Client-Secret',
      'password',
      'autocomplete="new-password" placeholder="Leer lassen, um das gespeicherte Secret zu behalten"'
    ) +
    button('yt-configure', 'Verbindungseinstellungen speichern') +
    '<label><input id="yt-memberships" type="checkbox"> Kanalmitgliedschaften zusätzlich freigeben (optional)</label>' +
    button('yt-connect', 'Mit Google verbinden') +
    '<details><summary>Kanalverbindung entfernen</summary><p>Widerruft den Google-Zugriff. Bereits hochgeladene Videos bleiben auf YouTube erhalten.</p><label><input id="yt-disconnect-approval" type="checkbox"> Google-Zugriff für den ausgewählten Kanal widerrufen</label>' +
    button('yt-disconnect', 'Verbindung widerrufen') +
    '</details></details></section>' +
    '<nav class="yt-tabs" aria-label="YouTube-Bereiche">' +
    [
      ['videos', 'Videos'],
      ['channel', 'Kanal'],
      ['playlists', 'Playlists'],
      ['comments', 'Kommentare'],
      ['captions', 'Untertitel & Thumbnail'],
      ['upload', 'Aus Video Studio hochladen'],
      ['advanced', 'Weitere Funktionen & Live']
    ]
      .map(
        ([id, label], i) =>
          '<button type="button" data-tab="' +
          id +
          '" aria-current="' +
          (i === 0 ? 'page' : 'false') +
          '">' +
          label +
          '</button>'
      )
      .join('') +
    '</nav>' +
    '<p id="yt-message" role="status" aria-live="polite"></p>' +
    '<section data-panel="channel" hidden><h2>Kanalprofil</h2><div id="yt-channel-summary" class="yt-summary">Verbinde einen Kanal, um Profil und Kennzahlen zu laden.</div><form id="yt-brand-form">' +
    input('yt-channel-title', 'Kanaltitel') +
    area('yt-channel-description', 'Beschreibung') +
    input('yt-channel-keywords', 'Kanal-Keywords') +
    input('yt-channel-language', 'Standardsprache (de oder en)') +
    input('yt-channel-country', 'Land (z. B. DE)') +
    input('yt-channel-trailer', 'Trailer-Video-ID (optional)') +
    input('yt-channel-banner', 'Banner-Adresse von YouTube (optional)', 'url') +
    '<button type="submit">Kanaländerung prüfen</button></form><p class="yt-note">Detaillierte Analyse und Umsatzdaten gehören zur YouTube Analytics API. Die Data API liefert Profil- und Videokennzahlen.</p></section>' +
    '<section data-panel="videos"><div class="yt-video-layout"><aside class="yt-library"><div class="yt-section-heading"><div><h2>Deine Videos</h2><p class="yt-note">Video auswählen, ansehen und bearbeiten.</p></div>' +
    button('yt-load-videos', 'Videos laden') +
    '</div><label for="yt-video-search">Geladene Videos durchsuchen</label><input id="yt-video-search" type="search" placeholder="Nach Titel suchen"><p id="yt-video-list-status" class="yt-note" role="status">Verbinde deinen Kanal, um deine Videos zu sehen.</p><div id="yt-videos" class="yt-list"></div>' +
    button('yt-more-videos', 'Weitere Videos') +
    '</aside><div class="yt-video-detail"><details class="yt-manual-video"><summary>Video über seine ID laden</summary>' +
    input('yt-video-id', 'Video-ID') +
    button('yt-video-load', 'Video laden') +
    '</details><div id="yt-video-empty" class="yt-empty"><h2>Welches Video möchtest du bearbeiten?</h2><p>Wähle links ein Video. Hier erscheinen Vorschau, Details und die Aktionen für Thumbnail und Untertitel.</p></div><div id="yt-video-editor" hidden><h2 id="yt-selected-title">Videovorschau</h2><div id="yt-player" class="yt-player"></div><p id="yt-player-note" class="yt-note"></p><div class="yt-toolbar yt-video-actions"><a id="yt-watch" target="_blank" rel="noopener noreferrer">Auf YouTube öffnen ↗</a><a id="yt-studio" target="_blank" rel="noopener noreferrer">In YouTube Studio öffnen ↗</a>' +
    button('yt-edit-assets', 'Thumbnail & Untertitel bearbeiten') +
    '</div><h3>Videodetails bearbeiten</h3><form id="yt-video-form">' +
    input('yt-video-title', 'Titel', 'text', 'maxlength="100"') +
    area('yt-video-description', 'Beschreibung mit Kapiteln und Hashtags', 9) +
    input('yt-video-tags', 'Keywords / Tags (durch Kommas trennen)') +
    '<div class="yt-field-grid"><div><label for="yt-video-category">Kategorie</label><select id="yt-video-category"></select></div><div>' +
    '<label for="yt-video-privacy">Sichtbarkeit</label><select id="yt-video-privacy"><option value="private">Privat</option><option value="unlisted">Nicht gelistet</option><option value="public">Öffentlich</option></select>' +
    '</div><div>' +
    input('yt-video-publish', 'Veröffentlichung planen (optional, lokale Zeit)', 'datetime-local') +
    '</div><div><label for="yt-video-language">Sprache</label><select id="yt-video-language"><option value="">Nicht festgelegt</option><option value="de">Deutsch</option><option value="en">English</option></select></div></div>' +
    '<label><input id="yt-video-kids" type="checkbox"> Speziell für Kinder</label><label><input id="yt-video-synthetic" type="checkbox"> Enthält kennzeichnungspflichtige veränderte / synthetische Medien</label><button type="submit">Videoänderung prüfen</button></form><p class="yt-note">Terminierung benötigt Sichtbarkeit privat und einen zukünftigen Zeitpunkt. Andere unveränderte Videoeinstellungen werden beim Speichern übernommen.</p>' +
    '<details class="yt-danger"><summary>Video entfernen</summary><p>Die Löschung auf YouTube ist dauerhaft. Erstelle zuerst eine Vorschau und prüfe das ausgewählte Video.</p>' +
    button('yt-delete-video', 'Löschung dieses Videos prüfen') +
    '</details></div></div></div></section>' +
    '<section data-panel="playlists" hidden><h2>Playlists</h2>' +
    button('yt-load-playlists', 'Playlists laden') +
    '<div id="yt-playlists" class="yt-list"></div><form id="yt-playlist-form">' +
    input('yt-playlist-id', 'Playlist-ID (leer = neue Playlist)') +
    input('yt-playlist-title', 'Titel') +
    area('yt-playlist-description', 'Beschreibung') +
    '<label for="yt-playlist-privacy">Sichtbarkeit</label><select id="yt-playlist-privacy"><option value="private">Privat</option><option value="unlisted">Nicht gelistet</option><option value="public">Öffentlich</option></select><button type="submit">Playliständerung prüfen</button></form><div class="yt-toolbar">' +
    button('yt-playlist-items', 'Inhalte laden') +
    button('yt-playlist-delete', 'Playlistlöschung prüfen') +
    '</div><div id="yt-playlist-items-list" class="yt-list"></div>' +
    input('yt-playlist-video', 'Video-ID zum Hinzufügen') +
    button('yt-playlist-add', 'Video hinzufügen – Vorschau') +
    '</section>' +
    '<section data-panel="comments" hidden><h2>Kommentare beantworten und moderieren</h2><label for="yt-comment-filter">Ansicht</label><select id="yt-comment-filter"><option value="published">Veröffentlicht</option><option value="heldForReview">Zur Prüfung zurückgehalten</option><option value="likelySpam">Wahrscheinlicher Spam</option></select>' +
    button('yt-load-comments', 'Kommentare laden') +
    '<div id="yt-comments" class="yt-list"></div>' +
    button('yt-more-comments', 'Weitere Kommentare') +
    input('yt-comment-id', 'Kommentar-ID') +
    area('yt-comment-text', 'Antwort oder neuer Text') +
    '<div class="yt-toolbar">' +
    button('yt-comment-reply', 'Antwort prüfen') +
    button('yt-comment-update', 'Eigenen Kommentar ändern – Vorschau') +
    button('yt-comment-delete', 'Kommentar löschen – Vorschau') +
    '</div><label for="yt-comment-moderation">Moderationsentscheidung</label><select id="yt-comment-moderation"><option value="published">Freigeben</option><option value="heldForReview">Zur Prüfung zurückhalten</option><option value="rejected">Ablehnen</option></select><label><input id="yt-comment-ban" type="checkbox"> Autor bei Ablehnung zusätzlich sperren</label>' +
    button('yt-comment-moderate', 'Moderation prüfen') +
    '</section>' +
    '<section data-panel="captions" hidden><h2>Untertitel und Thumbnail</h2><p id="yt-asset-context" class="yt-note">Wähle zuerst unter Videos ein Video oder gib seine ID ein.</p><div class="yt-thumbnail-comparison"><figure><img id="yt-current-thumbnail" hidden alt="Aktuelles Thumbnail des ausgewählten Videos"><figcaption>Aktuelles Thumbnail</figcaption></figure><figure id="yt-new-thumbnail-box" hidden><img id="yt-new-thumbnail" alt="Vorschau des neu ausgewählten Thumbnails"><figcaption>Neue Datei · noch nicht gespeichert</figcaption></figure></div>' +
    input('yt-caption-video', 'Video-ID') +
    button('yt-load-captions', 'Untertitel laden') +
    '<div id="yt-captions" class="yt-list"></div>' +
    input('yt-caption-id', 'Untertitelspur-ID (leer = neue Spur)') +
    input('yt-caption-language', 'Sprache (de oder en)') +
    input('yt-caption-name', 'Spurname') +
    '<label><input id="yt-caption-draft" type="checkbox"> Untertitel als Entwurf</label>' +
    area('yt-caption-text', 'Untertiteldatei (SRT / VTT)', 9) +
    '<div class="yt-toolbar">' +
    button('yt-caption-save', 'Untertiteländerung prüfen') +
    button('yt-caption-download', 'Untertitel herunterladen') +
    button('yt-caption-delete', 'Untertitel löschen – Vorschau') +
    '</div>' +
    input('yt-thumbnail', 'Thumbnail-Datei (PNG oder JPEG)', 'file', 'accept="image/png,image/jpeg"') +
    button('yt-thumbnail-set', 'Thumbnailänderung prüfen') +
    '<h3>Aus Video Studio übernehmen</h3><label for="yt-asset-job">Abgeschlossener Video-Studio-Auftrag</label><select id="yt-asset-job"></select>' +
    button('yt-asset-jobs', 'Produktionen laden') +
    button('yt-asset-thumbnail', 'Video-Studio-Thumbnail prüfen') +
    button('yt-asset-subtitles', 'Video-Studio-Untertitel prüfen') +
    '</section>' +
    '<section data-panel="upload" hidden><h2>Fertige Produktion privat hochladen</h2><p>Wähle einen abgeschlossenen Auftrag. Der Upload läuft fortsetzbar im Hintergrund. Eine Veröffentlichung ist ein separater Schritt im Bereich Videos.</p><label for="yt-upload-job">Video-Studio-Auftrag</label><select id="yt-upload-job"><option value="">Aufträge laden …</option></select><label for="yt-upload-kind">Datei</label><select id="yt-upload-kind"><option value="video">Hauptvideo</option><option value="short">9:16-Short</option></select><label><input id="yt-upload-kids" type="checkbox"> Speziell für Kinder</label><label><input id="yt-upload-synthetic" type="checkbox"> Enthält kennzeichnungspflichtige synthetische Medien</label><label><input id="yt-upload-declarations" type="checkbox"> Zielgruppe und Kennzeichnung für dieses Video geprüft</label>' +
    button('yt-upload-preview', 'Privaten Upload prüfen') +
    button('yt-load-uploads', 'Upload-Fortschritt aktualisieren') +
    '<div id="yt-uploads" class="yt-list"></div></section>' +
    '<section data-panel="advanced" hidden><h2>Weitere Funktionen und Live-Verwaltung</h2><p>Kanalabschnitte, Banner, Wasserzeichen, Abos, Live-Sendungen und Streams sowie weitere von Google freigegebene Funktionen. Änderungen werden auch hier erst nach der Vorschau ausgeführt.</p><label for="yt-resource">Bereich</label><select id="yt-resource"></select><label for="yt-operation">Funktion</label><select id="yt-operation"></select><p id="yt-operation-description" class="yt-note"></p><form id="yt-operation-form"><div id="yt-operation-parameters" class="yt-field-grid"></div><label for="yt-operation-body">Inhalt der Änderung (JSON bei komplexen Einstellungen)</label><textarea id="yt-operation-body" rows="10" spellcheck="false"></textarea>' +
    input('yt-operation-file', 'Datei (falls die Funktion einen Upload unterstützt)', 'file') +
    '<button type="submit">Lesen oder Änderung prüfen</button></form><details><summary>Erlaubte Datenfelder dieser Funktion</summary><pre id="yt-operation-schema"></pre></details><pre id="yt-operation-result" aria-live="polite"></pre><a href="https://studio.youtube.com/" target="_blank" rel="noopener noreferrer">YouTube Studio für dort exklusive Einstellungen öffnen</a></section>' +
    '<section id="yt-review" class="yt-review" hidden aria-labelledby="yt-review-title"><h2 id="yt-review-title">Änderung prüfen</h2><p id="yt-review-warning"></p><pre id="yt-review-content"></pre><div class="yt-toolbar">' +
    button('yt-execute', 'Diese Änderung jetzt ausführen') +
    button('yt-cancel', 'Verwerfen') +
    button('yt-check-change', 'Ausführungsstatus prüfen') +
    '</div><p id="yt-review-result" role="status"></p></section></div><link rel="stylesheet" href="/assets/youtube.css' +
    assets +
    '"><script defer src="/assets/youtube.js' +
    assets +
    '"></script>' +
    suiteEnd()
  );
}
