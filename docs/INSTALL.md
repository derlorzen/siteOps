# Deploy SiteOps

SiteOps 1.1 is a Node.js/Fastify application backed by MySQL. It can run on any Node.js 22+ hosting environment with outbound HTTPS access and a MySQL database. Hostinger Cloud is one supported deployment target, but it is not required.

The main application does not require Docker, systemd, PostgreSQL, a local Git binary, a PHP binary or persistent application storage. The optional Chromium Browser Runner is a separate service and is documented below.

## 1. Create the Hostinger MySQL database

In hPanel:

1. Open **Websites → Dashboard → Databases → Management** for the SiteOps website.
2. Create a database, for example `siteops`.
3. Create/assign a database user and a strong password.
4. Note the database name, username and host. For a Node.js app and database on the same Hostinger hosting plan, the database host is normally `localhost`.
5. Add the values to the Node.js application's environment variables:

```
DB_HOST=localhost
DB_PORT=3306
DB_USER=<hostinger database user>
DB_PASSWORD=<hostinger database password>
DB_NAME=<hostinger database name>
```

SiteOps automatically creates its tables on application startup.

A single connection string is also supported:

```
DATABASE_URL=mysql://USER:PASSWORD@localhost:3306/DATABASE
```

Do not configure both unless they point to the same database. If `DATABASE_URL` exists, it takes precedence.

## 2. Private GitHub backup repository

Create a separate **private** GitHub repository, recommended name:

```
your-org/siteops-backups
```

It may be empty. SiteOps can create the configured branch on the first snapshot.

Create a fine-grained GitHub personal access token restricted to this repository with:

- Repository access: only the backup repository
- Contents: Read and write
- Metadata: Read

Store the token only in Hostinger environment variables. Never commit it.

SiteOps stores snapshots below:

```
sites/<site-slug>/public/
sites/<site-slug>/.siteops.json
```

All backup Git operations use GitHub's HTTPS API. No deploy key, SSH key file or local clone is required.

## 3. Deploy the application

1. In hPanel open **Websites → Add Website → Deploy Web App**.
2. Choose **Import Git Repository**.
3. Select `YOUR-ORG/siteOps`.
4. Choose Node.js 22.
5. Hostinger should detect Fastify. If it is shown as **Other**, use `app.mjs` as the entry file.
6. There is no separate build step.
7. Start command: `npm start`.
8. Add the environment variables from `.env.example`.
9. Deploy.

Hostinger supports GitHub deployment for Node.js applications and can rebuild the application after repository updates.

## 4. Required environment variables

```
HOST=0.0.0.0
PUBLIC_BASE_URL=https://siteops.example.com

DB_HOST=localhost
DB_PORT=3306
DB_USER=...
DB_PASSWORD=...
DB_NAME=...

SITEOPS_MASTER_KEY=...
DASHBOARD_USER=admin
DASHBOARD_PASSWORD=...

# Optional compatibility token for older MCP clients:
MCP_API_TOKEN=

# Optional OAuth lifetime overrides:
OAUTH_ACCESS_TOKEN_TTL_SECONDS=3600
OAUTH_REFRESH_TOKEN_TTL_SECONDS=2592000
OAUTH_CODE_TTL_SECONDS=600

GITHUB_BACKUP_REPO=your-org/siteops-backups
GITHUB_BACKUP_TOKEN=...
BACKUP_REPO_BRANCH=main
```

`PORT` should normally be left to Hostinger.

Generate `SITEOPS_MASTER_KEY` locally:

```bash
openssl rand -base64 32
```

`DASHBOARD_PASSWORD` protects both the SiteOps dashboard and the human approval step of the built-in OAuth flow. Use a strong unique password. `MCP_API_TOKEN` is optional and should only be set when an older client still needs static Bearer authentication.

## 5. Backup limits

`BACKUP_MAX_FILE_BYTES` defaults to 50 MiB per file. The per-site dashboard additionally limits the number of files in one backup.

The default WordPress exclusions are intentionally conservative:

```
.git
node_modules
wp-content/cache
wp-content/uploads
```

Uploads are excluded because storing a large media library in Git is usually inefficient. A later object-storage/media-backup layer should be used for complete WordPress disaster recovery.

## 6. Quality Suite notes

The technical SEO crawler, duplicate-content checks, link/resource checks, accessibility quick checks, security-header analysis and crawl comparison work without a paid API. Google PageSpeed/Lighthouse remains optional and requires `PAGESPEED_API_KEY`.

SiteOps also reads public RDAP data for domain-expiry monitoring. Failed/unavailable RDAP lookups are treated as unknown rather than as a site outage.

## 7. Optional Browser Runner

Synthetic journeys and visual regression use the separate service in `runner/`. This is intentionally not started inside the normal Hostinger Cloud SiteOps process.

On a Linux Node.js host:

```bash
cd runner
npm install
npx playwright install --with-deps chromium
export BROWSER_RUNNER_TOKEN='<long random token>'
npm start
```

Expose it through HTTPS, then configure its URL/token in the SiteOps settings page. The runner rejects unauthenticated executions, arbitrary JavaScript steps and main-frame navigation away from the managed website hostname.

The main SiteOps app stores journey definitions, encrypted test secrets, schedules, results and visual baselines. Failure screenshots are automatically discarded after 30 days. After a successful SiteOps `change_apply`, enabled journeys are queued automatically: after 10 seconds for direct webspace changes and after 120 seconds for Hostinger Git deployments.

## 8. Verification after deployment

Open:

```
https://siteops.example.com/health
```

Expected response includes:

```json
{
  "status": "ok",
  "version": "1.1.0",
  "database": "mysql"
}
```

Then sign in to the dashboard and add the first customer site. For ChatGPT or Claude, open **MCP & OAuth** in SiteOps after deployment and connect the remote MCP URL. No separate OAuth provider is required.

If startup fails, check Hostinger Node.js runtime logs and verify the five `DB_*` variables first.
