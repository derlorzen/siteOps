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

Bei einem Archivfehler verbleibt der Vorgang in **archiving**. Er kann mit
identischem PDF und derselben Rechnungsnummer erneut ausgeführt werden. Eine
Rechnung gilt erst nach erfolgreichem GitHub-Commit als ausgestellt.

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
- Rechnungsdaten sind nach Ausstellung festgeschrieben. Fehler müssen mit
  nachvollziehbaren Berichtigungs-/Stornobelegen korrigiert werden.
- Automatischer E-Mail-Versand und eine vollständige Buchhaltung sind nicht Teil
  dieses Moduls.
- Vor produktiver Verwendung rechtliche, steuerliche und Layout-Prüfung
  anhand eigener Absenderdaten durchführen.

## Referenzen

- https://www.gesetze-im-internet.de/ustg_1980/__14.html
- https://www.gesetze-im-internet.de/ustg_1980/__14b.html
- https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.html
