# SiteOps Browser Runner

Optional Playwright execution service for SiteOps 1.0 synthetic journeys and visual regression checks.

## Install

```bash
cd runner
npm install
npx playwright install --with-deps chromium
export BROWSER_RUNNER_TOKEN='<long random token>'
npm start
```

The service is intentionally separate from the main Hostinger Cloud application. Run it on a Node.js host/VPS that can launch Chromium.

## Security

- `/run` and `/auth-test` require `Authorization: Bearer <BROWSER_RUNNER_TOKEN>`.
- Navigation steps are restricted to the hostname of the configured SiteOps test URL.
- The runner does not accept arbitrary JavaScript/eval steps.
- Keep the runner behind HTTPS/reverse proxy and do not expose the token in a repository.

Supported actions: `goto`, `click`, `fill`, `press`, `select`, `check`, `uncheck`, `hover`, `reload`, `waitFor`, `waitForLoadState`, `wait`, `assertText`, `assertVisible`, `assertValue`, `assertAttribute`, `assertCount`, `assertUrl`, `assertTitle`.

The runner also captures console errors, uncaught page errors, failed network requests and HTTP 4xx/5xx responses. Visual screenshots run with reduced motion and disabled animations to reduce false-positive pixel diffs.
