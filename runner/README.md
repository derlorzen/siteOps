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

## Manual / development install

```bash
cd runner
npm install
npx playwright install --with-deps chromium
export BROWSER_RUNNER_TOKEN='<long random token>'
npm start
```

## Security

- `/run` and `/auth-test` require `Authorization: Bearer <BROWSER_RUNNER_TOKEN>`.
- Navigation steps are restricted to the hostname of the configured SiteOps test URL.
- The runner does not accept arbitrary JavaScript/eval steps.
- Keep the service itself on localhost/private networking and expose it only through HTTPS.
- Keep the token in `/etc/siteops-browser-runner.env` or another secret store, never in Git.

Supported actions: `goto`, `click`, `fill`, `press`, `select`, `check`, `uncheck`, `hover`, `reload`, `waitFor`, `waitForLoadState`, `wait`, `assertText`, `assertVisible`, `assertValue`, `assertAttribute`, `assertCount`, `assertUrl`, `assertTitle`.

The runner also captures console errors, uncaught page errors, failed network requests and HTTP 4xx/5xx responses. Visual screenshots run with reduced motion and disabled animations to reduce false-positive pixel diffs.
