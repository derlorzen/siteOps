import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createConnectionProfiles, registerConnectionProfileRoutes } from '../lib/connection-profiles.mjs';

const firstSite = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Lorzen',
  domain: 'lorzen.de',
  protocol: 'ftp',
  host: 'ftp.example.com'
};

test('source-site list exposes webspace connection metadata without credentials', async () => {
  let query;
  const db = {
    async query(sql) {
      query = sql;
      return [[{ ...firstSite, encrypted_credentials: 'encrypted-value', username: 'secret-user' }]];
    }
  };
  const service = createConnectionProfiles({ db, encrypt: () => '', decrypt: () => ({}) });
  assert.deepEqual(await service.sourceSites(), [firstSite]);
  assert.match(query, /deployment_mode='webspace'/);
  assert.match(query, /protocol IN \('ftp','ftps','sftp'\)/);
  assert.doesNotMatch(query, /encrypted_credentials|password|username/i);
});

test('a dedicated endpoint serves existing websites to the profile selector', async () => {
  const handlers = new Map();
  const app = {
    get(path, callback) {
      handlers.set('GET ' + path, callback);
    },
    post() {},
    delete() {},
    addHook() {}
  };
  registerConnectionProfileRoutes(app, { sourceSites: () => [firstSite], list: () => [] }, () => 'https://example.com');
  assert.deepEqual(await handlers.get('GET /api/server-profiles/source-sites')(), [firstSite]);
});

test('website setup loads hosting sources from the dedicated endpoint and handles errors', async () => {
  const appSource = await readFile(new URL('../app.mjs', import.meta.url), 'utf8');
  const setup = appSource.slice(
    appSource.indexOf('function setupPage()'),
    appSource.indexOf('function setupPage()') + 22000
  );
  assert.match(setup, /fetch\('\/api\/server-profiles\/source-sites'\)/);
  assert.match(setup, /sites\.length\?'Website wählen/);
  assert.match(setup, /profileSource\.disabled=!sites\.length/);
  assert.match(setup, /Websites konnten nicht geladen werden/);
  assert.doesNotMatch(setup, /sites\.filter\(s=>s\.deploymentMode==='webspace'\)/);
});
