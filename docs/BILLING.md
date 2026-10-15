## Projekt-Workspace (mobile-first, ab Oktober 2026)

Der Bereich ist bewusst **projektorientiert** gestaltet:

1. **`/billing`**: Übersicht **aller Projekte über alle Kunden**, mit
   Kundensuche, Statusfilter, Fortschritt, offenen Tasks und erfasster Zeit.
2. **`/billing/projects/:id`**: Ein Projekt öffnen. Dort sind Board und
   Liste verfügbar. Ein Projekt ist immer einem Kunden zugeordnet.
3. **Task-Karte**: Status direkt ändern, Task öffnen, Timer starten/stoppen.
   Im Detailfenster können Zeitbuchungen, Checklisten, Kommentare, Anhänge,
   Fälligkeiten, Priorität und Beschreibung gepflegt werden.
4. **Mobil**: Statusspalten werden **einzeln** angezeigt und über größere
   Tabs gewechselt. Statuswechsel und ↑/↓-Sortierung sind ohne
   Desktop-Drag-and-drop möglich; auf dem Desktop ist Drag-and-drop aktiv.
   Die Navigation liegt mobil am unteren Bildschirmrand.
5. Der laufende Timer bleibt oben **seitenübergreifend sichtbar** und lässt
   sich jederzeit stoppen.

Kundenstammdaten: `/billing/customers`, globale Zeiterfassung:
`/billing/time`, Rechnungen: `/billing/invoices`, Absenderdaten:
`/billing/settings`. Bestehende API-Endpunkte und Rechnungsdaten bleiben
erhalten.

Die neue Oberfläche lädt nicht mehr die alten vier voneinander abhängigen
Billing-Skripte. Wenn Rechnungs-, Site- oder Einstellungen-Endpunkte
zeitweilig Fehler melden, lassen sich Projekte und das Kanban-Board
trotzdem öffnen. Ein sichtbarer Fehler mit Retry wird angezeigt, falls
das projektspezifische Board selbst nicht geladen werden kann.

# Kundenverwaltung, Zeiterfassung und Rechnungen

Der neue Bereich ist unter /billing verfügbar und verwendet die bestehende
SiteOps-Anmeldung. Die Daten werden über Migration 0004 in MySQL angelegt.

## Ablauf

1. Unter **Rechnungsabsender** Name/Firma, Straße, PLZ, Ort und Steuernummer
   hinterlegen; IBAN und weitere Daten ergänzen.
2. Kunden mit vollständiger Rechnungsanschrift und Standard-Stundensatz anlegen.
3. Pro Kunde Projekte und darunter Aufgaben anlegen. Ein Projekt kann optional
   einer bestehenden SiteOps-Website zugeordnet werden (API).
4. Arbeitszeiten oder Telefonate pro Aufgabe manuell erfassen oder den Timer
   verwenden. Die Stundensätze werden beim Buchen festgeschrieben.
5. Abrechnungszeitraum wählen, offene Zeiten auswählen und einen Entwurf erstellen.
6. Nach Prüfung **Ausstellen** wählen. Die Rechnungsnummer wird vergeben und
   die endgültige Rechnung als PDF und Datensnapshot archiviert.
7. Eine ausgestellte Rechnung kann nur über eine eigenständig nummerierte
   Stornorechnung mit negativem Betrag korrigiert werden. Der Stornobeleg wird
   zusätzlich als Original-PDF und JSON im selben privaten GitHub-Archiv abgelegt.

Bei einem Archivfehler verbleibt der Vorgang in **archiving**. Er kann mit
identischem PDF und derselben Rechnungsnummer erneut ausgeführt werden. Eine
Rechnung gilt erst nach erfolgreichem GitHub-Commit als ausgestellt.

## Kanban-Board für Projekt-Tasks

Das Kanban-Board ist im Kundenbereich unter `/billing` integriert.

1. Kunden und danach das Projekt auswählen. Das Board zeigt **nur Tasks dieses Projekts**.
2. Tasks per Drag & Drop zwischen **Ideen → Offen → In Arbeit → Abnahme → Erledigt**
   verschieben und innerhalb einer Spalte sortieren.
3. Auf Smartphones lässt sich eine Karte auch am Griff ziehen oder alternativ
   mit Spaltenauswahl und den ↑/↓-Tasten bewegen.
4. Über das Drei-Punkte-Menü einer Karte Titel, Beschreibung, Priorität,
   Fälligkeit und optionalen Stundensatz bearbeiten. Über `+ Task` eine
   neue Karte in der jeweiligen Spalte erstellen.

Alle Änderungen werden in MySQL gespeichert. Bereits bestehende offene und
erledigte Tasks bleiben erhalten. Es werden **keine neuen eigenständigen Tasks
ohne Projekt** eingeführt. Bestehende Zeiteinträge und Rechnungspositionen
bleiben mit demselben Task verknüpft.

Wenn mehrere Browser gleichzeitig dasselbe Projekt-Board ändern, schützt
`board_revision` vor unbeabsichtigtem Überschreiben: Ein veralteter
Stand wird abgelehnt und neu geladen.


## Task-Workflows (Phase 1)

Das Projekt-Kanban unter `/billing` bietet nun:

- **Task-Details** mit Checklisten, Kommentaren, Aktivitätsprotokoll der
  Kanban-Verschiebungen und Datei-Anhängen (maximal 2 MB je Datei, gespeichert
  in der MySQL-Datenbank; nur angemeldete SiteOps-Benutzer).
- **Timer auf Task-Karten** zum Starten/Stoppen des bereits vorhandenen
  Einzel-Timers; direkte manuelle Zeiterfassung im Task-Detailfenster.
- **Fälligkeiten** kundenübergreifend für die nächsten sieben Tage. Bei
  konfigurierter `ALERT_EMAIL_TO` bzw. SiteOps-Alarmadresse und funktionierendem
  SMTP wird einmal täglich eine Nachricht über heute oder morgen fällige und
  überfällige Tasks verschickt; Versand wird in MySQL dedupliziert.
- **Projektvorlagen:** `Neue Website` und `Website-Wartung` erzeugen
  Standard-Tasks im gerade ausgewählten Projekt.

## Rechnungsversand und Nachverfolgung (Phase 3, ohne ZUGFeRD)

- In der Rechnungsübersicht **Per E-Mail senden**: nur nach erfolgreicher
  Rechnungs-Ausstellung und Archivierung. Versand an die gepflegte
  Kunden-E-Mail-Adresse mit unveränderter Original-PDF als Anhang.
- **Zahlungserinnerung** für überfällige, unbezahlte Rechnungen; höchstens
  einmal innerhalb von sieben Tagen. Versand über bereits vorhandene
  SiteOps-SMTP-Konfiguration. Fehlversuche und erfolgreiche Sendungen werden
  protokolliert.
- **DATEV-Vorbereitung CSV** pro Jahr, Basis-SKR03-Logik mit Rechnungen und
  Stornos. Die Datei ist ein Buchungsvorschlag, kein zertifizierter
  DATEV-Buchungsstapel und ersetzt keine Kontierungs-/Steuerprüfung.
- **Archiv-Manifest JSON** pro Jahr mit Git-Commit, Archivpfad und SHA-256.
  Für revisionssichere Langzeitaufbewahrung müssen **Originale plus Manifest**
  in ein separat betriebenes, geeignet konfiguriertes WORM-Archiv übernommen
  werden. Eine automatische WORM-Anbindung ist nicht Bestandteil dieses Releases.

## Wiederkehrende Wartung und Monitoring-Anbindung

- Wartungsregeln gehören zu einem Kundenprojekt und legen automatisch neue
  offene Tasks an (erste Aufgabe beim nächsten Worker-Lauf; danach nach der
  gewählten Anzahl Tage). Pausieren ist jederzeit möglich.
- Das Projektformular enthält die optionale Zuordnung einer **SiteOps-Website**.
  Entsteht nach Erreichen der eingestellten Monitor-Fehlerschwelle ein Vorfall,
  legt SiteOps im **eindeutig** zugeordneten Kundenprojekt einen dringenden
  Task an. Wiederholte Monitor-Checks erzeugen für denselben Vorfall keine
  Duplikate.
- Sobald die Website wieder erreichbar ist, erhält der Task automatisch
  einen Kommentar und wird zur Prüfung nach `Abnahme` verschoben. Er wird
  bewusst nicht als erledigt markiert: Ursache und Arbeitszeit sind noch
  zu dokumentieren.
- Sind mehrere Kundenprojekte mit derselben Website verbunden, wird zur
  Vermeidung einer fehlerhaften Kundenzuordnung **kein automatischer Task**
  erzeugt; die Verknüpfung muss eindeutig eingerichtet werden.

## GitHub-Archiv

SiteOps verwendet **ausschließlich das bereits konfigurierte private
GitHub-Backup-Repository und den bestehenden Backup-Branch**. Der Code für das
Archiv verwendet dieselbe Sperre, den privaten Repository-Check, die
Blob-Erstellung und Commit-Funktionen wie die normalen Website-Backups.

Die Originale liegen getrennt von den Website-Snapshots unter

    invoices/YYYY/RE-YYYY-NNNNN/RE-YYYY-NNNNN.pdf
    invoices/YYYY/RE-YYYY-NNNNN/RE-YYYY-NNNNN.json

Ein bestehender Dateipfad darf nur wiederverwendet werden, wenn der Inhalt
bytegenau identisch ist. Der PDF-SHA-256 und die Git-Commit-ID stehen zusätzlich
in der Rechnungstabelle. Die Website-Backup-Routine löscht nur Dateien unter
sites/<slug>/ und berührt daher Rechnungsdokumente nicht.

**Wichtiger Compliance-Hinweis:** Git-Historie ist veränderbar, wenn
Administratorberechtigungen einen Force-Push oder Löschvorgang ermöglichen.
Eine einfache GitHub-Archivierung garantiert daher weder GoBD-Konformität noch
automatische Acht-Jahres-Aufbewahrung, Datenschutz-konformen Speicherort oder
jederzeitige behördliche Abrufbarkeit. Zugriffs- und Löschschutz, dauerhaftes
Offsite-Backup, dokumentierte Verfahrensbeschreibung und ggf. ein WORM-Archiv
müssen separat eingerichtet und geprüft werden.

## Grenzen der ersten Version

- Für deutsche Inland-Dienstleistungen mit ausgewiesenen 19 % Umsatzsteuer.
- Kein Warenverkauf, keine Kleinunternehmerrechnung, keine §13b- oder
  Auslandssachverhalte.
- PDF-Rechnungen sind nur im Rahmen der E-Rechnungs-Übergangsregelungen und
  bei elektronischer Zustellung mit Zustimmung des Empfängers vorgesehen.
  ZUGFeRD/XRechnung folgen als separates Release.
- Rechnungsdaten sind nach Ausstellung festgeschrieben. Für vollständige
  Aufhebung wird ein separat nummerierter, archivierter Stornobeleg erzeugt.
  Teilberichtigungen sind in dieser Version noch nicht vorgesehen.
- Automatischer E-Mail-Versand und eine vollständige Buchhaltung sind nicht Teil
  dieses Moduls.
- Vor produktiver Verwendung rechtliche, steuerliche und Layout-Prüfung
  anhand eigener Absenderdaten durchführen.

## Referenzen

- https://www.gesetze-im-internet.de/ustg_1980/__14.html
- https://www.gesetze-im-internet.de/ustg_1980/__14b.html
- https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.html
