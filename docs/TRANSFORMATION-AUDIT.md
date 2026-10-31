# SiteOps: UX-, Architektur- und MCP-Audit

Stand: 30.10.2026. Basis: `origin/main` (`95f553c`), Entwicklungsbranch `feat/product-workspace-mcp`. Keine Produktionsänderungen.

## Befund und Priorität

| Priorität | Beleg im Ausgangszustand | Auswirkung | Umsetzung / Prüfung |
| --- | --- | --- | --- |
| P0 | `app.mjs:mcpAuth`: ein globaler `siteops:access`-Scope; Tools rufen kritische Services unmittelbar auf | Ein erfolgreicher Login autorisiert zu viel; Bestätigungstexte sind keine serverseitige Freigabe | Zentrale Tool-Policies, getrennte Lese-/Schreibrechte, gebundene Freigaben und negative Protokolltests |
| P0 | `app.mjs:toolText`: ausschließlich Text; Toolfehler werden vom SDK übersetzt; Audit erfasst HTTP-Status | HTTP 200 kann einen fachlichen Fehler verdecken; Agenten können Fehler schlecht auswerten | Strukturierte Ergebnisse und Fehler, Audit auf Tool-Ebene |
| P0 | `test/mcp-catalog.test.mjs` ruft unmittelbar `tools/list` auf; keine vollständige HTTP-Authentifizierungssequenz | „Authentication succeeded, action discovery failed“ bleibt trotz grünem Katalogtest möglich | Beide Protokollgenerationen, echte Fastify-Transportgrenze, ungültige Tokens und Schemas prüfen |
| P1 | `/` und `/websites` verwenden `dashboard()`; Fokus/Klassisch plus zusätzliches JS-Portfolio | Drei konkurrierende Websiteansichten, operative Probleme hinter Disclosure verborgen | Eine Arbeitszentrale und eine Websiteverwaltung mit eigenen Aufgaben |
| P1 | `public/ops-workspace.js:websiteStatus` liest `.pill` aus einer versteckten Tabelle | Status hängt von Markup und Übersetzung ab; „Monitoring aktiv“ wird mit Betriebszustand verwechselt | Gemeinsamer Portfolio-Service mit Zeitpunkt und unbekanntem/veraltetem Status |
| P1 | `app.css` → `ops-workspace.css` → Modul-CSS → `workspace-shell.css`; viele generische `section`, `button`, `p`-Regeln | Gegenseitige Overrides, 9–12px Text, globale Nebenwirkungen | Tokens als Quelle; vorhandene Shell-Datei ersetzen, gezielte Komponenten statt weiterer Override-Datei |
| P1 | `mcpInfoPage()` pflegt Toolnamen von Hand; CRM fehlt; OAuth-Badge behauptet „aktiv“ | Unvollständige Administration und unbelegte Verbindungsbehauptung | Katalog aus tatsächlicher Registrierung, abgestufter Selbsttest, Verbindungen/Audit/Freigaben |
| P1 | `createWorkspaceSearch`, `createProjectOverview`, `createWorkspaceActivity`, Billing-Controller bereits vorhanden, aber ohne MCP-Adapter | Kunden-/Projektkontext fehlt KI-Agenten | Dieselben Serviceinstanzen für REST und MCP, gemeinsame Validierung |
| P1 | Video-Seiten besitzen Produktionsnavigation und globale Sidebar-Einträge pro Phase | Lange globale Navigation, unklarer Kontext, konkurrierende aktive Zustände | Produktionsschritte im Produktionskontext, globale Navigation auf Arbeitsbereiche beschränken |
| P2 | Browserprüfungen verwenden teils nachgebaute Beispielseiten; standardmäßig übersprungen | Kein Nachweis für wirklich gerenderte Serveransichten oder 360/768/1280px | Render-Harness mit echten Renderern, dokumentierten Fixtures, Klickwegen und fünf Viewports |
| P2 | Modul-Skripte verwenden eigene Fehlermeldungen, Status- und Ladebehandlung | Uneinheitliche Rückmeldung und verlorene Formularwerte | Gemeinsame zugängliche Zustandskomponenten, wiederholbare Ladefehler, Formularschutz |

## System und Modulbestand

Node.js/Fastify, serverseitiges HTML, native Browsermodule und CSS. `app.mjs` vereint Konfiguration, Datenbank, Datei-/Backup-/Monitoring-/SEO-Services, OAuth, MCP und Rendering. Die Module in `lib/` kapseln CRM, Hosting, Coolify, CMS, Search Console, Video und YouTube bereits teilweise. Keine Frameworkmigration notwendig. MySQL und Provider bleiben führend.

| Arbeitsbereich | Nutzeraufgabe | Darstellung und fachlicher Kontext |
| --- | --- | --- |
| Arbeitszentrale | Was benötigt jetzt Aufmerksamkeit? | Priorisierte Problemliste, fällige Aufgaben, letzte Aktivitäten; echte Datenfrische |
| Websites | Eine Website finden und betreuen | Tabelle mit Suche, Sortierung, Kunden-/Projektbezug und Status; Websitekontext für Betrieb, SEO, Google, Tests und Bericht |
| Kunden und Projekte | Arbeit planen, bearbeiten und abrechnen | Projektliste, Board mit Tastaturalternative, Aufgaben, Zeiten und Rechnungsstatus |
| Hosting / DNS / Coolify | Verbinden, vorbereiten und sicher ändern | Voraussetzungen, Vorschau, Freigabe, Jobstatus und nachvollziehbare Fehler |
| LorzCMS | Installationen verbinden und aktualisieren | Installationsliste, kontextbezogene Einrichtung, Jobs, Releases, Rücknahme |
| SEO / Monitoring / Google | Probleme verstehen und beheben | Priorisierte Befunde mit betroffener URL, Auswirkung und nächstem Schritt; Diagramme nur für Zeitreihen |
| Video / YouTube | Produktion fortführen und veröffentlichen | Ein Produktionskontext, geordnete Schritte, vorhandene Vorschauen, tatsächlicher Renderstatus |
| KI / Kosten | Assistenz bewusst auslösen | Empfehlung, Entwurf, Ausführung und Kosten klar unterscheiden; keine erfundenen Kostenwerte |
| Tools / Einstellungen | Verknüpfungen verwenden und konfigurieren | Suchbare Verknüpfungen, nach Themen gegliederte Formulare und technische Details bei Bedarf |
| MCP | Verbindung einrichten und Fehler finden | Tatsächlicher Toolkatalog, Rechte, Freigaben, Verbindungen, Audit und gestufte Diagnose |

## Designentscheidung

Taste-App-Richtung: **Framed sheet**, Seed `1016384710`, ohne Neuauslosung. Bestehendes Dunkelblau und konfigurierbare Akzentfarbe bleiben. Die Website mit ihrem geprüften Zustand und ihrer nächsten Aktion bildet das zentrale Produktobjekt. Segoe UI/Systemschrift vermeidet einen externen Font-Download. 15px Leseschrift, 24–28px Seitentitel, 12px Metadaten, 4px-Abstandsraster, kleine Radien, keine dekorativen Gradients. Farbe kennzeichnet Zustände und gezielte Aktionen. Mobile Tabellen behalten Identität und nächste Aktion; Details stehen im Websitekontext bereit.

## Skills und Quellen

Tatsächlich gelesen: Design Taste (lokale Plugin-Anweisung und offizielle Quelle), Redesign Existing Projects, Web Design Guidelines, transitions-polish und transitions-dev; 21st UI geprüft (keine angeschlossenen 21st-Tools, kein passender Grund für eine React-Komponentenbibliothek). Computer-use geprüft; für lokale Browser-Automation ist vorhandenes Playwright geeigneter. OpenAI Docs und Diagnosing Bugs für Clientvertrag/Discovery geprüft. Weitere Dashboard-/UX-/Accessibility-/MCP-Skills werden nicht aufgrund eines Namens als vorhanden angenommen; verfügbare Skillliste und tatsächliche Dateien sind maßgeblich.

Offizielle Referenzen, abgerufen am 30.10.2026:

- [MCP 2026-07-28 Discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)
- [MCP Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [TypeScript SDK: neue Protokollgeneration](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28)
- [OpenAI: MCP-Authentifizierung](https://developers.openai.com/plugins/build/auth)
- [OpenAI: Verbindung und Tests](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [Claude: Remote-Connector-Anforderungen](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)

Die aktuelle Spezifikation hat eine zustandslose Discovery; ältere Clients benötigen weiterhin `initialize`. Tests mit simulierten Clientmetadaten sind keine erfolgreichen Tests in den realen ChatGPT-/Claude-Produkten. Externe Provideraktionen, Rechnungsversand und Veröffentlichungen werden nicht im Produktivsystem ausgelöst.

## Ausgangsprüfung

Der lokale Checkout war vor dem Abruf vier weitere Main-Änderungen zurück. Der erste Testlauf scheiterte teilweise an fehlendem `saxes` im veralteten `node_modules` und an Sandbox-Portbeschränkungen. Diese Umgebungsfehler werden von Produktfehlern getrennt. Die endgültige Testbilanz, Screenshots, Abdeckungsmatrix und verbleibende Abweichungen werden mit der Implementierung dokumentiert.
