import crypto from 'node:crypto';
import * as z from 'zod/v4';
import { parseVideoInput } from './video-production.mjs';
const fail = (statusCode, message) => {
  throw Object.assign(Error(message), { statusCode });
};
export function createVideoIntros({ db, getProject, runner, capabilities }) {
  const sql = async (q, p = []) => (await db.query(q, p))[0];
  const get = async (id, projectId) => {
    parseVideoInput(z.uuid(), id);
    const row = (await sql('SELECT * FROM video_studio_intro_assets WHERE id=?', [id]))[0];
    if (!row || (projectId && row.project_id !== projectId)) fail(404, 'Intro in diesem Projekt nicht gefunden.');
    return { ...row, metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata };
  };
  const list = async projectId => {
    await getProject(projectId);
    return (
      await sql(
        "SELECT id,name,metadata FROM video_studio_intro_assets WHERE project_id=? AND status='ready' ORDER BY created_at DESC LIMIT 100",
        [projectId]
      )
    ).map(x => ({ ...x, metadata: typeof x.metadata === 'string' ? JSON.parse(x.metadata) : x.metadata }));
  };
  const start = async raw => {
    const x = parseVideoInput(
      z.object({ project_id: z.uuid(), name: z.string().trim().min(1).max(160) }).strict(),
      raw
    );
    await getProject(x.project_id);
    if ((await capabilities()).introVersion !== 1)
      fail(409, 'Für Intro-Uploads den Browser Runner auf mindestens 1.4.0 aktualisieren.');
    const id = crypto.randomUUID();
    await sql('INSERT INTO video_studio_intro_assets(id,project_id,name) VALUES(?,?,?)', [id, x.project_id, x.name]);
    return { id };
  };
  const forward = async (id, action, body) => {
    const asset = await get(id);
    if (asset.status === 'ready' && action !== 'complete')
      fail(409, 'Dieses Intro ist bereits vollständig hochgeladen.');
    const response = await runner('/video/intros/' + id + '/' + action, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    let result = await response.json().catch(() => ({}));
    if (!response.ok)
      fail(
        [413, 422, 409, 507].includes(response.status) ? response.status : 502,
        result.error || result.message || 'Intro-Upload fehlgeschlagen.'
      );
    if (action === 'complete')
      result = parseVideoInput(
        z
          .object({
            id: z.literal(id),
            duration: z.number().min(0.5).max(60),
            width: z.number().int().min(1).max(4096),
            height: z.number().int().min(1).max(4096),
            has_audio: z.boolean(),
            size: z
              .number()
              .int()
              .min(1)
              .max(50 * 1024 * 1024)
          })
          .refine(x => Math.min(x.width, x.height) >= 720),
        result
      );
    if (action === 'complete')
      await sql("UPDATE video_studio_intro_assets SET status='ready',metadata=? WHERE id=?", [
        JSON.stringify(result),
        id
      ]);
    if (action === 'cancel') await sql("DELETE FROM video_studio_intro_assets WHERE id=? AND status='uploading'", [id]);
    return result;
  };
  const chunk = async (id, raw) => {
    const x = parseVideoInput(
      z
        .object({
          index: z.number().int().min(0).max(49),
          data: z
            .string()
            .min(4)
            .max(1398104)
            .regex(/^[A-Za-z0-9+/]+={0,2}$/)
        })
        .strict(),
      raw
    );
    return forward(id, 'chunks', x);
  };
  const complete = id => forward(id, 'complete', {}),
    cancel = id => forward(id, 'cancel', {});
  const file = async (id, range) => {
    const asset = await get(id);
    if (asset.status !== 'ready') fail(409, 'Intro noch nicht vollständig hochgeladen.');
    return runner('/video/intros/' + id + '/file', { headers: range ? { Range: range } : {} });
  };
  return { get, list, start, chunk, complete, cancel, file };
}
