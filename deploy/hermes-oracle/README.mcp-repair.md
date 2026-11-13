# Hermes Oracle / SiteOps MCP – controlled repair

This branch is a **staging change**, not a completed installation or authorization.
Do not merge/deploy until the running Coolify application, its volumes, and current
image tags have been inspected. Preserve existing Selene SSO and Nous OAuth settings.

## Why this change is needed

The deployed Compose file mounts `hermes-agent-src` read-only in `hermes-webui`,
but previously did not mount it in the actual `hermes` service. In a two-container
configuration that can leave Selene with an old or incomplete Hermes Python runtime.
The official two-container design mounts the source volume at `/opt/hermes` on the
Hermes service and read-only inside WebUI.

The config-init service now adds an absent `mcp_servers` section with:
```yaml
mcp_servers:
  siteops:
    url: https://siteops.lorzen.cloud/mcp
    auth: oauth
```
This does **not** authenticate automatically; OAuth must still be approved.

## Before any deployment

1. Identify the exact Coolify application UUID and compose project for
   `hermes-agent-oracle-secure` (do not confuse it with the retired container).
2. Inspect the effective image tags/digests, container state, mounts and volumes.
   The important volumes are `hermes-oracle-data` (user data and credentials),
   `hermes-agent-src` (agent source + bundled venv) and `selene-sso-state`.
   Actual Docker volume names may be prefixed by the Compose project.
3. Make recoverable, permission-restricted backups of **all three** volumes.
   They contain private settings and potentially secrets; store backups securely.
4. Confirm enough disk space and document a rollback path. Keep old images.
5. Validate the updated Compose with `docker compose config` using the existing
   Coolify environment (never print credentials or substituted secrets in logs).

## Source-volume refresh (requires direct host/Coolify control)

The existing `hermes-agent-src` is stale; a Git commit or `docker compose pull`
alone does NOT refresh this Docker volume.

* Stop the relevant Compose stack without `down -v`; preserve all volumes.
* Confirm the source volume is no longer mounted and that its backup is valid.
* Remove **only the verified `hermes-agent-src` source volume**, never
  `hermes-oracle-data` or `selene-sso-state`.
* Deploy this branch with the same Coolify secrets and domains. The Hermes
  service mounts `hermes-agent-src` at `/opt/hermes`; Selene waits for Hermes
  health and mounts the freshly initialized volume read-only.
* Verify both containers use the intended compatible source/runtime versions.

Use the upstream multi-container volume-upgrade procedure as a reference:
https://github.com/nesquena/hermes-webui/blob/master/docs/docker.md

## Verify

Test imports in the **actual Python interpreter that the Hermes command uses**
inside both the gateway and WebUI containers, not an unrelated system Python:
```
python -c "import mcp.client.streamable_http; print('MCP HTTP OK')"
```
Then check `~/.hermes/config.yaml` / `/opt/data/config.yaml` for the new
server without displaying tokens. Authorize via the Hermes dashboard or
`hermes mcp login siteops` from an interactive shell. For headless OAuth,
use dashboard authorization or paste-back callback; a remote-phone browser
cannot hit the container's localhost callback directly.

Finally run `hermes mcp test siteops` and verify a real read-only SiteOps tool
call plus `https://ki.lorzen.net`, `https://hermes-admin.lorzen.net`,
`https://selene-sso.lorzen.net` (where used) and session persistence.

## Rollback

If any health, auth, or MCP check fails, restore the previous Compose revision
and the backed-up `hermes-agent-src` volume. **Do not overwrite user-data or
SSO-state volumes**. Never mark repair complete until tested.
