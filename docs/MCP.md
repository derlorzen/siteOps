# SiteOps MCP

Endpoint:

```
https://siteops.lorzen.cloud/mcp
```

Authentication:

```
Authorization: Bearer <MCP_API_TOKEN>
```

## Tools

- `sites_list` – managed sites
- `site_status` – immediate HTTP/SSL check
- `files_list` – live remote directory listing
- `file_read` – live text file read
- `change_preview` – prepare and validate a file change without writing production
- `change_apply` – apply an approved preview with pre/post GitHub snapshots
- `history_list` – recent changes
- `history_diff` – human-readable GitHub comparison for a change
- `rollback_preview` – prepare rollback as a new preview
- `site_backup` – create a full GitHub-backed site snapshot
- `backups_list` – list full backups
- `backup_restore_preview` – create a safe restore preview from a historical backup

A restore never writes an old backup directly to production. SiteOps first creates a fresh safety snapshot of the current live files, then creates a normal preview, and only `change_apply` performs the write.
