# SiteOps MCP

Remote endpoint:

```
https://siteops.lorzen.cloud/mcp
```

Current authentication:

```
Authorization: Bearer <MCP_API_TOKEN>
```

The interactive setup guide is available in SiteOps at `/mcp-info`.

SiteOps never returns stored passwords, private keys, GitHub PATs, PageSpeed API keys, SMTP passwords or the master key. Secret-bearing update tools accept replacement secrets but responses remain redacted.

## Initial setup

1. Set `MCP_API_TOKEN` as a long random Hostinger environment variable.
2. Keep `PUBLIC_BASE_URL=https://siteops.lorzen.cloud`.
3. Redeploy SiteOps.
4. Verify `/health` no longer lists `MCP_API_TOKEN` in `missingConfig`.
5. Test the remote server with MCP Inspector using Streamable HTTP and an `Authorization: Bearer ...` header.

## Main tools

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
- `seo_compare` – compare the two latest completed crawls: Health Score delta, new/resolved issues, changed/new/removed pages
- `quality_overview` – combined SEO quality, regression, uptime/incidents and backup state

The WDF×IDF values are calculated against the corpus of the crawled website. They are useful for internal content analysis but are not a competitor SERP corpus.

The Quality Suite additionally checks duplicate/near-duplicate content, broken internal links/resources, redirecting links, canonicals, sitemap coverage, hreflang, social metadata, static accessibility signals, security headers and AI crawler access declared in robots.txt. These checks are technical diagnostics; they do not claim search-engine ranking outcomes.

### Connections and configuration

- `site_update`
- `site_connection_test`
- `site_connection_update`

### Files and discovery

- `files_list`
- `files_find`
- `text_search`
- `file_read`

For Hostinger Git deployments, the current source of truth is the configured GitHub repository. For classic sites it is the configured live webspace.

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

The backup repository is automatically initialized on the first backup even when the GitHub repository is completely empty.

## Recommended agent workflow

1. `site_overview`
2. `files_find` / `text_search`
3. `file_read`
4. `change_preview`
5. obtain human approval
6. `change_apply`
7. `site_status`

For SEO:

1. `seo_start`
2. poll `seo_run_status`
3. `seo_latest`
4. inspect important URLs with `seo_page`
5. use `seo_graph` and `seo_issues` for structure and priorities

## Client notes

SiteOps currently uses static Bearer authentication. MCP clients and API integrations that support a Bearer/authorization token can use it directly.

Native web connector experiences increasingly use OAuth. If a specific ChatGPT or Claude connector UI requires OAuth and does not provide a static Bearer option, SiteOps will need an OAuth authorization layer for that native connection. Do not make the MCP endpoint unauthenticated as a workaround.
