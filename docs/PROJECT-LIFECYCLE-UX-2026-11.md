# Projekt- und Website-Lebenszyklus (November 2026)

## Informationsarchitektur
Projekt: Übersicht → Aufgaben → Websites → Zeiten & Abrechnung → Aktivität → Einstellungen.
Website: Übersicht, Überwachung, Dateien (wenn verfügbar), Sichtbarkeit, Tests, Bericht, Sicherungen (wenn verfügbar), Einstellungen.
Der Einstieg zeigt Status und nächste Handlung statt vollständiger historischer Tabellen. Prüfverläufe und Störungen gehören zur Überwachung, Sicherungsverläufe zu Sicherungen. Projektaktivität ist separat. Mobil sind die Bereichslinks sichtbar und die Überwachung hat einen direkt erreichbaren Schalter. Coolify erhält dieselben Monitoring-Aktionen wie andere Website-Typen; Dateisicherung bleibt beim Anbieter.

## Arbeitsablauf
Kundenprojekt anlegen → Website erstellen oder zuordnen → Überwachung konfigurieren → Aufgaben bearbeiten und Zeiten erfassen → Projekt abschließen oder Website-Überwachung pausieren → bei endgültiger Entfernung Website und Projekt getrennt prüfen und löschen.
Projektlöschung verlangt eine kurzlebige Vorschau und Bestätigung. Websites zuerst lösen oder entfernen. Zeiteinträge blockieren das Löschen, damit Abrechnungsdaten erhalten bleiben. Externe Dienste werden durch Projektlöschung nicht entfernt. Die Incident/Task-Verknüpfung wird beim Löschen eines Elternobjekts entfernt, das andere Elternobjekt bleibt erhalten.

## Designgrundsätze
SiteOps UX-Workspace-Standard; Impeccable (distill, clarify, adapt, operate) als UX-Checkliste; UI-Audit-Prinzipien (Aufgabenfluss, responsive Navigation, klare Zustände). Keine neue UI-Bibliothek eingeführt.

## Abnahme
MySQL-Migration mit Regressionstest für Website-/Projektlöschung, Tests für getrennte Website-Ansichten und Monitoring-Aktionen, aktualisierter bestehender Browser-Workflow. Mobile und Desktop-Darstellung sowie CI vor Produktivfreigabe prüfen. Eine Vorschau ist keine Bestätigung der produktiven Löschung.
