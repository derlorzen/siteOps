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

Supported actions: `goto`, `click`, `fill`, `press`, `waitFor`, `wait`, `assertText`, `assertVisible`, `assertUrl`, `assertTitle`.
