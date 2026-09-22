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
- expanded MCP toolkit for site overview, configuration, connection testing, file discovery, monitoring, incidents, backups and safe changes
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

## Hosting

SiteOps 0.7 is designed for Hostinger Cloud Startup as a managed Node.js/Fastify application deployed directly from this GitHub repository.

The application now uses the MySQL database included with Hostinger Cloud Startup. No Supabase or external PostgreSQL service is required.

The customer snapshot repository must be **private**. SiteOps refuses to write backups to a public repository.

Prefer SFTP for managed customer websites. FTPS exists for legacy hosts; plain FTP should only be used where unavoidable.

See `docs/INSTALL.md` and `docs/MCP.md`.
