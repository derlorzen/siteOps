import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchConsoleClient, searchConsoleScopes } from '../lib/search-console-client.mjs';

const responses = [];
const client = createSearchConsoleClient({
  accessToken: 'test-token',
  fetcher: async (url, init) => {
    responses.push({ url, init });
    return new Response(JSON.stringify({ ok: true, token: 'google-site-verification=example' }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  }
});

test('Google OAuth scopes cover Search Console and domain ownership verification', () => {
  assert.equal(searchConsoleScopes.length, 2);
  assert.ok(searchConsoleScopes.some(x => x.endsWith('/webmasters')));
  assert.ok(searchConsoleScopes.some(x => x.endsWith('/siteverification')));
});

test('read property and performance without exposing access token in URL', async () => {
  await client.listProperties();
  await client.searchAnalytics('sc-domain:example.com', {
    startDate: '2026-10-01', endDate: '2026-10-27', dimensions: ['query', 'page']
  });
  assert.equal(responses[0].url, 'https://www.googleapis.com/webmasters/v3/sites');
  assert.equal(responses[1].init.method, 'POST');
  assert.deepEqual(JSON.parse(responses[1].init.body).dimensions, ['query', 'page']);
  assert.ok(!responses[1].url.includes('test-token'));
  assert.equal(responses[1].init.headers.Authorization, 'Bearer test-token');
});

test('domain ownership uses Google DNS_TXT verification method', async () => {
  await client.getDnsToken('sc-domain:example.com');
  await client.confirmDnsVerification('sc-domain:example.com');
  assert.equal(JSON.parse(responses.at(-2).init.body).site.identifier, 'example.com');
  assert.equal(JSON.parse(responses.at(-2).init.body).verificationMethod, 'DNS_TXT');
  assert.equal(new URL(responses.at(-1).url).searchParams.get('verificationMethod'), 'DNS_TXT');
});

test('reject arbitrary domains, cross-property sitemaps and inspections', async () => {
  assert.throws(() => client.getDnsToken('http://example.com/'), TypeError);
  assert.throws(() => client.getProperty('sc-domain:example.com.evil/'), TypeError);
  assert.throws(() => client.submitSitemap('sc-domain:example.com', 'https://example.com.evil/sitemap.xml'), TypeError);
  assert.throws(() => client.inspectUrl('sc-domain:example.com', 'https://attacker.example.net/'), TypeError);
  assert.throws(() => client.searchAnalytics('sc-domain:example.com', {
    startDate: '2026-10-01', endDate: '2026-10-27', dimensions: ['unexpected']
  }), TypeError);
});

test('does not report a failed Google write as successful', async () => {
  const failing = createSearchConsoleClient({
    accessToken: 'test', fetcher: async () => new Response(JSON.stringify({
      error: { status: 'PERMISSION_DENIED' }
    }), { status: 403 })
  });
  await assert.rejects(failing.addProperty('sc-domain:example.com'), err =>
    err.statusCode === 403 && err.googleReason === 'PERMISSION_DENIED');
});

test('submit sitemap encodes its URL without contacting the sitemap host', async () => {
  await client.submitSitemap('sc-domain:example.com', 'https://www.example.com/sitemap.xml');
  assert.ok(responses.at(-1).url.includes(encodeURIComponent('https://www.example.com/sitemap.xml')));
  assert.equal(responses.at(-1).init.method, 'PUT');
});
