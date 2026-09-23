# Lorzen SiteOps

Central operations hub for customer websites on SFTP/FTPS/FTP hosts.

## Features

- Hostinger Git Deploy mode: SiteOps writes a single GitHub commit to the deployment branch instead of modifying production files through SFTP
- Supports WordPress, PHP/HTML, static sites and Node.js web apps as website types

- Settings UI for GitHub backup target, new-site defaults and alert delivery
- editable connection credentials and deployment settings with test-before-save
- per-site operations dashboard for monitoring, backup, incidents and audit history
- DNS, redirect-chain, title/content, SSL, response-time and optional WordPress REST monitoring
- incident event timeline with repeated alert escalation and recovery delivery
- expanded MCP toolkit for site overview, configuration, connection testing, file discovery, monitoring, incidents, backups, SEO and safe changes
- built-in OAuth 2.1 authorization server for ChatGPT and Claude remote MCP: PKCE S256, CIMD, DCR, refresh-token rotation and revocation
- SEO crawler with robots.txt/sitemap discovery, technical on-page checks, internal-link graph and crawl depth
- PageRank-style internal page-strength analysis and per-page site-corpus WDF×IDF terms
- optional Google PageSpeed Insights / Lighthouse mobile and desktop audits
- Website Quality Health Score with crawl-to-crawl regression comparison
- duplicate and near-duplicate content detection plus duplicate titles, descriptions and H1s
- broken internal links, redirecting links and bounded broken image/CSS/JS resource checks
- hreflang, Open Graph/Twitter metadata, indexability, sitemap coverage and canonical checks
- static accessibility quick checks and HTTP security-header scoring
- AI crawler visibility overview for GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, PerplexityBot and Google-Extended
- combined Quality Overview via REST/MCP and printable client-facing quality/maintenance report
- cached RDAP domain-expiry monitoring alongside SSL expiry
- per-page SEO detail views for metadata, headings, image-alt issues, link anchors, WDF×IDF and Lighthouse
- in-app MCP setup guide for SiteOps, MCP Inspector, ChatGPT and Claude/API
- Guided website setup with SFTP/FTPS/FTP connection test before saving

- live webspace remains the production source of truth
- private GitHub repository stores a per-site version history under `sites/<slug>/public`
- GitHub Git Data API is used directly; no local Git checkout or SSH deploy key is required
- Hostinger MySQL stores sites, previews, changes, backups, monitor checks and incidents
- two-step `change_preview` → `change_apply`
- live hash conflict detection before writes
- automatic restoration of touched files if a transfer or post-change snapshot fails
- Git pre/post snapshots and human-readable diffs
- rollback is itself a preview before it can be applied
- manual and scheduled full backups per customer project
- restore creates a fresh safety snapshot before applying an older state
- binary-safe backup and rollback handling
- PHP syntax validation runs in Node.js and does not require a PHP CLI
- per-site backup interval, file limit and monitoring settings
- uptime/status/content/SSL/response-time monitoring
- incident + recovery alerts by SMTP and/or generic webhook
- lightweight operations dashboard plus Streamable HTTP MCP endpoint
- customer host credentials encrypted with AES-256-GCM
- optional secured Playwright Browser Runner for scheduled synthetic user journeys
- visual-regression baselines with configurable pixel-difference threshold and failure screenshots
- synthetic checks for navigation, clicks, forms, visibility, URL/title/text assertions and real Chromium rendering
- encrypted per-test secret variables referenced as `{{secret.NAME}}`
- automatic repair prompts for SEO/Quality issues, monitoring incidents and failed browser journeys
- one-click copy workflow for ChatGPT/Claude that instructs the agent to diagnose through SiteOps MCP and create a safe `change_preview` without applying it
- DOWN, backup and synthetic failure alerts automatically include the generated repair prompt
- successful `change_apply` queues enabled browser journeys for post-change validation (10s direct webspace, 120s Hostinger Git deploy)

## Hosting

SiteOps 1.0 is designed for Hostinger Cloud Startup as a managed Node.js/Fastify application deployed directly from this GitHub repository.

The application now uses the MySQL database included with Hostinger Cloud Startup. No Supabase or external PostgreSQL service is required.

The customer snapshot repository must be **private**. SiteOps refuses to write backups to a public repository.

Prefer SFTP for managed customer websites. FTPS exists for legacy hosts; plain FTP should only be used where unavoidable.

See `docs/INSTALL.md` and `docs/MCP.md`.


## MCP OAuth

SiteOps can be connected natively to ChatGPT and Claude without sharing the dashboard password or requiring a third-party identity provider. The MCP endpoint publishes OAuth Protected Resource Metadata and Authorization Server Metadata, supports ChatGPT CIMD and Claude-compatible Dynamic Client Registration, and issues short-lived resource-bound access tokens plus rotating refresh tokens.

The existing `MCP_API_TOKEN` remains an optional compatibility path for older clients. See `docs/MCP.md` and the in-app **MCP & OAuth** page.

## Browser Runner

The main SiteOps application stays lightweight on Hostinger Cloud. Browser automation runs in the optional `runner/` service on a Node.js host that can launch Chromium.

```bash
cd runner
npm install
npx playwright install --with-deps chromium
BROWSER_RUNNER_TOKEN=... npm start
```

Configure its HTTPS URL and the same bearer token under **SiteOps → Einstellungen → Synthetic Runner**. See `runner/README.md`.
