# Deploy on Hostinger Cloud Startup

SiteOps is a Node.js/Fastify application and should be deployed through Hostinger's managed Node.js Web App flow, not through a VPS.

## GitHub deployment

1. In hPanel open **Websites → Add Website → Deploy Web App**.
2. Choose **Import Git Repository**.
3. Select `derlorzen/siteOps`.
4. Use Node.js 22.
5. Let Hostinger detect Fastify. If it is shown as **Other**, use `app.mjs` as the entry file.
6. There is no separate build step. The start command is `npm start`.
7. Add the required environment variables from `.env.example`.
8. Deploy.

Pushes to the connected GitHub repository can be redeployed automatically by Hostinger.

## Runtime

The app listens on `process.env.PORT` when Hostinger provides it. `HOST` should be `0.0.0.0`.

SiteOps needs an externally reachable PostgreSQL database through `DATABASE_URL`.

The local workspace is only a working copy/cache for the Git-backed customer-site snapshots. On managed hosting use a writable temporary path such as:

```
WORKSPACE_ROOT=/tmp/siteops/workspaces
```

The authoritative backup history remains the configured Git backup repository.

## Required environment variables

At minimum configure:

- `DATABASE_URL`
- `SITEOPS_MASTER_KEY`
- `MCP_API_TOKEN`
- `DASHBOARD_USER`
- `DASHBOARD_PASSWORD`
- `PUBLIC_BASE_URL`
- `BACKUP_REPO_URL`

Optional alert and SMTP variables are documented in `.env.example`.

Generate the encryption key locally with:

```bash
openssl rand -base64 32
```

Do not commit secrets or a real `.env` file.
