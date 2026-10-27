import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoPublication, publicationThumbnail } from '../lib/video-publication.mjs';
import { createYouTubeUploadWorker } from '../lib/youtube-upload.mjs';
const id = '11111111-1111-4111-8111-111111111111';
const image = Buffer.from([255, 216, 255, 224, 0, 2, 255, 217]);
const metadata = {
  title: 'A complete tutorial',
  description: 'Description of the actual video.',
  keywords: ['Bagisto'],
  hashtags: ['#Bagisto'],
  chapters: [{ start_seconds: 0, title: 'Intro' }],
  thumbnail_concept: 'A clear product image',
  sources: []
};
test('publication saves metadata and a job-specific thumbnail without changing or rerendering the video', async () => {
  const job = {
    id,
    project_id: id,
    status: 'done',
    youtube: metadata,
    result: { resolution: { width: 1920, height: 1080 } }
  };
  let thumbnail,
    updates = 0;
  const db = {
    query: async (sql, p = []) => {
      if (sql.startsWith('INSERT')) thumbnail = p[1];
      return [[...(thumbnail ? [{ thumbnail, updated_at: new Date('2026-10-27') }] : [])]];
    }
  };
  const service = createVideoPublication({
    db,
    getJob: async () => job,
    updateMetadata: async (_id, m) => {
      job.youtube = m;
      updates++;
    }
  });
  assert.equal((await service.read(id)).ready, false);
  const result = await service.save(id, {
    youtube: { ...metadata, title: 'Reviewed title' },
    thumbnail: image.toString('base64')
  });
  assert.equal(result.ready, true);
  assert.equal(result.youtube.title, 'Reviewed title');
  assert.match(result.description, /00:00 Intro\n\n#Bagisto/);
  assert.equal(updates, 1);
  assert.equal(job.status, 'done');
  assert.equal((await service.thumbnail(id)).equals(image), true);
  await service.save(id, { youtube: metadata });
  assert.equal((await service.read(id)).has_thumbnail, true);
  job.status = 'running';
  await assert.rejects(service.save(id, { youtube: metadata }), /fertig produzieren/);
});
test('invalid publication images and oversized assembled descriptions fail before changing metadata', async () => {
  assert.throws(() => publicationThumbnail(Buffer.from('not a JPEG').toString('base64')), /JPEG/);
  assert.throws(() => publicationThumbnail(image.toString('base64') + '!'), /JPEG/);
  let writes = 0;
  const service = createVideoPublication({
    db: {
      query: async () => {
        writes++;
        return [[]];
      }
    },
    getJob: async () => ({ status: 'done' }),
    updateMetadata: async () => {
      writes++;
    }
  });
  await assert.rejects(service.save(id, { youtube: metadata, thumbnail: 'invalid' }), /JPEG/);
  assert.equal(writes, 0);
  await assert.rejects(
    service.save(id, {
      youtube: {
        ...metadata,
        description: 'x'.repeat(4500),
        chapters: Array.from({ length: 100 }, (_, i) => ({
          start_seconds: i,
          title: 'Long chapter title repeated more than enough to reach the description limit'
        }))
      }
    }),
    /5.000/
  );
  assert.equal(writes, 0);
});
test('thumbnail retry after a completed video upload never starts another video upload', async () => {
  const row = {
    id,
    account_id: id,
    video_job_id: id,
    kind: 'video',
    status: 'queued',
    attempts: 0,
    total_bytes: 1,
    metadata: JSON.stringify({ title: 'Reviewed', thumbnail: image.toString('base64') }),
    encrypted_session: 'session'
  };
  let checks = 0,
    thumbs = 0;
  const service = {
    encrypt: x => x,
    decrypt: () => ({ url: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=test' }),
    now: () => Date.now(),
    accessToken: async () => 'token',
    sql: async (sql, p = []) => {
      if (sql.startsWith('SELECT')) return [{ ...row }];
      if (sql.includes("status='uploading'")) {
        row.lease_token = p[0];
        return { affectedRows: 1 };
      }
      const keys = sql
        .split(' SET ')[1]
        .split(' WHERE ')[0]
        .split(',')
        .map(x => x.split('=')[0]);
      keys.forEach((key, i) => (row[key] = p[i]));
      return { affectedRows: 1 };
    },
    google: async (url, options) => {
      if (url.includes('/thumbnails/set')) {
        thumbs++;
        assert.equal(options.body.equals(image), true);
        return new Response(null, { status: thumbs === 1 ? 503 : 200 });
      }
      assert.equal(options.method, 'PUT');
      checks++;
      return Response.json({ id: 'existing001' });
    }
  };
  const worker = createYouTubeUploadWorker(service);
  await worker.tick();
  assert.equal(row.remote_video_id, 'existing001');
  assert.equal(row.status, 'retry');
  await worker.tick();
  assert.equal(row.status, 'done');
  assert.equal(checks, 1);
  assert.equal(thumbs, 2);
});
