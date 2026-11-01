import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fields = html =>
  Object.fromEntries(
    [...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)].map(match => [match[1], match[2]])
  );
const cookie = response =>
  []
    .concat(response.headers['set-cookie'] || [])
    .map(value => value.split(';')[0])
    .join('; ');
const rpcResult = body =>
  JSON.parse(
    body.trim().startsWith('{')
      ? body
      : body
          .split('\n')
          .find(line => line.startsWith('data:'))
          .slice(5)
  );

test(
  'real HTTP OAuth flow: login, DCR, PKCE, discovery, tool call, expiry, rotating refresh and replay rejection',
  { timeout: 20000 },
  async t => {
    process.env.SITEOPS_TEST_NO_AUTOSTART = '1';
    process.env.DASHBOARD_USER = 'oauth-fixture';
    process.env.DASHBOARD_PASSWORD = 'local-fixture-password';
    process.env.SITEOPS_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
    const { buildApplication, db } = await import('../app.mjs');
    const clients = new Map(),
      codes = new Map(),
      tokens = new Map(),
      sessions = new Map(),
      customers = new Map();
    t.mock.method(db, 'query', async (sql, p = []) => {
      const text = sql.toLowerCase().replace(/\s+/g, ' ').trim();
      if (text.startsWith('insert into customers(')) {
        const keys = sql.match(/customers\(([^)]+)\)/i)[1].split(',');
        const row = Object.fromEntries(keys.map((key, i) => [key, p[i]]));
        customers.set(row.id, row);
        return [{ affectedRows: 1 }, []];
      }
      if (text.startsWith('update customers set ')) {
        const keys = sql
          .match(/SET (.+) WHERE/i)[1]
          .split(',')
          .map(part => part.split('=')[0]);
        const row = customers.get(p.at(-1));
        keys.forEach((key, i) => (row[key] = p[i]));
        return [{ affectedRows: 1 }, []];
      }
      if (text.startsWith('select * from customers where')) return [[customers.get(p[0])].filter(Boolean), []];
      if (text.includes('from customers c order by'))
        return [[...customers.values()].map(row => ({ ...row, projects: 0 })), []];
      if (text === 'select * from sites order by name')
        return [
          [
            {
              id: '11111111-1111-4111-8111-111111111111',
              slug: 'legacy',
              deployment_mode: 'webspace',
              remote_root: '/public',
              monitor_enabled: 1,
              encrypted_credentials: 'do-not-return',
              git_credentials: 'do-not-return'
            }
          ],
          []
        ];
      if (text.startsWith('insert into dashboard_sessions')) {
        sessions.set(p[0], { subject: p[1], credential_revision: p[2] });
        return [{ affectedRows: 1 }, []];
      }
      if (text.startsWith('select') && text.includes('from dashboard_sessions'))
        return [[sessions.get(p[0])].filter(Boolean), []];
      if (text.startsWith('insert into oauth_clients')) {
        clients.set(p[1], {
          id: p[0],
          client_id: p[2],
          client_name: p[3],
          client_secret_hash: p[4],
          token_endpoint_auth_method: p[5],
          redirect_uris: p[6],
          metadata: p[7]
        });
        return [{ affectedRows: 1 }, []];
      }
      if (text.startsWith('select') && text.includes('from oauth_clients'))
        return [[clients.get(p[0])].filter(Boolean), []];
      if (text.startsWith('insert into oauth_authorization_codes')) {
        codes.set(
          p[1],
          Object.fromEntries(
            [
              'id',
              'code_hash',
              'client_id',
              'redirect_uri',
              'code_challenge',
              'code_challenge_method',
              'scope',
              'resource',
              'subject',
              'expires_at'
            ].map((key, i) => [key, p[i]])
          )
        );
        return [{ affectedRows: 1 }, []];
      }
      if (text.startsWith('select') && text.includes('from oauth_authorization_codes')) {
        const row = codes.get(p[0]);
        return [[row].filter(row => row && !row.consumed_at && row.expires_at > Date.now()), []];
      }
      if (text.startsWith('update oauth_authorization_codes')) {
        const row = [...codes.values()].find(row => row.id === p[0] && !row.consumed_at);
        if (row) row.consumed_at = new Date();
        return [{ affectedRows: row ? 1 : 0 }, []];
      }
      if (text.startsWith('insert into oauth_tokens')) {
        tokens.set(
          p[1],
          Object.fromEntries(
            ['id', 'token_hash', 'token_type', 'client_id', 'scope', 'resource', 'subject', 'expires_at'].map(
              (key, i) => [key, p[i]]
            )
          )
        );
        return [{ affectedRows: 1 }, []];
      }
      if (text.startsWith('select') && text.includes('from oauth_tokens')) {
        const row = tokens.get(p[0]);
        return [
          [row].filter(
            row =>
              row &&
              !row.revoked_at &&
              row.expires_at > Date.now() &&
              row.token_type === (text.includes("token_type='refresh'") ? 'refresh' : 'access')
          ),
          []
        ];
      }
      if (text.startsWith('update oauth_tokens')) {
        const row = [...tokens.values()].find(row => row.id === p[0] && !row.revoked_at);
        if (row) row.revoked_at = new Date();
        return [{ affectedRows: row ? 1 : 0 }, []];
      }
      if (text.startsWith('insert into audit_log') || text.startsWith('delete from ')) return [{ affectedRows: 1 }, []];
      throw Error('Unexpected fixture query');
    });
    const app = await buildApplication({ initialize: false });
    t.after(async () => {
      await app.close();
      await db.end();
    });
    const login = await app.inject({ method: 'GET', url: '/login' });
    const loggedIn = await app.inject({
      method: 'POST',
      url: '/login',
      headers: { cookie: cookie(login), origin: 'http://localhost:3000', 'content-type': 'application/json' },
      payload: { ...fields(login.body), username: 'oauth-fixture', password: 'local-fixture-password' }
    });
    assert.equal(loggedIn.statusCode, 303);
    const dashboardCookie = cookie(loggedIn);
    const siteList = await app.inject({ method: 'GET', url: '/api/sites', headers: { cookie: dashboardCookie } });
    assert.equal(siteList.statusCode, 200);
    assert.equal(siteList.json()[0].remote_root, '/public');
    assert.equal(siteList.json()[0].deployment_mode, 'webspace');
    assert.doesNotMatch(siteList.body, /do-not-return|encrypted_credentials|git_credentials/);
    for (const [name, redirect] of [
      ['ChatGPT protocol fixture', 'https://chatgpt.com/connector_platform/oauth_redirect'],
      ['Claude protocol fixture', 'https://claude.ai/api/mcp/auth_callback']
    ]) {
      const registered = await app.inject({
        method: 'POST',
        url: '/oauth/register',
        payload: { client_name: name, redirect_uris: [redirect], token_endpoint_auth_method: 'none' }
      });
      assert.equal(registered.statusCode, 201);
      const client = registered.json(),
        verifier = crypto.randomBytes(48).toString('base64url');
      const params = {
        response_type: 'code',
        client_id: client.client_id,
        redirect_uri: redirect,
        code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
        resource: 'http://localhost:3000/mcp',
        scope: 'siteops:access siteops:write offline_access',
        state: 'fixture-state'
      };
      const consent = await app.inject({
        method: 'GET',
        url: '/oauth/authorize?' + new URLSearchParams(params),
        headers: { cookie: dashboardCookie }
      });
      assert.equal(consent.statusCode, 200);
      const authorized = await app.inject({
        method: 'POST',
        url: '/oauth/authorize',
        headers: { cookie: dashboardCookie, origin: 'http://localhost:3000' },
        payload: { ...fields(consent.body), decision: 'allow' }
      });
      assert.equal(authorized.statusCode, 302);
      const callback = new URL(authorized.headers.location);
      assert.equal(callback.searchParams.get('state'), 'fixture-state');
      const exchange = {
        grant_type: 'authorization_code',
        client_id: client.client_id,
        redirect_uri: redirect,
        resource: params.resource,
        code: callback.searchParams.get('code'),
        code_verifier: verifier
      };
      assert.equal(
        (
          await app.inject({
            method: 'POST',
            url: '/oauth/token',
            payload: { ...exchange, code_verifier: 'incorrect-verifier' }
          })
        ).statusCode,
        400
      );
      const token = await app.inject({ method: 'POST', url: '/oauth/token', payload: exchange });
      assert.equal(token.statusCode, 200);
      const credentials = token.json();
      assert.equal((await app.inject({ method: 'POST', url: '/oauth/token', payload: exchange })).statusCode, 400);
      const rpc = async (method, params) =>
        app.inject({
          method: 'POST',
          url: '/mcp',
          headers: {
            authorization: 'Bearer ' + credentials.access_token,
            accept: 'application/json, text/event-stream',
            'content-type': 'application/json'
          },
          payload: { jsonrpc: '2.0', id: 1, method, params }
        });
      const initialized = await rpc('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name, version: 'fixture' }
      });
      assert.equal(initialized.statusCode, 200);
      assert.ok(rpcResult(initialized.body).result.capabilities.tools);
      const catalog = await rpc('tools/list', {});
      assert.ok(rpcResult(catalog.body).result.tools.length > 200);
      const called = await rpc('tools/call', { name: 'capabilities_list', arguments: { limit: 1 } });
      assert.equal(rpcResult(called.body).result.isError, undefined);
      assert.equal(rpcResult(called.body).result.structuredContent.data.items.length, 1);
      // Cross-adapter workflow: a real REST controller writes, MCP edits the same
      // record, REST reads it, and MCP can create another record. Only SQL is a fixture.
      const headers = { cookie: dashboardCookie, origin: 'http://localhost:3000', 'content-type': 'application/json' };
      const created = await app.inject({
        method: 'POST',
        url: '/api/billing/customers',
        headers,
        payload: { name: '  Nordlicht ' + name + '  ' }
      });
      assert.equal(created.statusCode, 201);
      assert.equal(created.json().country, 'DE');
      assert.equal(created.json().name, 'Nordlicht ' + name);
      const edited = rpcResult(
        (
          await rpc('tools/call', {
            name: 'customer_update',
            arguments: { customer_id: created.json().id, changes: { email: 'studio@example.test' } }
          })
        ).body
      ).result;
      assert.equal(edited.isError, undefined);
      const readBack = await app.inject({
        method: 'GET',
        url: '/api/billing/customers',
        headers: { cookie: dashboardCookie }
      });
      assert.equal(readBack.json().find(row => row.id === created.json().id).email, 'studio@example.test');
      const agentCreated = rpcResult(
        (await rpc('tools/call', { name: 'customer_create', arguments: { name: 'MCP ' + name } })).body
      ).result;
      assert.equal(agentCreated.isError, undefined);
      assert.ok(customers.has(agentCreated.structuredContent.data.id));
      tokens.get(hash(credentials.access_token)).expires_at = new Date(0);
      assert.equal((await rpc('tools/list', {})).statusCode, 401);
      const refresh = {
        grant_type: 'refresh_token',
        client_id: client.client_id,
        refresh_token: credentials.refresh_token,
        resource: params.resource
      };
      const renewed = await app.inject({ method: 'POST', url: '/oauth/token', payload: refresh });
      assert.equal(renewed.statusCode, 200);
      assert.notEqual(renewed.json().refresh_token, credentials.refresh_token);
      assert.equal((await app.inject({ method: 'POST', url: '/oauth/token', payload: refresh })).statusCode, 400);
    }
  }
);
