# Google Search Console integration — implementation status

This feature branch currently contains the **shared, isolated Google API client** and contract tests. The client is not wired into production or MCP yet. Do not merge until the remaining checklist is implemented and tested.

## Requirements for full delivery
- [ ] Per-user Google OAuth 2.0 connection with PKCE, refresh token storage encrypted using the existing SiteOps crypto service, correct Google scopes and secure state bound to the authenticated dashboard session.
- [ ] Persist project-to-Search-Console-property links, Google account ID, live approval timestamp, verified status, sitemap status and last synchronization time in MySQL migrations. Do not register staging sites without explicit live approval.
- [ ] Reuse existing properties, request DNS TXT verification token, determine authoritative DNS provider via nameservers, and call existing ALL-INKL KAS DNS methods only after user approval of the exact record.
- [ ] Hostinger DNS integration after validating API support, credentials/permissions, nameserver authority and conflict checks. Never assume hosting provider equals DNS authority.
- [ ] Poll public authoritative DNS and then independently ask Google to verify. Do not conflate DNS TXT presence with Google verified ownership.
- [ ] Submit only an accessible, canonical XML sitemap to Search Console. Verification, sitemap submission and indexing are separate states.
- [ ] Build dashboard panel under the per-site SEO view with clicks, impressions, CTR, average position, date comparison, query/page dimension breakdown and opportunity suggestions derived from real API data.
- [ ] Implement daily sync, pagination, backoff and last-complete-date behavior; keep Google API data separate from crawler-derived SEO scores.
- [ ] Add URL Inspection with bounded per-URL quota and explicit limitation that Search Console does not expose a site-wide index coverage report through the API.
- [ ] Register dedicated MCP tools for read-only status/performance/inspection and preview/approve flows for property creation, DNS writes, sitemap submissions. Follow existing MCP security and annotations.
- [ ] Test API error cases, OAuth CSRF, missing scopes, expired access tokens, wrong properties, DNS conflict/authority and live gate, permissions, HTTP routes, dashboard and MCP discovery.
- [ ] Run npm test, npm run lint, npm run format:check, integration tests and smoke tests. Merge and deploy only on passing checks.

Google endpoints are maintained in lib/search-console-client.mjs, with matching contract tests in test/search-console-client.test.mjs. Both dashboard and MCP must call a shared, authorization-enforcing service around that client.
