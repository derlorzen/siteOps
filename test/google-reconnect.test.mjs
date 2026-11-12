import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { oauthReturnPath, registerGoogleReconnectRoutes, renderGoogleReconnect } from '../lib/google-reconnect.mjs';
import { renderYouTube } from '../lib/youtube-ui.mjs';
import { renderSearchConsole, renderSearchConsoleOverview } from '../lib/search-console-ui.mjs';

test('the OAuth return path only accepts the YouTube and Search Console workspaces', () => {
  for (const path of [
    '/youtube',
    '/youtube?google_reconnected=1',
    '/search-console?google_reconnected=1',
    '/sites/meine-seite/search-console',
    '/sites/meine-seite/search-console?google_reconnected=1'
  ])
    assert.equal(oauthReturnPath(path, '/fallback'), path);
  for (const path of [
    undefined,
    null,
    42,
    '',
    'youtube',
    '//evil.example/youtube',
    'https://evil.example/youtube',
    '/youtube/../settings',
    '/youtube\\evil',
    '/youtube?next=https://evil.example',
    '/sites/x/files',
    '/api/youtube/disconnect',
    '/youtube?' + 'a'.repeat(200)
  ])
    assert.equal(oauthReturnPath(path, '/fallback'), '/fallback', String(path));
});

test('one endpoint reports expired Google connections of both services without secrets', async t => {
  const app = Fastify();
  t.after(() => app.close());
  let searchConsoleFails = false;
  registerGoogleReconnectRoutes(app, {
    youtube: {
      verifyAccess: async () => [
        {
          id: 'yt-1',
          channel_id: 'UC1',
          title: 'Mein Kanal',
          reconnect_required: true,
          encrypted_credentials: 'secret'
        },
        { id: 'yt-2', channel_id: 'UC2', title: 'Zweitkanal', reconnect_required: false }
      ]
    },
    searchConsole: {
      verifyAccess: async () => {
        if (searchConsoleFails) throw new Error('database down');
        return [{ id: 'gsc-1', email: 'ich@example.org', reconnect_required: false }];
      }
    }
  });
  const body = (await app.inject('/api/google-connections')).json();
  assert.deepEqual(body.connections, [
    {
      service: 'youtube',
      label: 'YouTube',
      accounts: [
        { id: 'yt-1', name: 'Mein Kanal', reconnect_required: true },
        { id: 'yt-2', name: 'Zweitkanal', reconnect_required: false }
      ],
      reconnect_required: true
    },
    {
      service: 'search_console',
      label: 'Search Console',
      accounts: [{ id: 'gsc-1', name: 'ich@example.org', reconnect_required: false }],
      reconnect_required: false
    }
  ]);
  // One failing service must not hide the state of the other, and is not reported as fine.
  searchConsoleFails = true;
  const partial = (await app.inject('/api/google-connections')).json().connections;
  assert.equal(partial[0].reconnect_required, true);
  assert.equal(partial[1].unavailable, true);
  assert.match((await app.inject('/assets/google-reconnect.js')).body, /api\/google-connections/);
  assert.match((await app.inject('/assets/google-reconnect.css')).body, /\.google-reconnect/);
});

test('both workspaces carry the reconnect notice', () => {
  const site = { id: 's', slug: 'demo', name: 'Demo', domain: 'demo.test' };
  for (const html of [
    renderYouTube(),
    renderSearchConsole(site),
    renderSearchConsoleOverview([site], { configured: true, accounts: [] }, [])
  ]) {
    assert.equal((html.match(/id="google-reconnect"/g) || []).length, 1);
    assert.match(html, /\/assets\/google-reconnect\.js/);
  }
  assert.match(renderGoogleReconnect('a b'), /google-reconnect\.css\?v=a%20b/);
});
