# MCP
Endpoint: `https://siteops.lorzen.link/mcp`

V1 uses `Authorization: Bearer <MCP_API_TOKEN>`. Configure write-tool approvals so `change_apply` requires explicit approval.

Tools:
- `sites_list`
- `site_status`
- `files_list`
- `file_read`
- `change_preview`
- `change_apply`
- `history_list`
- `history_diff`
- `rollback_preview`
- `site_backup`
- `backups_list`
- `backup_restore_preview`

`backup_restore_preview` is intentionally two-step. It first creates a fresh full safety backup of the current live webspace and then prepares a normal change preview for the requested historical backup. Production is not changed until `change_apply` is approved.

For a published ChatGPT workspace plugin with account linking, add OAuth 2.1 protected-resource and authorization-server metadata as the next hardening phase. The core SiteOps API is intentionally independent of a specific AI client.
