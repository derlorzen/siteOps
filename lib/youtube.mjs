import crypto from 'node:crypto';
import * as z from 'zod/v4';
import {
  youtubeCatalog,
  validateYouTubeRequest,
  youtubeUrl,
  youtubeUploadSchema,
  publicYouTubeCatalog
} from './youtube-contract.mjs';
import { parseVideoInput, youtubeDescription } from './video-production.mjs';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const json = value => (typeof value === 'string' ? JSON.parse(value) : value);
const fail = (statusCode, message) => {
  throw Object.assign(new Error(message), { statusCode });
};
const random = () => crypto.randomBytes(32).toString('base64url');
const configSchema = z
  .object({ client_id: z.string().trim().min(10).max(300), client_secret: z.string().max(500).optional() })
  .strict();
const scopes = ['https://www.googleapis.com/auth/youtube', 'https://www.googleapis.com/auth/youtube.force-ssl'];
const analyticsScope = 'https://www.googleapis.com/auth/yt-analytics.readonly';

export async function boundedYouTubeBody(response, maximum = 4 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of response.body || []) {
      size += chunk.length;
      if (size > maximum) {
        await response.body?.cancel().catch(() => {});
        fail(502, 'YouTube-Antwort überschreitet das erlaubte Größenlimit.');
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error.statusCode) throw error;
    fail(503, 'Datenübertragung wurde unterbrochen. Fortschritt vor einem erneuten Versuch prüfen.');
  }
  return Buffer.concat(chunks);
}

export function createYouTubeService({
  db,
  encrypt,
  decrypt,
  publicBaseUrl,
  studio,
  fetcher = (...args) => fetch(...args),
  now = () => Date.now()
}) {
  const sql = async (query, args = []) => (await db.query(query, args))[0];
  const refreshes = new Map();
  const cleanPreviews = () =>
    sql(
      "DELETE FROM youtube_previews WHERE expires_at<DATE_SUB(NOW(),INTERVAL 7 DAY) AND status IN ('pending','failed','done')"
    );
  const redirectUri = () => {
    const base = new URL(publicBaseUrl());
    if (base.protocol !== 'https:')
      fail(503, 'YouTube benötigt eine öffentliche HTTPS-Adresse für die Google-Anmeldung.');
    return base.origin + '/api/youtube/oauth/callback';
  };
  const setting = async key => {
    const rows = await sql('SELECT setting_value FROM app_settings WHERE setting_key=? LIMIT 1', [key]);
    return rows.length ? decrypt(rows[0].setting_value) : null;
  };
  const configuration = async () => {
    const cfg = await setting('youtube_oauth_client');
    if (!cfg?.client_id || !cfg?.client_secret)
      fail(503, 'Google OAuth-Client zuerst unter YouTube → Verbindung konfigurieren.');
    return cfg;
  };
  const accounts = async () =>
    sql('SELECT id,channel_id,title,created_at,updated_at FROM youtube_accounts ORDER BY title');
  const account = async id => {
    parseVideoInput(z.uuid(), id);
    const row = (await sql('SELECT * FROM youtube_accounts WHERE id=? LIMIT 1', [id]))[0];
    if (!row) fail(404, 'YouTube-Kanal ist nicht verbunden.');
    return row;
  };
  async function google(url, options = {}) {
    let response;
    try {
      response = await fetcher(url, {
        ...options,
        redirect: 'error',
        signal: AbortSignal.timeout(options.timeout || 60000)
      });
    } catch (error) {
      fail(error.name === 'TimeoutError' ? 504 : 503, 'YouTube ist nicht erreichbar oder antwortet nicht rechtzeitig.');
    }
    return response;
  }
  async function googleJson(url, options = {}) {
    const response = await google(url, options);
    let payload = {};
    try {
      payload = JSON.parse((await boundedYouTubeBody(response)).toString());
    } catch (error) {
      if (error.statusCode) throw error;
      if (response.ok && response.status !== 204)
        fail(502, 'YouTube hat eine ungültige Bestätigung geliefert. Remote-Status vor erneutem Versuch prüfen.');
    }
    if (!response.ok) {
      if (response.status === 412)
        fail(409, 'Die YouTube-Daten wurden inzwischen geändert. Neu laden und eine neue Vorschau erstellen.');
      const reason = payload.error?.errors?.[0]?.reason || payload.error || 'HTTP ' + response.status;
      if (response.status === 401 || reason === 'invalid_grant')
        fail(401, 'Google-Zugriff abgelaufen oder widerrufen. Kanal erneut verbinden.');
      if (['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded'].includes(reason) || response.status === 429)
        fail(
          429,
          'YouTube-Kontingent oder Anfragelimit erreicht. Später erneut versuchen; Google-Cloud-Kontingent prüfen.'
        );
      fail(
        response.status >= 500 ? 502 : response.status === 403 ? 403 : 422,
        'YouTube hat die Anfrage abgelehnt: ' +
          String(typeof reason === 'string' ? reason : 'HTTP ' + response.status).slice(0, 120) +
          '. Kanalberechtigung, API-Aktivierung und Eingaben prüfen.'
      );
    }
    return payload;
  }
  const status = async () => {
    const cfg = await setting('youtube_oauth_client');
    return {
      configured: Boolean(cfg?.client_id && cfg?.client_secret),
      client_id: cfg?.client_id || '',
      redirect_uri: redirectUri(),
      accounts: await accounts(),
      api_revision: youtubeCatalog.revision,
      scopes,
      limitations: [
        'YouTube Analytics/Revenue benötigen eine separate Analytics-API.',
        'YouTube Studio bietet Einstellungen, die Google nicht über die Data API freigibt.'
      ],
      upload_default: 'private',
      publishing_requires_explicit_approval: true
    };
  };
  const configure = async input => {
    const x = parseVideoInput(configSchema, input),
      old = await setting('youtube_oauth_client');
    if (old && old.client_id !== x.client_id && (await accounts()).length)
      fail(409, 'Vor dem Wechsel des Google-Clients die verbundenen Kanäle trennen.');
    const value = { client_id: x.client_id, client_secret: x.client_secret || old?.client_secret };
    if (!value.client_secret) fail(422, 'Google-Client-Secret fehlt.');
    await sql(
      'INSERT INTO app_settings(setting_key,setting_value,encrypted) VALUES(?,?,1) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),encrypted=1,updated_at=NOW()',
      ['youtube_oauth_client', encrypt(value)]
    );
    return status();
  };
  const beginOAuth = async (session, options = {}) => {
    const selected = parseVideoInput(z.object({ memberships: z.boolean().default(false), analytics: z.boolean().default(false) }).strict(), options);
    const requestedScopes = selected.memberships
      ? [...scopes, 'https://www.googleapis.com/auth/youtube.channel-memberships.creator']
      : [...scopes];
    if (selected.analytics) requestedScopes.push(analyticsScope);
    if (!session?.tokenHash) fail(401, 'SiteOps-Anmeldung erforderlich.');
    const cfg = await configuration(),
      state = random(),
      verifier = random();
    await sql('DELETE FROM youtube_oauth_states WHERE expires_at<NOW()');
    await sql('INSERT INTO youtube_oauth_states(state_hash,encrypted_payload,expires_at) VALUES(?,?,?)', [
      hash(state),
      encrypt({
        session: session.tokenHash,
        verifier,
        client_id: cfg.client_id,
        scopes: requestedScopes,
        expires_at: now() + 600000
      }),
      new Date(now() + 600000)
    ]);
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    for (const [k, v] of Object.entries({
      client_id: cfg.client_id,
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: requestedScopes.join(' '),
      state,
      code_challenge: hashChallenge(verifier),
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true'
    }))
      url.searchParams.set(k, v);
    return { url: url.toString() };
  };
  const completeOAuth = async (input, session) => {
    const x = parseVideoInput(
      z
        .object({
          state: z.string().min(20).max(200),
          code: z.string().max(4000).optional(),
          error: z.string().max(100).optional()
        })
        .passthrough(),
      input
    );
    const row = (await sql('SELECT * FROM youtube_oauth_states WHERE state_hash=?', [hash(x.state)]))[0];
    if (!row) fail(403, 'Google-Anmeldung ist ungültig oder abgelaufen. Bitte erneut verbinden.');
    const pending = decrypt(row.encrypted_payload);
    if (!Number.isSafeInteger(pending.expires_at) || pending.expires_at <= now())
      fail(403, 'Google-Anmeldung ist abgelaufen. Bitte erneut verbinden.');
    if (!session?.tokenHash || pending.session !== session.tokenHash)
      fail(403, 'Google-Anmeldung gehört zu einer anderen SiteOps-Sitzung.');
    const removed = await sql('DELETE FROM youtube_oauth_states WHERE state_hash=?', [hash(x.state)]);
    if (removed.affectedRows !== 1) fail(403, 'Google-Anmeldung wurde bereits verwendet.');
    if (x.error || !x.code) fail(422, 'Google-Anmeldung wurde abgebrochen oder verweigert.');
    const cfg = await configuration();
    if (cfg.client_id !== pending.client_id)
      fail(409, 'Google-Client wurde inzwischen geändert. Bitte erneut anmelden.');
    const token = await googleJson('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.client_id,
        client_secret: cfg.client_secret,
        redirect_uri: redirectUri(),
        code: x.code,
        code_verifier: pending.verifier,
        grant_type: 'authorization_code'
      })
    });
    if (!token.access_token || !token.refresh_token)
      fail(422, 'Google hat keinen dauerhaften Zugriff freigegeben. Einwilligung prüfen und erneut verbinden.');
    const granted = String(token.scope || '').split(' ');
    if (!(pending.scopes || scopes).every(scope => granted.includes(scope)))
      fail(403, 'Google hat nicht alle angeforderten YouTube-Berechtigungen erteilt. Bitte erneut verbinden.');
    const channels = await googleJson('https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true', {
      headers: { authorization: 'Bearer ' + token.access_token }
    });
    if (!channels.items?.length)
      fail(422, 'Dieses Google-Konto hat keinen freigegebenen YouTube-Kanal. Brand-Konto bei Google auswählen.');
    for (const channel of channels.items) {
      const credentials = {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: now() + Number(token.expires_in || 3600) * 1000,
        scope: token.scope
      };
      await sql(
        'INSERT INTO youtube_accounts(id,channel_id,title,encrypted_credentials) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title),encrypted_credentials=VALUES(encrypted_credentials)',
        [crypto.randomUUID(), channel.id, String(channel.snippet.title).slice(0, 200), encrypt(credentials)]
      );
    }
    return accounts();
  };
  async function accessToken(id) {
    const row = await account(id),
      credentials = decrypt(row.encrypted_credentials);
    if (credentials.expires_at > now() + 90000) return credentials.access_token;
    if (!refreshes.has(id))
      refreshes.set(
        id,
        (async () => {
          const cfg = await configuration();
          const token = await googleJson('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: cfg.client_id,
              client_secret: cfg.client_secret,
              refresh_token: credentials.refresh_token,
              grant_type: 'refresh_token'
            })
          });
          if (!token.access_token) fail(401, 'Google-Zugriff kann nicht erneuert werden. Kanal erneut verbinden.');
          await sql('UPDATE youtube_accounts SET encrypted_credentials=? WHERE id=?', [
            encrypt({
              ...credentials,
              access_token: token.access_token,
              refresh_token: token.refresh_token || credentials.refresh_token,
              expires_at: now() + Number(token.expires_in || 3600) * 1000
            }),
            id
          ]);
          return token.access_token;
        })().finally(() => refreshes.delete(id))
      );
    return refreshes.get(id);
  }
  async function perform(input) {
    const x = validateYouTubeRequest(input),
      definition = youtubeCatalog.methods[x.action];
    const headers = { authorization: 'Bearer ' + (await accessToken(x.account_id)) };
    if (x.etag) headers['if-match'] = x.etag;
    let body = x.body ? JSON.stringify(x.body) : undefined;
    if (x.media) {
      const bytes = Buffer.from(x.media.data_base64, 'base64');
      if (x.body) {
        const boundary = 'siteops-' + crypto.randomBytes(16).toString('hex');
        headers['content-type'] = 'multipart/related; boundary=' + boundary;
        body = Buffer.concat([
          Buffer.from(
            '--' +
              boundary +
              '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
              body +
              '\r\n--' +
              boundary +
              '\r\nContent-Type: ' +
              x.media.mime_type +
              '\r\n\r\n'
          ),
          bytes,
          Buffer.from('\r\n--' + boundary + '--\r\n')
        ]);
      } else {
        headers['content-type'] = x.media.mime_type;
        body = bytes;
      }
    } else if (body) headers['content-type'] = 'application/json';
    if (definition.download) {
      const response = await google(youtubeUrl(x), { method: definition.method, headers });
      if (!response.ok) fail(response.status === 403 ? 403 : 502, 'YouTube-Untertitel sind nicht verfügbar.');
      const bytes = await boundedYouTubeBody(response);
      return {
        mime_type: response.headers.get('content-type') || 'application/octet-stream',
        data_base64: bytes.toString('base64')
      };
    }
    return googleJson(youtubeUrl(x), { method: definition.method, headers, body });
  }
  const read = async input => {
    const x = validateYouTubeRequest(input);
    if (youtubeCatalog.methods[x.action].method !== 'GET')
      fail(422, 'Änderungen benötigen zuerst eine Vorschau und danach ausdrückliche Freigabe.');
    return perform(x);
  };
  const preview = async input => {
    await cleanPreviews();
    const x = validateYouTubeRequest(input);
    if (youtubeCatalog.methods[x.action].method === 'GET') fail(422, 'Lesezugriffe benötigen keine Änderungsvorschau.');
    const channel = await account(x.account_id),
      token = random();
    await sql('INSERT INTO youtube_previews(token_hash,account_id,encrypted_payload,expires_at) VALUES(?,?,?,?)', [
      hash(token),
      x.account_id,
      encrypt({ type: 'api', request: x }),
      new Date(now() + 600000)
    ]);
    return {
      preview_token: token,
      expires_in_seconds: 600,
      channel: { id: channel.channel_id, title: channel.title },
      action: x.action,
      parameters: x.parameters,
      etag: x.etag || null,
      body: x.body || null,
      media: x.media
        ? {
            mime_type: x.media.mime_type,
            bytes: Buffer.byteLength(x.media.data_base64, 'base64'),
            sha256: hash(Buffer.from(x.media.data_base64, 'base64'))
          }
        : null,
      warning:
        'Prüfe diese konkrete Änderung. Sie wird erst nach ausdrücklicher Freigabe ausgeführt. Updates ersetzen alle veränderbaren Felder der angegebenen parts.'
    };
  };
  const execute = async input => {
    const x = parseVideoInput(
      z.object({ preview_token: z.string().min(40).max(100), approved: z.literal(true) }).strict(),
      input
    );
    const row = (await sql('SELECT * FROM youtube_previews WHERE token_hash=?', [hash(x.preview_token)]))[0];
    if (!row) fail(404, 'Änderungsvorschau nicht gefunden.');
    if (row.status === 'done') return { status: 'done', result: json(row.result) };
    if (row.status !== 'pending' || new Date(row.expires_at).getTime() <= now())
      fail(409, 'Vorschau abgelaufen oder bereits in Bearbeitung. Status prüfen; keine unkontrollierte Wiederholung.');
    const claim = await sql('UPDATE youtube_previews SET status=? WHERE token_hash=? AND status=?', [
      'executing',
      hash(x.preview_token),
      'pending'
    ]);
    if (claim.affectedRows !== 1) fail(409, 'Diese Änderung wird bereits verarbeitet.');
    try {
      const operation = decrypt(row.encrypted_payload);
      const result =
        operation.type === 'upload' ? await enqueueUpload(operation.request) : await perform(operation.request);
      await sql('UPDATE youtube_previews SET status=?,result=? WHERE token_hash=?', [
        'done',
        JSON.stringify(result),
        hash(x.preview_token)
      ]);
      return { status: 'done', result };
    } catch (error) {
      await sql('UPDATE youtube_previews SET status=?,error=? WHERE token_hash=?', [
        'failed',
        'Ausführung fehlgeschlagen. Remote-Status vor erneutem Versuch prüfen.',
        hash(x.preview_token)
      ]);
      throw error;
    }
  };
  const previewStatus = async token => {
    const row = (
      await sql('SELECT status,result,error,expires_at FROM youtube_previews WHERE token_hash=?', [
        hash(parseVideoInput(z.string().min(40).max(100), token))
      ])
    )[0];
    if (!row) fail(404, 'Änderungsvorschau nicht gefunden.');
    return { ...row, result: row.result ? json(row.result) : null };
  };
  const previewUpload = async input => {
    await cleanPreviews();
    const x = parseVideoInput(youtubeUploadSchema, input),
      channel = await account(x.account_id),
      job = await studio().refreshJob(x.job_id);
    if (job.deleted_at) fail(409, 'Produktion zuerst aus dem Papierkorb wiederherstellen.');
    if (job.status !== 'done' || !job.result?.files?.includes(x.kind))
      fail(409, 'Fertige Videodatei im Video Studio erforderlich.');
    if (!(await studio().capabilities()).artifactRanges)
      fail(409, 'Browser Runner für sichere fortsetzbare Uploads aktualisieren.');
    const metadata = job.youtube;
    if (!metadata && !x.title) fail(422, 'YouTube-Vorbereitung zuerst speichern.');
    const publication = x.kind === 'video' ? await studio().publication?.read(x.job_id) : null;
    const thumbnail = publication?.has_thumbnail
      ? (await studio().publication.thumbnail(x.job_id)).toString('base64')
      : undefined;
    const prepared = {
      ...x,
      ...(thumbnail ? { thumbnail } : {}),
      title: x.title || metadata.title,
      description: x.description ?? (metadata ? youtubeDescription(metadata) : ''),
      tags: x.tags || metadata?.keywords || [],
      default_language: x.default_language || job.render_settings?.language || 'en'
    };
    if (prepared.description.length > 5000) fail(422, 'YouTube-Beschreibung darf höchstens 5.000 Zeichen enthalten.');
    const token = random();
    await sql('INSERT INTO youtube_previews(token_hash,account_id,encrypted_payload,expires_at) VALUES(?,?,?,?)', [
      hash(token),
      x.account_id,
      encrypt({ type: 'upload', request: prepared }),
      new Date(now() + 600000)
    ]);
    return {
      preview_token: token,
      expires_in_seconds: 600,
      channel: { id: channel.channel_id, title: channel.title },
      action: 'Upload aus Video Studio',
      body: { ...prepared, thumbnail: undefined, has_thumbnail: Boolean(thumbnail), privacyStatus: 'private' },
      warning:
        'Lädt ausschließlich privat hoch. Veröffentlichung und Terminierung benötigen eine eigene Änderungsvorschau.'
    };
  };
  const previewAsset = async input => {
    const x = parseVideoInput(
      z
        .object({
          account_id: z.uuid(),
          job_id: z.uuid(),
          video_id: z.string().min(6).max(80),
          kind: z.enum(['thumbnail', 'subtitles']),
          language: z.enum(['en', 'de']).optional()
        })
        .strict(),
      input
    );
    const job = await studio().refreshJob(x.job_id);
    if (job.status !== 'done') fail(409, 'Abgeschlossene Video-Studio-Produktion erforderlich.');
    const response = await studio().artifactResponse(x.job_id, x.kind);
    if (!response.ok) fail(502, 'Video-Studio-Datei ist auf dem Runner nicht verfügbar.');
    const data = await boundedYouTubeBody(response, x.kind === 'thumbnail' ? 2 * 1024 * 1024 : 4 * 1024 * 1024);
    return preview({
      account_id: x.account_id,
      action: x.kind === 'thumbnail' ? 'thumbnails.set' : 'captions.insert',
      parameters: x.kind === 'thumbnail' ? { videoId: x.video_id } : { part: 'snippet' },
      ...(x.kind === 'subtitles'
        ? {
            body: {
              snippet: {
                videoId: x.video_id,
                language: x.language || job.render_settings?.language || 'en',
                name: 'SiteOps',
                isDraft: false
              }
            }
          }
        : {}),
      media: {
        mime_type: x.kind === 'thumbnail' ? 'image/png' : 'application/octet-stream',
        data_base64: data.toString('base64')
      }
    });
  };
  async function enqueueUpload(x) {
    const id = crypto.randomUUID();
    await sql('INSERT INTO youtube_uploads(id,account_id,video_job_id,kind,metadata) VALUES(?,?,?,?,?)', [
      id,
      x.account_id,
      x.job_id,
      x.kind,
      JSON.stringify(x)
    ]);
    return { id, status: 'queued', privacyStatus: 'private' };
  }
  const uploads = async accountId => {
    await account(accountId);
    return sql(
      'SELECT id,video_job_id,kind,status,total_bytes,uploaded_bytes,remote_video_id,error,created_at,updated_at FROM youtube_uploads WHERE account_id=? ORDER BY created_at DESC LIMIT 100',
      [accountId]
    );
  };
  const disconnect = async id => {
    const row = await account(id),
      credentials = decrypt(row.encrypted_credentials);
    const response = await google('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: credentials.refresh_token })
    });
    if (!response.ok && response.status !== 400)
      fail(502, 'Google konnte die Verbindung nicht widerrufen. Bitte erneut versuchen.');
    await sql('DELETE FROM youtube_accounts WHERE id=?', [id]);
    return { disconnected: true };
  };
  async function analytics(input) {
    const x = parseVideoInput(
      z.object({
        account_id: z.uuid(),
        days: z.number().int().min(7).max(90).default(28),
        dimension: z.enum(['summary', 'video', 'day']).default('summary')
      }).strict(),
      input
    );
    const row = await account(x.account_id);
    const credentials = decrypt(row.encrypted_credentials);
    if (!String(credentials.scope || '').split(' ').includes(analyticsScope))
      fail(403, 'YouTube-Analytics-Berechtigung fehlt. Bitte die Analytics-Freigabe bei Google aktivieren und den Kanal erneut verbinden.');
    const end = new Date(now() - 2 * 86400000).toISOString().slice(0, 10);
    const start = new Date(now() - (x.days + 1) * 86400000).toISOString().slice(0, 10);
    const params = new URLSearchParams({
      ids: 'channel==MINE',
      startDate: start,
      endDate: end,
      metrics: 'views,estimatedMinutesWatched,averageViewDuration',
      maxResults: '50'
    });
    if (x.dimension === 'video') {
      params.set('dimensions', 'video');
      params.set('sort', '-views');
    } else if (x.dimension === 'day') {
      params.set('dimensions', 'day');
      params.set('sort', 'day');
    }
    const data = await googleJson('https://youtubeanalytics.googleapis.com/v2/reports?' + params, {
      headers: { authorization: 'Bearer ' + (await accessToken(x.account_id)) }
    });
    const columns = (data.columnHeaders || []).map(item => item.name);
    return {
      start_date: start,
      end_date: end,
      dimension: x.dimension,
      columns,
      rows: (data.rows || []).slice(0, 50).map(row => Object.fromEntries(columns.map((name, index) => [name, row[index]])))
    };
  }
  return {
    analytics,
    status,
    configure,
    accounts,
    beginOAuth,
    completeOAuth,
    read,
    preview,
    execute,
    previewStatus,
    previewUpload,
    previewAsset,
    uploads,
    disconnect,
    catalog: publicYouTubeCatalog,
    accessToken,
    google,
    googleJson,
    sql,
    encrypt,
    decrypt,
    studio,
    now
  };
}
const hashChallenge = value => crypto.createHash('sha256').update(value).digest('base64url');
