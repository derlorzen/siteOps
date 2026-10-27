import * as z from 'zod/v4';
import { parseVideoInput, metadataSchema, youtubeDescription } from './video-production.mjs';
const fail = (statusCode, message) => {
  throw Object.assign(Error(message), { statusCode });
};
export function publicationThumbnail(encoded) {
  if (typeof encoded !== 'string' || encoded.length > 2800000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
    fail(422, 'Bitte ein JPEG-Titelbild bis 2 MB auswählen.');
  const bytes = Buffer.from(encoded, 'base64');
  if (
    bytes.length > 2 * 1024 * 1024 ||
    bytes.toString('base64') !== encoded ||
    bytes[0] !== 255 ||
    bytes[1] !== 216 ||
    bytes[2] !== 255
  )
    fail(422, 'Titelbild muss eine gültige JPEG-Datei bis 2 MB sein.');
  return bytes;
}
export function createVideoPublication({ db, getJob, updateMetadata }) {
  const sql = async (q, p = []) => (await db.query(q, p))[0];
  const read = async id => {
    const job = await getJob(id);
    const rows = await sql('SELECT thumbnail,updated_at FROM video_suite_publications WHERE job_id=?', [id]);
    return {
      job_id: id,
      project_id: job.project_id,
      status: job.status,
      title: job.title,
      youtube: job.youtube,
      format: job.format,
      resolution: job.result?.resolution || null,
      duration: job.result?.duration || null,
      captures: job.result?.captures || [],
      has_thumbnail: Boolean(rows[0]?.thumbnail),
      thumbnail_url: rows[0]?.thumbnail
        ? '/api/video-studio/jobs/' + id + '/publication/thumbnail?v=' + new Date(rows[0].updated_at).getTime()
        : null,
      description: job.youtube ? youtubeDescription(job.youtube) : '',
      ready:
        job.status === 'done' &&
        Math.min(job.result?.resolution?.width || 0, job.result?.resolution?.height || 0) >= 1080 &&
        Boolean(rows[0]?.thumbnail) &&
        Boolean(job.youtube?.title && job.youtube?.description)
    };
  };
  const save = async (id, raw) => {
    const job = await getJob(id);
    if (job.deleted_at) fail(409, 'Produktion zuerst wiederherstellen.');
    if (job.status !== 'done') fail(409, 'Zuerst das Video fertig produzieren.');
    const input = parseVideoInput(
      z.object({ youtube: metadataSchema, thumbnail: z.string().max(2800000).optional() }).strict(),
      raw
    );
    if (youtubeDescription(input.youtube).length > 5000)
      fail(422, 'Beschreibung mit Kapiteln und Hashtags ist länger als 5.000 Zeichen.');
    const bytes = input.thumbnail === undefined ? undefined : publicationThumbnail(input.thumbnail);
    await updateMetadata(id, input.youtube);
    if (bytes)
      await sql(
        'INSERT INTO video_suite_publications(job_id,thumbnail) VALUES(?,?) ON DUPLICATE KEY UPDATE thumbnail=VALUES(thumbnail),updated_at=NOW(3)',
        [id, bytes]
      );
    return read(id);
  };
  const thumbnail = async id => {
    await getJob(id);
    const rows = await sql('SELECT thumbnail FROM video_suite_publications WHERE job_id=?', [id]);
    if (!rows[0]?.thumbnail) fail(404, 'Noch kein Titelbild für diese Produktion ausgewählt.');
    return rows[0].thumbnail;
  };
  return { read, save, thumbnail };
}
