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
2. Ein PHP-8.3+-Webspace mit SNI-SSL-Unterstützung ist nötig. Für neue ALL-INKL-Subdomains reiht SiteOps die Let's-Encrypt-Ausstellung über ACME DNS-01 automatisch ein. Voraussetzung ist, dass die autoritative DNS-Zone über die KAS-API verwaltbar ist und das Konto eigene SSL-Zertifikate einbinden darf. Die HTTPS-Aktivierung benötigt mitunter einige Minuten.
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
- Die KAS-API stellt selbst kein Zertifikat aus. SiteOps beantragt es extern über Let's Encrypt, installiert es über `update_ssl` und prüft die Aktivierung. Bis dahin kann der CMS-Erstauftrag in `preflight` anhalten; sobald das exakt beantragte Zertifikat per TLS aktiv ist, reiht der SSL-Worker diesen CMS-Auftrag automatisch wieder ein. Bei nicht über KAS verwaltbaren Nameservern oder fehlender Tarifberechtigung muss die Ursache zuerst behoben werden.
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


## Themenwebsite: Unfallversicherung mit vier Sport-Landingpages

Auch dieser vollständige Auftrag kann über `website_create` ausgeführt werden:

> Erstelle mir mit LorzCMS eine Website unter unfall.lorzen.de über die
> Notwendigkeit einer privaten Unfallversicherung, mit Praxisbeispielen,
> gesetzlich-vs-privat-Vergleich und vier Landingpages für die Sportarten
> mit den meisten gemeldeten Unfällen.

Dafür `preset: "accident-insurance"` und `baseUrl: "https://unfall.lorzen.de"`
übergeben. Anders als bei `preset: "business"` sind **kein Firmenname und
kein Ort erforderlich**. SiteOps verwendet unverändert die gleiche
ALL-INKL-/FTP-Subdomain-Erkennung, neue Datenbank, CMS-Installation, Warteschlange,
Schutzprüfungen und Admin-Passwortvergabe.

Das Inhalts-Preset erzeugt sechs Seiten: die Startseite, einen ausführlichen
Vergleich gesetzlicher und privater Unfallversicherung sowie vier
themenspezifische Landingpages:
- `/unfallversicherung-fussball`
- `/unfallversicherung-skisport`
- `/unfallversicherung-radfahren`
- `/unfallversicherung-handball`

**Statistikmethodik:** Die zugrunde liegende ERGO-Unfallstatistik 2025 wurde
am **10.06.2026** veröffentlicht:
https://www.ergo.com/de/newsroom-ergo/reports-dossiers/sportunfaelle .
Die vier Sportarten sind die mit den meisten *bei ERGO gemeldeten
Versicherungsfällen*, nicht die mit dem höchsten Verletzungsrisiko je
Sportler oder Sportstunde. Angaben: Fußball 2.308 (35,6 %), Skisport
1.001 (15,4 %), Fahrrad 579 (8,9 %), Handball 189 (2,9 %).
Der Hinweis auf die fehlende Repräsentativität steht sichtbar auf den Seiten.

Rechtsgrundlagen zum Vergleich:
- https://www.dguv.de/de/ihr_partner/arbeitnehmer/gesetzliche-uv/index.jsp
- https://www.dguv.de/de/versicherung/versicherte_personen/faq_leistungen/index.jsp
- https://www.bmas.de/DE/Soziales/Gesetzliche-Unfallversicherung/Fragen-und-Antworten/faq-gesetzliche-unfallversicherung.html

Die Angaben sind allgemeine Information, keine Leistungszusage und
keine individuelle Beratung. Sie zeigen unter anderem die Leistungen der
gesetzlichen Krankenversicherung und die mögliche Einkommensabsicherung
durch Berufsunfähigkeitsversicherung, statt eine private Unfallversicherung
als universelle Lösung darzustellen. Der Vertrag entscheidet über
versicherte Sportarten, Leistungsarten und Invaliditätsleistungen.

**Vor Freigabe prüfen:** verantwortlicher Website-Betreiber, Anbieterkennzeichnung,
Datenschutz, mögliche Vermittlerpflichtangaben, Beratungskontakt sowie das
SSL-Zertifikat. Bis zur Freigabe bleibt die Site `noindex`.
