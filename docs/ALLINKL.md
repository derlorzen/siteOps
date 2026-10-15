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

- **HTTPS/Let's Encrypt:** Das Anlegen der Subdomain ist *nicht* gleichbedeutend mit einem ausgestellten Zertifikat. Bei ALL-INKL kann ein SSL-Zertifikat im KAS aktiviert werden müssen. LorzCMS benötigt HTTPS und PHP **8.3 oder neuer**. Eine Installation bei noch fehlendem SSL kann im Auftrag mit einem prüfbaren Fehler stoppen; anschließend den Auftrag erneut starten.
- **DNS-Hosting:** Die KAS-API kann DNS nur verwalten, wenn die Zone dort tatsächlich administriert wird. Bei externen Nameservern muss deren Dienst genutzt werden.
- **Verzeichnispfade:** Der KAS-Webroot-Pfad und der FTP-Pfad müssen denselben Serverordner bezeichnen. Deshalb verwendet jeder KAS-Account genau ein passendes gespeichertes Serverprofil.
- **Flood-Schutz:** KAS-Anfragen werden pro KAS-Konto serialisiert und mit mindestens fünf Sekunden Abstand ausgeführt.
- **Nicht enthalten:** automatische Beschaffung/Erneuerung von SSL-Zertifikaten, Anlegen eines ALL-INKL-Vertrags, automatische MySQL-Datenbank-Provisionierung sowie Löschen von Subdomains durch CMS-Abbruch.

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
- `POST /api/lorzcms/installations` mit `allinklAccountId`

### MCP
- `allinkl_accounts`
- `allinkl_domains`
- `allinkl_dns_list`
- `allinkl_dns_add`
- `allinkl_dns_update`
- `allinkl_provision`
- `cms_install_allinkl` (Subdomain, Webroot und CMS-Auftrag)

Alle HTTP-Änderungsrouten sind durch die bestehende Dashboard-Authentifizierung und den Origin-/Content-Type-Schutz geschützt. MCP verwendet den bestehenden OAuth-Zugang.

## Referenzen
- [KAS-API Dokumentation](https://kasapi.kasserver.com/dokumentation/)
- [SOAP-Beispiele](https://kasapi.kasserver.com/dokumentation/?open=quellcode)
- [KAS API Funktionen](https://kasapi.kasserver.com/dokumentation/phpdoc/)
