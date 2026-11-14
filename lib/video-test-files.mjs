import crypto from 'node:crypto';
import * as z from 'zod/v4';
import { parseVideoInput } from './video-production.mjs';
import { MAX_DEMO_FILE_BYTES, MAX_DEMO_FILES_BYTES, safeDemoFileName } from '../runner/video-files.mjs';

// Test files that demo recordings may upload, for example an example extension ZIP. They are only
// ever sent to the browser runner together with a request that references them by SHA-256.
const fail = (statusCode, message) => {
  throw Object.assign(new Error(message), { statusCode });
};
export const testFileSaveSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    mime: z.string().trim().max(100).default('application/octet-stream'),
    data: z
      .string()
      .min(4)
      .max(Math.ceil((MAX_DEMO_FILE_BYTES * 4) / 3) + 8)
  })
  .strict();

export function createVideoTestFiles({ db }) {
  const sql = async (query, params = []) => (await db.query(query, params))[0];
  const list = async () =>
    sql('SELECT id,name,mime,size,sha256,created_at FROM video_test_files ORDER BY created_at DESC LIMIT 50');
  const save = async raw => {
    const input = parseVideoInput(testFileSaveSchema, raw);
    let name;
    try {
      name = safeDemoFileName(input.name);
    } catch (error) {
      fail(422, error.message + ' Erlaubt: Buchstaben, Ziffern, Leerzeichen, . _ - ( ) +');
    }
    const data = Buffer.from(input.data, 'base64');
    if (!data.length) fail(422, 'Die Datei ist leer.');
    if (data.length > MAX_DEMO_FILE_BYTES) fail(413, 'Testdateien dürfen höchstens 8 MiB groß sein.');
    const sha256 = crypto.createHash('sha256').update(data).digest('hex');
    const existing = (await sql('SELECT id FROM video_test_files WHERE sha256=? LIMIT 1', [sha256]))[0];
    if (existing) {
      await sql('UPDATE video_test_files SET name=? WHERE id=?', [name, existing.id]);
      return {
        saved: true,
        file: (
          await sql('SELECT id,name,mime,size,sha256,created_at FROM video_test_files WHERE id=?', [existing.id])
        )[0]
      };
    }
    const id = crypto.randomUUID();
    await sql('INSERT INTO video_test_files(id,name,mime,size,sha256,data) VALUES(?,?,?,?,?,?)', [
      id,
      name,
      input.mime,
      data.length,
      sha256,
      data
    ]);
    return { saved: true, file: { id, name, mime: input.mime, size: data.length, sha256 } };
  };
  const remove = async raw => {
    const { id } = parseVideoInput(z.object({ id: z.uuid() }).strict(), raw);
    const result = await sql('DELETE FROM video_test_files WHERE id=?', [id]);
    if (!result.affectedRows) fail(404, 'Diese Testdatei ist nicht vorhanden.');
    return { removed: true };
  };
  // Files referenced by upload steps, ready for a runner request.
  const forScenes = async scenes => {
    const wanted = new Map();
    for (const scene of scenes || [])
      for (const step of scene?.demoSteps || []) if (step?.action === 'upload') wanted.set(step.sha256, step.name);
    if (!wanted.size) return [];
    const rows = await sql(
      'SELECT sha256,data FROM video_test_files WHERE sha256 IN (' + [...wanted.keys()].map(() => '?').join(',') + ')',
      [...wanted.keys()]
    );
    const found = new Map(rows.map(row => [row.sha256, row.data]));
    let total = 0;
    return [...wanted].map(([sha256, name]) => {
      const data = found.get(sha256);
      if (!data) fail(422, `Testdatei „${name}“ ist nicht mehr vorhanden. Unter Vorlagen erneut hochladen.`);
      total += data.length;
      if (total > MAX_DEMO_FILES_BYTES) fail(413, 'Zu viele Testdaten in einer Produktion (höchstens 10 MiB).');
      return { name, sha256, data: Buffer.from(data).toString('base64') };
    });
  };
  return { list, save, remove, forScenes };
}

export function registerVideoTestFileRoutes(app, files) {
  app.get('/api/video-suite/test-files', async () => ({ files: await files.list() }));
  app.post('/api/video-suite/test-files', { bodyLimit: 12 * 1024 * 1024 }, req => files.save(req.body));
  app.post('/api/video-suite/test-files/remove', req => files.remove(req.body));
}
