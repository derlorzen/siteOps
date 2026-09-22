# Deploy SiteOps on Hostinger Cloud Startup

SiteOps 0.3 is a Node.js/Fastify application designed for Hostinger's managed Node.js Web App hosting. It does not require a VPS, Docker, systemd, a local Git binary, a PHP binary or persistent application storage.

## 1. PostgreSQL

Hostinger Cloud/Web hosting provides MySQL, not PostgreSQL. SiteOps therefore uses an external PostgreSQL database.

Recommended setup:

1. Create a dedicated Supabase project named **SiteOps** in the EU region.
2. In the Hostinger Node.js application dashboard use **Database → Connect → Supabase**, or configure the connection manually.
3. Ensure SiteOps receives a PostgreSQL connection string as `DATABASE_URL`.
4. Prefer the Supabase pooled connection string for the long-running Node.js application.
5. Keep `sslmode=require` in the connection string when applicable.

The schema is applied automatically when SiteOps starts. It can also be applied explicitly with `npm run migrate`.

Do not reuse an unrelated production project's database for SiteOps.

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
6. There is no build step.
7. Start command: `npm start`.
8. Add the environment variables from `.env.example`.
9. Deploy.

Hostinger supports deployment from GitHub and can redeploy the application after repository updates.

## 4. Required environment variables

```
HOST=0.0.0.0
PUBLIC_BASE_URL=https://siteops.lorzen.link
DATABASE_URL=postgresql://...
SITEOPS_MASTER_KEY=...
MCP_API_TOKEN=...
DASHBOARD_USER=kai
DASHBOARD_PASSWORD=...
GITHUB_BACKUP_REPO=derlorzen/lorzen-site-backups
GITHUB_BACKUP_TOKEN=...
BACKUP_REPO_BRANCH=main
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
https://siteops.lorzen.link/health
```

Expected response includes:

```json
{
  "status": "ok",
  "version": "0.3.0",
  "database": "ok",
  "backup": "github-api"
}
```

Then sign in to the dashboard and add the first customer site.

If a backup fails, check Hostinger Node.js runtime logs and verify `DATABASE_URL`, `GITHUB_BACKUP_REPO` and `GITHUB_BACKUP_TOKEN`.
