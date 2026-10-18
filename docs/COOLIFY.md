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
   Standard-Coolify-Server-UUID speichern. Der Server prüft zuerst lesend
   `GET /api/v1/projects`; nur danach speichert SiteOps das Token mit
   `SITEOPS_MASTER_KEY` verschlüsselt. API-Tokens erscheinen weder in
   MCP-Antworten noch in Statusabfragen.
4. In Coolify ausreichend Rechenleistung, Container-Storage und Backups
   bereitstellen. Ein eigener Supabase-Stack besteht aus mehreren
   Diensten (PostgreSQL, Auth, REST, Storage, Studio und weiteren
   Komponenten der gewählten Coolify-Vorlage). Jeder Stack benötigt
   eigenen Speicher und eigene Ressourcen.

Die Einrichtung erfordert keine API-Zugangsdaten im Chat. Auch das Backend
von SiteOps bleibt auf seinem bestehenden Hosting; lediglich die neue
Supabase-Instanz wird auf dem in Coolify registrierten Server installiert.

## Eine Instanz pro Projekt

Beispiel:

> Erstelle in Coolify eine eigene Supabase-Instanz für das Projekt
> `kunden-app`.

Ablauf:

1. `coolify_supabase_create` erhält gespeicherte `connectionId`, einen
   **dauerhaft stabilen** `projectKey` (z. B. `kunden-app`), einen Namen
   und optional `siteopsProjectId`, `serverUuid`,
   `coolifyProjectUuid` sowie `environmentName`.
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
- `GET /api/coolify/connections/:id/info`
- `GET|POST /api/coolify/supabase`
- `GET /api/coolify/supabase/:id`
- `POST /api/coolify/supabase/:id/retry`

**MCP (OAuth):**
- `coolify_connections`, `coolify_connection_info`
- `coolify_supabase_list`, `coolify_supabase_create`,
  `coolify_supabase_status`, `coolify_supabase_retry`

**Referenzen:** [Coolify API](https://coolify.io/docs/api/overview),
[Service erstellen](https://coolify.io/docs/api/endpoints/services/create-service),
[Supabase in Coolify](https://coolify.io/docs/services/supabase).
