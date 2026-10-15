# Eine Website mit einer ChatGPT-Anfrage erstellen

## Beispiel

> Erstelle mir mit LorzCMS eine Website für Containerdienst Schartau aus
> Süderbrarup mit der Subdomain container.lorzen.de.

Das neue **MCP-Werkzeug `website_create`** übernimmt Firma, Ort und Ziel-URL und
koordiniert den bestehenden ALL-INKL- und LorzCMS-Installationsprozess. Der
Assistent darf zusätzliche *verifizierte* Informationen zu Leistungen und
Kontakt in `description`, `services`, `contactEmail` und `contactPhone`
übergeben. Nichts davon ist für die erste Vorschau erforderlich. Es gibt
außerdem `website_create_plan` (ohne Schreibzugriffe) und
`website_create_status` zum späteren Nachsehen.

## Einmalige Vorbereitung

1. In **Integrationen → Hosting & DNS** muss das ALL-INKL-KAS-Konto inklusive
   passendem, gespeicherten FTP-/SFTP-Profil existieren.
2. Ein PHP-8.3+-Webspace und HTTPS für die neue Subdomain sind nötig.
   ALL-INKL kann eine zusätzliche manuelle Zertifikatsaktivierung verlangen.
3. `SITEOPS_DEFAULT_CMS_ADMIN_EMAIL` auf eine administrativ erreichbare
   E-Mail-Adresse setzen. Alternativ `adminEmail` beim Aufruf übergeben.
   Falls `ALERT_EMAIL_TO` eine einzelne gültige E-Mail-Adresse enthält,
   wird sie ersatzweise als Betreiberadresse verwendet.
4. Optional `SITEOPS_WEBSITE_ROOT_BASE` setzen (Vorgabe
   `/siteops-websites`). Das FTP-Verzeichnis **und** der über die KAS-API
   verwendete Webroot-Pfad müssen dasselbe reale Hosting-Verzeichnis
   bezeichnen. Als individueller Aufrufparameter kann `remoteRoot` gewählt
   werden. Für `container.lorzen.de` ist die Vorgabe
   `/siteops-websites/container-lorzen-de`.
5. SiteOps muss unter `main` mit dieser Version laufen und der MCP-Client
   die neuen Werkzeuge geladen haben (gegebenenfalls App neu verbinden).

## Was der Auftrag ausführt

1. Die **genau eine** KAS-Verbindung ermitteln, die die Stamm-Domain der
   Ziel-Subdomain tatsächlich verwaltet. Bei fehlendem oder mehrdeutigem
   Konto abbrechen; optional `allinklAccountId` angeben.
2. Die gebündelte LorzCMS-Core-Version freigeben, falls noch nicht vorhanden.
3. Über die bestehende, verschlüsselte Hosting-Verbindung das Zielverzeichnis
   und `public/` vorbereiten und gegebenenfalls eine **neue** Subdomain
   anlegen. Fremde Dateien oder abweichende bestehende Domain-Zuordnungen
   werden nicht überschrieben.
4. Einen verschlüsselt gespeicherten CMS-Installationsauftrag mit SQLite und
   neuem CMS-Admin einreihen.
5. **Während der ersten CMS-Installation** in derselben Datenbanktransaktion
   Startseite, Leistungen, Über uns, Kontakt, Hauptnavigation, responsive
   LorzCMS-Templates, Gestaltung und individuelle SEO-Metadaten anlegen.
6. Nach dem CMS-Job die vorhandene Prüfung von Homepage, Admin-Login und
   aktivem Core nutzen. `website_create_status` gibt den gespeicherten
   Installationsstatus und den letzten Job zurück.

Ohne bestätigte Firmendaten enthalten die Seiten **keine erfundenen
Leistungsversprechen, Öffnungszeiten, Preise, Rezensionen, Telefonnummern oder
Rechtsangaben**. Kontakte und Impressum müssen noch redaktionell ergänzt
werden. Der CMS-Kern hält deshalb die **Suchmaschinenindexierung deaktiviert**,
bis die Betreiberin oder der Betreiber sie im CMS freigibt.

Wenn `adminPassword` fehlt, generiert das Werkzeug ein starkes individuelles
Passwort und gibt es beim **Erstellungsaufruf einmalig** zurück. Die späteren
Statusabfragen enthalten keine Zugangsdaten. Dieses Passwort sicher ablegen;
es wird nicht als Klartext in SiteOps-Jobstatus gespeichert.

## Grenzen

- Die Funktion verwendet derzeit die **responsive Basis-CMS-Gestaltung**,
  keine KI-generierten Bilder, kein individuelles Logo und kein externes
  Bildmaterial. Erweiterte Designs können danach im CMS erstellt werden.
- Ohne geprüfte reale Kontaktdaten entsteht eine **prüfpflichtige Vorschau**,
  keine rechtlich fertige, suchmaschinenfreigegebene Unternehmenswebsite.
- Die KAS-API stellt in dieser Integration **kein automatisches SSL-Zertifikat
  aus**. Fehlt HTTPS, wird der CMS-Job zur Prüfung angehalten; die angelegte
  Subdomain und das leere Verzeichnis bleiben erhalten.
- Der aktuelle MCP-Client muss das neue Toolset neu synchronisieren, bevor
  `website_create` direkt aus ChatGPT aufgerufen werden kann.
- Das Backend führt keine selbstständige Webrecherche aus. Die mit
  Websuche/Recherche verifizierten Fakten müssen vom Aufrufer an das
  Werkzeug übergeben werden.

## Schnittstellen

- MCP: `website_create_plan`, `website_create`, `website_create_status`
- Dashboard API: `POST /api/website-factory/plan`,
  `POST /api/website-factory/create`,
  `GET /api/website-factory/:installationId`
- Bestehende Oberfläche: `/lorzcms`, `/hosting`

Eine Vorschau kann jederzeit über `website_create_plan` ohne Domain-,
Datei- oder Datenbankänderung erzeugt werden.
