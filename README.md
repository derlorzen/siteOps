# Lorzen SiteOps

Central operations and Site Intelligence hub for customer websites on SFTP/FTPS/FTP or Git-based Hostinger deployments.

## SiteOps 0.9

SiteOps combines website operations, safe changes, monitoring, Git-backed backups and a technical SEO / Site Intelligence suite in one dashboard and one MCP server.

### Operations

- Hostinger Git Deploy mode: SiteOps writes one GitHub commit to the configured deployment branch instead of modifying production files through SFTP
- WordPress, PHP/HTML, static sites and Node.js web apps
- editable connection credentials and deployment settings with test-before-save
- live webspace or configured Git repository remains the source of truth
- two-step `change_preview` → `change_apply`
- live hash conflict detection before writes
- automatic restoration of touched files if transfer or post-change snapshots fail
- Git pre/post snapshots, human-readable diffs and rollback previews
- manual and scheduled full backups per customer project
- restore creates a fresh safety snapshot before an older state can be applied
- binary-safe backup and rollback handling
- private GitHub snapshot repository under `sites/<slug>/public`
- GitHub Git Data API; no local Git checkout or deploy key required

### Monitoring & incidents

- uptime, HTTP status, redirect chain and response-time monitoring
- SSL expiry, DNS, expected title/content and optional WordPress REST checks
- incident timeline, repeated alert escalation and recovery notifications
- SMTP and generic webhook alert delivery
- domain/DNS/mail hygiene checks, including A/AAAA, MX, SPF, DMARC, CAA and nameservers
- RDAP-based domain expiry visibility
- HTTP security-header baseline and cookie flag inspection
- technology fingerprinting

### SEO Suite

- crawler using internal links, robots.txt and XML sitemaps
- crawl-depth and orphan-page discovery
- indexability, canonical and robots/X-Robots analysis
- title, meta description, H1/H2 and heading hierarchy checks
- duplicate titles, descriptions, H1s and content fingerprints
- internal PageRank-style page-strength graph
- per-page site-corpus WDF×IDF
- image alt, dimensions and lazy-loading checks
- mobile viewport and html language checks
- hreflang validation
- Open Graph and Twitter/X Card checks
- JSON-LD discovery and syntax validation
- mixed-content, HTML-size and response-time checks
- internal and external Link Health with HTTP status, redirect and response-time data
- optional Google PageSpeed Insights / Lighthouse mobile and desktop audits
- SEO Health Score, category scores, prioritized remediation recommendations and audit-to-audit comparison

### AI Search / GEO

- robots.txt accessibility checks for OAI-SearchBot, Claude-SearchBot and PerplexityBot
- separate visibility of training/grounding controls for GPTBot, ClaudeBot and Google-Extended
- llms.txt discovery without treating it as a Google ranking factor
- AI Search score kept separate from training opt-in/opt-out choices

### Reporting & MCP

- printable client report combining uptime, incidents, backups, changes, SEO health and Site Intelligence
- per-site Site Intelligence dashboard
- Streamable HTTP MCP endpoint with Bearer authentication
- MCP tools for operations, monitoring, files, safe changes, backups, SEO, Link Health, Site Intelligence and client-report data
- in-app MCP setup guide for MCP Inspector, ChatGPT and Claude/API

## Hosting

SiteOps 0.9 is designed for Hostinger Cloud Startup as a managed Node.js/Fastify application deployed directly from this GitHub repository.

It uses the MySQL database included with Hostinger Cloud Startup. No Supabase, PostgreSQL, VPS, Docker or persistent application filesystem is required.

The customer snapshot repository must be **private**. SiteOps refuses to write backups to a public repository.

Prefer SFTP for classic managed customer websites. FTPS exists for legacy hosts; plain FTP should only be used where unavoidable.

See `docs/INSTALL.md` and `docs/MCP.md`.
