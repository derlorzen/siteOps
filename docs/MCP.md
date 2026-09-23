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
- `fleet_overview` – cross-customer uptime, incident, backup, SEO and Site Intelligence overview
- `deployment_info`
- `settings_get`

### Monitoring and incidents

- `site_status`
- `monitor_history`
- `incidents_list`
- `incident_get`

### SEO & Site Intelligence

- `seo_start` – asynchronous full crawl with technical SEO, indexability, duplicates, Link Health, internal graph, recommendations and optional PageSpeed
- `seo_run_status` – crawl progress/result
- `seo_latest` – latest crawl and page metrics
- `seo_page` – full details for one crawled URL, including stored signals and outgoing-link status
- `seo_graph` – strongest pages and internal link edges
- `seo_issues` – bounded issue list, optionally by severity
- `seo_recommendations` – prioritized issue groups with affected URLs and remediation text
- `seo_compare` – compare the latest two completed audits
- `link_health` – broken/redirected internal and external links
- `site_intelligence` – live security, DNS/domain, technology and AI-search crawler audit
- `site_intelligence_latest` – latest stored Site Intelligence result
- `client_report_data` – client-ready operations/SEO/intelligence dataset

### WordPress fleet

- `wordpress_inventory` – read-only Core/Plugin/Theme/MU-Plugin inventory from the configured source of truth, including safe wp-config flags and WordPress.org version matching
- `wordpress_update_plan` – read-only list of available Core/Plugin/Theme updates; SiteOps 0.9 does not auto-apply these updates

The WDF×IDF values are calculated against the corpus of the crawled website. They are useful for internal content analysis but are not a competitor SERP corpus.

AI Search scoring covers search/discovery crawler accessibility. Training choices such as GPTBot, ClaudeBot or Google-Extended are reported separately and are not treated as a quality failure simply because a site owner opts out.

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

For SEO / Site Intelligence:

1. `seo_start`
2. poll `seo_run_status`
3. `seo_recommendations` and `seo_compare`
4. inspect important URLs with `seo_page`
5. use `seo_graph` and `link_health` for architecture and link integrity
6. use `site_intelligence_latest` for Security, DNS/domain and AI-search visibility

## Client notes

SiteOps currently uses static Bearer authentication. MCP clients and API integrations that support a Bearer/authorization token can use it directly.

Native web connector experiences increasingly use OAuth. If a specific ChatGPT or Claude connector UI requires OAuth and does not provide a static Bearer option, SiteOps will need an OAuth authorization layer for that native connection. Do not make the MCP endpoint unauthenticated as a workaround.
