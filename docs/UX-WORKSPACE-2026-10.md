# SiteOps – UX- und Dashboard-Standard (Oktober 2026)

## Gemeinsame Leitlinien
- Priorität vor Dekoration: Status, nächste Aktion und Ergebnis sollen ohne Fachbegriffe verständlich sein.
- Keine erfundenen Metriken, Preise oder Erfolgsmeldungen. Externe APIs können ausfallen; der Zustand heißt dann „Status unbekannt“ statt „0“.
- Die Website-Übersicht bleibt die zentrale Einstiegsseite. Suchen, Filtern und Schnellzugriffe sind unmittelbar erreichbar.
- Jede datenverändernde Aktion benötigt eine eindeutige Vorschau, Sicherheitsprüfung und ausdrückliche Freigabe. Read-only-Aktionen dürfen einfacher sein.
- Zugänglichkeit: durchgehende Fokusmarkierung, semantische Statusmeldung, Tabellen mit horizontalem Scrollen, Bedienbarkeit auf 390px und weniger Animation bei reduzierter Bewegung.
- Weniger Fachjargon: „Website bei Google bestätigen“ statt unkommentierter OAuth-/Property-Begriffe.

## Bereits im Quellcode umgesetzt
- Portfolio-Kennzahlen für Websites, Projektzuordnung, Search-Console-Verifizierung und erkennbaren Handlungsbedarf.
- Website- und Kundenfilter; Suchfunktion ohne Neuladen.
- Schnelleinstiege zu Kunden/Projekten, Tools, Video Suite, Search Console und Hosting.
- Website-Detailnavigation mit direktem Search-Console-Reiter.
- Einheitliche, responsive Fokus-, Formular- und Tabellenregeln im gemeinsamen Workspace.
- Explizite Kennzeichnung unbekannter Integrationszustände.

## Weitere funktionale Prüfpunkte
1. **KI-Assistent und Kosten**: zentrale OpenAI-Konfiguration, Token-/Kostenledger, konfigurierbares Monatslimit sowie Änderungsvorschau vor Veröffentlichung. Das vorhandene Datenbankschema für Nutzungskosten allein implementiert noch keinen einsatzfähigen Assistenten.
2. **Video Suite**: pro Produktionsstufe klare Statusmeldungen und nachvollziehbarer Wiedereinstieg nach Unterbrechung.
3. **Hosting & DNS**: genau ein klarer Primärschritt pro Konfigurationsvorgang; keine „erfolgreich“-Meldung vor bestätigtem Provider-Ergebnis.
4. **Kunden & Projekte**: Trennung von Arbeit, Risiken und erledigten Aufgaben sowie deutliche nächste Aktion.
5. **SEO und Monitoring**: Fehlerfundstellen und „Mit KI beheben“ erst dann anbieten, wenn echte Vorschau und Freigabe implementiert sind.
6. **Systemweite Qualität**: Browser-Smoke-Tests mit echten Klickwegen für Mobilgeräte, Formulare und Tastaturbedienung.

Die konkreten Daten aller integrierten Dienste bleiben führend; Design und Statuslogik dürfen keine Vollständigkeit oder Echtzeitdaten vortäuschen.
