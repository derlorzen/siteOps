import crypto from 'node:crypto';
import * as z from 'zod/v4';
import { parseVideoInput } from './video-production.mjs';
const schema = z
  .object({
    project_id: z.uuid(),
    name: z.string().trim().min(1).max(160),
    mime_type: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    data: z
      .string()
      .min(4)
      .max(2800000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/)
  })
  .strict();
const fail = (statusCode, message) => {
  throw Object.assign(Error(message), { statusCode });
};
const meta = row => ({ id: row.id, name: row.name, url: '/api/video-suite/chat-images/' + row.id });
export function createChatImages({ db, studio }) {
  const get = async (id, projectId) => {
    parseVideoInput(z.uuid(), id);
    if (projectId) parseVideoInput(z.uuid(), projectId);
    const [rows] = await db.query(
      'SELECT id,project_id,name,mime_type,image FROM video_suite_chat_images WHERE id=?' +
        (projectId ? ' AND project_id=?' : '') +
        ' LIMIT 1',
      [id, ...(projectId ? [projectId] : [])]
    );
    if (!rows.length) fail(404, 'Chat-Bild in diesem Projekt nicht gefunden.');
    return rows[0];
  };
  const upload = async raw => {
    const x = parseVideoInput(schema, raw);
    await studio.getProject(x.project_id);
    const bytes = Buffer.from(x.data, 'base64');
    if (bytes.length > 2 * 1024 * 1024) fail(413, 'Bild ist zu groß (maximal 2 MB nach Aufbereitung).');
    if (bytes.toString('base64') !== x.data) fail(422, 'Ungültige Bildkodierung.');
    const valid =
      x.mime_type === 'image/png'
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : x.mime_type === 'image/jpeg'
          ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
    if (!valid) fail(422, 'Dateiinhalt und Bildformat stimmen nicht überein. PNG, JPG oder WebP verwenden.');
    const id = crypto.randomUUID();
    await db.query('INSERT INTO video_suite_chat_images(id,project_id,name,mime_type,image) VALUES(?,?,?,?,?)', [
      id,
      x.project_id,
      x.name,
      x.mime_type,
      bytes
    ]);
    return meta({ id, name: x.name });
  };
  const context = async (ids, projectId) => {
    const rows = [];
    for (const id of ids) rows.push(await get(id, projectId));
    return {
      attachments: rows.map(meta),
      parts: rows.map(row => ({
        type: 'input_image',
        image_url: 'data:' + row.mime_type + ';base64,' + row.image.toString('base64'),
        detail: 'auto'
      }))
    };
  };
  return { get, upload, context };
}
