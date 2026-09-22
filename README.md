# Lorzen SiteOps

Central operations hub for customer websites on SFTP/FTPS/FTP hosts.

## Features

- live webspace remains the production source of truth
- private Git repository stores a per-site version history under `sites/<slug>/public`
- PostgreSQL stores sites, previews, changes, backups, monitor checks and incidents
- two-step `change_preview` → `change_apply`
- live hash conflict detection before writes
- automatic restoration of touched files if a transfer or post-change snapshot fails
- Git pre/post snapshots and human-readable diffs
- rollback is itself a preview before it can be applied
- manual and scheduled full backups per customer project
- restore creates a fresh safety snapshot before applying an older state
- binary-safe backup and rollback handling
- per-site backup interval, file limit and monitoring settings
- uptime/status/content/SSL/response-time monitoring
- incident + recovery alerts by SMTP and/or generic webhook
- lightweight operations dashboard plus Streamable HTTP MCP endpoint
- credentials encrypted with AES-256-GCM

## Hosting

SiteOps is intended to run as a managed Node.js web app on Hostinger Cloud Startup, deployed directly from this GitHub repository.

Prefer SFTP for managed customer websites. FTPS exists for legacy hosts; plain FTP should only be used where unavoidable.

See `docs/INSTALL.md` and `docs/MCP.md`.
