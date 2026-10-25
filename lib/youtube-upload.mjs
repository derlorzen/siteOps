import crypto from 'node:crypto';
import { boundedYouTubeBody } from './youtube.mjs';

const fail = (statusCode, message) => {
  throw Object.assign(new Error(message), { statusCode });
};
const json = x => (typeof x === 'string' ? JSON.parse(x) : x);
const CHUNK = 8 * 1024 * 1024;
export function validatedYouTubeUploadUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    !['www.googleapis.com', 'youtube.googleapis.com'].includes(url.hostname) ||
    !['/upload/youtube/v3/videos', '/resumable/upload/youtube/v3/videos'].includes(url.pathname) ||
    !url.searchParams.get('upload_id')
  )
    fail(502, 'Google hat eine unerwartete Upload-Adresse geliefert.');
  return url.toString();
}
export function confirmedUploadOffset(response, total) {
  const range = response.headers.get('range');
  if (!range) return 0;
  const match = /^bytes=0-(\d+)$/.exec(range);
  const offset = match ? Number(match[1]) + 1 : NaN;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > total)
    fail(502, 'Google meldet einen ungültigen Upload-Fortschritt.');
  return offset;
}
export function createYouTubeUploadWorker(service) {
  let busy = false,
    timer;
  const update = async (row, status, fields = {}) => {
    const values = { status, lease_until: null, lease_token: null, ...fields };
    await service.sql(
      'UPDATE youtube_uploads SET ' +
        Object.keys(values)
          .map(key => key + '=?')
          .join(',') +
        ' WHERE id=? AND lease_token=?',
      [...Object.values(values), row.id, row.lease_token]
    );
  };
  const finish = async (row, response) => {
    let result;
    try {
      result = JSON.parse((await boundedYouTubeBody(response)).toString());
    } catch {
      fail(502, 'Google hat den abgeschlossenen Upload nicht bestätigt.');
    }
    if (!result.id || !/^[-_A-Za-z0-9]{6,80}$/.test(result.id))
      fail(502, 'Google hat keine gültige Video-ID zurückgegeben.');
    await update(row, 'done', { remote_video_id: result.id, uploaded_bytes: row.total_bytes, error: null });
  };
  async function process(row) {
    const metadata = json(row.metadata),
      token = await service.accessToken(row.account_id);
    const headers = { authorization: 'Bearer ' + token };
    if (!row.encrypted_session) {
      const info = await service.studio().artifactResponse(row.video_job_id, row.kind, { method: 'HEAD' });
      const total = Number(info.headers.get('content-length'));
      if (!info.ok || !Number.isSafeInteger(total) || total < 1)
        fail(409, 'Runner muss Dateigröße und Byte-Ranges für Uploads unterstützen.');
      row.total_bytes = total;
      const resource = {
        snippet: {
          title: metadata.title,
          description: metadata.description,
          tags: metadata.tags,
          categoryId: metadata.category_id,
          defaultLanguage: metadata.default_language,
          defaultAudioLanguage: metadata.default_language
        },
        status: {
          privacyStatus: 'private',
          selfDeclaredMadeForKids: metadata.made_for_kids,
          containsSyntheticMedia: metadata.contains_synthetic_media
        }
      };
      const response = await service.google(
        'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=false',
        {
          method: 'POST',
          headers: {
            ...headers,
            'content-type': 'application/json',
            'x-upload-content-length': String(total),
            'x-upload-content-type': 'video/mp4'
          },
          body: JSON.stringify(resource)
        }
      );
      if (!response.ok)
        fail(
          response.status === 401 ? 401 : response.status === 403 ? 403 : 502,
          'YouTube konnte den privaten Upload nicht beginnen. Kontingent und Kanalberechtigung prüfen.'
        );
      const session = validatedYouTubeUploadUrl(response.headers.get('location'));
      row.encrypted_session = service.encrypt({ url: session });
      const saved = await service.sql(
        'UPDATE youtube_uploads SET encrypted_session=?,total_bytes=? WHERE id=? AND lease_token=?',
        [row.encrypted_session, total, row.id, row.lease_token]
      );
      if (saved.affectedRows !== 1) return;
    }
    const session = validatedYouTubeUploadUrl(service.decrypt(row.encrypted_session).url);
    const status = await service.google(session, {
      method: 'PUT',
      headers: { ...headers, 'content-range': 'bytes */' + row.total_bytes, 'content-length': '0' }
    });
    if (status.status === 200 || status.status === 201) return finish(row, status);
    if ([404, 410].includes(status.status))
      fail(409, 'Upload-Sitzung abgelaufen. Kanal vor einem neuen Upload auf bereits vorhandene Videos prüfen.');
    if (status.status !== 308)
      fail(status.status === 401 ? 401 : 502, 'Upload-Status kann nicht sicher ermittelt werden.');
    const start = confirmedUploadOffset(status, Number(row.total_bytes));
    if (start === Number(row.total_bytes)) fail(502, 'Google hat alle Bytes, aber den Abschluss noch nicht bestätigt.');
    const end = Math.min(start + CHUNK, Number(row.total_bytes)) - 1;
    const artifact = await service.studio().artifactResponse(row.video_job_id, row.kind, { start, end });
    if (
      artifact.status !== 206 ||
      artifact.headers.get('content-range') !== 'bytes ' + start + '-' + end + '/' + row.total_bytes
    )
      fail(409, 'Runner hat den angeforderten Dateibereich nicht bestätigt.');
    const data = await boundedYouTubeBody(artifact, CHUNK);
    if (data.length !== end - start + 1) fail(502, 'Runner-Dateibereich ist unvollständig.');
    const response = await service.google(session, {
      method: 'PUT',
      headers: {
        ...headers,
        'content-type': 'video/mp4',
        'content-range': 'bytes ' + start + '-' + end + '/' + row.total_bytes,
        'content-length': String(data.length)
      },
      body: data
    });
    if (response.status === 200 || response.status === 201) return finish(row, response);
    if (response.status !== 308)
      fail(
        response.status === 401 ? 401 : response.status === 403 ? 403 : 502,
        'YouTube hat den Dateibereich nicht bestätigt. Ein erneuter Versuch ermittelt zuerst den sicheren Server-Fortschritt.'
      );
    const uploaded = confirmedUploadOffset(response, Number(row.total_bytes));
    if (uploaded < start || uploaded > end + 1) fail(502, 'Google meldet einen unerwarteten Dateibereich.');
    await update(row, 'queued', { uploaded_bytes: uploaded, error: null, attempts: 0 });
  }
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const row = (
        await service.sql(
          "SELECT * FROM youtube_uploads WHERE status IN ('queued','retry','uploading') AND next_attempt_at<=NOW() AND (lease_until IS NULL OR lease_until<NOW()) ORDER BY created_at LIMIT 1"
        )
      )[0];
      if (!row) return;
      row.lease_token = crypto.randomBytes(24).toString('hex');
      const claim = await service.sql(
        "UPDATE youtube_uploads SET status='uploading',lease_until=DATE_ADD(NOW(),INTERVAL 3 MINUTE),lease_token=? WHERE id=? AND (lease_until IS NULL OR lease_until<NOW()) AND status IN ('queued','retry','uploading')",
        [row.lease_token, row.id]
      );
      if (claim.affectedRows !== 1) return;
      try {
        await process(row);
      } catch (error) {
        const attempts = Number(row.attempts) + 1,
          retry = attempts < 8 && [429, 502, 503, 504].includes(error.statusCode);
        await update(row, retry ? 'retry' : 'failed', {
          error: String(error.message || 'Upload fehlgeschlagen.').slice(0, 900),
          attempts,
          next_attempt_at: new Date(service.now() + Math.min(300000, 10000 * 2 ** Math.min(attempts, 5)))
        });
      }
    } finally {
      busy = false;
    }
  };
  return {
    tick,
    start: () => {
      if (!timer) {
        timer = setInterval(() => tick().catch(() => {}), 5000);
        timer.unref();
        tick().catch(() => {});
      }
    },
    stop: () => {
      clearInterval(timer);
      timer = null;
    }
  };
}
