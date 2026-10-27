import { readFileSync } from 'node:fs';
export const RUNNER_VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
export function registerRunnerHealth(app, auth) {
  app.get('/health', async () => ({ status: 'ok', service: 'siteops-browser-runner', version: RUNNER_VERSION }));
  app.get('/auth-test', async (req, reply) => {
    if (!auth(req, reply)) return;
    return { ok: true, version: RUNNER_VERSION };
  });
}
