import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAllInklHttpChallenge, http01File } from '../lib/allinkl-http-challenge.mjs';

const hostname = 'container.lorzen.de';
const accountId = '11111111-1111-4111-8111-111111111111';
const root = '/siteops-websites/container-lorzen-de';
const token = 'q123456789_abcdef012345';
const authorization = token + '.abcdefghij_-ABCDEFGH0123456789';
function fixture({ kasRoot = root + '/public', publicResponse = 'correct' } = {}) {
  const files = new Map();
  const events = [];
  const site = {
    remote_root: root,
    domain: hostname,
    deployment_mode: 'webspace'
  };
  const db = {
    async query(sql, params) {
      assert.match(sql, /FROM sites WHERE domain=/);
      assert.equal(params[0], hostname);
      return [[site]];
    }
  };
  const allInklService = {
    async subdomains(id) {
      assert.equal(id, accountId);
      return [{ subdomain_name: hostname, subdomain_path: kasRoot + '/' }];
    }
  };
  const connectSite = async input => {
    assert.equal(input, site);
    return {
      async ensureDirectory(p) { events.push(['mkdir', p]); },
      async exists(p) { return files.has(p); },
      async write(p, bytes) { files.set(p, Buffer.from(bytes)); events.push(['write', p]); },
      async read(p) { return files.get(p); },
      async remove(p) { files.delete(p); events.push(['remove', p]); },
      async close() { events.push(['close']); }
    };
  };
  const fetcher = async (url, options) => {
    const expectedPath = root + '/public/.well-known/acme-challenge/' + token;
    assert.equal(url, 'http://' + hostname + '/.well-known/acme-challenge/' + token);
    assert.equal(options.redirect, 'manual');
    const response = publicResponse === 'correct'
      ? files.get(expectedPath)?.toString('utf8') || null
      : publicResponse;
    return {
      status: response === null ? 404 : publicResponse === 'redirect' ? 302 : 200,
      headers: { get: () => String(response?.length || 0) },
      async text() { return response || ''; }
    };
  };
  return { files, events, ssl: createAllInklHttpChallenge({
    db, allInklService, connectSite, fetcher, sleep: async () => {}
  }) };
}

test('HTTP-01 uses exact token file under KAS-verified site public/ and cleans after validation', async () => {
  const f = fixture();
  await f.ssl.put(accountId, hostname, token, authorization);
  const path = root + '/public/' + http01File(token, authorization);
  assert.equal(f.files.get(path).toString('utf8'), authorization);
  assert.ok(f.events.some(([kind, p]) => kind === 'mkdir' && p === root + '/public/.well-known/acme-challenge'));
  await f.ssl.verify(hostname, token, authorization);
  await f.ssl.remove(accountId, hostname, token, authorization);
  assert.equal(f.files.size, 0);
  assert.ok(f.events.some(([kind, p]) => kind === 'remove' && p === path));
});

test('HTTP-01 cannot traverse paths, overwrite foreign files or delete modified challenges', async () => {
  const f = fixture();
  assert.throws(() => http01File('../escape', authorization), /Ungültige/);
  assert.throws(() => http01File('..', authorization), /Ungültige/);
  assert.throws(() => http01File(token, 'unrelated-payload'), /Ungültige/);
  const path = root + '/public/' + http01File(token, authorization);
  f.files.set(path, Buffer.from('foreign data'));
  await assert.rejects(() => f.ssl.put(accountId, hostname, token, authorization), /fremdem Inhalt/);
  await f.ssl.remove(accountId, hostname, token, authorization);
  assert.equal(f.files.get(path).toString('utf8'), 'foreign data');
});

test('HTTP-01 refuses a subdomain whose KAS webroot differs from the registered site', async () => {
  const f = fixture({ kasRoot: '/other-customer/public' });
  await assert.rejects(
    () => f.ssl.put(accountId, hostname, token, authorization),
    /ALL-INKL-Webroot weicht/
  );
  assert.equal(f.events.length, 0);
});

test('HTTP-01 rejects redirects and incorrect content instead of requesting a certificate', async () => {
  const f = fixture({ publicResponse: 'redirect' });
  await f.ssl.put(accountId, hostname, token, authorization);
  await assert.rejects(() => f.ssl.verify(hostname, token, authorization, { maxAttempts: 2 }), /nicht unverändert/);
  const altered = fixture({ publicResponse: 'wrong content' });
  await altered.ssl.put(accountId, hostname, token, authorization);
  await assert.rejects(() => altered.ssl.verify(hostname, token, authorization, { maxAttempts: 2 }), /nicht unverändert/);
});
