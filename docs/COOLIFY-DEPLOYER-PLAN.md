# Universal Coolify deployment plan

Reuse `createCoolifyClient`, encrypted connections, KAS DNS, `customer_projects`,
`project_sites`, website monitoring, dashboard authentication and MCP OAuth.
Keep the existing low-level Git, command and Supabase APIs compatible.

1. Add resumable deployment records and website deployment metadata through a
   rerunnable migration. No production database is available in this checkout;
   startup/migrate applies it on the target installation.
2. Extend the allowlisted API client for version, environments, application
   configuration/storage, service Compose, deployment history and status.
3. Analyze public sources without cloning or executing their code. Retain source
   URLs and commit IDs; classify desktop/server/browser support conservatively.
4. Persist an immutable, expiring plan and encrypted configuration. Execution
   accepts its ID, never a replacement configuration. Record approval separately.
5. Serialize work with the existing MySQL advisory-lock pattern. Reconcile remote
   ownership markers after an interrupted create; never adopt or alter foreign
   applications. Reuse unambiguous existing project names without modifying them.
6. Run provision/configure/DNS/deploy/verify/register as durable steps. Retry
   individual failures, reconcile ambiguous deployment requests, poll asynchronously.
   Never delete resources automatically.
7. Register only verified deployments as Coolify websites. Disable FTP backups and
   file operations, reuse monitoring, project linkage and SSL checks.
8. Expose the same service through dashboard and OAuth MCP with explicit plan/run
   tools. Add responsive forms, progress, logs, retry and project entry points.
9. Exercise successful and failed workflows with mocked remote writes, run the
   regression suite, document OpenChatCut evidence, commit and open a PR.

API evidence: official `coollabsio/coolify` commit
`6c6fff5d26900e106e08a34f23f7289639b387f4`, `routes/api.php` and the
Applications/Services/Project/Deploy API controllers (retrieved 2026-10-22).
https://coolify.io/docs/api/overview
https://coolify.io/docs/api/endpoints/services/create-service
https://coolify.io/docs/api/endpoints/applications/create-dockerfile-application
https://coolify.io/docs/api/endpoints/applications/create-dockerimage-application

Live production deployment, DNS mutation and the OpenChatCut media E2E test need
separate authorization. A mock test or page response never establishes production
readiness or successful video export.
