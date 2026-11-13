// Shared "reconnect Google" notice for the YouTube and Search Console workspaces.
import { readFile } from 'node:fs/promises';

// Where the browser lands after Google's consent screen. Only local paths of the two
// workspaces are accepted, so the OAuth round trip can never be used as an open redirect.
export function oauthReturnPath(value, fallback) {
  const path = typeof value === 'string' ? value : '';
  return /^\/(?:youtube|search-console|sites\/[a-z0-9-]{1,80}\/search-console)(?:[?#][\w\-=&.%#]{0,100})?$/i.test(path)
    ? path
    : fallback;
}

export function renderGoogleReconnect(assetVersion = 'v1') {
  const assets = '?v=' + encodeURIComponent(assetVersion);
  return `<div id="google-reconnect" class="google-reconnect" hidden></div><link rel="stylesheet" href="/assets/google-reconnect.css${assets}"><script defer src="/assets/google-reconnect.js${assets}"></script>`;
}

export function registerGoogleReconnectRoutes(app, { youtube, searchConsole }) {
  for (const [name, type] of [
    ['google-reconnect.js', 'text/javascript'],
    ['google-reconnect.css', 'text/css']
  ])
    app.get('/assets/' + name, async (_req, reply) =>
      reply
        .type(type)
        .header('Cache-Control', 'no-store')
        .send(await readFile(new URL('../public/' + name, import.meta.url), 'utf8'))
    );
  // One answer for both integrations. `verify` asks Google whether the stored access still
  // works (a token refresh, no API quota), so an expired connection shows up before the
  // first failed request. A service that cannot be checked is reported, never guessed.
  app.get('/api/google-connections', async () => {
    const check = async (service, label, load) => {
      try {
        const accounts = await load();
        return {
          service,
          label,
          accounts: accounts.map(account => ({
            id: account.id,
            name: account.title || account.email,
            reconnect_required: Boolean(account.reconnect_required)
          })),
          reconnect_required: accounts.some(account => account.reconnect_required)
        };
      } catch {
        return { service, label, accounts: [], reconnect_required: false, unavailable: true };
      }
    };
    return {
      connections: await Promise.all([
        check('youtube', 'YouTube', () => youtube.verifyAccess()),
        check('search_console', 'Search Console', () => searchConsole.verifyAccess())
      ])
    };
  });
}
