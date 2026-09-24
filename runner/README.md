# SiteOps Browser Runner

Optional Playwright execution service for SiteOps synthetic journeys and visual regression checks.

## Production install on a VPS (systemd, no Docker)

Requirements: Ubuntu/Debian-compatible VPS, Node.js 22+, npm, root/sudo access and an HTTPS reverse proxy.

From a checkout of the SiteOps repository:

```bash
cd runner
sudo bash install-systemd.sh
```

The installer:

- creates the restricted `siteops-runner` system user,
- installs the runner into `/opt/siteops-browser-runner`,
- installs Playwright + Chromium and required OS packages,
- generates `/etc/siteops-browser-runner.env` with a random bearer token,
- installs and enables `siteops-browser-runner.service`,
- binds the runner to `127.0.0.1:3200` by default.

The generated token is printed once. Store it in **SiteOps → Einstellungen → Synthetic Runner** together with the public HTTPS URL.

Useful commands:

```bash
sudo systemctl status siteops-browser-runner
sudo journalctl -u siteops-browser-runner -f
curl http://127.0.0.1:3200/health
```

For HTTPS, proxy a dedicated hostname to `http://127.0.0.1:3200`. See `nginx-siteops-browser-runner.conf.example`. If the VPS already has another reverse proxy, use the same upstream and timeout values rather than running a second proxy stack.

After publishing the hostname, enter the URL and token in SiteOps and click **Browser Runner testen**.

## Docker

```bash
cd runner
docker build -t siteops-browser-runner .
docker run -d --name siteops-browser-runner \
  -e BROWSER_RUNNER_TOKEN="$(openssl rand -base64 32)" \
  -p 127.0.0.1:3200:3200 \
  --restart unless-stopped \
  siteops-browser-runner
```

Or with Compose:

```bash
cd runner
cp docker-compose.yml.example docker-compose.yml
# edit BROWSER_RUNNER_TOKEN in docker-compose.yml
docker compose up -d
```

The image runs as a non-root user, same as the systemd install. It binds to
`127.0.0.1:3200` by default (via the `-p 127.0.0.1:3200:3200` port mapping) -
put your own reverse proxy in front for HTTPS (Nginx, Caddy, Traefik, or
whatever your Docker host already uses), exactly as in the VPS setup above.
`nginx-siteops-browser-runner.conf.example` still applies if you're using
Nginx.

Update: rebuild the image (`docker build ...` / `docker compose build`) and
recreate the container - this re-runs `npx playwright install` and picks up
both the latest code and a matching Chromium build.

```bash
docker logs -f siteops-browser-runner
curl http://127.0.0.1:3200/health
```

## Manual / development install

```bash
cd runner
npm install
npx playwright install --with-deps chromium
export BROWSER_RUNNER_TOKEN='<long random token>'
npm start
```

## Security

- `/run`, `/render` and `/auth-test` require `Authorization: Bearer <BROWSER_RUNNER_TOKEN>`.
- `/run` navigation steps are restricted to the hostname of the configured SiteOps test URL. `/render` only restricts the scheme to `http`/`https`.
- The runner does not accept arbitrary JavaScript/eval steps.
- Keep the service itself on localhost/private networking and expose it only through HTTPS.
- Keep the token in `/etc/siteops-browser-runner.env` (or your Docker env var) or another secret store, never in Git.

Supported `/run` actions: `goto`, `click`, `fill`, `press`, `select`, `check`, `uncheck`, `hover`, `reload`, `waitFor`, `waitForLoadState`, `wait`, `assertText`, `assertVisible`, `assertValue`, `assertAttribute`, `assertCount`, `assertUrl`, `assertTitle`.

`/render` takes `{ "url": "https://...", "timeoutMs": 20000 }`, navigates once, waits for the network to go quiet (or the timeout, whichever comes first) and returns the rendered `html`. SiteOps' SEO crawler uses this as a fallback for pages that look too thin in the raw HTTP response (client-rendered content, e.g. Next.js).

The runner also captures console errors, uncaught page errors, failed network requests and HTTP 4xx/5xx responses. Visual screenshots run with reduced motion and disabled animations to reduce false-positive pixel diffs.
