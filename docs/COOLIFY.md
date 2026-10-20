# Coolify und projektbezogene Supabase-Instanzen

SiteOps kann die bestehende selbstgehostete Coolify-Instanz über deren
offizielle REST-API verwalten und für **jedes SiteOps-Projekt auf Anforderung
genau einen separaten Supabase-One-Click-Service** anlegen.

## Einmalige Verbindung

1. Auf Coolify unter **Keys & Tokens → API tokens** einen API-Token für das
   gewünschte Team mit den notwendigen Rechten für Projekte, Server und
   Services erstellen.
2. Auf selbstgehostetem Coolify die **API aktivieren**; gegebenenfalls die
   ausgehende IP des SiteOps-Hostings in der **IP Allowlist** freigeben.
3. In SiteOps **Coolify** (`/coolify`) öffnen, eine ausschließlich per
   HTTPS erreichbare Coolify-Adresse, den Token und optional die
   Standard-Coolify-Server-UUID speichern. Das Token wird mit
   `SITEOPS_MASTER_KEY` verschlüsselt. Das Speichern ist unabhängig davon,
   ob der externe Coolify-Server momentan erreichbar ist. Über **Verbindung prüfen**
   oder die Server-/Projektliste erfolgt anschließend ein lesender
   `GET /api/v1/projects` und `GET /api/v1/servers`. Eine fehlgeschlagene
   API-Prüfung löscht die gespeicherte Verbindung nicht.
   API-Tokens erscheinen weder in MCP-Antworten noch in Statusabfragen.
4. In Coolify ausreichend Rechenleistung, Container-Storage und Backups
   bereitstellen. Ein eigener Supabase-Stack besteht aus mehreren
   Diensten (PostgreSQL, Auth, REST, Storage, Studio und weiteren
   Komponenten der gewählten Coolify-Vorlage). Jeder Stack benötigt
   eigenen Speicher und eigene Ressourcen.

Nach dem Speichern zeigt der Bereich **Gespeicherte Coolify-Verbindungen** die bestätigten Einträge dauerhaft an; das Formular wird nicht neu geladen oder kommentarlos geleert. Über **Bearbeiten** lassen sich Bezeichnung, URL, Standardserver und bei Bedarf auch das Token aktualisieren. Das Token ist niemals auslesbar; beim Bearbeiten kann das Feld leer bleiben, dann bleibt das bisherige Token verschlüsselt gespeichert. Änderungen werden unabhängig von der API-Erreichbarkeit gespeichert. Ein gesonderter API-Test zeigt Berechtigungs- oder Erreichbarkeitsprobleme an, ohne den gespeicherten Eintrag zu löschen. Bei Speicherfehlern bleiben die eingegebenen Werte im Formular stehen.

Die Einrichtung erfordert keine API-Zugangsdaten im Chat. Auch das Backend
von SiteOps bleibt auf seinem bestehenden Hosting; lediglich die neue
Supabase-Instanz wird auf dem in Coolify registrierten Server installiert.


## Normale Projekte und Git-Anwendungen

SiteOps kann über dieselbe gespeicherte Coolify-Verbindung **normale Coolify-Projekte**
und darin Anwendungen aus Git-Repositories erstellen. Die Oberfläche \`/coolify\` bietet
dafür zwei eigene Formulare und eine Liste bestehender Anwendungen.

- \`coolify_projects_list\`: bestehende Projekte lesen.
- \`coolify_project_create\`: eigenständiges Projekt anhand stabiler \`projectKey\` erstellen.
  Wiederholte Aufrufe verwenden nur eindeutig SiteOps-markierte Projekte.
- \`coolify_apps_list\` / \`coolify_app_info\`: bestehende Git-Anwendungen ohne Secrets auflisten.
- \`coolify_app_create\`: neues Git-Repository mit \`projectUuid\`, \`appKey\`,
  Name, Branch, Buildpack, Port, Zielserver, Umgebung und optional Domain,
  Build-Verzeichnissen sowie Docker-Destination anlegen.
- \`coolify_app_deploy\`: vorhandene App nur auf ausdrücklichen Auftrag deployen.

Die Git-Quellen sind \`public\` (öffentliches HTTPS-Repository),
\`private-deploy-key\` (bestehende private Key-UUID in Coolify) oder
\`private-github-app\` (bestehende GitHub-App-UUID in Coolify).
SiteOps überträgt **keine Git-Zugriffstokens oder privaten Schlüssel**; private
Quellen müssen vorher direkt in Coolify verbunden sein.

Die Kennung ist pro Verbindung + Coolify-Projekt stabil. Vor dem Schreiben prüft
SiteOps auf gleichnamige fremde Ressourcen und eindeutig markierte vorhandene
Apps. Wiederholung mit derselben Konfiguration führt zu keiner Doppelanlage
oder automatischen erneuten Bereitstellung. Ein Konfigurationskonflikt wird
abgelehnt. Ein Deployment wird nur gestartet, wenn \`deployNow=true\` beim
expliziten Erstellen angegeben ist oder \`coolify_app_deploy\` ausdrücklich
aufgerufen wird. \`deployment_requested\` ist kein Healthcheck und bestätigt
keinen erfolgreichen Start. Domainkonflikte werden **niemals erzwungen**.

Die API verwendet die offiziellen Coolify-Endpunkte:
\`POST /api/v1/projects\`,
\`POST /api/v1/applications/public\`,
\`POST /api/v1/applications/private-deploy-key\`,
\`POST /api/v1/applications/private-github-app\`,
\`POST /api/v1/applications/{uuid}/start\`.
Ein projektbezogener \`production\`-Environment-Name muss in Coolify vorhanden sein.

## Eine Instanz pro Projekt

Beispiel:

> Erstelle in Coolify eine eigene Supabase-Instanz für das Projekt
> `kunden-app`.

Ablauf:

1. `coolify_supabase_create` erhält gespeicherte `connectionId`, einen
   **dauerhaft stabilen** `projectKey` (z. B. `kunden-app`), einen Namen
   und optional `siteopsProjectId`, `serverUuid`,
   `destinationUuid`, `coolifyProjectUuid` sowie `environmentName`.
2. SiteOps speichert vor dem ersten externen Aufruf einen eigenen
   DB-Auftrag mit Unique-Key `(connectionId,projectKey)`.
   **Mehrfaches Aufrufen** mit derselben Projektkennung erzeugt keine
   weitere Supabase-Instanz.
3. Ohne vorhandenes `coolifyProjectUuid` wird ein separates Coolify-Projekt
   erstellt. Bestehende, eindeutig von SiteOps markierte Projekte werden
   wiederverwendet; gleichnamige fremde Projekte werden nicht übernommen.
4. SiteOps erstellt über `POST /api/v1/services` den **One-Click-Service**
   vom Typ `supabase` mit `instant_deploy=false` und
   `force_domain_override=false` und startet ihn dann explizit über
   `POST /api/v1/services/{uuid}/start`.
5. Der Status `deployment_requested` bedeutet **nur**, dass Coolify den
   Start entgegengenommen hat. Danach sind auf Coolify die
   Container-Gesundheit, generierten Service-URLs, Domains, TLS und
   Backups zu prüfen. Erst nach Prüfung die Supabase-URL und einen
   passenden öffentlichen Client-Schlüssel in einer Anwendung hinterlegen.
6. Generierte DB-Passwörter, JWT-Secrets und Service-Role-Schlüssel bleiben
   unter Coolifys Verwaltung. SiteOps fragt diese Geheimnisse nicht ab und
   veröffentlicht sie auch nicht über MCP.

Eine SiteOps-Kundenprojekt-ID kann mit der Instanz verbunden werden.
Das automatische Anlegen eines Dienstes erfolgt **nur auf ausdrücklichen
Erstellungsauftrag**; bestehende Websites erhalten nicht automatisch einen
Supabase-Stack.

## Unterbrochene Aufträge

Die SiteOps-Queue arbeitet mit einer DB-Sperre gegen parallele Worker.
Nach einem unklaren Fehler wird der Auftrag `needs_attention` und kann mit
`coolify_supabase_retry` beziehungsweise in der UI erneut angefordert
werden. Vor jedem neuen Remote-POST wird anhand der eindeutig zugeordneten
Ressourcennamen und einer SiteOps-Kennung abgeglichen, ob Coolify das Projekt
oder den Service bereits erstellt hat. Fehlende UUIDs werden in SiteOps
nachgetragen; fremde, gleichnamige Ressourcen werden **nicht** verändert.

Die Integration löscht keine Coolify-Projekte, Datenbanken, Volumes,
bestehenden Container oder Domains.

## Schnittstellen

**Dashboard:** `/coolify`

**Authentifizierte HTTP-API:**
- `GET|POST /api/coolify/connections`
- `PUT /api/coolify/connections/:id` (bestehende Verbindung validiert aktualisieren, Token optional)
- `GET /api/coolify/connections/:id/info`
- `GET /api/coolify/connections/:id/projects`
- `POST /api/coolify/projects`
- `GET /api/coolify/connections/:id/applications`
- `GET /api/coolify/connections/:id/applications/:uuid`
- `POST /api/coolify/applications`
- `POST /api/coolify/applications/:uuid/deploy`
- `GET|POST /api/coolify/supabase`
- `GET /api/coolify/supabase/:id`
- `POST /api/coolify/supabase/:id/retry`

**MCP (OAuth):**
- `coolify_connections`, `coolify_connection_info`
- `coolify_projects_list`, `coolify_project_create`
- `coolify_apps_list`, `coolify_app_info`, `coolify_app_create`, `coolify_app_deploy`
- `coolify_supabase_list`, `coolify_supabase_create`,
  `coolify_supabase_status`, `coolify_supabase_retry`

**Referenzen:** [Coolify API](https://coolify.io/docs/api/overview),
[Service erstellen](https://coolify.io/docs/api/endpoints/services/create-service),
[Supabase in Coolify](https://coolify.io/docs/services/supabase).

## Docker-Compose-Anwendungen mit Variablen

`coolify_app_create` (und das Formular unter `/coolify`) unterstützt für
`buildPack: "dockercompose"` zusätzlich:

- `dockerComposeLocation`: Pfad der Compose-Datei im Repository,
  zum Beispiel `/docker-compose.yml`.
- `dockerComposeDomains`: Domains je Compose-Dienst, etwa
  `[{ "service": "app", "domain": "https://app.example.de:8080" }]`.
  Der Port nennt den Container-Port, an den Coolify weiterleitet.
  Das Feld `domain` ist bei Compose nicht zulässig.
- `environment`: Liste aus `{ key, value, buildTime? }`. SiteOps legt die
  Anwendung ohne Sofort-Deployment an, setzt die Variablen über
  `PATCH /api/v1/applications/{uuid}/envs/bulk` und startet erst danach
  ein angefordertes Deployment. Die Werte werden weder gespeichert noch
  protokolliert noch zurückgegeben; in den Konfigurations-Fingerabdruck
  gehen nur die Variablennamen ein. Bei einem erneuten Aufruf mit gleichem
  `appKey` bleibt die bestehende Anwendung samt Variablen unverändert.
