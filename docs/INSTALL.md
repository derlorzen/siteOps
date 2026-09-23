# Deploy SiteOps on Hostinger Cloud Startup

SiteOps 0.9 is a Node.js/Fastify application designed for Hostinger Cloud Startup. It uses Hostinger's managed MySQL database and does not require a VPS, Docker, systemd, PostgreSQL, a local Git binary, a PHP binary or persistent application storage.

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
derlorzen/lorzen-site-backups
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
3. Select `derlorzen/siteOps`.
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
PUBLIC_BASE_URL=https://siteops.lorzen.cloud

DB_HOST=localhost
DB_PORT=3306
DB_USER=...
DB_PASSWORD=...
DB_NAME=...

SITEOPS_MASTER_KEY=...
MCP_API_TOKEN=...
DASHBOARD_USER=kai
DASHBOARD_PASSWORD=...

GITHUB_BACKUP_REPO=derlorzen/lorzen-site-backups
GITHUB_BACKUP_TOKEN=...
BACKUP_REPO_BRANCH=main

SEO_MAX_PAGES=100
SEO_LINK_CHECK_LIMIT=1000
SEO_EXTERNAL_LINK_CHECK_LIMIT=300
SEO_WORKER_INTERVAL_MS=300000
SEO_REGRESSION_ALERT_DROP=10
PAGESPEED_API_KEY=
SEO_USER_AGENT=Lorzen-SiteOps-SEO/0.9
```

`PORT` should normally be left to Hostinger.

Generate `SITEOPS_MASTER_KEY` locally:

```bash
openssl rand -base64 32
```

Use separate strong random values for `MCP_API_TOKEN` and `DASHBOARD_PASSWORD`.

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

## 6. Verification after deployment

Open:

```
https://siteops.lorzen.cloud/health
```

Expected response includes:

```json
{
  "status": "ok",
  "version": "0.9.0",
  "database": {
    "engine": "mysql",
    "ready": true
  }
}
```

Then sign in to the dashboard and add the first customer site. A complete SEO audit also runs Link Health and Site Intelligence. Per-site recurring audits can be enabled from the site operations page; regressions use the existing alert channels. The PageSpeed API key is optional; all other SEO, DNS, security-header and AI-crawler checks work without it.

If startup fails, check Hostinger Node.js runtime logs and verify the five `DB_*` variables first.
