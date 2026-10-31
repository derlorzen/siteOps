# Search Console: Verbindung zurücknehmen, fehlende Schritte erklären

Stand 31.10.2026, Nacharbeit zu `fd5604c`. Tatsächliche Server-Renderer in Chromium mit simulierten Google-Antworten; keine Mockups oder Live-Kundendaten.

| Zustand | Desktop | Mobil |
| --- | --- | --- |
| Zentrale Übersicht, verbunden | [Website-Liste statt Kurzanleitung](overview-connected.png) | [Mobil](overview-connected-mobile.png) |
| Google-Zugang vorbereitet, Konto fehlt | [Genau der fehlende Kontozugriff](overview-account-missing.png) | – |
| Website verbunden | [Suchleistung mit dezenter Verwaltungsoption](website-connected.png) | – |
| Google-Zugang fehlt | [Offene Schritte und nächste Aktion](website-setup-missing.png) | [Mobil](website-setup-missing-mobile.png) |
| DNS hinterlegt, Google-Bestätigung fehlt | [Verifizierung, Anmeldung und Abruf offen](website-verification-missing.png) | – |

Die zentrale `/search-console`-Seite zeigte zuvor eine allgemeine Kurzanleitung unabhängig vom Verbindungsstatus. Jetzt steht bei verbundenem Konto die Website-Liste im Vordergrund; Kontodetails bleiben geschlossen. Fehlende Google-Konfiguration und fehlende Kontoautorisierung sind getrennte Zustände.

Im Website-Bericht entfallen der sichtbare Verbindungsbadge und der Einrichtungstab bei möglichem Datenabruf. „Verbindung verwalten“ steht klein bei den Berichtsinformationen. Ohne fertige Einrichtung öffnet sich die Liste der tatsächlich fehlenden Schritte mit Erläuterungen und der nächsten möglichen Aktion. Formulare öffnen sich gezielt über diese Aktion. Erledigte, bedingte und optionale Schritte bleiben gesondert einsehbar.

`lib/search-console-setup.mjs` leitet diese Hinweise aus gespeicherten Fakten ab. REST und MCP erhalten denselben `setup`-Status mit fehlenden Schritten und nächster Aktion. Die globale Übersicht liefert nur eine kompakte Zusammenfassung pro Website. Eine vorhandene Google-Leseberechtigung erfordert keine erneute DNS-Verifizierung; eine Sitemap ist optional. Ein unbekannter DNS-Status wird als unbekannt behandelt. Alle bestehenden serverseitigen Berechtigungen, Vorschauen und ausdrücklichen Freigaben bleiben wirksam.

Verifiziert: 445 lokale Tests bestanden, 17 ohne aktivierte Umgebung ausdrücklich übersprungen. Die zusätzlich aktivierten Browser-Suiten bestanden. 35 gezielte Zustands-/Viewport-Prüfungen plus die bestehenden 125 Ansichten ohne Seitenüberlauf oder JavaScript-Fehler; insgesamt 80 axe-Prüfungen ohne Befunde. Die zehn neuen Scans stehen in [accessibility.json](accessibility.json). Geprüft bei 360, 390, 768, 1280 und 1440 Pixeln. Syntax, Format und Lint bestanden; acht bestehende Lint-Warnungen unverändert.

Der echte lokale Search-Console-Workflow prüft die neue nächste Aktion: Website zuordnen → Freigabevorschau → explizit bestätigen → Suchdaten abrufen. Die reine Zustandsansicht löst weder OAuth noch externe Änderungen aus. Unit-Tests prüfen auch neue Domain, vorhandene Leserechte, optionale Sitemap, unbekannten DNS-Stand, geänderte Domain, deaktivierte Website und fehlgeschlagene Synchronisierung.

Die Daten sind gespeicherte Statusinformationen, kein zusätzlicher Live-Verbindungstest. Keine neuen Google-/DNS-Änderungen an Kundenprojekten und keine neue externe Client-Abnahme. CI führt die Zustandsprüfungen dauerhaft aus und archiviert Screenshots sowie Befunde unter `siteops-product-qa`.
