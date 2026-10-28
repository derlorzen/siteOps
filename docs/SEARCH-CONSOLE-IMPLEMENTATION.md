# Google Search Console

Website and MCP share `lib/search-console.mjs`. The per-site SEO view links to the Search Console workspace. `seo_latest` and the SEO dashboard include cached Google performance and opportunities separately from crawler scores.

## Setup

1. Apply migrations through normal SiteOps startup or `npm run migrate`. Migration `20261028_search_console.sql` adds account, OAuth state, site linkage, approval history, report and inspection quota tables without modifying existing sites.
2. In Google Cloud enable **Google Search Console API** and **Site Verification API**. Configure an OAuth consent screen and a Web application client. Add the exact HTTPS redirect URI displayed in **SEO → Search Console** (`PUBLIC_BASE_URL` origin + `/api/search-console/oauth/callback`). In testing mode, add the intended Google users as test users; Google's testing-mode refresh-token restrictions still apply.
3. Save client ID and secret in SiteOps, then connect Google. Client secrets, access/refresh tokens, PKCE verifiers and pending approvals are encrypted with the existing `SITEOPS_MASTER_KEY`. Blank secret fields preserve existing values. Optional Hostinger API tokens use the same encrypted settings service. ALL-INKL reuses existing hosting accounts.
4. Select an existing Google property, or enter a matching `sc-domain:example.com` as a **local draft linkage**. Existing canonical HTTPS URL-prefix properties can be reused. New ownership verification supports domain properties through DNS TXT. Linking never registers a remote property; relinking resets this project's live approval and cached report.

SiteOps currently has one configured dashboard operator (`DASHBOARD_USER`). Google accounts are bound to that authenticated subject. Authorized MCP clients retain the same operator-wide site permissions as existing SiteOps tools; this feature does not introduce a separate multi-tenant permission model. OAuth is dashboard-only, PKCE-protected, tied to the exact session and single-use for ten minutes. API writes require existing session/CSRF protection plus same-origin JSON. OAuth callbacks use silent request logging.

## Per-project live release

For each step, prepare the preview, review its exact account/project/domain/property/record, then approve with the displayed `slug domain` confirmation. Every preview expires after ten minutes, has an atomic execution claim and persists its result. Site/linkage rows are locked during reviewed external writes. Domain changes, relinking, disabling or deleting a project block stale approvals. A timeout or interrupted process is not permission to repeat a write: inspect change status and remote state first.

1. Approve **Livegang** for this active project. This records local consent only; it performs no external registration.
2. Prepare **Google TXT** for a new domain property. SiteOps checks the closest authoritative DNS delegation, nameservers, provider credentials, zone access and CNAME conflicts. ALL-INKL needs the selected hosting account; Hostinger uses its configured token. Only `google-site-verification=…` TXT records are appended. Existing TXT, mail, routing and unrelated Google verification records remain. Hostinger explicitly uses `overwrite:false` and preserves an existing TXT TTL. General ALL-INKL apex/wildcard protection remains; a dedicated Google-only method permits this narrowly validated TXT at the apex.
3. Prepare **Google-Verifizierung**. SiteOps polls every authoritative nameserver directly with bounded retries, joins TXT chunks and checks the exact token, then independently asks Google's Site Verification API to confirm ownership. A DNS write does not mark Google ownership verified.
4. Prepare **Property-Anmeldung** after Google ownership confirmation. Existing owned properties can be reused without registration.
5. Prepare **Sitemap-Einreichung**. The sitemap must return HTTP 200 directly at the canonical project HTTPS origin, contain bounded, well-formed XML with the sitemap namespace and have URLs within the linked property. Redirects, credentials, custom ports, DTDs/entities, foreign URLs and changed preview contents are rejected. Google owner/full-user permission is checked again. Submission, processing/errors and indexing have separate states.

Unknown/mixed/unsupported authoritative providers are refused rather than inferred from hosting. Nameservers and existing DNS records are never replaced. Local unlink/disconnect deletes corresponding local linkage/cache and credentials; Google properties, grants and DNS remain unchanged. Revoke the grant in the Google account separately if no longer needed.

## Performance, synchronization and quotas

The worker checks due approved, enabled projects every 15 minutes, including startup. Success schedules the next sync 24 hours later. Failure preserves the last successful report, records a redacted error and retries no earlier than one hour later. A durable lease prevents concurrent syncs across instances. Revision checks prevent an old sync from publishing after relinking. **The worker reads Google APIs and updates local reports only. It never registers properties, writes DNS, verifies ownership or submits sitemaps.**

Reports compare 28 days with the prior 28 days using Google's `America/Los_Angeles` dates, `dataState:final` and a conservative three-day processing delay. The last available finalized data date is stored separately; missing days do not prove deindexing. Totals derive from daily property aggregates. CTR is clicks/impressions; position is weighted by impressions. Query/page datasets remain separate. Google provides top rows and omits anonymized queries, so query/page sums need not equal property totals.

Google responses are bounded. Analytics paginate in batches of 5,000, capped at 50,000 rows per dimension with explicit truncation. Read requests use bounded exponential backoff for transient errors. Expired tokens refresh once with concurrent-request coalescing. Mutation timeouts are never automatically replayed. Cached rows paginate with `offset`, `limit` and `next_offset` in UI/API/MCP.

URL Inspection accepts a single HTTPS URL within the linked property, requires live approval and has a persistent local limit of 100 requests/property/UTC day in addition to Google's quotas. It does not request indexing or provide a site-wide coverage report. Sitemap submission cannot guarantee indexing.

## MCP tools

`search_console_status`, `search_console_properties`, `search_console_link`, `search_console_change_preview`, `search_console_change_execute`, `search_console_change_status`, `search_console_performance`, `search_console_sync`, `search_console_inspect_url`, `search_console_unlink`.

Only an explicitly human-reviewed preview may execute. Tool descriptions forbid interpreting a general implementation request as permission to register every site. OAuth secrets and refresh tokens are never returned. Status/performance/inspection carry read-only annotations; mutations share the dashboard's service gates.

## Validation

Run `npm test`, `npm run check`, `npm run lint`, `npm run format:check`, `npm run check:runtime` and runner checks. The existing serial migration test includes real MySQL linkage, concurrent approvals, report publication, daily scheduling, migration idempotency and cascading cleanup. `RUN_GSC_BROWSER_TESTS=1 node --test test/search-console-browser.test.mjs` runs the real UI with local simulated Google/DNS responses. CI installs Chromium and runs this explicitly. No test registers a real property or changes public DNS.

Protocol references: [Google OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [verification token](https://developers.google.com/site-verification/v1/webResource/getToken), [ownership confirmation](https://developers.google.com/site-verification/v1/webResource/insert), [Search Analytics](https://developers.google.com/webmaster-tools/v1/searchanalytics/query), [URL Inspection](https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect), [Hostinger DNS API](https://developers.hostinger.com/).
