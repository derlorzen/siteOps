# SiteOps dashboard session login

## Purpose

The dashboard and OAuth consent screens used HTTP Basic authentication. Some mobile and embedded browser clients repeatedly displayed the browser credential prompt during ChatGPT/Claude MCP OAuth authorization. The dashboard now uses a normal HTML login form and a browser session stored in MySQL.

**Important:** This reduces browser authentication loops but does not guarantee that every OAuth token/redirect error is resolved. Inspect OAuth status codes if connection problems remain.

## Behavior

- Open /login and sign in with the existing DASHBOARD_USER and DASHBOARD_PASSWORD.
- The form issues a host-only HttpOnly cookie with Secure on HTTPS and SameSite=Lax, lasting up to 12 hours.
- Only a SHA-256 hash of the random session token is stored in MySQL.
- Sessions survive app restarts and invalidate automatically if the configured dashboard credentials change.
- The login form uses a CSRF challenge and per-IP rate limit.
- /logout has a confirmation form and revokes the session.
- Browser API writes require same-origin Origin or Referer headers or a session CSRF header.
- Anonymous dashboard page requests redirect to /login?next=... rather than triggering a native browser popup. Unauthenticated /api requests return JSON 401 without WWW-Authenticate.
- The OAuth authorization request, including client_id, state and PKCE challenge, remains intact through login and resumes on /oauth/authorize.
- OAuth /token, /register, metadata, revoke and /mcp bearer authorization work as before. MCP clients do not receive the dashboard password.

## Rollout

1. Merge the dedicated pull request and deploy/restart SiteOps.
2. The dashboard_sessions MySQL table is created automatically on startup.
3. Open https://siteops.lorzen.cloud/login in a private tab, sign in, then visit /mcp-info.
4. In ChatGPT or Claude, reconnect the MCP endpoint https://siteops.lorzen.cloud/mcp using OAuth.
5. The first OAuth consent flow redirects to login as needed, then shows Access erlauben.
6. The MCP connection should continue to work with its access and refresh tokens after you log out from the website.

Legacy third-party scripts calling SiteOps dashboard /api endpoints with HTTP Basic will have to use browser-session authorization or be migrated to supported MCP OAuth tools. The public /mcp authentication is unchanged.

## Safety

Cookies must never be exposed as URLs or written to logs. Keep SITEOPS_MASTER_KEY and DASHBOARD_PASSWORD secret and provide stable encryption keys across app instances. All instances must connect to the same MySQL database to share sessions. Keep PUBLIC_BASE_URL set to the exact HTTPS origin.

Inspect /oauth/token responses and issuer/resource metadata if a client still loops. Do not disable OAuth validation, CSRF, redirect URI checking or HTTPS.

## Quick checks

- GET /login shows HTML (no Basic Auth challenge).
- GET / with no session redirects to /login.
- POST /login with a valid challenge sets __Host-siteops_session on HTTPS.
- GET /oauth/authorize with a session continues consent; without a session it redirects to /login carrying the original query.
- POST /oauth/authorize returns to the registered ChatGPT/Claude callback.
- POST /oauth/token completes authorization code exchange with PKCE S256.
- Logout removes the session and redirects back to login.
