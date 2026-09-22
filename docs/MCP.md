# SiteOps MCP

Endpoint:

```
https://siteops.lorzen.cloud/mcp
```

Authentication:

```
Authorization: Bearer <MCP_API_TOKEN>
```

SiteOps MCP never returns stored passwords, private keys, GitHub PATs or the SiteOps master key. Secret-bearing update tools accept replacement secrets, but their responses are always redacted.

## Operations / context

- `sites_list` – list managed websites with deployment, monitoring and backup mode
- `site_get` – redacted configuration for one website
- `site_overview` – preferred first call for an agent: configuration, deployment state, latest monitor result, open incidents and backup state
- `deployment_info` – deployment/source information and Git branch HEAD where available
- `settings_get` – redacted global SiteOps configuration

## Monitoring and incidents

- `site_status` – immediate detailed check: HTTP, redirect chain, DNS, SSL, response time, expected text/title and optional WordPress REST API
- `monitor_history` – recent monitoring results
- `incidents_list` – recent incidents for a website
- `incident_get` – complete incident timeline including alerts, repeated failures and recovery

## Configuration

- `site_update` – update non-secret monitoring, backup and operational settings
- `site_connection_test` – test the currently stored SFTP/FTPS/FTP or Git source connection
- `site_connection_update` – test and then persist connection/deployment configuration; blank secret fields retain existing secrets

## Files and discovery

For Hostinger Git Deploy sites, “current source of truth” means the configured GitHub source repository. For classic sites, it means the configured live webspace.

- `files_list` – directory listing
- `files_find` – bounded recursive filename/path search
- `text_search` – bounded search through text-file contents
- `file_read` – read a text file

## Safe changes

- `change_preview` – prepare and validate file changes without writing
- `change_apply` – apply an approved preview with pre/post snapshots and post-change health check
- `history_list` – recent recorded changes
- `history_diff` – human-readable Git comparison for a change
- `rollback_preview` – prepare rollback as a new preview

For a Hostinger Git Deploy site, `change_apply` commits the proposed changes to the configured deployment branch. Hostinger then deploys that branch. For a webspace site, SiteOps writes through its configured SFTP/FTPS/FTP adapter.

## Backups and restore

- `site_backup` – create a full SiteOps Git-backed snapshot
- `backup_status` – scheduler state and latest backup
- `backups_list` – list full backups
- `backup_restore_preview` – prepare restore from a historical backup

A restore never writes an old backup directly. SiteOps first creates a fresh safety snapshot, creates a normal preview, and only `change_apply` performs the change.

## Recommended agent workflow

For ordinary work on a website:

1. `site_overview`
2. `files_find` / `text_search` / `file_read`
3. `change_preview`
4. show the user the proposed change and obtain approval
5. `change_apply`
6. `site_status`
7. if needed, use `history_diff` or `rollback_preview`

This keeps discovery, proposed changes, approval and execution separate.
