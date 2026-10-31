# QA: Produkt-Workspace und MCP

Geprüft am 31.10.2026 mit Node 24.14 und Chromium Headless unter Windows. Alle dargestellten Websites, Kunden und Providerantworten sind Testdaten. Die Bilder zeigen die tatsächlichen Serverrenderer; die APIs externer Anbieter wurden simuliert.

## Lokale Ergebnisse

- Gesamte Testsuite: **436 bestanden, 0 fehlgeschlagen, 15 umgebungsabhängig übersprungen** (451 insgesamt).
- Produktsuite: **23 Ansichten × 5 Breiten = 115 Layoutprüfungen**, keine horizontalen Seitenüberläufe und keine JavaScript-Seitenfehler.
- **66 axe-Analysen**, einschließlich aller neun Videostufen, Freigabedialog und heller eigener Akzentfarbe: keine gefundenen WCAG-A/AA-Verstöße in den geprüften Zuständen.
- Websitefilter und Wiederholung nach Fehler, mobile Tastatur/Fokus, globale Suche, Projektfilter, Board-Statuswechsel und Listenansicht geprüft.
- Dateiänderung mit Vergleich: Abbrechen verändert nichts; bestätigte Ausführung wird durch erneutes Lesen geprüft. Backup-Status und Budgetformular geprüft.
- Bestehender Video-Browserablauf: KI-Vorschlag übernehmen, Szenen bearbeiten, Entwurf neu laden und responsive Navigation bestanden. Der Test verwendet die gemeinsame Phasennavigation und reguläre Chromium-Prozessisolierung.
- Bestehender Search-Console-Browserablauf mit Verknüpfung, exakter Änderungsvorschau, Synchronisierung und sicherer Datenausgabe bestanden.
- Reale lokale HTTP-Grenze: Login → OAuth-DCR → PKCE → Token → Discovery → Tool-Aufruf → Ablauf → Refreshrotation; Wiederverwendung abgewiesen. Beide Clientmetadaten getestet.
- REST-Kunde anlegen → MCP bearbeiten → REST lesen sowie MCP-Kunde anlegen verwenden dieselben echten Controller; SQL ist eine Fixture. Website-API-Vertrag und Secret-Ausschluss geprüft.
- Vollständiger Katalog: AJV kompiliert alle Eingabe-/Ausgabeschemas; Python kompiliert die veröffentlichten Regex-Muster. Aktuelle und vorherige MCP-Protokollgeneration geprüft.
- Syntax, Runtime-Imports, Format und Lint bestanden. Acht bereits bestehende Lint-Warnungen bleiben; keine Lint-Fehler.

Die 15 übersprungenen Tests sind keine bestandenen Prüfungen. Insbesondere war lokal keine MySQL-Testdatenbank konfiguriert. CI stellt MySQL bereit und prüft Migrationen, echte SQL-Abfragen, Budgetkonkurrenz und Freigabeatomizität. Echte ChatGPT-/Claude-Sitzungen, Hostingänderungen und Veröffentlichungen wurden nicht ausgeführt. Automatisierte axe-Analysen sind keine vollständige Accessibility-Zertifizierung.

## Screenshots

- [Arbeitszentrale Desktop](1440-home.png), [Mobil](390-home.png)
- [Websiteverwaltung Desktop](1440-websites.png), [Mobil](390-websites.png)
- [Projektliste](1440-billing.png), [Projektboard Mobil](390-billing-projects-11111111-1111-4111-8111-111111111111.png)
- [Video Suite](1440-video-suite.png)
- [MCP-Verwaltung](1440-mcp-info.png)

[Maschinenlesbarer Layoutbericht](report.json) · [axe-Befunde](accessibility.json).

Die vollständigen Screenshots werden bei einem erneuten Lauf unter `.test-runtime/product-ui/` erzeugt und in CI als Artefakt `siteops-product-qa` archiviert. Diese ausgewählten Bilder dokumentieren den geprüften Entwicklungsstand.
