import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { createYouTubeService, boundedYouTubeBody } from '../lib/youtube.mjs';
import { encryptWithKey, decryptWithKey } from '../lib/crypto.mjs';
import { validateYouTubeRequest, publicYouTubeCatalog, youtubeUrl } from '../lib/youtube-contract.mjs';
import { validatedYouTubeUploadUrl, confirmedUploadOffset, createYouTubeUploadWorker } from '../lib/youtube-upload.mjs';
import { videoFileRange } from '../runner/video-file-range.mjs';
import { registerYouTubeTools, registerYouTubeRoutes } from '../lib/youtube-api.mjs';
import { createDashboardSessions } from '../lib/dashboard-session.mjs';

const id = '11111111-1111-4111-8111-111111111111';
const key = Buffer.alloc(32, 9),
  encrypt = value => encryptWithKey(value, key),
  decrypt = value => decryptWithKey(value, key);
function harness(fetcher, studio = () => ({})) {
  const settings = new Map(),
    accounts = new Map(),
    states = new Map(),
    previews = new Map(),
    uploads = [];
  let clock = 1000000000;
  const db = {
    query: async (sql, args = []) => {
      if (sql.startsWith('SELECT setting_value'))
        return [settings.has(args[0]) ? [{ setting_value: settings.get(args[0]) }] : []];
      if (sql.startsWith('INSERT INTO app_settings')) settings.set(args[0], args[1]);
      if (sql.startsWith('SELECT id,channel_id'))
        return [[...accounts.values()].map(({ encrypted_credentials: _credentials, ...x }) => x)];
      if (sql.startsWith('SELECT * FROM youtube_accounts')) return [[accounts.get(args[0])].filter(Boolean)];
      if (sql.startsWith('INSERT INTO youtube_accounts'))
        accounts.set(args[0], { id: args[0], channel_id: args[1], title: args[2], encrypted_credentials: args[3] });
      if (sql.startsWith('UPDATE youtube_accounts')) accounts.get(args[1]).encrypted_credentials = args[0];
      if (sql.startsWith('INSERT INTO youtube_oauth_states'))
        states.set(args[0], { state_hash: args[0], encrypted_payload: args[1], expires_at: args[2] });
      if (sql.startsWith('SELECT * FROM youtube_oauth_states')) {
        const row = states.get(args[0]);
        return [[row].filter(Boolean)];
      }
      if (sql.startsWith('DELETE FROM youtube_oauth_states WHERE state_hash'))
        return [{ affectedRows: states.delete(args[0]) ? 1 : 0 }];
      if (sql.startsWith('INSERT INTO youtube_previews'))
        previews.set(args[0], {
          token_hash: args[0],
          account_id: args[1],
          encrypted_payload: args[2],
          expires_at: args[3],
          status: 'pending'
        });
      if (sql.startsWith('SELECT * FROM youtube_previews') || sql.startsWith('SELECT status,result'))
        return [[previews.get(args[0])].filter(Boolean)];
      if (sql.startsWith('UPDATE youtube_previews SET status=? WHERE')) {
        const row = previews.get(args[1]);
        if (row?.status !== args[2]) return [{ affectedRows: 0 }];
        row.status = args[0];
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE youtube_previews SET status=?,result')) {
        const row = previews.get(args[2]);
        row.status = args[0];
        row.result = args[1];
      }
      if (sql.startsWith('UPDATE youtube_previews SET status=?,error')) {
        const row = previews.get(args[2]);
        row.status = args[0];
        row.error = args[1];
      }
      if (sql.startsWith('INSERT INTO youtube_uploads')) uploads.push(args);
      return [{ affectedRows: 1 }];
    }
  };
  accounts.set(id, {
    id,
    channel_id: 'UCtest',
    title: 'Test channel',
    encrypted_credentials: encrypt({
      access_token: 'access-secret',
      refresh_token: 'refresh-secret',
      expires_at: clock + 3600000
    })
  });
  const service = createYouTubeService({
    db,
    encrypt,
    decrypt,
    publicBaseUrl: () => 'https://siteops.example.com',
    studio,
    fetcher,
    now: () => clock
  });
  return { service, settings, accounts, states, previews, uploads, advance: ms => (clock += ms) };
}

test('verified catalog validates method/query/body types, bounds and fixed Google URLs', () => {
  const catalog = publicYouTubeCatalog({ resource: 'videos' });
  assert.ok(catalog.operations.some(x => x.action === 'videos.update'));
  assert.ok(publicYouTubeCatalog({ action: 'videos.update' }).schemas.Video);
  const request = {
    account_id: id,
    action: 'videos.update',
    parameters: { part: 'snippet,status' },
    body: { id: 'test-video', snippet: { title: 'Test', categoryId: '28' }, status: { privacyStatus: 'private' } }
  };
  assert.equal(validateYouTubeRequest(request).body.status.privacyStatus, 'private');
  assert.equal(youtubeUrl(request).origin, 'https://www.googleapis.com');
  for (const x of [
    { ...request, action: 'not.real' },
    { ...request, parameters: { part: 'snippet', access_token: 'bad' } },
    { ...request, body: { unknown: true } },
    { ...request, body: { status: { privacyStatus: 'bad' } } },
    { ...request, body: { status: { privacyStatus: 'public', publishAt: '2030-01-01T10:00:00Z' } } },
    { ...request, parameters: {} },
    { ...request, action: 'videos.insert' }
  ])
    assert.throws(() => validateYouTubeRequest(x), undefined, JSON.stringify(x));
  assert.throws(() =>
    validateYouTubeRequest({
      account_id: id,
      action: 'thumbnails.set',
      parameters: { videoId: 'test' },
      media: { mime_type: 'image/png\r\nBad: true', data_base64: 'YQ==' }
    })
  );
});

test('Google OAuth credentials are encrypted, state is PKCE/session-bound, single-use and never returned', async () => {
  let exchanges = 0;
  const h = harness(async (url, options) => {
    assert.equal(options.redirect, 'error');
    if (String(url).includes('/token')) {
      exchanges++;
      assert.equal(options.body.get('code_verifier').length, 43);
      return Response.json({
        access_token: 'oauth-access-secret',
        refresh_token: 'oauth-refresh-secret',
        expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/youtube.force-ssl'
      });
    }
    return Response.json({ items: [{ id: 'UCowned', snippet: { title: 'Owned channel' } }] });
  });
  await h.service.configure({ client_id: 'google-test-client-id', client_secret: 'client-secret' });
  const stored = h.settings.get('youtube_oauth_client');
  assert.ok(!stored.includes('client-secret'));
  const status = await h.service.status();
  assert.ok(!JSON.stringify(status).includes('client-secret'));
  const session = { tokenHash: 'session-hash' },
    start = await h.service.beginOAuth(session),
    url = new URL(start.url),
    state = url.searchParams.get('state');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  await assert.rejects(h.service.completeOAuth({ state, code: 'authorization-code' }, { tokenHash: 'other' }), {
    statusCode: 403
  });
  assert.equal(exchanges, 0);
  const accounts = await h.service.completeOAuth({ state, code: 'authorization-code' }, session);
  assert.equal(
    accounts.some(x => x.channel_id === 'UCowned'),
    true
  );
  assert.equal(JSON.stringify(accounts).includes('oauth-access-secret'), false);
  await assert.rejects(h.service.completeOAuth({ state, code: 'authorization-code' }, session), { statusCode: 403 });
  const second = new URL((await h.service.beginOAuth(session)).url).searchParams.get('state');
  h.advance(600001);
  await assert.rejects(h.service.completeOAuth({ state: second, code: 'code' }, session), { statusCode: 403 });
});

test('YouTube changes are immutable expiring approvals; execute is replay-safe and sends If-Match', async () => {
  const calls = [];
  const h = harness(async (url, options) => {
    calls.push({ url, options });
    return Response.json({ id: 'test-video' });
  });
  const request = {
    account_id: id,
    action: 'videos.update',
    etag: 'original-etag',
    parameters: { part: 'snippet' },
    body: { id: 'test-video', snippet: { title: 'Approved title', categoryId: '28' } }
  };
  await assert.rejects(h.service.read(request), { statusCode: 422 });
  const preview = await h.service.preview(request);
  assert.equal(calls.length, 0);
  request.body.snippet.title = 'Changed after preview';
  await assert.rejects(h.service.execute({ preview_token: preview.preview_token, approved: false }), {
    statusCode: 422
  });
  const result = await h.service.execute({ preview_token: preview.preview_token, approved: true });
  assert.equal(result.status, 'done');
  assert.equal(JSON.parse(calls[0].options.body).snippet.title, 'Approved title');
  assert.equal(calls[0].options.headers['if-match'], 'original-etag');
  await h.service.execute({ preview_token: preview.preview_token, approved: true });
  assert.equal(calls.length, 1);
  assert.equal((await h.service.previewStatus(preview.preview_token)).status, 'done');
  const expired = await h.service.preview(request);
  h.advance(600001);
  await assert.rejects(h.service.execute({ preview_token: expired.preview_token, approved: true }), {
    statusCode: 409
  });
});

test('YouTube transport rejects redirects, quota failures, stale edits and malformed confirmations', async () => {
  let mode = 'quota';
  const h = harness(async (_url, options) => {
    assert.equal(options.redirect, 'error');
    if (mode === 'network') throw Error('redirect or network failure');
    if (mode === 'quota') return Response.json({ error: { errors: [{ reason: 'quotaExceeded' }] } }, { status: 403 });
    if (mode === 'stale') return Response.json({}, { status: 412 });
    return new Response('not JSON', { status: 200 });
  });
  const read = { account_id: id, action: 'channels.list', parameters: { part: 'snippet', mine: true } };
  await assert.rejects(h.service.read(read), { statusCode: 429 });
  mode = 'network';
  await assert.rejects(h.service.read(read), { statusCode: 503 });
  mode = 'stale';
  await assert.rejects(h.service.read(read), { statusCode: 409 });
  mode = 'malformed';
  await assert.rejects(h.service.read(read), { statusCode: 502 });
});

test('private upload requires a complete Studio job, media declarations and reviewed approval', async () => {
  const metadata = {
    title: 'Test video',
    description: 'Description',
    keywords: ['Bagisto'],
    hashtags: ['#Bagisto'],
    chapters: []
  };
  const h = harness(
    async () => Response.json({}),
    () => ({
      refreshJob: async () => ({
        status: 'done',
        result: { files: ['video'] },
        youtube: metadata,
        render_settings: { language: 'de' }
      }),
      capabilities: async () => ({ artifactRanges: true })
    })
  );
  const input = { account_id: id, job_id: id, made_for_kids: false, contains_synthetic_media: true };
  const preview = await h.service.previewUpload(input);
  assert.equal(h.uploads.length, 0);
  assert.equal(preview.body.privacyStatus, 'private');
  const result = await h.service.execute({ preview_token: preview.preview_token, approved: true });
  assert.equal(result.result.privacyStatus, 'private');
  assert.equal(h.uploads.length, 1);
  assert.equal(JSON.parse(h.uploads[0][4]).default_language, 'de');
});

test('upload session destinations and byte ranges reject arbitrary URLs and impossible offsets', () => {
  const good = 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=test';
  assert.equal(validatedYouTubeUploadUrl(good), good);
  for (const value of [
    'http://www.googleapis.com/upload/youtube/v3/videos?upload_id=x',
    'https://www.googleapis.com.evil.test/upload/youtube/v3/videos?upload_id=x',
    'https://www.googleapis.com@evil.test/upload/youtube/v3/videos?upload_id=x',
    'https://www.googleapis.com/other?upload_id=x',
    'https://127.0.0.1/upload/youtube/v3/videos?upload_id=x'
  ])
    assert.throws(() => validatedYouTubeUploadUrl(value));
  assert.deepEqual(videoFileRange('bytes=3-6', 10), { status: 206, start: 3, end: 6, length: 4 });
  for (const value of ['bytes=-5', 'bytes=11-12', 'bytes=7-3', 'bytes=1-2,4-5'])
    assert.throws(() => videoFileRange(value, 10));
  assert.equal(confirmedUploadOffset(new Response(null, { status: 308, headers: { range: 'bytes=0-4' } }), 10), 5);
  assert.throws(() => confirmedUploadOffset(new Response(null, { status: 308, headers: { range: 'bytes=0-20' } }), 10));
});

test('durable upload resumes after a lost final response without creating a second YouTube video', async () => {
  const source = Buffer.alloc(8 * 1024 * 1024 + 1024, 3);
  const row = {
    id,
    account_id: id,
    video_job_id: id,
    kind: 'video',
    status: 'queued',
    attempts: 0,
    total_bytes: 0,
    metadata: JSON.stringify({
      title: 'Private',
      description: 'Text',
      tags: [],
      category_id: '28',
      default_language: 'de',
      made_for_kids: false,
      contains_synthetic_media: true
    })
  };
  let committed = 0,
    initiations = 0,
    chunks = 0,
    lost = false;
  const service = {
    encrypt,
    decrypt,
    now: () => 1000000000,
    accessToken: async () => 'test-token',
    sql: async (sql, args = []) => {
      if (sql.startsWith('SELECT')) return [{ ...row }];
      if (sql.includes("status='uploading'")) {
        row.status = 'uploading';
        row.lease_token = args[0];
        return { affectedRows: 1 };
      }
      if (sql.includes('SET encrypted_session')) {
        row.encrypted_session = args[0];
        row.total_bytes = args[1];
        return { affectedRows: 1 };
      }
      const keys = sql
        .split(' SET ')[1]
        .split(' WHERE ')[0]
        .split(',')
        .map(x => x.split('=')[0]);
      keys.forEach((key, i) => (row[key] = args[i]));
      return { affectedRows: 1 };
    },
    studio: () => ({
      artifactResponse: async (_job, _kind, options) =>
        options.method === 'HEAD'
          ? new Response(null, { headers: { 'content-length': String(source.length) } })
          : new Response(source.subarray(options.start, options.end + 1), {
              status: 206,
              headers: { 'content-range': 'bytes ' + options.start + '-' + options.end + '/' + source.length }
            })
    }),
    google: async (url, options) => {
      if (options.method === 'POST') {
        initiations++;
        assert.equal(JSON.parse(options.body).status.privacyStatus, 'private');
        return new Response(null, {
          headers: { location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=test' }
        });
      }
      if (options.headers['content-range'].startsWith('bytes */'))
        return committed === source.length
          ? Response.json({ id: 'completed01' })
          : new Response(null, { status: 308, headers: committed ? { range: 'bytes=0-' + (committed - 1) } : {} });
      chunks++;
      committed += options.body.length;
      if (committed === source.length && !lost) {
        lost = true;
        throw Object.assign(new Error('lost response'), { statusCode: 503 });
      }
      return new Response(null, { status: 308, headers: { range: 'bytes=0-' + (committed - 1) } });
    }
  };
  await createYouTubeUploadWorker(service).tick();
  assert.equal(row.status, 'queued');
  await createYouTubeUploadWorker(service).tick();
  assert.equal(row.status, 'retry');
  await createYouTubeUploadWorker(service).tick();
  assert.equal(row.status, 'done');
  assert.equal(row.remote_video_id, 'completed01');
  assert.equal(initiations, 1);
  assert.equal(chunks, 2);
  assert.equal(committed, source.length);
});

test('MCP exposes channel capabilities but never credentials, and cannot execute without explicit approval', async () => {
  const definitions = new Map();
  let executes = 0;
  registerYouTubeTools(
    { registerTool: (name, definition, run) => definitions.set(name, { definition, run }) },
    {
      execute: async () => {
        executes++;
        return {};
      }
    },
    x => ({ content: [{ type: 'text', text: JSON.stringify(x) }] })
  );
  assert.equal(definitions.size, 9);
  assert.equal(definitions.has('youtube_configure'), false);
  const result = await definitions
    .get('youtube_change_execute')
    .run({ preview_token: 'x'.repeat(43), approved: false });
  assert.equal(result.isError, true);
  assert.equal(executes, 0);
});

test('expired Google tokens refresh once for concurrent requests without exposing refresh tokens', async () => {
  let refreshCount = 0;
  const h = harness(async (url, options) => {
    if (String(url).includes('/token')) {
      refreshCount++;
      assert.equal(options.body.get('refresh_token'), 'refresh-secret');
      await new Promise(resolve => setTimeout(resolve, 5));
      return Response.json({ access_token: 'new-access-secret', expires_in: 3600 });
    }
    assert.equal(options.headers.authorization, 'Bearer new-access-secret');
    return Response.json({ items: [] });
  });
  await h.service.configure({ client_id: 'google-test-client-id', client_secret: 'secret' });
  h.advance(3600000);
  const request = { account_id: id, action: 'channels.list', parameters: { part: 'snippet', mine: true } };
  const results = await Promise.all([h.service.read(request), h.service.read(request)]);
  assert.equal(refreshCount, 1);
  assert.equal(JSON.stringify(results).includes('secret'), false);
});

test('partial Google consent is rejected before any account credential is replaced', async () => {
  let calls = 0;
  const h = harness(async () => {
    calls++;
    return Response.json({
      access_token: 'new-secret',
      refresh_token: 'refresh',
      expires_in: 3600,
      scope: 'https://www.googleapis.com/auth/youtube'
    });
  });
  await h.service.configure({ client_id: 'google-test-client-id', client_secret: 'secret' });
  const session = { tokenHash: 'same-session' },
    start = await h.service.beginOAuth(session, { memberships: true });
  const url = new URL(start.url);
  assert.ok(url.searchParams.get('scope').includes('youtube.channel-memberships.creator'));
  await assert.rejects(h.service.completeOAuth({ state: url.searchParams.get('state'), code: 'code' }, session), {
    statusCode: 403
  });
  assert.equal(calls, 1);
  assert.equal(h.accounts.size, 1);
  assert.equal(decrypt(h.accounts.get(id).encrypted_credentials).access_token, 'access-secret');
});

test('streamed responses stay bounded and interrupted bodies remain retryable', async () => {
  await assert.rejects(boundedYouTubeBody(new Response(Buffer.alloc(20)), 10), { statusCode: 502 });
  const broken = new Response(
    new globalThis.ReadableStream({
      start(controller) {
        controller.error(new TypeError('connection reset'));
      }
    })
  );
  await assert.rejects(boundedYouTubeBody(broken), { statusCode: 503 });
});

test('Video Studio thumbnail/subtitle transfers produce previews without posting to YouTube', async () => {
  let requests = 0;
  const h = harness(
    async () => {
      requests++;
      return Response.json({});
    },
    () => ({
      refreshJob: async () => ({ status: 'done', render_settings: { language: 'de' } }),
      artifactResponse: async () => new Response(Buffer.from('test asset'))
    })
  );
  const preview = await h.service.previewAsset({
    account_id: id,
    job_id: id,
    video_id: 'existing001',
    kind: 'subtitles'
  });
  assert.equal(preview.action, 'captions.insert');
  assert.equal(preview.body.snippet.language, 'de');
  assert.equal(requests, 0);
  assert.ok(preview.media.bytes > 0);
  assert.equal(Object.hasOwn(preview.media, 'data_base64'), false);
});

test('YouTube settings/OAuth use dashboard sessions and reject unauthenticated, Bearer-only and cross-origin writes', async t => {
  const app = Fastify();
  t.after(() => app.close());
  const sessions = new Map();
  let configured = 0;
  const auth = createDashboardSessions({
    q: async (sql, args) => {
      if (sql.startsWith('INSERT')) sessions.set(args[0], { subject: args[1], credential_revision: args[2] });
      return { rows: sql.startsWith('SELECT') ? [sessions.get(args[0])].filter(Boolean) : [] };
    },
    baseUrl: () => 'https://siteops.test',
    username: () => 'admin',
    password: () => 'test-password',
    masterKey: () => Buffer.alloc(32).toString('base64')
  });
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/login') && !(await auth.guard(req, reply))) return reply;
  });
  app.get('/login', auth.loginPage);
  app.post('/login', auth.loginSubmit);
  registerYouTubeRoutes(
    app,
    {
      status: async () => ({ configured: true }),
      configure: async () => {
        configured++;
        return {};
      },
      completeOAuth: async (_query, session) => assert.ok(session.tokenHash)
    },
    { page: () => '', render: () => '', origin: () => 'https://siteops.test', worker: { stop: () => {} } }
  );
  assert.equal((await app.inject('/api/youtube/status')).statusCode, 401);
  assert.equal(
    (await app.inject({ url: '/api/youtube/status', headers: { authorization: 'Bearer test' } })).statusCode,
    401
  );
  const login = await app.inject('/login'),
    nonce = login.headers['set-cookie'].split(';')[0],
    csrf = login.body.match(/name="csrf" value="([^"]+)"/)[1];
  const loggedIn = await app.inject({
    method: 'POST',
    url: '/login',
    headers: { cookie: nonce },
    payload: { csrf, username: 'admin', password: 'test-password' }
  });
  const cookie = loggedIn.headers['set-cookie'][0].split(';')[0];
  for (const origin of ['https://evil.test', 'null', undefined])
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/youtube/configure',
          headers: { cookie, ...(origin ? { origin } : {}) },
          payload: {}
        })
      ).statusCode,
      403
    );
  assert.equal(configured, 0);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/youtube/configure',
        headers: { cookie, origin: 'https://siteops.test' },
        payload: {}
      })
    ).statusCode,
    200
  );
  assert.equal(configured, 1);
  assert.equal(
    (await app.inject({ url: '/api/youtube/oauth/callback?state=test', headers: { cookie } })).statusCode,
    302
  );
});

test('upload approval freezes the selected publication thumbnail with the reviewed title and description', async () => {
  let image = Buffer.from([255, 216, 255, 1]);
  const h = harness(
    async () => Response.json({}),
    () => ({
      refreshJob: async () => ({
        status: 'done',
        result: { files: ['video'] },
        youtube: {
          title: 'Reviewed title',
          description: 'Reviewed description',
          keywords: [],
          hashtags: [],
          chapters: []
        },
        render_settings: { language: 'en' }
      }),
      capabilities: async () => ({ artifactRanges: true }),
      publication: { read: async () => ({ has_thumbnail: true }), thumbnail: async () => image }
    })
  );
  const preview = await h.service.previewUpload({
    account_id: id,
    job_id: id,
    made_for_kids: false,
    contains_synthetic_media: false
  });
  assert.equal(preview.body.has_thumbnail, true);
  assert.equal(preview.body.thumbnail, undefined);
  const expected = image.toString('base64');
  image = Buffer.from([255, 216, 255, 2]);
  await h.service.execute({ preview_token: preview.preview_token, approved: true });
  const snapshot = JSON.parse(h.uploads[0][4]);
  assert.equal(snapshot.thumbnail, expected);
  assert.equal(snapshot.title, 'Reviewed title');
  assert.equal(snapshot.description, 'Reviewed description');
});
