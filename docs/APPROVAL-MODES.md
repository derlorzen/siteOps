# SiteOps operation modes

`main` defaults to **direct** operation: the shared SiteOps MCP and HTTP adapters do not request an additional dashboard approval. Authentication, OAuth write scopes, origin checks, audit records, semantic previews, version checks and private-first YouTube uploads remain in place. Direct mode authorizes no additional user intent; callers still need an actual task instruction.

The unchanged approval-enabled snapshot is preserved at branch **`archive/with-approvals-2026-11-01`**, commit `3d25339c699b356fd03aa3cfaa125620fbb656a4`.

Set `SITEOPS_APPROVAL_MODE=required` before starting the current application to retain the approval workflow without switching branches. `direct` is the default when the variable is absent. Any other value is rejected at startup. Mode changes take effect on application restart and MCP clients must refresh discovery so tool schemas, metadata and server instructions match the running mode.

The current mode is visible under **MCP & KI-Zugriff** and in the redacted `settings_get` result. SiteOps does not automatically approve pending approvals, forge approval IDs, or weaken authentication when switching modes. Existing pending approvals remain historical entries. The live instance continues enforcing its current mode until an authorized deployment has completed.

Tests explicitly cover direct mode and the existing required-mode suite. CI runs the existing application security fixtures with `SITEOPS_APPROVAL_MODE=required`; dedicated direct-mode tests verify no approval request occurs and missing authentication/write scopes still prevent mutations.
