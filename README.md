# SiteOps

Self-hosted website operations for monitoring, backups, SEO/quality analysis, safe remote changes, MCP automation and real-browser synthetic tests.

SiteOps is intended for people or agencies that manage multiple customer websites across classic SFTP/FTPS hosting and Git-based deployments. It provides one operational dashboard while keeping the live website or deployment repository as the source of truth.

> **Current version:** 1.1.1  
> **License:** PolyForm Noncommercial 1.0.0  
> **Model:** source-available, free for noncommercial use  
> **Runtime:** Node.js 22+ / Fastify / MySQL  
> **Browser automation:** optional separate Playwright/Chromium runner  
> **MCP:** Streamable HTTP with built-in OAuth 2.1 for ChatGPT and Claude

## What SiteOps does

### Website operations

- Manage WordPress, PHP/HTML, static and Node.js websites
- SFTP, FTPS and legacy FTP connections
- Git-based deployment mode for hosts such as Hostinger
- Per-site connection testing before credentials are saved
- AES-256-GCM encrypted stored credentials
- Operational dashboard with a compact Focus view and a classic detail view

### Monitoring and incidents

- HTTP status and response-time monitoring
- redirect-chain checks
- DNS resolution
- SSL expiry monitoring
- RDAP-based domain-expiry lookup
- expected page title/content checks
- optional WordPress REST checks
- configurable failure thresholds
- incident/recovery timeline
- repeated incident alerts
- SMTP and generic webhook notifications
- paginated/filterable monitoring history

### Backups and safe changes

- manual and scheduled full snapshots
- snapshots stored in a separate **private GitHub repository**
- per-site version history below `sites/<slug>/public`
- binary-safe backup handling
- two-step `change_preview` → `change_apply`
- hash conflict detection before writes
- automatic recovery when a write/post-change snapshot fails
- rollback preview before rollback execution
- safety snapshot before restore
- human-readable history and diffs

### SEO and website quality

- robots.txt and sitemap discovery
- bounded internal crawler
- technical on-page checks
- duplicate titles, descriptions and H1s
- duplicate and near-duplicate content detection
- broken internal links
- redirecting internal links
- broken image/CSS/JS resource checks
- canonical and indexability checks
- sitemap coverage
- hreflang
- Open Graph / Twitter metadata
- internal link graph and PageRank-style relative strength
- WDF×IDF relative to the crawled site corpus
- static accessibility quick checks
- HTTP security-header scoring
- AI crawler visibility checks
- optional Google PageSpeed Insights / Lighthouse
- crawl-to-crawl regression comparison
- client-facing quality/maintenance report
- filterable and paginated SEO, link and WDF×IDF tables

### MCP and AI integration

SiteOps exposes a Streamable HTTP MCP endpoint and includes its own OAuth 2.1 authorization server.

Supported authentication features:

- OAuth Protected Resource Metadata
- Authorization Server Metadata
- Authorization Code flow
- mandatory PKCE S256
- ChatGPT Client ID Metadata Documents (CIMD)
- Dynamic Client Registration (DCR) for Claude and compatible clients
- short-lived opaque access tokens
- rotating refresh tokens
- token revocation
- optional legacy static Bearer token

The MCP toolset includes website context, monitoring, incidents, file discovery, SEO, backups, deployment information, synthetic tests and safe change previews.

### Browser / synthetic tests

An optional separate Browser Runner executes real Chromium journeys using Playwright.

It supports:

- navigation
- clicks
- form filling
- select/checkbox interactions
- URL/title/text assertions
- visibility/value/attribute/count assertions
- console and page-error capture
- failed network-request capture
- HTTP 4xx/5xx capture
- screenshots
- visual-regression baselines
- encrypted journey secrets
- scheduled journeys
- automatic post-change validation

The Browser Runner is deliberately separated from the main SiteOps process so the main application can run on lightweight managed Node.js hosting.

---

# Architecture

```text
                         ┌──────────────────────┐
                         │      ChatGPT         │
                         │       Claude         │
                         └──────────┬───────────┘
                                    │ MCP + OAuth
                                    ▼
┌──────────────┐          ┌──────────────────────┐
│ Web browser  │─────────▶│       SiteOps        │
│ Dashboard    │  HTTPS   │ Node.js / Fastify    │
└──────────────┘          │                      │
                          │  Monitoring          │
                          │  SEO / Quality       │
                          │  Backups             │
                          │  Safe Changes        │
                          │  MCP / OAuth         │
                          └───────┬───────┬──────┘
                                  │       │
                          MySQL   │       │ HTTPS
                                  ▼       ▼
                         ┌────────────┐  ┌─────────────────┐
                         │   MySQL    │  │ Browser Runner  │
                         │ database   │  │ Playwright      │
                         └────────────┘  │ Chromium        │
                                         └────────┬────────┘
                                                  │
                                                  ▼
                                           managed websites

SiteOps also talks directly to:
- customer webspaces over SFTP / FTPS / FTP
- GitHub repositories over the GitHub HTTPS API
- public website/DNS/SSL/RDAP endpoints
- optional Google PageSpeed Insights API
```

---

# Requirements

## Main application

Required:

- Node.js **22 or newer**
- npm
- MySQL database
- a public HTTPS URL for production
- outbound HTTPS access

Recommended:

- MySQL 8.x
- reverse proxy or managed hosting with TLS
- a dedicated private GitHub repository for snapshots

Not required for the main application:

- Docker
- PHP CLI
- Git CLI
- PostgreSQL
- persistent local application storage
- Chromium

## Optional Browser Runner

Recommended:

- Linux VPS, preferably Ubuntu/Debian
- Node.js 22+
- npm
- Git
- root/sudo access
- public HTTPS hostname for the runner

---

# Quick start

## 1. Clone the repository

```bash
git clone https://github.com/YOUR-ORG/siteOps.git
cd siteOps
npm install
```

## 2. Create a MySQL database

Create an empty MySQL database and user.

Example:

```sql
CREATE DATABASE siteops CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'siteops'@'%' IDENTIFIED BY 'CHANGE_ME';
GRANT ALL PRIVILEGES ON siteops.* TO 'siteops'@'%';
FLUSH PRIVILEGES;
```

Use the host/user rules appropriate for your MySQL installation. On managed hosting the database provider normally gives you these values.

SiteOps creates and updates its tables automatically at startup.

## 3. Generate the master encryption key

```bash
openssl rand -base64 32
```

Store this value as `SITEOPS_MASTER_KEY`.

> **Important:** keep this key permanently. Changing or losing it makes previously encrypted website credentials, SMTP passwords, runner tokens and synthetic-test secrets unreadable.

## 4. Configure environment variables

Use `.env.example` as the reference.

Minimum production configuration:

```bash
HOST=0.0.0.0
PUBLIC_BASE_URL=https://siteops.example.com

DB_HOST=localhost
DB_PORT=3306
DB_USER=siteops
DB_PASSWORD=CHANGE_ME
DB_NAME=siteops

SITEOPS_MASTER_KEY=BASE64_32_BYTE_KEY
DASHBOARD_USER=admin
DASHBOARD_PASSWORD=CHANGE_ME_LONG_RANDOM_PASSWORD
```

You can use a single database URL instead:

```bash
DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/DATABASE
```

If `DATABASE_URL` is present, it takes precedence over the separate `DB_*` variables.

### Important: `.env` is not loaded automatically

SiteOps intentionally reads environment variables from the process environment and does not include a dotenv loader.

On managed hosting, enter the variables in the hosting control panel.

For a local shell you can do:

```bash
cp .env.example .env
# edit .env first

set -a
source .env
set +a

npm start
```

Do **not** commit your real `.env` file. It is already ignored by `.gitignore`.

## 5. Start SiteOps

```bash
npm start
```

Default local URL:

```text
http://localhost:3000
```

Health endpoint:

```text
http://localhost:3000/health
```

For production, set `PUBLIC_BASE_URL` to the exact public HTTPS origin, for example:

```text
https://siteops.example.com
```

The OAuth issuer and MCP resource URLs are derived from this value, so it must be correct.

---

# Environment variables

## Core

| Variable | Required | Purpose |
|---|---:|---|
| `HOST` | no | Bind address, default `0.0.0.0` |
| `PORT` | usually no | HTTP port; managed hosting often supplies it |
| `PUBLIC_BASE_URL` | production: yes | Public SiteOps origin used for OAuth/MCP links |
| `SITEOPS_MASTER_KEY` | yes | Base64-encoded 32-byte key used for secret encryption |
| `DASHBOARD_USER` | yes | Dashboard / OAuth approval username |
| `DASHBOARD_PASSWORD` | yes | Dashboard / OAuth approval password |
| `MCP_API_TOKEN` | no | Legacy static Bearer token for older MCP clients |

## Database

| Variable | Required | Purpose |
|---|---:|---|
| `DATABASE_URL` | alternative | Full MySQL connection string |
| `DB_HOST` | yes without DATABASE_URL | MySQL hostname |
| `DB_PORT` | no | Default `3306` |
| `DB_USER` | yes without DATABASE_URL | MySQL user |
| `DB_PASSWORD` | yes without DATABASE_URL | MySQL password |
| `DB_NAME` | yes without DATABASE_URL | MySQL database |

## Backup repository

| Variable | Required | Purpose |
|---|---:|---|
| `GITHUB_BACKUP_REPO` | for backups | `owner/repository` of the private snapshot repository |
| `GITHUB_BACKUP_TOKEN` | for backups | GitHub PAT with repository Contents read/write |
| `BACKUP_REPO_BRANCH` | no | Default `main` |
| `BACKUP_MAX_FILE_BYTES` | no | Default 50 MiB per file |

## Default site settings

- `DEFAULT_BACKUP_INTERVAL_SECONDS`
- `DEFAULT_BACKUP_MAX_FILES`
- `DEFAULT_MONITOR_INTERVAL_SECONDS`
- `DEFAULT_MONITOR_FAILURE_THRESHOLD`
- `DEFAULT_SSL_WARN_DAYS`

## Alerts

- `ALERT_EMAIL_TO`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `SMTP_FROM`
- `ALERT_WEBHOOK_URL`

## SEO / Lighthouse

- `SEO_MAX_PAGES`
- `PAGESPEED_API_KEY`
- `SEO_USER_AGENT`

The normal SiteOps SEO crawler does **not** require a PageSpeed API key.

## OAuth

Defaults:

```bash
OAUTH_ACCESS_TOKEN_TTL_SECONDS=3600
OAUTH_REFRESH_TOKEN_TTL_SECONDS=2592000
OAUTH_CODE_TTL_SECONDS=600
```

## Browser Runner

The URL/token can be configured either through environment variables or from the SiteOps settings UI:

```bash
BROWSER_RUNNER_URL=
BROWSER_RUNNER_TOKEN=
SYNTHETIC_WORKER_INTERVAL_MS=60000
```

---

# Deploying the main application

SiteOps is a normal Node.js/Fastify application. It can run on a VPS, PaaS or managed Node.js hosting.

Production requirements:

1. Node.js 22+
2. MySQL
3. environment variables
4. persistent HTTPS hostname
5. `npm install`
6. start command `npm start`

The application does not need local persistent files. Operational state is stored in MySQL and backup snapshots are stored in GitHub.

## Hostinger Cloud / Web App example

One supported setup is Hostinger's managed Node.js deployment:

1. create a MySQL database in hPanel
2. create/import the SiteOps GitHub repository as a Web App
3. select Node.js 22
4. use `app.mjs` if an entry file is requested
5. no build step is required
6. start command: `npm start`
7. add the required environment variables
8. set `PUBLIC_BASE_URL` to the final HTTPS URL
9. deploy

The database schema is created/migrated automatically during startup.

More detail is available in [docs/INSTALL.md](docs/INSTALL.md).

---

# First login

Open your SiteOps URL and authenticate using:

- username: `DASHBOARD_USER`
- password: `DASHBOARD_PASSWORD`

Then open **Settings**.

Recommended initial order:

1. configure the private GitHub backup repository
2. test the GitHub connection
3. configure alert delivery
4. optionally configure Google PageSpeed
5. optionally configure the Browser Runner
6. add the first website

---

# GitHub backup repository

The source-code repository for SiteOps itself can be public.

The **snapshot/backup repository must be private**.

Create a separate repository, for example:

```text
your-org/siteops-backups
```

It may start completely empty.

Create a fine-grained GitHub PAT with access only to that repository:

- Metadata: Read
- Contents: Read and write

Configure:

```bash
GITHUB_BACKUP_REPO=your-org/siteops-backups
GITHUB_BACKUP_TOKEN=github_pat_...
BACKUP_REPO_BRANCH=main
```

Or enter the same values under **SiteOps → Settings → GitHub**.

SiteOps refuses to use a public repository as its backup target.

Snapshots are stored as:

```text
sites/
└── customer-site/
    ├── .siteops.json
    └── public/
        └── ...
```

Never use the public SiteOps source repository as the customer backup repository.

---

# Adding websites

SiteOps supports two deployment/source modes.

## 1. Direct webspace

For classic hosting where the live files are the source of truth.

Supported protocols:

- SFTP — recommended
- FTPS — legacy option
- FTP — only if unavoidable

SiteOps can:

- inspect files
- create backups
- search/read source
- preview changes
- apply approved changes
- monitor the public website

Credentials are encrypted before being stored in MySQL.

## 2. Git deployment

For websites where a Git repository is the source of truth and the hosting provider deploys from it.

SiteOps writes approved changes to the configured GitHub repository/branch instead of modifying production files directly.

Per-site Git credentials should use a fine-grained PAT restricted to that source repository with:

- Metadata: Read
- Contents: Read and write

The hosting platform remains responsible for deploying the commit.

---

# Monitoring

Per website you can configure:

- enabled/disabled state
- monitor URL
- expected HTTP status
- interval
- timeout
- expected title
- expected content
- DNS checks
- optional WordPress REST check
- response-time warning threshold
- failure threshold before an incident is opened
- SSL warning threshold
- repeated alert interval

SiteOps stores monitor history and creates incident timelines when checks repeatedly fail.

Alerts can go to:

- SMTP email
- generic webhook
- both

---

# SEO / Quality Suite

Open a website and choose **Quality / SEO**.

A crawl can inspect up to the configured maximum number of pages and includes:

- status codes
- crawl depth
- page titles and descriptions
- headings
- canonicals
- robots/indexability
- sitemaps
- link graph
- internal/external links
- broken resources
- duplicate content
- WDF×IDF
- accessibility indicators
- security headers
- social metadata
- hreflang
- AI crawler declarations

Optional PageSpeed/Lighthouse requires `PAGESPEED_API_KEY`.

The WDF×IDF implementation is calculated against the crawled website corpus. It is an internal content-analysis signal, not a competitor/SERP corpus.

---

# Browser Runner setup

The Browser Runner is optional but required for real Chromium journeys and visual regression.

It runs **separately** from the main SiteOps application.

## Why separate?

Many managed Node.js hosts are not intended to launch a persistent Chromium process. Keeping Playwright on a small VPS makes the main SiteOps installation lightweight while still allowing real browser tests.

## Recommended installation: Linux + systemd

### 1. Prepare the VPS

Recommended:

- Ubuntu/Debian
- Node.js 22+
- npm
- Git
- sudo/root

Check:

```bash
node -v
npm -v
git --version
```

### 2. Clone SiteOps on the VPS

```bash
cd /opt
sudo git clone https://github.com/YOUR-ORG/siteOps.git siteops-source
cd /opt/siteops-source
```

### 3. Run the included installer

```bash
sudo bash runner/install-systemd.sh
```

The installer:

- creates a restricted `siteops-runner` system user
- copies the runner to `/opt/siteops-browser-runner`
- installs runner dependencies
- installs Playwright Chromium and required OS packages
- creates `/etc/siteops-browser-runner.env`
- generates a random `BROWSER_RUNNER_TOKEN` if no env file exists
- installs `siteops-browser-runner.service`
- enables and starts the service

**Save the generated token.**

The default service listens only on:

```text
127.0.0.1:3200
```

### 4. Verify the runner locally

```bash
sudo systemctl status siteops-browser-runner
curl http://127.0.0.1:3200/health
```

Logs:

```bash
sudo journalctl -u siteops-browser-runner -f
```

Restart:

```bash
sudo systemctl restart siteops-browser-runner
```

### 5. Publish it through HTTPS

Use a dedicated hostname, for example:

```text
browser.example.com
```

Point DNS to the VPS and reverse-proxy HTTPS traffic to:

```text
http://127.0.0.1:3200
```

An Nginx example is included:

[runner/nginx-siteops-browser-runner.conf.example](runner/nginx-siteops-browser-runner.conf.example)

Do not expose port 3200 directly to the public internet.

### 6. Connect the runner to SiteOps

Open:

**SiteOps → Settings → Synthetic Runner**

Enter:

```text
Browser Runner URL:
https://browser.example.com

Runner Bearer Token:
<token generated by install-systemd.sh>
```

Save the settings and click **Browser Runner testen**.

A successful test confirms both network reachability and token authentication.

### 7. Create the first synthetic journey

Open a managed website and select **Browser Tests**.

Start with a small journey such as:

1. load the homepage
2. assert the title
3. click an important navigation element
4. assert expected text/URL

Run it manually first. Once it is stable, enable scheduling and optionally create a visual baseline.

### Updating the Browser Runner

```bash
cd /opt/siteops-source
sudo git pull
sudo bash runner/install-systemd.sh
```

The installer keeps an existing `/etc/siteops-browser-runner.env`, so the token is preserved unless you intentionally replace it.

More runner-specific details are in [runner/README.md](runner/README.md).

---

# MCP setup

SiteOps exposes:

```text
https://siteops.example.com/mcp
```

The exact URL is always:

```text
<PUBLIC_BASE_URL>/mcp
```

OAuth discovery endpoints are published automatically.

## ChatGPT

In a ChatGPT custom MCP/app flow:

1. enter `<PUBLIC_BASE_URL>/mcp`
2. use OAuth
3. allow ChatGPT to discover the SiteOps OAuth metadata
4. authenticate to the SiteOps approval page with the dashboard credentials
5. approve access
6. scan/use the MCP tools

SiteOps supports ChatGPT CIMD and PKCE S256.

## Claude

In Claude:

1. open Settings → Connectors
2. add a custom connector
3. enter `<PUBLIC_BASE_URL>/mcp`
4. connect
5. authenticate on the SiteOps approval page
6. approve access

SiteOps supports Dynamic Client Registration and rotating refresh tokens.

Active OAuth clients can be viewed/revoked under **SiteOps → MCP & OAuth**.

See [docs/MCP.md](docs/MCP.md) for implementation details and the MCP tool list.

---

# Safe AI-assisted changes

SiteOps is designed so an AI client can inspect and prepare changes without immediately writing them.

Recommended flow:

```text
site_overview
      ↓
files_find / text_search
      ↓
file_read
      ↓
change_preview
      ↓
human review / approval
      ↓
change_apply
      ↓
site_status / synthetic_run
```

This safety model is independent of OAuth. OAuth grants access to the MCP server; it does not bypass the preview/apply workflow.

---

# Security model

Important safeguards:

- website credentials are encrypted with AES-256-GCM
- the master encryption key stays outside the repository
- OAuth authorization codes and tokens are stored as SHA-256 hashes
- OAuth uses PKCE S256
- refresh tokens rotate
- OAuth access is resource-bound to the MCP endpoint
- backup repositories must be private
- GitHub tokens should be fine-grained and repository-scoped
- Browser Runner requests require a Bearer token
- Browser Runner navigation is restricted to the configured target hostname
- the runner does not execute arbitrary JavaScript/eval steps
- the runner should bind to localhost and be exposed only through HTTPS
- change application remains a two-step preview/apply process
- secrets are never returned through normal settings or MCP responses

## Never commit

Do not commit:

- `.env`
- `SITEOPS_MASTER_KEY`
- database passwords
- GitHub PATs
- SMTP passwords
- Browser Runner tokens
- SFTP/FTP credentials
- private keys
- customer snapshot data

The repository's `.gitignore` already excludes `.env`, logs, `node_modules` and local workspaces.

---

# Updating SiteOps

## Main application

If your hosting platform deploys from Git:

1. pull/merge the new SiteOps version
2. redeploy/restart the Node.js app

Database migrations run automatically at startup.

For a manual installation:

```bash
git pull
npm install
npm run check
npm start
```

Keep the existing:

- database
- `SITEOPS_MASTER_KEY`
- dashboard credentials
- backup repository configuration

## Browser Runner

```bash
cd /opt/siteops-source
sudo git pull
sudo bash runner/install-systemd.sh
```

---

# Validation and CI

Local syntax/runtime checks:

```bash
npm run check
npm run check:runtime
```

Runner syntax check:

```bash
cd runner
npm install
npm run check
```

The repository includes GitHub Actions for:

- main SiteOps validation
- runtime import checks
- Browser Runner dependency/import checks
- real Chromium smoke testing

---

# Troubleshooting

## `/health` reports degraded

Check the `missingConfig` array in the response.

The most common missing values are:

- `SITEOPS_MASTER_KEY`
- `DASHBOARD_USER`
- `DASHBOARD_PASSWORD`
- database configuration

## Database connection fails

Verify:

- hostname
- port
- database name
- user/password
- whether the provider allows connections from the application host

If `DATABASE_URL` is set, remember that it overrides the separate `DB_*` values.

## OAuth connection opens the wrong domain

Check `PUBLIC_BASE_URL`.

It must exactly match the public HTTPS origin of SiteOps. After changing it, restart/redeploy SiteOps and reconnect the MCP client.

## ChatGPT or Claude cannot discover OAuth

Verify these URLs publicly:

```text
<PUBLIC_BASE_URL>/.well-known/oauth-protected-resource
<PUBLIC_BASE_URL>/.well-known/oauth-protected-resource/mcp
<PUBLIC_BASE_URL>/.well-known/oauth-authorization-server
```

## Browser Runner test fails

On the VPS:

```bash
sudo systemctl status siteops-browser-runner
sudo journalctl -u siteops-browser-runner -n 100 --no-pager
curl http://127.0.0.1:3200/health
```

Then verify:

- public runner hostname resolves to the VPS
- HTTPS certificate is valid
- reverse proxy points to `127.0.0.1:3200`
- SiteOps has the same Bearer token as `/etc/siteops-browser-runner.env`

## GitHub backup test fails

Verify that the PAT:

- has access to the exact backup repository
- has Contents read/write
- points to a **private** repository

## A website change is rejected because the source changed

SiteOps uses live/source hashes to detect conflicting edits. Create a fresh preview from the current source instead of forcing an old preview.

---

# Repository structure

```text
.
├── app.mjs
├── schema.sql
├── migrations/
│   ├── 0001_init.sql
│   ├── 0002_deployment_and_extra_columns.mjs
│   └── README.md
├── package.json
├── .env.example
├── public/
│   └── app.css
├── docs/
│   ├── INSTALL.md
│   └── MCP.md
├── runner/
│   ├── server.mjs
│   ├── package.json
│   ├── install-systemd.sh
│   ├── siteops-browser-runner.service
│   ├── siteops-browser-runner.env.example
│   ├── nginx-siteops-browser-runner.conf.example
│   └── README.md
└── .github/
    └── workflows/
```

---

# Public repository checklist

The SiteOps source repository can be public.

Before publishing a fork or deployment configuration, verify:

- [ ] no real `.env` file is committed
- [ ] no database credentials are committed
- [ ] no GitHub PAT is committed
- [ ] no Browser Runner token is committed
- [ ] no customer SFTP credentials are committed
- [ ] no private key is committed
- [ ] the snapshot repository is separate and private
- [ ] `PUBLIC_BASE_URL` is configured through the deployment environment
- [ ] `SITEOPS_MASTER_KEY` exists only in the deployment secret/environment store

The example configuration in this repository intentionally contains placeholders only.

---

# Additional documentation

- [Installation notes](docs/INSTALL.md)
- [MCP and OAuth](docs/MCP.md)
- [Browser Runner](runner/README.md)

---

# License

**SiteOps 1.1.1 and later are licensed under the PolyForm Noncommercial License 1.0.0.** See [LICENSE](LICENSE).

You may use, study, modify and redistribute SiteOps for **noncommercial purposes** under the terms of that license. Commercial use is not granted. In particular, the current SiteOps source must not be sold, offered as a paid hosted service, used as part of a commercial product/service, or otherwise used for an anticipated commercial application unless the copyright holder separately grants permission.

This repository is therefore **source-available**, not OSI Open Source. The Open Source Definition requires licenses to allow commercial fields of endeavor.

## Commercial licensing

The public license does **not** grant commercial-use rights.

If you want to use SiteOps commercially — for example as part of a paid service, hosted/SaaS offering, commercial product, agency platform or other revenue-generating activity — you need a separate commercial license from the copyright holder.

Commercial licenses, partnerships and custom licensing terms can be arranged directly with the copyright holder. The copyright holder may also operate SiteOps commercially and may grant different license terms to individual customers or partners.

This is a dual-licensing model:

- **Public license:** PolyForm Noncommercial 1.0.0 for noncommercial use.
- **Commercial license:** separate permission from the copyright holder for commercial use.

## License history

SiteOps 1.1.0 was previously published under **AGPL-3.0-only**. Rights already granted for that historical version remain governed by its license. The noncommercial terms apply to SiteOps 1.1.1 and subsequent versions released under the current [LICENSE](LICENSE).
