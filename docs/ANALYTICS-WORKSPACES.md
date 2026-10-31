# Search Console und YouTube: Analyse als Arbeitsbereich

Stand: 31.10.2026. Nacharbeit zur Produkttransformation, ausgehend von `464bac492bfd06b0de8d6d1907cf0627e2d23256`. [Vorher-/Nachher-Screenshots und Prüfnachweise](qa/analytics-workspaces/README.md).

## Befund und Prioritäten

| Priorität | Konkretes Problem | Umsetzung |
| --- | --- | --- |
| Hoch | Search Console zeigte selbst bei abgeschlossener Einrichtung erst eine lange Checkliste, Zugangsdaten, Zuordnungsformulare und Freigabebuttons. Die eigentlichen Daten folgten weit unten. | Suchleistung ist die Startansicht. URL-Prüfung und Einrichtung haben eigene, per Tastatur bedienbare Tabs. Abgeschlossene Einrichtung bleibt geschlossen. |
| Hoch | Beide Berichte lieferten Zahlen und lange Tabellen ohne visuell lesbaren Zeitverlauf. Die bisherigen YouTube-Einheiten waren Minuten und Sekunden ohne verständliche Aufbereitung. | Auswählbare Kennzahlen steuern einen gemeinsamen, interaktiven SVG-Zeitverlauf. Wiedergabezeit in Stunden, durchschnittliche Dauer als Minuten und Sekunden. |
| Hoch | YouTube zeigte die Analytics-Freigabeaufforderung auch bei bereits vorhandenen Berichten. Videos waren nur über IDs erkennbar. | Verbindungs-, Berechtigungs- und Datenzustand werden unterschieden. Videotitel und vorhandene Provider-Thumbnails ersetzen IDs als primäre Identität. Ein Klick öffnet das bestehende Video zur Bearbeitung. |
| Hoch | Ein angefragter YouTube-Zeitraum von 90 Tagen wurde serverseitig nach 50 Tageszeilen abgeschnitten. | Tagesberichte können bis zu 90 Zeilen liefern; die Videoauswahl bleibt auf 50 begrenzt. |
| Mittel | Search-Console-Tabellen waren lang und ohne Suche oder fachliche Sortierung. Eine Suche nur über die sichtbare Seite hätte Ergebnisse versteckt. | Suche und Sortierung erfolgen im gemeinsamen Service über den gesamten gespeicherten Bericht, danach folgt Pagination mit 10/25/50 Zeilen. |
| Mittel | YouTube erbte zusätzlich die Video-Suite-Darstellung. Mehrere Stylesheets veränderten Buttons, Navigation und Abstände gegenseitig. | YouTube ist aus der Suite-Darstellung gelöst. Veraltete YouTube-Regeln im Suite-Stylesheet wurden entfernt; beide Analysen verwenden gemeinsame Komponenten. |

## Gemeinsame Gestaltung und Interaktionen

`lib/analytics-ui.mjs`, `public/analytics.css` und `public/analytics.js` definieren Kennzahlleiste, Zeitverlauf, Berichtsnavigation, Tabellen, Suchfelder, Pagination, Datenhinweise, Leer- und Fehlerzustände. Eine zusammenhängende Messfläche ersetzt einzelne KPI-Karten. Ruhige Linien, tabellarische Zahlen und eine einzige Datenfarbe unterstützen den Vergleich. Die bestehende SiteOps-Typografie, Dunkelblau und konfigurierbare Akzentfarbe bleiben erhalten. Keine neue Laufzeitabhängigkeit.

Der Graph verwendet gemeldete Tagesdaten, keine geglätteten oder ergänzten Werte. Zeitlücken unterbrechen die Linie. Fehlende Kennzahlen erscheinen als „–“, echte Nullwerte als Null. Maus, Fokus, Pfeiltasten sowie Home/End lesen einzelne Messpunkte. Die Rohdaten bleiben als Tabelle verfügbar. Vergleichswerte in Search Console stammen aus dem bereits vorhandenen Vorperiodenbericht; für YouTube wird kein unbelegter Wachstumstrend berechnet.

Auf schmalen Bildschirmen umbrechen Kennzahlen und Werkzeuge. Tabellen scrollen innerhalb ihres Bereichs; die Objektspalte bleibt sichtbar. Der Seiteninhalt läuft nicht horizontal über. Tabs haben verständliche Namen, sichtbaren Fokus, Pfeiltastenbedienung und direkt adressierbare Bereiche. Animation beschränkt sich auf kurze Zustandswechsel und berücksichtigt Reduced Motion.

## Daten und gemeinsame Geschäftslogik

`search_console_performance` und der vorhandene REST-Endpunkt verwenden dasselbe Eingabeschema und denselben Service für `query`, `sort`, `order`, `offset` und `limit`. Die bisherigen Defaults und Aufrufe bleiben gültig. Filtern und Sortieren verändern den gespeicherten Bericht nicht. Berechtigungsprüfung und Website-Kontext bleiben im Service. Die Capability-Matrix bleibt bei 237 Tools, 268 API-Routen und 41 begründeten Ausnahmen.

Die YouTube-Korrektur gilt ebenfalls für UI und MCP, da beide `analytics()` verwenden. Die [offizielle Reports-Dokumentation](https://developers.google.com/youtube/analytics/reference/reports/query) beschreibt `maxResults` als Zeilengrenze; ein gewählter Zeitraum garantiert keine Daten für jeden Tag. Die Darstellung benennt den gemeldeten Bereich und mögliche fehlende jüngste Tage.

Kontowechsel und konkurrierende Zeitraumanfragen verwerfen veraltete Ergebnisse. Nach vorübergehendem Providerfehler bleiben zuletzt geladene Daten als solche erhalten. Teilausfälle, fehlende Berechtigung, fehlende Verbindung und erfolgreiche leere Berichte erhalten unterschiedliche Rückmeldungen. Ein zusätzlicher OAuth-Dialog wird nur über die explizite Verbindungsaktion gestartet. Bestehende Vorschau- und Freigabeschritte für Änderungen bleiben erhalten.

## Verifikation und Grenzen

- Lokale Gesamtsuite: 439 bestanden, 16 ausdrücklich übersprungen, keine Fehler. Bash und lokaler Netzwerkzugriff wurden für die vorhandenen Integrationstests bereitgestellt.
- Sieben Browser-Testfälle einschließlich bestehender Search-Console-Freigabe, YouTube-Videobearbeitung und Video-Suite-Produktion bestanden.
- 115 bestehende Produktprüfungen plus zehn zusätzliche Analytics-Ansichten bei 360, 390, 768, 1280 und 1440 Pixeln ohne Seitenüberlauf oder JavaScript-Fehler.
- 66 bestehende und vier zusätzliche axe-Prüfungen: keine gemeldeten WCAG-2.2-AA-Verstöße in den geprüften Zuständen.
- Neue Servicetests prüfen Suche hinter der ersten API-Seite, Pagination, Sortierung, unveränderten Cache, Autorisierung, MCP-Parameter und die 90-Tage-Grenze. Neue Interaktionstests prüfen Diagramm/Tastatur, Titelsuche, Videokontext, Zeitraumanfragen mit verspäteter Antwort, leere Berichte, Teilausfall, Wiederholen und Berechtigungsfehler.
- Syntax, Lint und Formatprüfung bestanden; acht unveränderte Lint-Warnungen außerhalb dieser Änderungen. CI führt die Analytics-Browserprüfungen jetzt dauerhaft aus und archiviert Screenshots und Accessibility-Befunde.

Die Screenshots zeigen tatsächliche Server-Renderer und Browser-Interaktionen mit simulierten Google-Antworten. Kein Live-Google-Konto, kein externer OAuth-Client und keine Kundenproduktion wurden für diese Nacharbeit verändert oder als live verifiziert ausgegeben. Die lokale MySQL-Integration wird ohne Datenbank übersprungen und gehört zum bestehenden CI-Job. Automatische Accessibility-Prüfung ersetzt keine vollständige Screenreader-Abnahme.
