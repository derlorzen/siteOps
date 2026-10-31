# SiteOps: Umsetzung und Prüfprotokoll

Basis: `origin/main`, Commit `95f553c`. Entwicklung auf `feat/product-workspace-mcp`. Implementiertes Verhalten und externe Abnahme werden getrennt dokumentiert.

## Was sich verändert hat

| Bereich | Konkretes Problem und Verbesserung |
| --- | --- |
| Anwendungshülle | Eine serverseitige Shell ersetzt nachträglich aufgebaute und konkurrierende Navigationen. Zentrale SVG-Navigation, gemeinsame Suche, Websitekontext und mobile Fokusführung. |
| Arbeitszentrale | Statt konkurrierender Technikansichten: Betriebsprobleme, fällige Aufgaben und Aktivitäten. Ausgefallene Quellen werden einzeln ausgewiesen. |
| Websites | Zustandsbewertung aus verstecktem HTML entfernt. Gemeinsamer Portfolio-Service mit Filtern, Sortierung, Pagination, Aktualität und Kundenbeziehungen. |
| Websitebetrieb | Aufklappbare technische Einstellungen. Erreichbarkeitstest ohne Alarmierung getrennt von einer protokollierten Monitoringprüfung. Wiederherstellung zeigt ihren Dateiumfang vor der Freigabe. |
| Dateien | Ordnerliste, Texteditor, Vergleich, gebundene Freigabe und erneutes Lesen zur Ergebnisprüfung nutzen den vorhandenen Änderungsservice. |
| CRM | Vergleichbare Projektliste ersetzt Karten. Board und Aufgaben stehen vor Zusatzpanels; Statusauswahl funktioniert ohne Drag-and-drop. API-Feldnamen bleiben erhalten. |
| Video | Ein Produktionspfad und kompakter Phasenkontext; vorhandene Vorschauen und tatsächliche Renderzustände bleiben erhalten. |
| Design | Shell- und Portfolio-Overrides ersetzt. Gemeinsame Tokens, größere Texte, direkte Kontrastkorrekturen in Modulstyles, native Validierung, Fokus, zugängliche Scrollbereiche und Reduced Motion. |
| MCP-Verwaltung | Durchsuchbarer Katalog mit Pagination, Rechte, Freigaben, bekannte Verbindungen, Tool-Audit und mehrstufiger Selbsttest. |
| KI-Kosten | Transaktionale Reservierung vor OpenAI-Text-/Bildaufrufen der Video Suite. Gemessene Tokens, konfigurierbare Limits und ausdrücklich unbekannte Preise. |
| Sicherungen | Persistente Backup-Jobs mit Idempotenzschlüssel, echten Phasen und wiederaufnehmbarer Statusabfrage. |

## Gemeinsame Services und MCP

Dashboard/REST und MCP rufen dieselben Fachcontroller auf. Vorhandene CRM-, Board-, Hosting-, DNS-, Coolify-, CMS-, Google-, YouTube- und Videodienste bleiben führend. Exportierte Eingabeschemas werden gemeinsam verwendet. Workspace-, Budget-, Freigabe- und Backupdienste hängen weder von HTML noch von MCP-Requestobjekten ab.

`capability-registry.mjs` instrumentiert auch spezialisierte Registrierungen. Unbekannte Tools gelten standardmäßig als schreibend und freigabepflichtig. Annotationen autorisieren keine Aktion. Der reale Anfragekontext wird über `AsyncLocalStorage` übernommen.

Die [Matrix](UI-MCP-COVERAGE.md) enthält 268 tatsächlich registrierte API-Funktionen, 237 MCP-Tools und 41 begründete Ausnahmen. Das bezeichnet Adapterabdeckung, keine erfolgreichen Live-Prüfungen sämtlicher Provider. Ausnahmen betreffen insbesondere persönliche OAuth-/Credential-Einrichtung, Binärtransfer und Erweiterungen von Ausführungsfreigaben.

Ergänzt wurden unter anderem Workspace und Suche, Kunden, Projekte, Aufgaben, Board, Zeiterfassung, Rechnungsvorgänge, Projektvorlagen, Aktivitäten, Werkzeugverknüpfungen, Videovorbereitung, Bildvorschauen, Kosten/Limits und gemeinsame Auftragsabfragen. Bestehende Toolnamen bleiben erhalten. `cms_admin_recovery` liefert ausschließlich den persönlichen Dashboard-Einstieg; der Aufruf ändert kein Passwort und gibt keine Zugangsdaten aus.

## Sicherheit

- OAuth startet mit Leserechten (`siteops:access`). Änderungen benötigen zusätzlich `siteops:write`.
- Kritische Tools mit `action_prepare` vorbereiten. Im Dashboard persönlich freigeben. Derselbe Benutzer und Client kann genau diese Aktion mit `approval_id` ausführen.
- Parameter und Ausgangszustand werden per Hash gebunden; Parameter verschlüsselt gespeichert. Freigaben gelten zehn Minuten und werden atomar einmal verbraucht.
- REST verwendet denselben Dienst: 428 liefert die Vorbereitung, persönliche Bestätigung und gebundener Header erlauben die konkrete Ausführung. Direkte Aufrufe umgehen die Grenze nicht.
- Verbrauchte Freigabe bedeutet nicht fachlichen Erfolg. Mehrdeutige externe Fehler werden nicht automatisch wiederholt. Negative Anbieterergebnisse bleiben fehlgeschlagene Tools, auch bei HTTP 200.
- Toolergebnis und HTTP-Status werden getrennt auditiert. Secret-Felder werden geschützt. Bekannte Credential-/Datenbankdateien und Verknüpfungen sind bei Dateiinspektion gesperrt; Links werden auch vor Vorschau und Übertragung geprüft. Externe Texte bleiben nicht vertrauenswürdige Daten.

Das bestehende Kontomodell hat einen Dashboard-Verantwortlichen. Projektfilter und Beziehungen sind Kontext, keine Mandantentrennung. Für eine spätere Mehrbenutzerfreigabe braucht es zusätzliche projektbezogene Serviceberechtigungen.

## Discovery und bekannte Fehlermeldung

Tests prüfen `server/discover` für `2026-07-28` sowie `initialize` für `2025-11-25` über den echten Fastify-HTTP-Handler. Alle Eingabe-/Ausgabeschemas werden mit AJV und sämtliche Regex-Muster zusätzlich mit Python kompiliert.

„Authentication succeeded, action discovery failed“ wird nach dem Login gezielt geprüft. Der im bisherigen Repository dokumentierte konkrete Fehler war ein nicht portables Unicode-Regex im Hashtag-Schema, bereits auf Main korrigiert. Die neue Prüfung schützt den gesamten Katalog. Lokale OAuth-/Schematests beweisen keine erfolgreiche Registrierung in externen Clients.

## Prüfung

```sh
npm ci
npm --prefix runner ci
npm run check
npm run check:runtime
npm run lint
npm run format:check
npm run capabilities
npm test
RUN_PRODUCT_BROWSER_TESTS=1 node --test test/product-browser.test.mjs
```

Chromium wird mit Playwright installiert. Optional wählen `SITEOPS_PLAYWRIGHT_MODULE` und `SUITE_CHROMIUM_EXECUTABLE` vorhandene Installationen. `RUN_SUITE_BROWSER_TESTS=1` bleibt als Alias der gemeinsamen Produktsuite erhalten. Die alte Shell-Fixture wurde durch tatsächliche Renderer ersetzt.

CI prüft Matrix-Drift, Produktsuite und MySQL-Integration und archiviert Screenshots/axe-Befunde. Der SQL-Test prüft auch konkurrierende Budgetreservierungen und die atomare Freigabe. Ohne Testdatenbank wird er ausdrücklich übersprungen. Die abschließende Bilanz und Screenshots stehen im [QA-Nachweis](qa/product-workspace/README.md).

## Offene externe Abnahme und Grenzen

- Echte ChatGPT-/Claude-Sitzungen am öffentlichen HTTPS-Endpunkt sind separat zu prüfen. Lokal getestet sind vollständige HTTP-/OAuth-Abläufe mit beiden Clientmetadaten.
- Hosting, CMS, Render-Runner und Veröffentlichung benötigen echte, ausdrücklich freigegebene Testziele. Keine Kundenwebsites, DNS-Records, Rechnungen oder YouTube-Veröffentlichungen wurden als Test verändert.
- Das Kostenlimit umfasst OpenAI-Text und Bild in der Video Suite. Runner-Sprachausgabe, andere Provider und historische Anfragen sind nicht enthalten. Keine erfundenen Preise oder tatsächliche Anbieterabrechnung.
- Backup-Jobs laufen im Webprozess. Nach Prozessabbruch wird ihr Zustand als unbekannt kenntlich; unklare externe Sicherungen werden nicht automatisch wiederholt. Garantierte Ausführung unabhängig vom Webprozess erfordert einen separaten Worker.
- Die Gestaltung wurde modulübergreifend vereinheitlicht. Seltene Dialoge, alle Kundendatenkombinationen und Screenreader wurden nicht vollständig manuell geprüft. axe ist keine WCAG-Zertifizierung.
- Der vollständige Katalog wurde lokal validiert. Praktische Discovery-Größe und Darstellung mit 237 Tools in externen Clients gehören zur Live-Abnahme.
- Die große `app.mjs` ist schrittweise entkoppelt, nicht vollständig neu geschrieben. Kein Frameworkwechsel.

## Einführung und Rücknahme

Drei additive Migrationen ergänzen Freigaben, Kosten und Backupaufträge. Bestehende Nutzdaten werden nicht umgeschrieben. Vor Einführung gelten die üblichen Datenbanksicherungen. Alte OAuth-Verbindungen benötigen neue Zustimmung für Schreibrechte. Kritische eigene REST-Clients müssen den 428-Freigabevertrag berücksichtigen.

Beim Rücknehmen des Anwendungscodes bleiben zusätzliche Tabellen und Protokolle erhalten. Unbestätigte externe Vorgänge vor einem neuen Versuch anhand ihres tatsächlichen Zustands prüfen.
