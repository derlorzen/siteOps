# ALL-INKL Hosting für SiteOps und LorzCMS

## Einmalige Einrichtung

1. Unter **Serverprofile** einen bereits funktionierenden FTP-, FTPS- oder SFTP-Zugang hinterlegen. Der Zugang muss den **Account-Pfad** kennen, den auch die KAS-API verwendet. Ein auf ein anderes Unterverzeichnis beschränkter FTP-Nutzer eignet sich nicht ohne korrekte Pfadzuordnung.
2. **Hosting & DNS** öffnen (`/hosting`) und **ALL-INKL-Konto hinzufügen**.
3. KAS-Benutzernamen (`w0123456`), KAS-Passwort und passendes gespeichertes Serverprofil angeben. SiteOps prüft `get_domains` und verschlüsselt das KAS-Passwort mit `SITEOPS_MASTER_KEY`. Das Passwort wird nicht an den Browser zurückgegeben.
4. In **LorzCMS → Neue Website** das ALL-INKL-Konto auswählen, `https://subdomain.example.de`, den neuen CMS-Projektordner (z. B. `/www/projekte/subdomain`), SQLite oder eine vorbereitete MySQL-Datenbank und die Admin-Daten angeben.

## Ablauf

Bei der Einrichtung prüft SiteOps:

- Ist die Subdomain tatsächlich unter einer Domain des gewählten KAS-Kontos?
- Ist der Zielordner neu/leer, bzw. enthält er ausschließlich ein **leeres** `public/`?
- Ist eine vorhandene Subdomain exakt auf `<projekt>/public/` geroutet?

Daraufhin legt SiteOps bei Bedarf Projektordner und `public/` per FTP/SFTP an, erzeugt die Subdomain per `add_subdomain` und startet die normale **LorzCMS-Installationswarteschlange**. DNS-Einträge lassen sich im Hosting-Workspace lesen sowie für A, AAAA, CNAME und TXT hinzufügen, ändern und löschen. MX/NS/SOA bleiben absichtlich schreibgeschützt.

**Bestehende Subdomains mit abweichendem Webroot werden nicht umgebogen.** Auch nicht leere Zielordner werden nicht überschrieben. Dadurch kann ein Installationsversuch nach teilweiser Vorbereitung gefahrlos wiederholt werden, sofern die angelegten Verzeichnisse weiterhin leer sind.

## Wichtige Grenzen

- **HTTPS/Let's Encrypt:** Das Anlegen einer Subdomain stellt noch kein Zertifikat aus. SiteOps kann seit der ACME-Erweiterung Zertifikate über DNS-01 ausstellen und mit KAS-API `update_ssl` installieren. Das erfolgt bei neuen ALL-INKL-LorzCMS-Aufträgen automatisch, sofern die Zone über die hinterlegte KAS-DNS-API verwaltbar ist und die Subdomain im Konto existiert. Der Provider muss die Einbindung eigener SNI-Zertifikate erlauben; die eigentliche HTTPS-Freischaltung kann einige Minuten dauern. LorzCMS benötigt PHP **8.3 oder neuer**.
- **DNS-Hosting:** Die KAS-API kann DNS nur verwalten, wenn die Zone dort tatsächlich administriert wird. Bei externen Nameservern muss deren Dienst genutzt werden.
- **Verzeichnispfade:** Der KAS-Webroot-Pfad und der FTP-Pfad müssen denselben Serverordner bezeichnen. Deshalb verwendet jeder KAS-Account genau ein passendes gespeichertes Serverprofil.
- **Flood-Schutz:** KAS-Anfragen werden pro KAS-Konto serialisiert und mit mindestens fünf Sekunden Abstand ausgeführt.
- **Nicht enthalten:** Anlegen eines ALL-INKL-Vertrags, automatische MySQL-Datenbank-Provisionierung sowie Löschen von Subdomains durch CMS-Abbruch. Die ALL-INKL-eigene Let's-Encrypt-KAS-Funktion ist nicht automatisiert; SiteOps nutzt die standardisierte externe ACME-Ausstellung.

## ACME HTTP-01 für LorzCMS-Webspace (bevorzugt)

Für bereits mit SiteOps registrierte ALL-INKL-Websites nutzt die Zertifikatsausstellung zuerst
**ACME HTTP-01**. SiteOps prüft die exakt zugeordnete KAS-Subdomain und das registrierte
`<site>/public`-Webverzeichnis, lädt die temporäre Datei nach
`public/.well-known/acme-challenge/<token>` per gespeichertem FTP-/SFTP-Zugang hoch
und prüft, dass sie **ohne Redirect** über Port 80 unverändert abrufbar ist. Nach
der ACME-Prüfung wird ausschließlich die selbst angelegte Challenge-Datei gelöscht.
Vorhandene fremde Dateien oder abweichende KAS-Webroot-Zuordnungen werden nicht verändert.

Bei Subdomains, für die SiteOps **kein** passendes Webspace-Projekt kennt,
bleibt DNS-01 als Fallback verfügbar. Achtung: Laut ALL-INKL können neue TXT-
Einträge drei bis vier Stunden zur Aktivierung benötigen. Die bisherige
DNS-Prüfung über einen einzelnen rekursiven Resolver kann zwischen den
autoritativen Nameservern und seinem Cache abweichen. Ein Test am
16.10.2026 zeigte TXT-Einträge auf ns5/ns6 und öffentlichen Resolvern,
obwohl der SiteOps-DNS-01-Versuch scheiterte.

Die HTTP-01-Methode benötigt eingehenden HTTP-Zugriff auf Port 80 und korrektes
Routing nach `public/`. Der LorzCMS-Apache-Frontcontroller muss die vorhandene
`/.well-known/acme-challenge/<token>`-Datei von der allgemeinen Weiterleitung
nach `index.php` ausnehmen. Das SiteOps-LorzCMS-Template enthält dafür vor
der Catch-all-Regel eine auf vorhandene ACME-Prüfdateien beschränkte Ausnahme. Bestehende SSL-/HTTPS-Einstellungen werden weiterhin
nicht überschrieben, wenn bereits ein gültiges, fremd verwaltetes Zertifikat
aktiv ist. Die Ausstellung und Verlängerung bleiben nach der Installation
weiter über den bestehenden SSL-Worker automatisiert.

## Vollautomatische SSL-Zertifikate

1. ALL-INKL-KAS-Zugang und FTP-/SFTP-Profil wie oben einrichten. Die Subdomain muss bereits angelegt sein; für neu angelegte LorzCMS-Sites erledigt der Website-Workflow das automatisch.
2. Unter **Hosting & DNS → SSL / Let's Encrypt** das KAS-Konto, den Subdomainnamen und eine gültige Kontakt-E-Mail-Adresse auswählen. Der Aufruf beauftragt ein **reales Zertifikat** bei Let's Encrypt und akzeptiert dessen Subscriber Agreement.
3. Auf registrierten LorzCMS-Webspace-Sites stellt SiteOps einen einmaligen HTTP-01-Prüfwert unter `public/.well-known/acme-challenge/` bereit. Andernfalls verwendet SiteOps DNS-01 mit einem TXT-Eintrag unter `_acme-challenge.<subdomain>`. Die Challenge wird nach Prüfung sicher bereinigt. Bei externen Nameservern benötigt DNS-01 deren Schreibzugang.
4. Der private Zertifikatsschlüssel und der ACME-Accountschlüssel werden mit `SITEOPS_MASTER_KEY` verschlüsselt in MySQL gespeichert. Über die KAS-API-Aktion `update_ssl` installiert SiteOps den privaten Schlüssel, das Zertifikat und die Intermediate-Kette. Keine Schlüssel werden über MCP-/Dashboard-Antworten zurückgegeben.
5. Der SSL-Worker prüft einmal pro Minute auf Aktivierung. Sobald die Subdomain per TLS mit **genau dem ausgestellten Zertifikat** und einer gültigen Vertrauenskette antwortet, wird der Zertifikatsstatus `active`. Unterbrochene LorzCMS-Erstinstallationen für die betreffende Subdomain in `preflight` werden einmalig automatisch erneut eingereiht.
6. Mit eingeschalteter automatischer Verlängerung löst der Worker ca. **30 Tage vor Ablauf** eine neue Ausstellung aus und prüft anschließend, ob das neue Zertifikat aktiv ist. Bei Fehlern bleibt der letzte gültige Stand erhalten; der Fehler ist in der SSL-Statusübersicht sichtbar.

**Fehlerbehebung ACME DNS-01:** `acme-client` 5 übergibt `keyAuthorization` für `dns-01` bereits als fertigen SHA-256-/Base64url-TXT-Wert. SiteOps schreibt diesen **unverändert** in `_acme-challenge.<subdomain>` und prüft genau diesen Wert gegen das öffentlich veröffentlichte DNS. Ein erneuter SHA-256-Hash ist falsch und führt zu `Authorization not found in DNS TXT record`. Zertifikatsinstallationen setzen in KAS ausdrücklich `ssl_certificate_is_active=Y` und `ssl_certificate_force_https=Y`. Nach der Installation der Korrektur können fehlgeschlagene Aufträge erneut über `allinkl_ssl_enable` eingereiht werden. Der Worker wiederholt fehlgeschlagene Bestellungen nicht unbeschränkt selbst, um CA-Rate-Limits zu vermeiden.

**Sicherheitsgrenzen:** Die KAS-API stellt keine neuen Let's-Encrypt-Zertifikate aus; ihre Aktion `update_ssl` bindet nur eine zuvor extern ausgestellte Zertifikatskette ein. Es werden keine bestehenden DNS- oder Zertifikatsdaten anderer Domains blind überschrieben. Die Domain muss einem hinterlegten KAS-Konto gehören. Die ACME-DNS-Challenge erfordert tatsächlich dort verwaltete öffentliche Nameserver. Zertifikate werden vor dem Upload auf Hostname, Ablauf und passenden privaten Schlüssel geprüft. Keys dürfen weder ins Git-Repository noch in Logs gelangen.

**Betrieb:** Vor dem ersten produktiven Einsatz im eigenen Tarif prüfen, ob das Einbinden externer SSL-Zertifikate per `update_ssl` freigeschaltet ist. Für isolierte ACME-Tests `SITEOPS_ACME_STAGING=true` setzen. Ein bei der Staging-CA ausgestelltes Zertifikat ist öffentlich nicht vertrauenswürdig; diesen Modus niemals für Produktionsdomains aktiv lassen.

**Bereits unterbrochene Installationen** (z. B. `container.lorzen.de`, `unfall.lorzen.de`) erhalten ein Zertifikat über `allinkl_ssl_enable`. Danach setzt der Worker passende unterbrochene LorzCMS-Aufträge selbst fort; neue Website-Projekte werden nicht erneut angelegt.

## Schnittstellen

### UI
- `GET /hosting`: Konto- und DNS-Verwaltung
- `GET /lorzcms/new`: CMS-Wizard mit ALL-INKL-Automatisierung

### HTTP-API
- `GET|POST /api/hosting/allinkl/accounts`
- `DELETE /api/hosting/allinkl/accounts/:id`
- `GET /api/hosting/allinkl/accounts/:id/domains`
- `GET /api/hosting/allinkl/accounts/:id/subdomains`
- `GET|POST /api/hosting/allinkl/accounts/:id/dns?zone=example.de`
- `PUT|DELETE /api/hosting/allinkl/accounts/:id/dns/:recordId`
- `POST /api/hosting/allinkl/provision`
- `GET /api/hosting/allinkl/ssl` und `GET /api/hosting/allinkl/ssl/:hostname`
- `POST /api/hosting/allinkl/ssl` (SSL-Ausstellung einreihen)
- `POST /api/lorzcms/installations` mit `allinklAccountId`

### MCP
- `allinkl_accounts`
- `allinkl_domains`
- `allinkl_dns_list`
- `allinkl_dns_add`
- `allinkl_dns_update`
- `allinkl_provision`
- `allinkl_ssl_list`, `allinkl_ssl_status`, `allinkl_ssl_enable`
- `cms_install_allinkl` (Subdomain, Webroot und CMS-Auftrag)

Alle HTTP-Änderungsrouten sind durch die bestehende Dashboard-Authentifizierung und den Origin-/Content-Type-Schutz geschützt. MCP verwendet den bestehenden OAuth-Zugang.

## Referenzen
- [KAS-API Dokumentation](https://kasapi.kasserver.com/dokumentation/)
- [SOAP-Beispiele](https://kasapi.kasserver.com/dokumentation/?open=quellcode)
- [KAS API Funktionen](https://kasapi.kasserver.com/dokumentation/phpdoc/)

## ALL-INKL-nginx blockiert ACME-Pfad (error_kas_44)

Bei `container.lorzen.de` und `unfall.lorzen.de` lieferte der nginx-Proxy für `/.well-known/acme-challenge/...` HTTP 404 `error_kas_44` – auch wenn die konkrete Datei über FTP **nachweislich vorhanden** war. Die Apache-Ausnahme in `.htaccess` ist dafür wirkungslos, weil der nginx-Proxy die Anforderung vorher abfängt. Die HTTP-Startseite ist dagegen mit 200 erreichbar; die autoritativen Nameserver sind `ns5.kasserver.com` und `ns6.kasserver.com`.

SiteOps schreibt deshalb vor jedem neuen HTTP-01-Auftrag einen zufälligen Testwert in genau das KAS-Webroot, liest ihn über Port 80 öffentlich zurück und löscht ihn. Wenn die Prüfung scheitert, verwendet SiteOps stattdessen automatisch **DNS-01**. ALL-INKL meldet für DNS-Änderungen eine mögliche Verteilungszeit von mehreren Stunden; SiteOps wartet bis zu **sechs Stunden**. Währenddessen ist der sichtbare Zustand `dns_propagating`. Unterschiedliche Subdomains werden parallel bearbeitet, damit die DNS-Wartezeit einer Domain nicht die anderen blockiert. Der Website-Installationsjob läuft nach erfolgreicher TLS-Prüfung automatisch weiter. Bei einem Neustart werden abgebrochene SSL-Aufträge erst nach Ablauf des maximalen Wartefensters erneut eingereiht, um unnötige ACME-Anfragen zu vermeiden.
