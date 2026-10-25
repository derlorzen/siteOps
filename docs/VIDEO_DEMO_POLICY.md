# Video demo domain policy: implementation and operations

## Architecture and implementation plan

SiteOps is the authenticated Fastify dashboard/API on managed Node hosting, with
MySQL `app_settings` storage. The separate Fastify/Playwright runner executes
videos, persists jobs/models under `VIDEO_OUTPUT_DIR`, and is deployed through
Hostinger Docker Manager (or the supplied systemd installer). The dashboard must
never edit Docker environment variables or require Docker socket/Hostinger access.

1. Share one strict, bounded hostname-rule validator between backend and runner.
   Exact rules match one DNS hostname. `*.lorzen.de` matches `demo.lorzen.de` and
   `a.demo.lorzen.de`, but never `lorzen.de`, `evillorzen.de` or
   `demo.lorzen.de.evil.test`. Reject `*`, IPs, schemes, ports, paths, credentials,
   partial wildcards, empty labels and ambiguous host spelling. No allow-all mode.
2. Add a dashboard-only JSON settings API and accessible Video Studio form. Reuse
   dashboard sessions and audit metadata; require same-origin JSON for mutations.
   Persist a versioned policy in MySQL. Missing setting means runner environment
   fallback; an explicit empty list means deny all demo traffic. Save, reload and
   fallback are separate visible actions. Defaults are suggestions, never grants.
3. Carry a validated immutable policy snapshot with each render request over the
   existing server-to-server Bearer-authenticated HTTPS connection. Discover
   protocol support first; never silently send a GUI override to an older runner
   that could ignore it. Reject redirects on runner API calls to protect the token.
   No direct browser-to-runner configuration endpoint, global push/sync or drift.
4. Apply that snapshot to initial URLs, goto steps, redirects, popups, frames and
   assets in isolated contexts. Block service workers, WebSockets and downloads.
   Force HTTPS/443. Resolve all DNS answers and reject non-public addresses;
   connect to the validated IP through an authenticated per-context CONNECT proxy
   so Chromium cannot re-resolve the hostname after validation (DNS rebinding).
   Keep browser TLS certificate/hostname checks enabled. Close contexts, proxy and
   sockets on all failure paths. Apply the same guard to stills and recordings.
   Disable HTTP/2 coalescing and QUIC so redirected destinations cannot reuse a
   different hostname's tunnel; disable non-proxied WebRTC UDP as well.
5. Preserve runner 422 as a clear client validation error, with a stable error code
   and a domain-settings hint; distinguish authentication, busy queue, timeout and
   unavailable-runner errors. Do not queue/update the database on rejection.
6. Cover matching, persistence/fallback, protocol compatibility, auth/CSRF, transport,
   DNS/IP filtering, CONNECT pinning, redirects and subresources with deterministic
   tests, plus real Chromium integration. Run repository checks and open a PR to
   `main`. No production settings, deployments or environment changes in this work.

## Migration and deliberate rollout

Deploy the reviewed runner code first when authorized: rebuild the runner image
from this branch/release in Docker Manager, preserve the existing token and named
video-data volume, and retain the existing HTTPS reverse proxy. The Dockerfile and
systemd installer both include the policy and network-guard modules. Do not expose
3200 publicly. Then deploy SiteOps. A newer SiteOps reports an older runner clearly
and refuses GUI policy overrides until protocol version 1 is advertised.

With no MySQL policy row, `VIDEO_ALLOWED_HOSTS` remains authoritative. Existing
comma-separated exact hosts continue to work; `*.lorzen.de` is now supported in
that variable too. Invalid legacy rules fail closed and are reported by the GUI;
they are never silently dropped. An unset/empty variable denies demos. No automatic
copy from a remote environment into the database occurs. The GUI displays the
active source and runner fallback, and offers an explicit environment reset.

For the requested setup, enter one rule per line and save explicitly:

```text
*.lorzen.de
shop.lorzen.link
```

The apex `lorzen.de` requires its own rule if later desired. Assets on external
CDNs need their own explicit rules; blocked redirects/assets remain blocked.
An empty saved list intentionally disables demos, including environment grants.
Rollback by switching to environment fallback before reverting backend/runner;
do not restore an old permissive environment accidentally.

## Trust boundary and limitations

The runner Bearer token already authorizes arbitrary video submissions; holders
can supply policy snapshots. Treat it as an administrator secret, store it only
in SiteOps encrypted settings or runner environment, and terminate HTTPS at the
existing trusted proxy. No policy signature adds a second copy of that authority.
Dashboard-authenticated administrators can edit this global policy; MCP clients
cannot edit it. Audit records contain actor/path/status, never Bearer tokens.

Policies are snapshots: changing settings affects new submissions, not an already
queued/running job. To revoke existing work, stop the runner deliberately. SSRF
checks deny private, loopback, link-local, reserved, multicast and mapped IPv6
addresses and mixed public/private DNS answers. DNS failures and proxy failures
deny access. Host firewall/container egress isolation remains defense in depth
against browser compromise and non-HTTP networking; this is not a general sandbox
for executing untrusted JavaScript outside Chromium's normal security boundary.

## Review / acceptance

- Test desired domains, apex/suffix confusion, malformed rules and explicit deny.
- Exercise save/reload/reset, runner outage/old protocol, rejected writes and audit.
- Exercise stills and recordings through real Chromium: public HTTPS succeeds;
  unapproved redirects, frames/assets, private DNS and rebinding cannot connect.
- Assert HTTP 422 stays 422 through the backend and produces readable UI text.
- Run syntax, lint, formatting, runtime checks and the complete test suite; document
  unavailable database/browser/platform checks in the PR rather than claiming them.

Run the deterministic browser suite with `RUN_VIDEO_BROWSER_TESTS=1 node --test
test/video-*.test.mjs` after installing both root and runner dependencies and the
matching Playwright Chromium. OpenSSL creates a temporary test-only certificate;
only the fixture browser bypasses certificate trust. Production contexts always
keep TLS verification enabled. CI runs these tests on Linux before its existing
MP4 and Docker smoke checks.
