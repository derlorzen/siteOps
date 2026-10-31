# SiteOps – Produkt- und UX-Standard

Stand: 30.10.2026. [Audit](TRANSFORMATION-AUDIT.md), [Umsetzung](PRODUCT-TRANSFORMATION.md), [Abdeckungsmatrix](UI-MCP-COVERAGE.md).

## Aufgaben und Navigation

- `/` ist die Arbeitszentrale: Handlungsbedarf, fällige Aufgaben und letzte Aktivitäten aus tatsächlichen Daten. Ausgefallene Datenquellen werden ausdrücklich ausgewiesen.
- `/websites` verwaltet Websites in einer durchsuchbaren, sortierbaren und paginierten Liste mit Kunde, Projekt und nächster Aktion. Mobile Ansichten bewahren Identität und Handlung.
- `/sites/:slug` verbindet Betrieb, Dateien, SEO, Search Console, Browserprüfungen und Bericht. Technische Verbindung, Prüfregeln und Sicherungsregeln sind gezielt aufklappbar.
- `/billing` zeigt vergleichbare Kundenprojekte als Liste. Im Projekt stehen Aufgaben und Board vor aufklappbaren Website- und Abrechnungsdetails. Tastaturbedienbare Statusauswahl ergänzt Drag-and-drop.
- Die Video Suite besitzt einen Produktionspfad. Globale Navigation wechselt den Arbeitsbereich, lokale Navigation die Produktionsphase.
- `/ai` erklärt gemessene Tokens, reserviertes Budget, unbekannte Kosten und die Reichweite der Limits.
- `/mcp-info` verwaltet Katalog, Rechte, persönliche Freigaben, bekannte Verbindungen und den lokalen Protokolltest.

Die zentrale Navigation stammt aus `lib/workspace-shell.mjs`. Die Anwendungshülle wird serverseitig erzeugt. JavaScript ergänzt Interaktion und Kontext.

## Gestaltung und Komponenten

Die zentrale Token- und Komponentenquelle ist `public/workspace-shell.css`; Akzentfarbe und Farbwähler liegen in `siteops-theme.css` und `siteops-theme.js`. Modulstyles enthalten die fachlichen Darstellungen. Weitere globale Override-Dateien vermeiden.

Systemschrift, Dunkelblau, weiße Arbeitsflächen, 15px Leseschrift, 14px Bedienelemente und 12px Metadaten bilden die Grundlage. Seitentitel haben 28px, Panels 8px und Bedienelemente 6px Radius. Zustände tragen zusätzlich zur Farbe eine Textbezeichnung. Die globale Navigation nutzt einen gemeinsamen SVG-Satz.

`product-ui.mjs` stellt Seitentitel, Zustände und Listenbausteine bereit. Gemeinsame Skripte ergänzen Fehlerrückmeldungen, native Inline-Validierung, Fokus, zugängliche Scrollbereiche, Freigabedialoge und Änderungsschutz für entsprechend markierte Formulare.

Navigation öffnet mit 400ms und schließt mit 350ms. `prefers-reduced-motion` schaltet Bewegung aus. Keine dekorativen Daueranimationen oder erfundenen Fortschrittsanzeigen.

## Verlässliche Zustände

„Überwachung an“ bestätigt keine funktionierende Website. `monitoringState()` unterscheidet erreichbare, fehlgeschlagene, unbekannte, veraltete und deaktivierte Prüfungen. Portfolio, Website und Projektübersicht verwenden dieselbe Logik.

Fehlende Daten werden nicht als erfolgreiche Nullwerte ausgegeben. Fehlgeschlagenes Nachladen lässt vorhandene Inhalte bestehen und bietet eine Wiederholung an. Eine Freigabe ist keine Ausführung. Eine übertragene Git-Datei bestätigt keinen Live-Deploy. Unklare Ergebnisse werden als unbestätigt beschrieben.

Einfache lokale Bearbeitung bleibt direkt. Externe, finanzielle, kostenpflichtige und destruktive Änderungen benötigen eine konkrete Vorschau und eine serverseitig gebundene persönliche Freigabe. Dieselbe Grenze gilt für REST und MCP.

## Verifikation

Der Produkttest verwendet tatsächliche Serverrenderer bei 360, 390, 768, 1280 und 1440px. Mobil und Desktop erhalten zusätzlich axe-Prüfungen sowie Klick- und Tastaturabläufe. Simulierte Providerantworten bestätigen keine reale Verbindung oder vollständige WCAG-Konformität.

Neue fachliche API-Routen benötigen einen Eintrag in `lib/ui-capabilities.json`, einen vorhandenen MCP-Adapter oder eine konkrete begründete Ausnahme. Der Abdeckungstest und die generierte Matrix zeigen Abweichungen.
