import { renderGoogleReconnect } from './google-reconnect.mjs';
import { analyticsMetrics, analyticsTrend, analyticsEmpty, videoMetrics } from './analytics-ui.mjs';
const input = (id, label, type = 'text', extra = '') =>
  '<label for="' + id + '">' + label + '</label><input id="' + id + '" type="' + type + '" ' + extra + '>';
const area = (id, label, rows = 5) =>
  '<label for="' + id + '">' + label + '</label><textarea id="' + id + '" rows="' + rows + '"></textarea>';
const button = (id, label) => '<button type="button" id="' + id + '">' + label + '</button>';
function renderVideoAnalytics() {
  return `<section data-panel="analytics" hidden class="yt-analytics-panel"><div class="analytics-period"><div><h2>Videoanalyse</h2><span class="analytics-meta" id="yt-analytics-period">Leistung deines ausgewählten Kanals</span></div><div><label><span class="ui-sr-only">Zeitraum</span><select id="yt-analytics-days"><option value="7">Letzte 7 Tage</option><option value="28" selected>Letzte 28 Tage</option><option value="90">Letzte 90 Tage</option></select></label><button type="button" id="yt-analytics-load">Aktualisieren</button></div></div>
 <p id="yt-analytics-status" class="ui-sr-only" role="status" aria-live="polite"></p><div id="yt-analytics-error" class="analytics-banner" data-tone="error" role="alert" hidden><div><strong>Videoanalyse konnte nicht aktualisiert werden.</strong><p id="yt-analytics-error-text"></p></div><button type="button" id="yt-analytics-retry">Erneut versuchen</button></div>
 ${analyticsEmpty('yt-analytics', 'Videoanalyse verbinden', 'Verbinde einen Kanal und erteile den Lesezugriff für die Videoanalyse. Deine Videos werden dabei nicht verändert.', '<button type="button" id="yt-analytics-connect" class="analytics-primary">Videoanalyse bei Google freischalten</button>')}
 <div id="yt-analytics-report"><div class="analytics-measurement yt-analytics-measurement">${analyticsMetrics('yt-analytics', videoMetrics)}${analyticsTrend('yt-analytics')}</div><p class="analytics-data-note" id="yt-analytics-freshness">YouTube Analytics · Die jüngsten Tage können noch fehlen.</p>
 <div class="analytics-details"><div class="analytics-table-toolbar"><div><h2>Videos im Vergleich</h2><span class="analytics-meta">Welche Inhalte zu deiner Kanalleistung beitragen</span></div><label class="analytics-search"><span class="ui-sr-only">Geladene Videos durchsuchen</span><input id="yt-analytics-search" type="search" placeholder="Videotitel durchsuchen" maxlength="100"></label></div><p id="yt-analytics-video-notice" class="analytics-meta" role="status"></p><p class="analytics-mobile-hint">Weitere Kennzahlen durch seitliches Scrollen anzeigen.</p><div class="analytics-scroll" tabindex="0" role="region" aria-label="Videoleistung, seitlich scrollbar"><table class="analytics-table yt-analytics-table"><caption class="ui-sr-only">Leistung der nach Aufrufen führenden Videos</caption><thead><tr><th scope="col">Video</th>${[
   ['views', 'Aufrufe'],
   ['estimatedMinutesWatched', 'Wiedergabezeit'],
   ['averageViewDuration', 'Ø Wiedergabedauer']
 ]
   .map(
     ([key, label], i) =>
       `<th scope="col"${i === 0 ? ' aria-sort="descending"' : ''}><button type="button" data-video-sort="${key}">${label}</button></th>`
   )
   .join(
     ''
   )}</tr></thead><tbody id="yt-analytics-rows"></tbody></table></div><div class="analytics-pagination"><span id="yt-analytics-video-count" role="status"></span><button type="button" id="yt-analytics-more" hidden>Weitere Videos anzeigen</button></div></div>
 <details class="yt-daily-details"><summary>Tageswerte als Tabelle</summary><div class="analytics-scroll" tabindex="0" role="region" aria-label="Tageswerte der Videoanalyse"><table class="analytics-table"><thead><tr><th scope="col">Datum</th><th scope="col">Aufrufe</th><th scope="col">Wiedergabezeit</th></tr></thead><tbody id="yt-analytics-days-rows"></tbody></table></div></details><p class="analytics-data-note">Quelle: YouTube Analytics. Die Videoauswahl umfasst bis zu 50 Videos mit den meisten Aufrufen im gewählten Zeitraum.</p></div></section>`;
}
const card = (title, hint, body, extra = '') =>
  '<div class="yt-card' +
  (extra ? ' ' + extra : '') +
  '"><div class="yt-card-head"><h3>' +
  title +
  '</h3>' +
  (hint ? '<p class="yt-note">' + hint + '</p>' : '') +
  '</div>' +
  body +
  '</div>';
const tabs = [
  ['overview', 'Übersicht'],
  ['videos', 'Videos'],
  ['analytics', 'Analyse'],
  ['comments', 'Kommentare'],
  ['playlists', 'Playlists'],
  ['upload', 'Hochladen'],
  ['channel', 'Kanal & Verbindung'],
  ['advanced', 'Erweitert']
];
function renderOverview() {
  return (
    '<section data-panel="overview">' +
    // Shown instead of the dashboard until a channel is connected.
    '<div id="yt-onboarding" class="yt-onboarding" hidden><h2>Verbinde deinen YouTube-Kanal</h2><p>Danach siehst du hier deine Kennzahlen, neueste Videos und offene Aufgaben.</p><ol class="yt-steps"><li><strong>Google-Zugang hinterlegen</strong><span>Client-ID und Secret deines Google-Cloud-Projekts eintragen.</span></li><li><strong>Mit Google verbinden</strong><span>Im Google-Dialog den Kanal auswählen und den Zugriff bestätigen.</span></li><li><strong>Loslegen</strong><span>Videos bearbeiten, Kommentare beantworten und Leistung auswerten.</span></li></ol>' +
    '<button type="button" id="yt-onboarding-start" class="yt-primary">Verbindung einrichten</button></div>' +
    '<div id="yt-dashboard" hidden><div class="yt-hero"><span id="yt-ov-avatar" class="yt-avatar" aria-hidden="true"></span><div class="yt-hero-text"><h2 id="yt-ov-title">Kanal wird geladen …</h2><p id="yt-ov-handle" class="yt-note"></p></div><a id="yt-ov-open" class="yt-link-button" target="_blank" rel="noopener noreferrer" hidden>Kanal auf YouTube öffnen ↗</a></div>' +
    '<dl class="yt-stats" id="yt-ov-stats"></dl>' +
    '<div class="yt-ov-grid">' +
    card(
      'Neueste Videos',
      '',
      '<div id="yt-ov-videos" class="yt-ov-videos"></div><p id="yt-ov-videos-status" class="yt-note" role="status"></p><button type="button" class="yt-text-action" data-go="videos">Alle Videos anzeigen</button>'
    ) +
    card(
      'Was möchtest du tun?',
      '',
      '<div class="yt-actions">' +
        [
          ['upload', 'Video hochladen', 'Fertige Produktion aus dem Video Studio privat hochladen'],
          ['comments', 'Kommentare beantworten', 'Neue Kommentare lesen, beantworten und moderieren'],
          ['analytics', 'Leistung auswerten', 'Aufrufe und Wiedergabezeit im Zeitverlauf'],
          ['playlists', 'Playlists pflegen', 'Videos in Playlists ordnen']
        ]
          .map(
            ([go, title, text]) =>
              '<button type="button" class="yt-action" data-go="' +
              go +
              '"><strong>' +
              title +
              '</strong><span>' +
              text +
              '</span></button>'
          )
          .join('') +
        '</div>'
    ) +
    '</div></div></section>'
  );
}
export function renderYouTube(assetVersion = 'visual-v1') {
  const assets = '?v=' + encodeURIComponent(assetVersion);
  return (
    '<div class="yt-workspace analytics-workspace"><header class="analytics-header yt-heading"><div class="analytics-identity"><span class="analytics-provider" aria-hidden="true"><svg width="22" height="18" viewBox="0 0 24 18" fill="none"><rect x="1" y="1" width="22" height="16" rx="4" stroke="currentColor" stroke-width="1.5"/><path d="m10 5 6 4-6 4V5Z" fill="currentColor"/></svg></span><div><h1>YouTube</h1><p>Dein Kanal. Videos und Leistung an einem Ort.</p></div></div>' +
    '<div class="yt-channel-switch"><div class="yt-account-field"><label for="yt-account">Kanal</label><select id="yt-account"><option value="">Noch kein Kanal verbunden</option></select></div>' +
    button('yt-refresh', 'Aktualisieren') +
    '</div></header>' +
    '<p id="yt-status" class="yt-status" role="status" aria-live="polite">Verbindung wird geprüft …</p>' +
    renderGoogleReconnect(assetVersion) +
    '<div class="yt-tabs analytics-nav" role="tablist" aria-label="YouTube-Bereiche">' +
    tabs
      .map(
        ([id, label], i) =>
          '<button type="button" role="tab" id="yt-tab-' +
          id +
          '" aria-controls="yt-panel-' +
          id +
          '" aria-selected="' +
          (i === 0) +
          '" tabindex="' +
          (i === 0 ? '0' : '-1') +
          '" data-tab="' +
          id +
          '" aria-current="' +
          (i === 0 ? 'page' : 'false') +
          '">' +
          label +
          '</button>'
      )
      .join('') +
    '</div>' +
    '<p id="yt-message" class="yt-message" role="status" aria-live="polite"></p>' +
    // Every change is reviewed here, directly under the navigation, whatever view started it.
    '<section id="yt-review" class="yt-review" hidden aria-labelledby="yt-review-title"><div class="yt-review-head"><span class="yt-review-badge">Noch nicht ausgeführt</span><h2 id="yt-review-title">Änderung prüfen</h2><p id="yt-review-action" class="yt-review-action"></p></div><p id="yt-review-warning"></p><pre id="yt-review-content" tabindex="0" aria-label="Details der geplanten Änderung"></pre><div class="yt-toolbar">' +
    button('yt-execute', 'Diese Änderung jetzt ausführen') +
    button('yt-cancel', 'Verwerfen') +
    button('yt-check-change', 'Ausführungsstatus prüfen') +
    '</div><p id="yt-review-result" role="status"></p></section>' +
    renderOverview() +
    renderVideoAnalytics() +
    '<section data-panel="videos" hidden><div class="yt-video-layout"><aside class="yt-library"><div class="yt-section-heading"><div><h2>Deine Videos</h2><p class="yt-note">Video auswählen, ansehen und bearbeiten.</p></div>' +
    button('yt-load-videos', 'Neu laden') +
    '</div><label for="yt-video-search" class="ui-sr-only">Geladene Videos durchsuchen</label><input id="yt-video-search" type="search" placeholder="Nach Titel suchen"><p id="yt-video-list-status" class="yt-note" role="status">Verbinde deinen Kanal, um deine Videos zu sehen.</p><div id="yt-videos" class="yt-list"></div>' +
    button('yt-more-videos', 'Weitere Videos') +
    '</aside><div class="yt-video-detail"><div id="yt-video-empty" class="yt-empty"><h2>Welches Video möchtest du bearbeiten?</h2><p>Wähle links ein Video. Hier erscheinen Vorschau, Details und die Aktionen für Thumbnail und Untertitel.</p></div><div id="yt-video-editor" hidden><h2 id="yt-selected-title">Videovorschau</h2><div id="yt-player" class="yt-player"></div><p id="yt-player-note" class="yt-note"></p><div class="yt-toolbar yt-video-actions">' +
    button('yt-edit-assets', 'Thumbnail & Untertitel bearbeiten') +
    '<a id="yt-watch" target="_blank" rel="noopener noreferrer">Auf YouTube öffnen ↗</a><a id="yt-studio" target="_blank" rel="noopener noreferrer">In YouTube Studio öffnen ↗</a></div><h3>Videodetails bearbeiten</h3><form id="yt-video-form">' +
    input('yt-video-title', 'Titel', 'text', 'maxlength="100"') +
    area('yt-video-description', 'Beschreibung mit Kapiteln und Hashtags', 9) +
    input('yt-video-tags', 'Keywords / Tags (durch Kommas trennen)') +
    '<div class="yt-field-grid"><div><label for="yt-video-category">Kategorie</label><select id="yt-video-category"></select></div><div>' +
    '<label for="yt-video-privacy">Sichtbarkeit</label><select id="yt-video-privacy"><option value="private">Privat</option><option value="unlisted">Nicht gelistet</option><option value="public">Öffentlich</option></select>' +
    '</div><div>' +
    input('yt-video-publish', 'Veröffentlichung planen (optional, lokale Zeit)', 'datetime-local') +
    '</div><div><label for="yt-video-language">Sprache</label><select id="yt-video-language"><option value="">Nicht festgelegt</option><option value="de">Deutsch</option><option value="en">English</option></select></div></div>' +
    '<label class="yt-check"><input id="yt-video-kids" type="checkbox"> Speziell für Kinder</label><label class="yt-check"><input id="yt-video-synthetic" type="checkbox"> Enthält kennzeichnungspflichtige veränderte / synthetische Medien</label><button type="submit">Videoänderung prüfen</button></form><p class="yt-note">Terminierung benötigt Sichtbarkeit privat und einen zukünftigen Zeitpunkt. Andere unveränderte Videoeinstellungen werden beim Speichern übernommen.</p>' +
    '<details class="yt-danger"><summary>Video entfernen</summary><p>Die Löschung auf YouTube ist dauerhaft. Erstelle zuerst eine Vorschau und prüfe das ausgewählte Video.</p>' +
    button('yt-delete-video', 'Löschung dieses Videos prüfen') +
    '</details></div><details class="yt-manual yt-manual-video"><summary>Video über seine ID laden</summary>' +
    input('yt-video-id', 'Video-ID') +
    button('yt-video-load', 'Video laden') +
    '</details></div></div></section>' +
    // Sub-view of a selected video; reached from the video editor, not from the navigation.
    '<section data-panel="captions" hidden><div class="yt-subview-head"><button type="button" class="yt-text-action" data-go="videos">← Zurück zum Video</button><h2>Thumbnail und Untertitel</h2><p id="yt-asset-context" class="yt-note">Wähle zuerst unter Videos ein Video oder gib seine ID ein.</p></div><div class="yt-two">' +
    card(
      'Thumbnail',
      'PNG oder JPEG, höchstens 2 MiB.',
      '<div class="yt-thumbnail-comparison"><figure><img id="yt-current-thumbnail" hidden alt="Aktuelles Thumbnail des ausgewählten Videos"><figcaption>Aktuelles Thumbnail</figcaption></figure><figure id="yt-new-thumbnail-box" hidden><img id="yt-new-thumbnail" alt="Vorschau des neu ausgewählten Thumbnails"><figcaption>Neue Datei · noch nicht gespeichert</figcaption></figure></div>' +
        input('yt-thumbnail', 'Neue Thumbnail-Datei', 'file', 'accept="image/png,image/jpeg"') +
        '<div class="yt-toolbar">' +
        button('yt-thumbnail-set', 'Thumbnailänderung prüfen') +
        '</div>'
    ) +
    card(
      'Untertitel',
      'Spur auswählen oder eine neue anlegen.',
      '<div class="yt-toolbar">' +
        button('yt-load-captions', 'Untertitel laden') +
        button('yt-caption-new', 'Neue Spur') +
        '</div><div id="yt-captions" class="yt-list yt-rows"></div><div class="yt-field-grid"><div>' +
        input('yt-caption-language', 'Sprache (de oder en)') +
        '</div><div>' +
        input('yt-caption-name', 'Spurname') +
        '</div></div><label class="yt-check"><input id="yt-caption-draft" type="checkbox"> Untertitel als Entwurf</label>' +
        area('yt-caption-text', 'Untertiteldatei (SRT / VTT)', 8) +
        '<div class="yt-toolbar">' +
        button('yt-caption-save', 'Untertiteländerung prüfen') +
        button('yt-caption-download', 'Untertitel herunterladen') +
        button('yt-caption-delete', 'Untertitel löschen – Vorschau') +
        '</div>'
    ) +
    '</div>' +
    card(
      'Aus Video Studio übernehmen',
      'Thumbnail oder Untertitel einer abgeschlossenen Produktion für dieses Video verwenden.',
      '<label for="yt-asset-job">Abgeschlossener Video-Studio-Auftrag</label><select id="yt-asset-job"></select><div class="yt-toolbar">' +
        button('yt-asset-jobs', 'Produktionen laden') +
        button('yt-asset-thumbnail', 'Video-Studio-Thumbnail prüfen') +
        button('yt-asset-subtitles', 'Video-Studio-Untertitel prüfen') +
        '</div>'
    ) +
    '<details class="yt-manual"><summary>Anderes Video oder andere Spur über die ID wählen</summary><div class="yt-field-grid"><div>' +
    input('yt-caption-video', 'Video-ID') +
    '</div><div>' +
    input('yt-caption-id', 'Untertitelspur-ID (leer = neue Spur)') +
    '</div></div></details></section>' +
    '<section data-panel="comments" hidden><div class="yt-section-heading"><div><h2>Kommentare</h2><p class="yt-note">Kommentar auswählen, dann antworten oder moderieren.</p></div><div class="yt-inline-controls"><label for="yt-comment-filter" class="ui-sr-only">Ansicht</label><select id="yt-comment-filter"><option value="published">Veröffentlicht</option><option value="heldForReview">Zur Prüfung zurückgehalten</option><option value="likelySpam">Wahrscheinlicher Spam</option></select>' +
    button('yt-load-comments', 'Neu laden') +
    '</div></div><div class="yt-master-detail"><div><p id="yt-comments-status" class="yt-note" role="status"></p><div id="yt-comments" class="yt-list yt-comment-list"></div>' +
    button('yt-more-comments', 'Weitere Kommentare') +
    '</div><div class="yt-card yt-composer"><div id="yt-comment-empty" class="yt-empty-inline"><h3>Kein Kommentar ausgewählt</h3><p>Wähle links einen Kommentar, um zu antworten oder ihn zu moderieren.</p></div><div id="yt-comment-editor" hidden><blockquote id="yt-comment-quote" class="yt-quote"></blockquote>' +
    area('yt-comment-text', 'Deine Antwort', 5) +
    '<div class="yt-toolbar">' +
    button('yt-comment-reply', 'Antwort prüfen') +
    '</div><div class="yt-subcard"><h4>Moderieren</h4><label for="yt-comment-moderation">Entscheidung</label><select id="yt-comment-moderation"><option value="published">Freigeben</option><option value="heldForReview">Zur Prüfung zurückhalten</option><option value="rejected">Ablehnen</option></select><label class="yt-check"><input id="yt-comment-ban" type="checkbox"> Autor bei Ablehnung zusätzlich sperren</label><div class="yt-toolbar">' +
    button('yt-comment-moderate', 'Moderation prüfen') +
    '</div></div><details class="yt-manual"><summary>Eigenen Kommentar ändern oder löschen</summary><p class="yt-note">Der Text im Antwortfeld ersetzt deinen eigenen Kommentar.</p><div class="yt-toolbar">' +
    button('yt-comment-update', 'Eigenen Kommentar ändern – Vorschau') +
    button('yt-comment-delete', 'Kommentar löschen – Vorschau') +
    '</div></details></div><details class="yt-manual"><summary>Kommentar über seine ID wählen</summary>' +
    input('yt-comment-id', 'Kommentar-ID') +
    '</details></div></div></section>' +
    '<section data-panel="playlists" hidden><div class="yt-section-heading"><div><h2>Playlists</h2><p class="yt-note">Playlist auswählen, bearbeiten und ihre Videos pflegen.</p></div><div class="yt-inline-controls">' +
    button('yt-playlist-new', 'Neue Playlist') +
    button('yt-load-playlists', 'Neu laden') +
    '</div></div><div class="yt-master-detail"><div><p id="yt-playlists-status" class="yt-note" role="status"></p><div id="yt-playlists" class="yt-list yt-rows"></div></div><div>' +
    '<div class="yt-card"><div class="yt-card-head"><h3 id="yt-playlist-heading">Neue Playlist</h3></div><form id="yt-playlist-form">' +
    input('yt-playlist-title', 'Titel', 'text', 'required maxlength="150"') +
    area('yt-playlist-description', 'Beschreibung', 4) +
    '<label for="yt-playlist-privacy">Sichtbarkeit</label><select id="yt-playlist-privacy"><option value="private">Privat</option><option value="unlisted">Nicht gelistet</option><option value="public">Öffentlich</option></select><button type="submit" id="yt-playlist-submit">Neue Playlist prüfen</button></form></div>' +
    '<div id="yt-playlist-contents" class="yt-card" hidden><div class="yt-card-head"><h3>Videos in dieser Playlist</h3></div><div id="yt-playlist-items-list" class="yt-list yt-rows"></div><div class="yt-add-row"><div><label for="yt-playlist-pick">Video hinzufügen</label><select id="yt-playlist-pick"><option value="">Video auswählen …</option></select></div>' +
    button('yt-playlist-add', 'Hinzufügen prüfen') +
    '</div><div class="yt-toolbar">' +
    button('yt-playlist-items', 'Inhalte neu laden') +
    '</div><details class="yt-danger"><summary>Playlist löschen</summary><p>Die Playlist wird dauerhaft entfernt. Die Videos selbst bleiben erhalten.</p>' +
    button('yt-playlist-delete', 'Playlistlöschung prüfen') +
    '</details></div><details class="yt-manual"><summary>Playlist oder Video über die ID wählen</summary><div class="yt-field-grid"><div>' +
    input('yt-playlist-id', 'Playlist-ID (leer = neue Playlist)') +
    '</div><div>' +
    input('yt-playlist-video', 'Video-ID zum Hinzufügen') +
    '</div></div></details></div></div></section>' +
    '<section data-panel="upload" hidden><div class="yt-section-heading"><div><h2>Fertige Produktion hochladen</h2><p class="yt-note">Der Upload landet privat auf YouTube und läuft fortsetzbar im Hintergrund. Veröffentlicht wird später im Bereich Videos.</p></div></div><div class="yt-two">' +
    '<div class="yt-card"><ol class="yt-form-steps"><li><h3>Produktion wählen</h3><label for="yt-upload-job">Video-Studio-Auftrag</label><select id="yt-upload-job"><option value="">Aufträge laden …</option></select><label for="yt-upload-kind">Datei</label><select id="yt-upload-kind"><option value="video">Hauptvideo</option><option value="short">9:16-Short</option></select></li>' +
    '<li><h3>Angaben für YouTube</h3><label class="yt-check"><input id="yt-upload-kids" type="checkbox"> Speziell für Kinder</label><label class="yt-check"><input id="yt-upload-synthetic" type="checkbox"> Enthält kennzeichnungspflichtige synthetische Medien</label></li>' +
    '<li><h3>Prüfen und starten</h3><label class="yt-check"><input id="yt-upload-declarations" type="checkbox"> Zielgruppe und Kennzeichnung für dieses Video geprüft</label><div class="yt-toolbar">' +
    button('yt-upload-preview', 'Privaten Upload prüfen') +
    '</div></li></ol></div>' +
    '<div class="yt-card"><div class="yt-card-head yt-card-head-row"><h3>Uploads aus SiteOps</h3>' +
    button('yt-load-uploads', 'Aktualisieren') +
    '</div><div id="yt-uploads" class="yt-list yt-rows"></div></div></div></section>' +
    '<section data-panel="channel" hidden><div class="yt-section-heading"><div><h2>Kanal & Verbindung</h2><p class="yt-note">Profilangaben deines Kanals und der Google-Zugang von SiteOps.</p></div></div><div id="yt-channel-summary" class="yt-summary">Verbinde einen Kanal, um Profil und Kennzahlen zu laden.</div><div class="yt-two">' +
    '<div class="yt-card"><div class="yt-card-head"><h3>Kanalprofil</h3></div><form id="yt-brand-form">' +
    input('yt-channel-title', 'Kanaltitel') +
    area('yt-channel-description', 'Beschreibung') +
    input('yt-channel-keywords', 'Kanal-Keywords') +
    '<div class="yt-field-grid"><div>' +
    input('yt-channel-language', 'Standardsprache (de oder en)') +
    '</div><div>' +
    input('yt-channel-country', 'Land (z. B. DE)') +
    '</div></div>' +
    input('yt-channel-trailer', 'Trailer-Video-ID (optional)') +
    input('yt-channel-banner', 'Banner-Adresse von YouTube (optional)', 'url') +
    '<button type="submit">Kanaländerung prüfen</button></form></div>' +
    '<div class="yt-card yt-connection"><div class="yt-card-head"><h3>Google-Verbindung</h3><p class="yt-note">Zugangsdaten bleiben verschlüsselt in SiteOps. Änderungen an YouTube benötigen immer eine eigene Freigabe.</p></div>' +
    '<div class="yt-toolbar">' +
    button('yt-connect', 'Mit Google verbinden') +
    '</div><label class="yt-check"><input id="yt-analytics-consent" type="checkbox" checked> Videoanalysen freigeben (YouTube Analytics API)</label><label class="yt-check"><input id="yt-memberships" type="checkbox"> Kanalmitgliedschaften zusätzlich freigeben (optional)</label>' +
    '<details id="yt-connection-settings"><summary>Google-Zugang einrichten</summary><p>In Google Cloud die YouTube Data API v3 aktivieren und einen OAuth-Client vom Typ Webanwendung erstellen. Der Google-Dialog bestimmt, auf welchen Kanal du zugreifst.</p><p>Autorisierte Weiterleitungsadresse: <code id="yt-callback"></code></p>' +
    input('yt-client-id', 'Google Client-ID') +
    input(
      'yt-client-secret',
      'Google Client-Secret',
      'password',
      'autocomplete="new-password" placeholder="Leer lassen, um das gespeicherte Secret zu behalten"'
    ) +
    '<div class="yt-toolbar">' +
    button('yt-configure', 'Verbindungseinstellungen speichern') +
    '</div></details>' +
    '<details><summary>Hilfe bei „App wird gerade getestet“ oder „403: access_denied“</summary><p>Im Google-Cloud-Projekt der hier verwendeten Client-ID unter <a href="https://console.cloud.google.com/auth/audience" target="_blank" rel="noopener noreferrer">Google Auth Platform → Zielgruppe</a> bei <strong>Testnutzer → Nutzer hinzufügen</strong> die Google-E-Mail-Adresse eintragen, die deinen YouTube-Kanal verwaltet, und speichern. Danach hier erneut „Mit Google verbinden“ wählen. Bei einem Brand-Kanal das verwaltende Google-Konto freigeben.</p>' +
    '<p>Im Google-Testmodus läuft die YouTube-Freigabe einschließlich Refresh-Token nach sieben Tagen ab. Für eine dauerhafte Verbindung den Produktionsstatus und die von Google gegebenenfalls verlangte App-Prüfung einrichten. <a href="https://support.google.com/cloud/answer/15549945" target="_blank" rel="noopener noreferrer">Google-Hilfe zum Testmodus</a></p></details>' +
    '<details class="yt-danger"><summary>Kanalverbindung entfernen</summary><p>Widerruft den Google-Zugriff. Bereits hochgeladene Videos bleiben auf YouTube erhalten.</p><label class="yt-check"><input id="yt-disconnect-approval" type="checkbox"> Google-Zugriff für den ausgewählten Kanal widerrufen</label>' +
    button('yt-disconnect', 'Verbindung widerrufen') +
    '</details></div></div></section>' +
    '<section data-panel="advanced" hidden><div class="yt-section-heading"><div><h2>Erweiterte Funktionen und Live-Verwaltung</h2><p class="yt-note">Für alles, was die anderen Bereiche nicht abdecken: Kanalabschnitte, Banner, Wasserzeichen, Abos, Live-Sendungen und Streams. Änderungen werden auch hier erst nach der Vorschau ausgeführt.</p></div><a href="https://studio.youtube.com/" target="_blank" rel="noopener noreferrer">YouTube Studio öffnen ↗</a></div><div class="yt-card"><div class="yt-field-grid"><div><label for="yt-resource">Bereich</label><select id="yt-resource"></select></div><div><label for="yt-operation">Funktion</label><select id="yt-operation"></select></div></div><p id="yt-operation-description" class="yt-note"></p><form id="yt-operation-form"><div id="yt-operation-parameters" class="yt-field-grid"></div><label for="yt-operation-body">Inhalt der Änderung (JSON bei komplexen Einstellungen)</label><textarea id="yt-operation-body" rows="8" spellcheck="false"></textarea>' +
    input('yt-operation-file', 'Datei (falls die Funktion einen Upload unterstützt)', 'file') +
    '<button type="submit">Lesen oder Änderung prüfen</button></form><details><summary>Erlaubte Datenfelder dieser Funktion</summary><pre id="yt-operation-schema"></pre></details><pre id="yt-operation-result" aria-live="polite"></pre></div></section>' +
    '</div><link rel="stylesheet" href="/assets/youtube.css' +
    assets +
    '"><link rel="stylesheet" href="/assets/analytics.css' +
    assets +
    '"><script defer src="/assets/analytics.js' +
    assets +
    '"></script><script defer src="/assets/youtube.js' +
    assets +
    '"></script>'
  ).replace(
    /<section data-panel="([^"]+)"/g,
    (_match, key) =>
      '<section role="tabpanel" id="yt-panel-' +
      key +
      '" aria-labelledby="yt-tab-' +
      // Thumbnail and captions belong to the selected video and have no navigation entry.
      (key === 'captions' ? 'videos' : key) +
      '" data-panel="' +
      key +
      '"'
  );
}
