import { escapeHtml as esc, pageHeading } from './product-ui.mjs';
export function renderWebsiteFiles(site) {
  return (
    pageHeading(
      'Dateien · ' + site.name,
      'Quelldateien prüfen und Änderungen vor der Ausführung vergleichen.',
      '<a class="btn ghost" href="/sites/' + encodeURIComponent(site.slug) + '">Zur Website</a>'
    ) +
    `<div id="websiteFiles" data-site="${esc(site.slug)}"><p class="ui-meta">Es wird dieselbe Quelle wie für Backups und MCP verwendet. Bei einer Git-Website ist dies das konfigurierte Repository.</p><form id="filePathForm" class="ui-toolbar"><label>Ordnerpfad<input name="path" id="fileDirectory" value="" placeholder="Zum Beispiel assets/ …" autocomplete="off" spellcheck="false"></label><button class="ghost" type="submit">Ordner öffnen</button></form><p id="fileStatus" role="status" aria-live="polite">Dateien werden geladen …</p><div class="ui-file-workspace"><section class="ui-panel"><h2>Dateien und Ordner</h2><button class="ghost" type="button" id="fileParent">Übergeordneter Ordner</button><ul id="fileList" class="ui-file-list"></ul></section><section class="ui-panel"><h2 id="fileEditorHeading">Datei auswählen</h2><p id="fileEditorHelp">Wähle eine Textdatei aus der Liste. Inhalte anderer Websites und Zugangsdaten werden nicht angefordert.</p><label for="fileContent">Dateiinhalt</label><textarea id="fileContent" rows="20" spellcheck="false" disabled></textarea><div class="actions"><button id="filePreview" type="button" disabled>Änderung vergleichen</button><button id="fileReset" type="button" class="ghost" disabled>Änderungen verwerfen</button></div><div id="fileChangePreview" hidden><h3>Geplante Änderung</h3><p>Die Vorschau hat die Datei noch nicht verändert. Prüfe beide Fassungen und gib anschließend genau diese Änderung frei.</p><div class="ui-file-comparison"><div><h4>Bisher</h4><pre id="fileBefore"></pre></div><div><h4>Geplant</h4><pre id="fileAfter"></pre></div></div><button type="button" id="fileApply">Geprüfte Änderung ausführen</button></div></section></div></div><script defer src="/assets/website-files.js"></script>`
  );
}
