import crypto from 'node:crypto';
import * as z from 'zod/v4';
import { parseVideoInput } from './video-production.mjs';

// Bounded local import; fits the existing 8 MiB MCP request envelope after base64.
export const FINAL_VIDEO_MAX_BYTES = 5 * 1024 * 1024;
export const finalVideoSchema = z
  .object({
    filename: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[^/\\]+\.mp4$/i)
      .refine(value => Array.from(value).every(char => char.codePointAt(0) >= 32), 'Ungültiger Dateiname'),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    data_base64: z
      .string()
      .min(4)
      .max(4 * Math.ceil(FINAL_VIDEO_MAX_BYTES / 3))
  })
  .strict();
const fail = (statusCode, message) => {
  throw Object.assign(Error(message), { statusCode });
};

// Inspect bounded ISO-BMFF atoms without executing uploaded content or external commands.
export function inspectFinalMp4(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 32 || bytes.length > FINAL_VIDEO_MAX_BYTES)
    fail(422, 'Eine MP4-Datei bis 5 MiB auswählen.');
  let count = 0;
  function atoms(start, end) {
    const result = [];
    for (let p = start; p < end;) {
      if (++count > 10000 || p + 8 > end) fail(422, 'Ungültige MP4-Struktur.');
      let size = bytes.readUInt32BE(p),
        header = 8;
      if (size === 1) {
        if (p + 16 > end) fail(422, 'Ungültige MP4-Struktur.');
        size = Number(bytes.readBigUInt64BE(p + 8));
        header = 16;
      } else if (size === 0) size = end - p;
      if (!Number.isSafeInteger(size) || size < header || p + size > end) fail(422, 'Unvollständige MP4-Datei.');
      result.push({ type: bytes.toString('ascii', p + 4, p + 8), start: p + header, end: p + size });
      p += size;
    }
    return result;
  }
  const top = atoms(0, bytes.length),
    ftyp = top.find(a => a.type === 'ftyp'),
    moov = top.find(a => a.type === 'moov');
  if (!ftyp || ftyp.end - ftyp.start < 8 || !moov || !top.some(a => a.type === 'mdat' && a.end > a.start))
    fail(422, 'MP4 benötigt Dateityp, Medieninhalt und Filmmetadaten.');
  const movie = atoms(moov.start, moov.end),
    mvhd = movie.find(a => a.type === 'mvhd');
  if (!mvhd || mvhd.end - mvhd.start < 20) fail(422, 'MP4-Laufzeit fehlt.');
  const version = bytes[mvhd.start];
  if (![0, 1].includes(version) || mvhd.end - mvhd.start < (version ? 32 : 20)) fail(422, 'Ungültige MP4-Laufzeit.');
  const scale = bytes.readUInt32BE(mvhd.start + (version ? 20 : 12));
  const ticks = version ? Number(bytes.readBigUInt64BE(mvhd.start + 24)) : bytes.readUInt32BE(mvhd.start + 16);
  const duration = ticks / scale;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 7200)
    fail(422, 'MP4-Laufzeit muss zwischen 0 und 7200 Sekunden liegen.');
  let video,
    audio = false;
  for (const track of movie.filter(a => a.type === 'trak')) {
    const parts = atoms(track.start, track.end),
      tkhd = parts.find(a => a.type === 'tkhd'),
      mdia = parts.find(a => a.type === 'mdia');
    if (!mdia) continue;
    const handler = atoms(mdia.start, mdia.end).find(a => a.type === 'hdlr');
    if (!handler || handler.end - handler.start < 12) continue;
    const type = bytes.toString('ascii', handler.start + 8, handler.start + 12);
    if (type === 'soun') audio = true;
    if (type !== 'vide') continue;
    if (!tkhd || ![0, 1].includes(bytes[tkhd.start]) || tkhd.end - tkhd.start < (bytes[tkhd.start] ? 96 : 84))
      fail(422, 'MP4-Bildabmessungen fehlen.');
    const width = bytes.readUInt32BE(tkhd.end - 8) / 65536,
      height = bytes.readUInt32BE(tkhd.end - 4) / 65536;
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 16 ||
      height < 16 ||
      width > 7680 ||
      height > 7680
    )
      fail(422, 'Ungültige MP4-Bildabmessungen.');
    video = { width, height };
  }
  if (!video || !audio) fail(422, 'MP4 muss eine Video- und eine Audiospur enthalten.');
  return { ...video, duration_seconds: duration };
}

export function createFinalVideoAssets({ db, getJob }) {
  const sql = async (q, p = []) => (await db.query(q, p))[0];
  const latest = async jobId => {
    const rows = await sql(
      'SELECT id,filename,sha256,byte_size,width,height,duration_seconds,created_at FROM video_studio_final_assets WHERE job_id=? ORDER BY revision DESC LIMIT 1',
      [jobId]
    );
    return rows[0] || null;
  };
  const source = async (jobId, kind) => {
    await getJob(jobId);
    const final = kind === 'video' ? await latest(jobId) : null;
    return final ? { type: 'final', asset_id: final.id, sha256: final.sha256, ...final } : { type: 'runner' };
  };
  const importFile = async (jobId, input) => {
    const job = await getJob(jobId);
    if (job.deleted_at || job.status !== 'done') fail(409, 'Eine fertige, aktive Produktion auswählen.');
    const x = parseVideoInput(finalVideoSchema, input);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(x.data_base64)) fail(422, 'Ungültige Dateikodierung.');
    const body = Buffer.from(x.data_base64, 'base64');
    if (body.toString('base64') !== x.data_base64) fail(422, 'Ungültige Dateikodierung.');
    const sha = crypto.createHash('sha256').update(body).digest('hex');
    if (sha !== x.sha256) fail(422, 'Prüfsumme stimmt nicht mit der Datei überein.');
    const info = inspectFinalMp4(body);
    if ((job.format === 'portrait') !== info.height > info.width)
      fail(422, 'Ausrichtung der Endfassung passt nicht zur Produktion.');
    const existing = await sql('SELECT id FROM video_studio_final_assets WHERE job_id=? AND sha256=?', [jobId, sha]);
    if (existing.length) {
      const active = await latest(jobId);
      if (active?.id !== existing[0].id) fail(409, 'Diese Datei ist bereits als ältere Endfassung gespeichert.');
      return active;
    }
    const id = crypto.randomUUID();
    await sql(
      'INSERT INTO video_studio_final_assets(id,job_id,filename,sha256,byte_size,width,height,duration_seconds,body) VALUES(?,?,?,?,?,?,?,?,?)',
      [id, jobId, x.filename, sha, body.length, info.width, info.height, info.duration_seconds, body]
    );
    return latest(jobId);
  };
  const response = async (jobId, selected, { method = 'GET', start, end } = {}) => {
    if (
      !selected ||
      selected.type !== 'final' ||
      !z.uuid().safeParse(selected.asset_id).success ||
      !/^[a-f0-9]{64}$/.test(selected.sha256 || '')
    )
      fail(422, 'Ungültige Endfassung.');
    const rows = await sql('SELECT body,sha256,byte_size FROM video_studio_final_assets WHERE id=? AND job_id=?', [
      selected.asset_id,
      jobId
    ]);
    const row = rows[0];
    if (!row || row.sha256 !== selected.sha256) fail(409, 'Die freigegebene Endfassung ist nicht mehr verfügbar.');
    const size = Number(row.byte_size),
      range = start !== undefined;
    if (range) end = end === undefined || end === '' ? size - 1 : Math.min(Number(end), size - 1);
    if (
      range &&
      (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= size)
    )
      fail(416, 'Ungültiger Dateibereich.');
    const headers = {
      'content-type': 'video/mp4',
      'content-length': String(range ? end - start + 1 : size),
      'accept-ranges': 'bytes',
      'cache-control': 'private, no-store'
    };
    if (range) headers['content-range'] = `bytes ${start}-${end}/${size}`;
    return new Response(method === 'HEAD' ? null : range ? row.body.subarray(start, end + 1) : row.body, {
      status: range ? 206 : 200,
      headers
    });
  };
  return { latest, source, importFile, response };
}
