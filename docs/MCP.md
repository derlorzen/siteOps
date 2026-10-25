# SiteOps MCP

Remote endpoint:

```
https://siteops.example.com/mcp
```

## Authentication

SiteOps includes its own OAuth 2.1 authorization server for native ChatGPT and Claude remote-MCP connections.

Primary flow:

- Protected Resource Metadata: `/.well-known/oauth-protected-resource`
- Authorization Server Metadata: `/.well-known/oauth-authorization-server`
- Authorization Code flow with PKCE `S256`
- Client ID Metadata Documents (CIMD) for ChatGPT
- Dynamic Client Registration (DCR) for Claude and compatible MCP clients
- short-lived access tokens
- rotating refresh tokens
- OAuth token revocation

The authorization UI is protected by the existing SiteOps dashboard credentials. ChatGPT and Claude never receive the dashboard password; after consent they use OAuth tokens.

The legacy static bearer remains optional for scripts or older clients:

```
Authorization: Bearer <MCP_API_TOKEN>
```

`MCP_API_TOKEN` is no longer required for SiteOps health when OAuth is used.

SiteOps stores only SHA-256 hashes of OAuth access/refresh tokens and authorization codes. Tokens are resource-bound to the configured MCP URL.

## ChatGPT

1. Open the ChatGPT custom app / MCP creation flow in Developer Mode.
2. Enter the SiteOps MCP URL: `https://siteops.example.com/mcp`.
3. Select OAuth when prompted.
4. ChatGPT discovers SiteOps through the well-known metadata endpoints.
5. With CIMD enabled, ChatGPT uses its HTTPS Client ID Metadata Document as `client_id`.
6. Complete the SiteOps authorization screen using the dashboard login and allow access.
7. ChatGPT exchanges the code using PKCE and receives access + refresh tokens.

SiteOps advertises RFC 9207 issuer identification and returns `iss` on authorization responses.

## Claude

1. Open Claude → Settings → Connectors.
2. Add a custom connector with `https://siteops.example.com/mcp`.
3. Click Connect.
4. Claude can dynamically register its OAuth client through SiteOps DCR.
5. Complete the SiteOps authorization screen.
6. Claude receives access + refresh tokens and can reconnect without storing the dashboard password.

Claude's standard callback `https://claude.ai/api/mcp/auth_callback` is supported.

## OAuth security model

- PKCE `S256` is mandatory.
- Only the canonical MCP resource may be authorized.
- Redirect URIs are validated against DCR/CIMD client metadata.
- CIMD URL clients are restricted to ChatGPT/OpenAI and Claude/Anthropic domains.
- ChatGPT stable and connector-specific callback forms are supported.
- Access tokens expire after one hour by default.
- Refresh tokens expire after 30 days by default and rotate on every use.
- Authorization codes are single-use and expire after 10 minutes by default.
- OAuth sessions can be reviewed and revoked under SiteOps → MCP.
- Existing `change_preview` → `change_apply` controls remain unchanged.

The lifetimes can be adjusted through:

```
OAUTH_ACCESS_TOKEN_TTL_SECONDS=3600
OAUTH_REFRESH_TOKEN_TTL_SECONDS=2592000
OAUTH_CODE_TTL_SECONDS=600
```

## Main tools

### YouTube channel management

The authenticated dashboard handles Google consent. MCP can inspect connected
channels, discover the pinned Data API schema, read resources and prepare exact
changes/private uploads, then execute only after explicit human approval. See
[YouTube setup, permissions and MCP workflow](YOUTUBE.md). No client secret or
Google token is exposed to MCP, and producing a video never implicitly publishes it.

### Video Studio

Project, runner, draft, demo-template, metadata and authenticated-download tools
are documented in [the complete bilingual production workflow](VIDEO_PRODUCTION.md).
Use `video_studio_create_project`, `video_studio_update_project`,
`video_studio_runner_status`, `video_studio_list_jobs` and `video_studio_downloads`
alongside the existing project/draft/render/status tools. English and German are
supported. Rendering requires explicit human approval and `approved:true`.

### Context and operations

- `sites_list`
- `site_get`
- `site_overview`
- `deployment_info`
- `settings_get`

### Monitoring and incidents

- `site_status`
- `monitor_history`
- `incidents_list`
- `incident_get`

### SEO

- `seo_start` – asynchronous crawl with on-page analysis, sitemaps, internal link graph and optional PageSpeed
- `seo_run_status` – crawl progress/result
- `seo_latest` – latest crawl and page metrics
- `seo_page` – full details for one crawled URL
- `seo_graph` – strongest pages and internal link edges
- `seo_issues` – bounded issue list, optionally by severity
- `seo_compare` – compare the two latest completed crawls
- `quality_overview` – combined quality, regression, uptime/incidents and backup state

### Synthetic browser tests

- `synthetics_list`
- `synthetic_create`
- `synthetic_update`
- `synthetic_run`
- `synthetic_run_get`
- `fix_prompt`

Synthetic secrets remain encrypted and are never returned by MCP.

### Connections and configuration

- `server_profiles_list` – list stored FTP/FTPS/SFTP profiles without credentials
- `site_provision` – register a website and create a dedicated empty FTP directory
- `site_update`
- `site_connection_test`
- `site_connection_update`

### Files and discovery

- `files_list`
- `files_find`
- `text_search`
- `file_read`

### Neue Website oder LorzCMS über MCP anlegen

1. Mit `server_profiles_list` einen gespeicherten Server auswählen, alternativ eine vorhandene Webspace-Website aus `sites_list`.
2. Für eine gewöhnliche Website `site_provision` mit `profileId` **oder** `existingSiteId`, `slug`, `name`, `domain`, `siteType` und neuem absolutem `remoteRoot` aufrufen. Optional `projectId` zuordnen. SiteOps legt das Zielverzeichnis rekursiv an, verweigert aber ein nicht leeres Ziel.
3. Mit `change_preview` und anschließend `change_apply` die Website-Dateien hochladen. Damit bleiben bestehende Upload-Sicherungen und die Freigabe der Änderungen erhalten. Erst nach der Veröffentlichung Monitoring und Backups per `site_update` aktivieren.
4. Für LorzCMS zunächst `cms_release_bundled` (falls noch kein Core freigegeben ist), dann `cms_install` mit `profileId` oder `existingSiteId` statt Zugangsdaten aufrufen. HTTPS-Domain, `publicRootReady: true`, Core-Version, Administrator und Datenbank sind weiterhin erforderlich. SiteOps erstellt das leere Verzeichnis und der persistierte CMS-Installationsauftrag lädt den Core und die Startdateien hoch. Fortschritt mit `cms_overview` prüfen.

Mit FTP können weder DNS, SSL, PHP-Version, MySQL-Datenbank noch Document-Root-Einstellungen des Hosting-Anbieters verwaltet werden. Bei LorzCMS muss die Domain bereits auf **remoteRoot/public/** zeigen; bei normalen Websites üblicherweise auf **remoteRoot/**. Serverpasswörter werden nicht über MCP ausgegeben.

### Safe changes

- `change_preview`
- `change_apply`
- `history_list`
- `history_diff`
- `rollback_preview`

Changes remain two-step. A preview is created first; only `change_apply` writes/commits it.

### Backups and restore

- `site_backup`
- `backup_status`
- `backups_list`
- `backup_restore_preview`

## Recommended agent workflow

1. `site_overview`
2. `files_find` / `text_search`
3. `file_read`
4. `change_preview`
5. obtain human approval
6. `change_apply`
7. `site_status`

The interactive OAuth/MCP setup and active connection management are available at `/mcp-info`.
