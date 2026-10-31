import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { searchConsoleFixture, accountId, txt } from './search-console-fixture.mjs';
import { registerSearchConsoleRoutes, registerSearchConsoleTools } from '../lib/search-console-api.mjs';
import { renderSearchConsole } from '../lib/search-console-ui.mjs';
import { propertyForSite, performanceSummary, searchOpportunities } from '../lib/search-console.mjs';

test('OAuth PKCE state is encrypted, expires, is session/subject-bound and cannot be replayed', async () => {
  const f = searchConsoleFixture(),
    { service, session } = f;
  const u = new URL((await service.beginOAuth(session)).url),
    state = u.searchParams.get('state');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(u.searchParams.get('scope').includes('siteverification'));
  assert.ok(!JSON.stringify([...f.states.values()]).includes(session.tokenHash));
  await assert.rejects(service.completeOAuth({ state, code: 'code' }, { ...session, tokenHash: 'other' }), {
    statusCode: 403
  });
  assert.equal(f.requests.length, 0);
  await service.completeOAuth({ state, code: 'code' }, session);
  assert.ok(f.requests.find(x => x.url.includes('oauth2.googleapis.com')).init.body.get('code_verifier'));
  await assert.rejects(service.completeOAuth({ state, code: 'code' }, session), { statusCode: 403 });
  const second = new URL((await service.beginOAuth(session)).url).searchParams.get('state');
  f.advance(600001);
  await assert.rejects(service.completeOAuth({ state: second, code: 'code' }, session), { statusCode: 403 });
  f.setSubject('another-user');
  await assert.rejects(service.properties(accountId, 'demo'), { statusCode: 403 });
});

test('missing scopes, denied consent and invalid Google user fail without persisting credentials', async () => {
  for (const payload of [
    { access_token: 't', refresh_token: 'r', scope: 'openid' },
    { access_token: 't', scope: 'openid' }
  ]) {
    const f = searchConsoleFixture({
      fetcher: async url => (url.includes('oauth2.googleapis.com/token') ? Response.json(payload) : null)
    });
    const state = new URL((await f.service.beginOAuth(f.session)).url).searchParams.get('state');
    await assert.rejects(f.service.completeOAuth({ state, code: 'code' }, f.session), { statusCode: 403 });
    assert.equal(f.accounts.size, 1);
    assert.ok(!f.requests.some(x => x.url.includes('/userinfo')));
  }
  const f = searchConsoleFixture();
  const state = new URL((await f.service.beginOAuth(f.session)).url).searchParams.get('state');
  await assert.rejects(f.service.completeOAuth({ state, error: 'access_denied' }, f.session), { statusCode: 422 });
  assert.equal(f.requests.length, 0);
});

test('tokens refresh once for concurrent readers and 401 retries after refresh; secrets stay private', async () => {
  const f = searchConsoleFixture();
  f.expireToken();
  await Promise.all([f.service.properties(accountId, 'demo'), f.service.properties(accountId, 'demo')]);
  assert.equal(f.requests.filter(x => x.url === 'https://oauth2.googleapis.com/token').length, 1);
  assert.ok(!JSON.stringify(await f.service.status('demo')).includes('access-test'));
  let rejected = false;
  const g = searchConsoleFixture({
    fetcher: async url => {
      if (url.endsWith('/sites') && !rejected) {
        rejected = true;
        return Response.json({ error: {} }, { status: 401 });
      }
    }
  });
  await g.service.properties(accountId, 'demo');
  assert.equal(g.requests.filter(x => x.url.endsWith('/sites')).length, 2);
  assert.equal(g.requests.filter(x => x.url === 'https://oauth2.googleapis.com/token').length, 1);
});

test('linking never registers remotely, rejects foreign properties, resets live approval and cache', async () => {
  const f = searchConsoleFixture();
  await f.link();
  assert.ok(f.requests.every(x => x.init.method === 'GET'));
  assert.equal(f.linkage.live_approved_at, null);
  assert.throws(() => propertyForSite(f.site, 'sc-domain:evil-example.com'));
  assert.throws(() => propertyForSite(f.site, 'https://example.com.evil/'));
  assert.throws(() => propertyForSite(f.site, 'https://user:password@example.com/'));
  await f.approve('live');
  await f.service.sync('demo');
  assert.equal((await f.service.performance('demo')).available, true);
  await f.link();
  assert.equal(f.linkage.live_approved_at, null);
  assert.equal((await f.service.performance('demo')).available, false);
});

test('every external mutation requires project live approval; daily worker never registers websites', async () => {
  const f = searchConsoleFixture();
  await f.link();
  for (const action of ['property', 'dns', 'verify', 'sitemap'])
    await assert.rejects(f.service.preview({ site: 'demo', action }), { statusCode: 403 });
  await assert.rejects(f.service.sync('demo'), { statusCode: 403 });
  await f.service.tick();
  assert.ok(f.requests.every(x => x.init.method === 'GET'));
  assert.equal(f.dnsEvents.length, 0);
});

test('approval binds exact project, domain, revision, expiry and confirmation, and consumes token atomically', async () => {
  const f = searchConsoleFixture();
  await f.link();
  const p = await f.service.preview({ site: 'demo', action: 'live' });
  const input = { preview_token: p.preview_token, approved: true, confirmation: p.confirmation };
  await assert.rejects(f.service.execute({ ...input, approved: false }), { statusCode: 422 });
  await assert.rejects(f.service.execute({ ...input, confirmation: 'another-project example.com' }), {
    statusCode: 403
  });
  await f.service.execute(input);
  await assert.rejects(f.service.execute(input), { statusCode: 409 });
  assert.equal((await f.service.changeStatus(p.preview_token)).status, 'done');
  const expired = await f.service.preview({ site: 'demo', action: 'dns' });
  f.advance(600001);
  await assert.rejects(f.service.execute({ ...input, preview_token: expired.preview_token }), { statusCode: 403 });
  const changed = await f.service.preview({ site: 'demo', action: 'dns' });
  await f.link();
  await assert.rejects(f.service.execute({ ...input, preview_token: changed.preview_token }), { statusCode: 403 });
  await f.approve('live');
  const domainChange = await f.service.preview({ site: 'demo', action: 'dns' });
  f.site.domain = 'different.example.com';
  await assert.rejects(f.service.execute({ ...input, preview_token: domainChange.preview_token }), { statusCode: 409 });
  assert.equal(f.dnsEvents.length, 0);
});

test('DNS submission, Google verification, property registration and sitemap are independent', async () => {
  const f = searchConsoleFixture();
  f.setRemoteProperty(null);
  await f.link();
  await f.approve('live');
  assert.equal(f.linkage.verified_at, null);
  await assert.rejects(f.approve('property'), { statusCode: 403 });
  const result = await f.approve('dns', { allinkl_account_id: accountId });
  assert.equal(result.google_verified, false);
  assert.equal(f.linkage.verified_at, null);
  await f.approve('verify');
  assert.ok(f.linkage.verified_at);
  f.setRemoteProperty({ permissionLevel: 'siteOwner' });
  await f.approve('property');
  assert.equal(f.linkage.permission_level, 'siteOwner');
  assert.equal(f.linkage.sitemap_status, 'not_submitted');
  await f.approve('sitemap');
  assert.equal(f.linkage.sitemap_status, 'submitted');
  const puts = f.requests.filter(x => x.init.method === 'PUT');
  assert.equal(puts.length, 2);
  assert.ok(puts[1].url.includes('/sitemaps/'));
});

test('DNS propagation and uncertain provider writes fail safely and never replay', async () => {
  const f = searchConsoleFixture({ dnsPresent: false });
  await f.link();
  await f.approve('live');
  await assert.rejects(f.approve('verify'), { statusCode: 409 });
  assert.ok(!f.requests.some(x => x.url.includes('/webResource?')));
  const g = searchConsoleFixture({ dnsFailure: true });
  await g.link();
  await g.approve('live');
  const p = await g.service.preview({ site: 'demo', action: 'dns' }),
    input = { preview_token: p.preview_token, confirmation: p.confirmation, approved: true };
  await assert.rejects(g.service.execute(input), { statusCode: 503 });
  await assert.rejects(g.service.execute(input), { statusCode: 409 });
  assert.equal(g.dnsEvents.length, 1);
  assert.equal((await g.service.changeStatus(p.preview_token)).status, 'failed');
});

test('sitemap rejects cross-origin, non-XML, entities, changed content and insufficient permissions', async () => {
  const f = searchConsoleFixture();
  await f.link();
  await f.approve('live');
  await assert.rejects(
    f.service.preview({ site: 'demo', action: 'sitemap', sitemap_url: 'https://other.example.net/sitemap.xml' }),
    { statusCode: 422 }
  );
  for (const body of [
    '<html>Login</html>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/</loc></url>',
    '<!DOCTYPE urlset><urlset/>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://evil.example.net/</loc></url></urlset>'
  ]) {
    f.setSitemap(body);
    await assert.rejects(f.service.preview({ site: 'demo', action: 'sitemap' }), { statusCode: 422 });
  }
  const g = searchConsoleFixture();
  await g.link();
  await g.approve('live');
  const p = await g.service.preview({ site: 'demo', action: 'sitemap' });
  g.setSitemap(
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/changed</loc></url></urlset>'
  );
  await assert.rejects(
    g.service.execute({ preview_token: p.preview_token, approved: true, confirmation: p.confirmation }),
    { statusCode: 409 }
  );
  g.setRemoteProperty({ permissionLevel: 'siteRestrictedUser' });
  await assert.rejects(g.approve('sitemap'), { statusCode: 403 });
  assert.ok(!g.requests.some(x => x.init.method === 'PUT'));
});

test('sync uses final data, weighted metrics, separate dimensions, comparison and opportunities', async () => {
  const f = searchConsoleFixture();
  await f.link();
  await f.approve('live');
  const result = await f.service.sync('demo');
  assert.equal(result.totals.ctr, 0.01);
  assert.equal(result.totals.position, 12);
  assert.equal(result.opportunities.length, 2);
  assert.ok(result.previous_range.endDate < result.range.startDate);
  for (const call of f.requests.filter(x => x.url.includes('/searchAnalytics/')))
    assert.equal(JSON.parse(call.init.body).dataState, 'final');
  assert.deepEqual(
    f.requests.filter(x => x.url.includes('/searchAnalytics/')).map(x => JSON.parse(x.init.body).dimensions),
    [['date'], ['date'], ['query'], ['page']]
  );
  assert.equal((await f.service.performance('demo', { dimension: 'page' })).rows[0].keys[0], 'https://example.com/');
  assert.equal((await f.service.performance('demo', { offset: 1 })).rows.length, 0);
  assert.equal(f.dnsEvents.length, 0);
  assert.ok(!f.requests.some(x => x.init.method === 'PUT' || x.url.includes('/webResource?')));
  assert.deepEqual(
    performanceSummary([
      { clicks: 1, impressions: 10, position: 2 },
      { clicks: 9, impressions: 90, position: 12 }
    ]),
    { clicks: 10, impressions: 100, ctr: 0.1, position: 11 }
  );
  assert.deepEqual(searchOpportunities([], []), []);
});

test('sync paginates API and retries bounded transient failures without losing last successful report', async () => {
  let failures = 0,
    queries = 0;
  const sleeps = [];
  const f = searchConsoleFixture({
    onSleep: ms => sleeps.push(ms),
    fetcher: async (url, init) => {
      if (!url.includes('/searchAnalytics/')) return;
      if (failures++ === 0) return Response.json({}, { status: 429 });
      const body = JSON.parse(init.body);
      if (body.dimensions[0] === 'query') {
        queries++;
        return Response.json({
          rows:
            body.startRow === 0
              ? Array.from({ length: body.rowLimit }, (_, i) => ({
                  keys: ['query-' + i],
                  clicks: 0,
                  impressions: 1,
                  ctr: 0,
                  position: 10
                }))
              : []
        });
      }
    }
  });
  await f.link();
  await f.approve('live');
  await f.service.sync('demo');
  assert.equal(queries, 2);
  assert.equal(sleeps.length, 1);
  const report = await f.service.performance('demo', { offset: 4900, limit: 100 });
  assert.equal(report.rows.length, 100);
  assert.equal(report.next_offset, null);
  f.linkage.sync_lease_token = 'locked';
  await assert.rejects(f.service.sync('demo'), { statusCode: 409 });
  assert.equal((await f.service.performance('demo')).available, true);
  f.linkage.sync_lease_token = null;
  f.setRemoteProperty({ permissionLevel: 'siteUnverifiedUser' });
  await assert.rejects(f.service.sync('demo'), { statusCode: 403 });
  assert.equal((await f.service.performance('demo')).available, true);
  assert.ok(f.linkage.sync_error);
});

test('performance filters and sorts the complete authorized cache before pagination without modifying it', async () => {
  const f = searchConsoleFixture({
    fetcher: async (url, init) => {
      if (url.includes('/searchAnalytics/') && JSON.parse(init.body).dimensions[0] === 'query')
        return Response.json({
          rows: Array.from({ length: 135 }, (_, i) => ({
            keys: [i === 134 ? 'Bücher Agentur' : 'query-' + i],
            clicks: i,
            impressions: 200,
            ctr: i / 200,
            position: 135 - i
          }))
        });
    }
  });
  await f.link();
  await f.approve('live');
  await f.service.sync('demo');
  const before = JSON.stringify([...f.reports]);
  const filtered = await f.service.performance('demo', { query: 'BÜCHER', limit: 10, sort: 'clicks' });
  assert.equal(filtered.total_rows, 1);
  assert.equal(filtered.source_total_rows, 135);
  assert.equal(filtered.rows[0].clicks, 134);
  assert.equal(filtered.next_offset, null);
  const page = await f.service.performance('demo', { sort: 'clicks', order: 'desc', offset: 10, limit: 10 });
  assert.equal(page.rows[0].clicks, 124);
  assert.equal(page.next_offset, 20);
  const position = await f.service.performance('demo', { sort: 'position', order: 'asc', limit: 1 });
  assert.equal(position.rows[0].position, 1);
  assert.equal(JSON.stringify([...f.reports]), before);
  assert.equal((await f.service.performance('demo')).rows[0].clicks, 0);
  const tools = new Map();
  registerSearchConsoleTools(
    { registerTool: (name, definition, run) => tools.set(name, { definition, run }) },
    f.service,
    value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] })
  );
  const mcp = await tools
    .get('search_console_performance')
    .run({ site: 'demo', query: 'BÜCHER', sort: 'position', order: 'asc', limit: 10 });
  assert.deepEqual(
    JSON.parse(mcp.content[0].text).rows,
    filtered.rows,
    'MCP shares the same full-cache search and authorization'
  );
  await assert.rejects(f.service.performance('demo', { limit: 1000 }), { statusCode: 422 });
  await assert.rejects(f.service.performance('demo', { sort: 'credentials' }), { statusCode: 422 });
  f.setSubject('another-user');
  await assert.rejects(f.service.performance('demo', { query: 'Bücher' }), { statusCode: 403 });
});

test('URL inspection enforces property boundaries and persistent per-property quota', async () => {
  const f = searchConsoleFixture();
  await f.link();
  await f.approve('live');
  await assert.rejects(f.service.inspect('demo', 'https://example.com.evil/'));
  await assert.rejects(f.service.inspect('demo', 'https://user:secret@example.com/'));
  const result = await f.service.inspect('demo', 'https://example.com/page');
  assert.equal(result.inspectionResult.indexStatusResult.verdict, 'PASS');
  for (const key of f.quotas.keys()) f.quotas.set(key, 100);
  await assert.rejects(f.service.inspect('demo', 'https://example.com/'), { statusCode: 429 });
  assert.equal(f.requests.filter(x => x.url.includes('/urlInspection/')).length, 1);
});

test('routes require session and same-origin JSON; dashboard escapes project data', async t => {
  const f = searchConsoleFixture(),
    app = Fastify();
  t.after(() => app.close());
  app.addHook('onRequest', async req => {
    if (req.headers.authorization === 'test-session') req.siteopsSession = f.session;
  });
  registerSearchConsoleRoutes(app, f.service, {
    origin: () => 'https://siteops.example.com',
    page: (_title, body) => body,
    render: renderSearchConsole,
    getSite: async () => f.site
  });
  assert.equal((await app.inject('/api/search-console/status')).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/search-console/link',
        headers: { authorization: 'test-session', origin: 'https://evil.example.net' },
        payload: { site: 'demo', account_id: accountId, property: 'sc-domain:example.com' }
      })
    ).statusCode,
    403
  );
  const response = await app.inject({
    method: 'POST',
    url: '/api/search-console/link',
    headers: { authorization: 'test-session', origin: 'https://siteops.example.com' },
    payload: { site: 'demo', account_id: accountId, property: 'sc-domain:example.com' }
  });
  assert.equal(response.statusCode, 200, response.body);
  const html = renderSearchConsole({ ...f.site, name: '<script>alert(1)</script>' });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
  for (const id of ['gsc-states', 'gsc-approved', 'gsc-preview-text', 'gsc-metrics', 'gsc-inspect'])
    assert.ok(html.includes(id));
});

test('MCP discovers complete typed tool catalog and uses the same live gate as HTTP', async t => {
  const f = searchConsoleFixture();
  await f.link();
  const tools = new Map();
  registerSearchConsoleTools(
    { registerTool: (name, definition, run) => tools.set(name, { definition, run }) },
    f.service,
    value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] })
  );
  assert.equal(tools.size, 10);
  assert.equal(tools.get('search_console_status').definition.annotations.readOnlyHint, true);
  assert.equal(tools.get('search_console_change_execute').definition.annotations.destructiveHint, true);
  const failed = await tools.get('search_console_change_preview').run({ site: 'demo', action: 'dns' });
  assert.equal(failed.isError, true);
  assert.equal(JSON.parse(failed.content[0].text).status, 403);
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: 'gsc-test', version: '1' });
    registerSearchConsoleTools(server, f.service, x => x);
    return server;
  });
  t.after(() => handler.close());
  const response = await handler.fetch(
    new globalThis.Request('http://localhost/mcp', {
      method: 'POST',
      headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    })
  );
  const payload = JSON.parse(
    (await response.text())
      .split('\n')
      .find(x => x.startsWith('data: '))
      .slice(6)
  );
  assert.equal(payload.result.tools.length, 10);
  assert.ok(payload.result.tools.every(x => x.inputSchema.type === 'object'));
});

test('local unlink/disconnect do not revoke remote properties or DNS', async () => {
  const f = searchConsoleFixture();
  await f.link();
  await f.approve('live');
  const before = f.requests.length;
  await f.service.unlink('demo');
  assert.equal(f.requests.length, before);
  assert.equal(f.linkage, null);
  await f.link();
  const beforeDisconnect = f.requests.length;
  await f.service.disconnect(accountId);
  assert.equal(f.accounts.size, 0);
  assert.equal(f.linkage, null);
  assert.equal(f.requests.length, beforeDisconnect);
  assert.equal(f.dnsEvents.length, 0);
  assert.ok(txt.startsWith('google-site-verification='));
});
