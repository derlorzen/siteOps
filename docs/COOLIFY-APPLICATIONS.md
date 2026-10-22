# Universelle Coolify-Anwendungen

Die Anwendungsverwaltung unter **Integrationen → Coolify** verwendet dieselben
verschlüsselten Verbindungen und denselben API-Client wie Git-Anwendungen und
Supabase. Aus einem Kundenprojekt führt **+ Coolify-Anwendung** zum vorausgefüllten
Formular. Bestehende Low-Level-Tools und Supabase-Aufträge bleiben erhalten.

## Voraussetzungen und Versionsprüfung

`coolify_targets` liest `/api/v1/version`, Server und Projekte der tatsächlich
verbundenen Instanz. SiteOps verwendet einen konservativen Vertrag für Coolify 4;
freie Compose-Services, Storage-API, Railpack und integrierte Basic-Authentifizierung
werden erst für stabile Versionen ab 4.4 angeboten. Unbekannte Hauptversionen und
nicht belegte Optionen werden abgelehnt. Die Payloads sind gegen den offiziellen
[API-Quellcode](https://github.com/coollabsio/coolify/tree/6c6fff5d26900e106e08a34f23f7289639b387f4/app/Http/Controllers/Api)
(4.4.7, abgerufen am 22.10.2026) geprüft. Ein erfolgreicher Versionsabruf beweist
keine Schreibberechtigung; API-Fehler bleiben am jeweiligen Workflow-Schritt sichtbar.

Der gespeicherte API-Token benötigt `read`, `write` und `deploy`, für Logs zusätzlich
`read:sensitive`. Die Coolify-API muss für SiteOps erreichbar sein. Der Zielserver
muss eine öffentliche IP melden; interne/NAT-Adressen werden nicht geraten.
Coolifys HTTPS-Proxy und Zertifikatsresolver müssen auf dem Server grundsätzlich
betriebsbereit sein. SiteOps setzt die HTTPS-Domain und erzwingt HTTPS, installiert
aber keinen zweiten Reverse-Proxy und verändert dessen globale Konfiguration nicht.

Die öffentliche DNS-Delegation muss zum eingerichteten ALL-INKL-Konto gehören.
Gleichnamige SiteOps-Projekte verschiedener Kunden erfordern eine Projekt-/Kunden-ID.
Fehlt ein Kundenkontext, werden neue interne Projekte dem Kunden **SiteOps** zugeordnet.
SiteOps-Projekt-IDs und Coolify-Projekt-UUIDs sind ausdrücklich verschiedene Felder.

## Quellen und Analyse

`coolify_app_analyze` lädt eine öffentliche Website und ihre eindeutige
GitHub-Verknüpfung oder ein direkt angegebenes GitHub-Repository. Es liest README,
Lizenz, Paketdefinition, Dockerfile und Compose-Dateien auf einem bestimmten Commit.
Quellen-URLs und Datei-Hashes bleiben im Plan. Es wird kein fremder Code ausgeführt.
Desktop-Anwendungen ohne belegten Server-Start werden zurückgewiesen.

Automatische Auswahl: Repository-Compose vor Dockerfile vor Nixpacks mit belegtem
Start-Script. Die Analyse gibt eine Begründung und offene Fragen aus. Railpack und
Static sind explizit auswählbar; Static setzt bereits erzeugte Dateien und ein
passendes `publishDirectory` voraus. Ein statisches Frontend ersetzt keinen Backend-
oder Medienserver. Ein nicht belegter Port muss angegeben werden.

Private GitHub-Apps/Deploy-Keys stammen aus bereits eingerichteten Coolify-Quellen.
Private und andere öffentliche Git-Server benötigen eine geprüfte Repository-URL,
Commit-SHA, Build-Methode und `reviewEvidence`; SiteOps behauptet dafür keine automatische
Quellcodeprüfung. Unklare Quellen erfordern menschliche Freigabe. Der Deployer
unterstützt außerdem Docker-Images (bevorzugt per Digest), Dockerfiles ohne Git
(experimentell) und freie Compose-Konfigurationen über `/services`.

Compose erlaubt ausschließlich benannte Volumes, private Containerports und
isolierte Netzwerke. Privilegierte Container, Host-/Socket-Mounts, externe Volumes,
ungeprüfte Includes und eigene Proxy-Router werden abgelehnt. Freies Compose darf
keine lokalen Build-Kontexte oder Dateien voraussetzen. SiteOps setzt RAM-/CPU-Limits
je Dienst in freiem Compose. Bei Git-Compose müssen die Limits bereits in der
geprüften Repository-Datei stehen: Coolify lädt diese beim Build erneut aus Git.
Private Git-Compose-Quellen benötigen zusätzlich den geprüften Compose-Inhalt.
Persistenz wird bei Compose in der Quelldatei definiert, sonst über die Storage-API.
Disk-Bedarf ist eine Planungsschätzung; SiteOps behauptet keine automatische
Kapazitätsmessung und reserviert keinen Speicherplatz.

## MCP-Ablauf

1. `coolify_connections`, `coolify_targets`, optional `coolify_sources_list` und
   `coolify_environments_list` lesen. Quellen mit `coolify_app_analyze` prüfen.
2. `coolify_app_plan` mit Verbindung, Quelle, Anwendungsname, `projectName`, Domain,
   Port, Ressourcen, Health-Check, Secrets und Zugriffsschutz aufrufen. Der Plan
   verändert keine externen Ressourcen. Secrets werden mit dem vorhandenen
   AES-GCM-Master-Key verschlüsselt. Die Antwort enthält nur Variablennamen.
3. Plan/Risiken prüfen. `coolify_install_execute` mit `id` und `approve:true` nur auf
   Installationsauftrag aufrufen. Bei Risiken sind zusätzlich `approveRisks:true`
   und `riskAcknowledgement` erforderlich; der Agent darf diese ausdrückliche
   menschliche Freigabe nicht selbst erfinden. Pläne sind zunächst eine Stunde gültig.
4. `coolify_app_status` bis `online` oder `needs_attention` abfragen.
   `coolify_deployment_status` und `coolify_install_logs` liefern begrenzte Diagnose.
   `coolify_app_verify` prüft den Zustand jederzeit erneut.

Weitere Tools: `coolify_project_ensure`, `siteops_project_ensure`, `domain_dns_ensure`,
`siteops_coolify_site_register` (setzt denselben geprüften Workflow fort) und
`coolify_app_redeploy` (erneute Bereitstellung derselben fixierten Konfiguration).
Diese Tools werden im vorhandenen OAuth-MCP registriert; es gibt keinen offenen
zweiten MCP-Endpunkt. Low-Level-Tools wie `coolify_app_create`, `coolify_app_deploy`
und `coolify_app_logs` bleiben für bestehende Clients kompatibel. Für vollständige
Installationen muss der Client den Plan-/Execute-Workflow verwenden.

Der Dashboard-Workflow verwendet dieselben Dienste unter `/api/coolify/analyze`,
`/plans`, `/installations`, `/installations/:id/execute`, `/redeploy`, `/logs`,
`/deployment` sowie `/connections/:id/targets`. Dashboard-Anmeldung, JSON-/Origin-
Prüfung und bestehendes Audit-Logging gelten weiter.

## Dauerhafte Ausführung und Fehlerbehebung

`analyze → plan → provision → configure → dns → deploy → verify → register` speichert
jeden Schritt in `coolify_deployments`. Der Worker läuft alle 15 Sekunden. MySQL-
Advisory-Locks verhindern parallele Anlage; Abfragen verwenden dieselbe Verbindung,
damit kleine Pools unter Konkurrenz nicht durch reservierte Lock-Verbindungen blockieren.
Eine eindeutige Domain und ein unveränderlicher Konfigurationsauftrag verhindern Duplikate.

Vor jedem Wiederholungsversuch werden Ressourcen über `SiteOps/deployment/<id>`
identifiziert. Fremde Anwendungen werden weder übernommen noch überschrieben.
Coolify-Projekte dürfen anhand eines eindeutigen Namens unverändert wiederverwendet
werden. Neue Umgebungen werden bei Bedarf innerhalb des ausgewählten Projekts angelegt.
Nach ungewissem Start wird die Deployment-Historie abgeglichen; ohne eindeutigen
Nachweis erfolgt kein zweiter blinder Start. In diesem Fall Coolify prüfen und den
Auftrag nach Klärung fortsetzen. Es gibt keine automatische Lösch-/Rollback-Routine.

`needs_attention` benennt den gescheiterten Schritt. Nach Fehlerbehebung denselben
Auftrag erneut freigeben. Bereits bestätigte Schritte bleiben erhalten. Eine erneute
Verifizierungsfreigabe öffnet ein neues 45-Minuten-Prüffenster, ohne erneut zu deployen.
Ein fehlgeschlagener Coolify-Build darf nach ausdrücklichem Retry erneut gestartet werden.
Eine geplante Konfiguration kann vor ihrer ersten Freigabe durch identische Eingabe
erneut geprüft werden. Bereits freigegebene Pläne sind unveränderlich; dieses Release
enthält keinen Editor zur In-place-Änderung oder Secret-Rotation freigegebener Pläne.
Solche Konfigurationsänderungen müssen gezielt in Coolify vorgenommen und anschließend
erneut geprüft werden; ein Redeploy verwendet weiterhin die gespeicherte Konfiguration.

## Erfolg, Zugriffsschutz und Monitoring

Ein DNS-Eintrag oder entgegengenommener Startauftrag ist kein Erfolg. Anwendungen
benötigen ein abgeschlossenes Coolify-Deployment, gesunden Remote-Status, vollständig
passende öffentliche DNS-Auflösung, ein gültiges vertrauenswürdiges TLS-Zertifikat
und den konfigurierten HTTPS-Health-Check. Für Compose-Services werden zusätzlich
aktuelle Zustandszeitstempel der Dienstressourcen benötigt. Ein alter gesunder Container
allein bestätigt kein neues Deployment. Fehlende Health-Checks/Zeitstempel bleiben
als wartende Verifizierung sichtbar und erzeugen keinen falschen Online-Status.

Standardmäßig ist Coolify HTTP Basic Auth erforderlich. Der Verifier prüft zusätzlich,
dass anonyme Anfragen mit 401 abgewiesen werden. Alternativ kann eine nachweislich
geschützte Anwendung verwendet werden; dies verlangt ausdrücklich bestätigte Risiken
und Nachweise über alle sensiblen API-/Agent-Routen. Compose-Stacks benötigen diesen
anwendungseigenen oder im Stack vorgeschalteten Schutz. Unbekannte Admin-/Agent-
Funktionen werden nicht stillschweigend öffentlich freigegeben.

`public-static` erlaubt eine öffentliche Website ohne Anmeldung ausschließlich für
nachgewiesene statische HTML-Dateien eines öffentlichen Git-Repositories ohne Backend.
Ein beliebiges Docker-Image oder eine dynamische Anwendung kann diesen Modus nicht verwenden.

Erst nach Verifizierung wird eine Website mit `deployment_mode=coolify` angelegt und
über `project_sites` zugeordnet. Bestehendes Monitoring, Incident-/Alert-Verhalten,
Projektübersichten und SSL-Ablaufprüfung werden wiederverwendet. Authentifizierte
Checks lesen Secrets nur intern. FTP-/Git-Dateioperationen und Webspace-Backups sind
für diesen Modus gesperrt; Volumen-Backups werden in Coolify verwaltet. Coolify vergibt
die Zertifikate, nicht der ALL-INKL-Webhosting-SSL-Prozess.

Ausgaben und Fehler maskieren konfigurierte Secret-Werte, URL-/Base64-/JSON-Kodierungen
und übliche Authentifizierungsfelder. Das ersetzt keine Geheimhaltung in fremdem
Anwendungscode: beliebig verschlüsselte/transformierte oder SiteOps unbekannte Secrets
können nicht zuverlässig aus Anwendungslogs erkannt werden. Keine Secrets in
Dockerfiles, Git-Dateien, Build-Argumente oder Log-Ausgaben schreiben.

## Migration und Tests

Die wiederholbar ausführbare Migration `20261022_coolify_deployer.mjs` legt das Journal
und zusätzliche nullable Website-Metadaten an. Sie läuft über die vorhandene
Startup-Migration oder `npm run migrate`. Bestehende Deployment-Modi werden nicht geändert.

`npm test`, `npm run check`, `npm run lint`, `npm run format:check` und
`npm run check:runtime` prüfen Regressionen und MCP-Discovery. Die neuen Tests decken
API-Payloads, Analyse, DNS-Konflikte, Verschlüsselung, Freigaben, Idempotenz,
Wiederaufnahme, Deploymentfehler und Verifizierung ab. Der vorhandene MySQL-CI-Test
führt zusätzlich Migration, Websiteanlage und Projektzuordnung gegen echte Tabellen
aus; nur externe Provisionierung wird gemockt.

Es wurde kein produktives Deployment und keine DNS-Änderung als Entwicklungstest
ausgeführt. Die konkrete OpenChatCut-Installation wurde vom Auftraggeber ausdrücklich
abgewählt; siehe [Quellenprüfung](OPENCHATCUT-ASSESSMENT.md).
