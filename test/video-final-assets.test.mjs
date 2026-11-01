import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createFinalVideoAssets, inspectFinalMp4, FINAL_VIDEO_MAX_BYTES } from '../lib/video-final-assets.mjs';
import { createVideoStudio } from '../lib/video-studio.mjs';

const jobId = '11111111-1111-4111-8111-111111111111';
const atom = (type, ...parts) => {
  const body = Buffer.concat(parts),
    header = Buffer.alloc(8);
  header.writeUInt32BE(body.length + 8);
  header.write(type, 4);
  return Buffer.concat([header, body]);
};
function sample(width = 1920, height = 1080) {
  const mvhd = Buffer.alloc(20);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(12000, 16);
  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(width * 65536, 76);
  tkhd.writeUInt32BE(height * 65536, 80);
  const handler = type => {
    const b = Buffer.alloc(12);
    b.write(type, 8);
    return atom('hdlr', b);
  };
  return Buffer.concat([
    atom('ftyp', Buffer.from('isom0000')),
    atom(
      'moov',
      atom('mvhd', mvhd),
      atom('trak', atom('tkhd', tkhd), atom('mdia', handler('vide'))),
      atom('trak', atom('mdia', handler('soun')))
    ),
    atom('mdat', Buffer.from([1, 2, 3]))
  ]);
}
function fixture() {
  const rows = [];
  const job = {
    id: jobId,
    project_id: jobId,
    status: 'done',
    format: 'landscape',
    result: { files: ['video'], resolution: { width: 1920, height: 1080 } },
    runner_job_id: jobId
  };
  const db = {
    query: async (sql, p = []) => {
      if (sql.startsWith('SELECT * FROM video_studio_jobs')) return [[job]];
      if (sql.startsWith('INSERT INTO video_studio_final_assets')) {
        const [id, job_id, filename, sha256, byte_size, width, height, duration_seconds, body] = p;
        rows.push({ id, job_id, filename, sha256, byte_size, width, height, duration_seconds, body });
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('FROM video_studio_final_assets')) {
        if (sql.includes('WHERE id=?')) return [rows.filter(r => r.id === p[0] && r.job_id === p[1])];
        if (sql.includes('AND sha256=?')) return [rows.filter(r => r.job_id === p[0] && r.sha256 === p[1])];
        return [
          rows
            .filter(r => r.job_id === p[0])
            .slice(-1)
            .map(({ body, ...rest }) => rest)
        ];
      }
      return [[]];
    }
  };
  const service = createFinalVideoAssets({ db, getJob: async () => job });
  return { rows, job, db, service };
}
const input = body => ({
  filename: 'edited.mp4',
  sha256: crypto.createHash('sha256').update(body).digest('hex'),
  data_base64: body.toString('base64')
});
test('MP4 inspector rejects invalid, truncated, oversized and trackless files and extracts actual dimensions', () => {
  assert.deepEqual(inspectFinalMp4(sample()), { width: 1920, height: 1080, duration_seconds: 12 });
  for (const body of [
    Buffer.from('not video'),
    sample().subarray(0, 40),
    Buffer.alloc(FINAL_VIDEO_MAX_BYTES + 1),
    atom('ftyp', Buffer.alloc(30))
  ])
    assert.throws(() => inspectFinalMp4(body));
});
test('final import preserves versions, verifies hash and job state, supports ranges, and pins previous uploads', async () => {
  const { service, job, rows } = fixture(),
    first = sample();
  await assert.rejects(service.importFile(jobId, { ...input(first), sha256: '0'.repeat(64) }), /Prüfsumme/);
  await assert.rejects(service.importFile(jobId, { ...input(first), filename: '../bad.mp4' }));
  assert.equal(rows.length, 0);
  const one = await service.importFile(jobId, input(first));
  assert.equal(one.byte_size, first.length);
  await service.importFile(jobId, input(first));
  assert.equal(rows.length, 1);
  const source = await service.source(jobId, 'video');
  assert.equal(source.type, 'final');
  const second = sample(1280, 720);
  await service.importFile(jobId, input(second));
  assert.equal(rows.length, 2);
  assert.notEqual((await service.source(jobId, 'video')).asset_id, source.asset_id);
  assert.equal((await service.source(jobId, 'video', one.id)).sha256, source.sha256);
  await assert.rejects(service.source(jobId, 'video', '33333333-3333-4333-8333-333333333333'), /nicht verfügbar/);
  const full = await service.response(jobId, source);
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), first);
  const part = await service.response(jobId, source, { start: 3, end: 9 });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 3-9/${first.length}`);
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), first.subarray(3, 10));
  const open = await service.response(jobId, source, { start: 3, end: '' });
  assert.equal(Number(open.headers.get('content-length')), first.length - 3);
  const head = await service.response(jobId, source, { method: 'HEAD' });
  assert.equal(head.body, null);
  assert.equal(Number(head.headers.get('content-length')), first.length);
  await assert.rejects(service.response(jobId, source, { start: first.length, end: first.length }), /Dateibereich/);
  await assert.rejects(service.response(jobId, { ...source, sha256: '0'.repeat(64) }), /nicht mehr/);
  assert.equal((await service.source(jobId, 'short')).type, 'runner');
  job.status = 'running';
  await assert.rejects(service.importFile(jobId, input(first)), /fertige/);
  job.status = 'done';
  job.deleted_at = '2026';
  await assert.rejects(service.importFile(jobId, input(first)), /aktive/);
});
test('studio downloads and publication select final while preserving original runner access', async () => {
  const { service, db } = fixture();
  await service.importFile(jobId, input(sample()));
  const studio = createVideoStudio({ db, runnerUrl: () => '', runnerToken: () => '' });
  const response = await studio.artifactResponse(jobId, 'video', { start: 0, end: 15 });
  assert.equal(response.status, 206);
  const file = await studio.download(jobId, 'video');
  assert.equal(file.type, 'video/mp4');
  const pub = await studio.publication.read(jobId);
  assert.equal(pub.media_source.type, 'final');
  assert.equal(pub.duration, 12);
  await assert.rejects(studio.artifactResponse(jobId, 'video', { source: { type: 'runner' } }), /Runner/);
});

test('private upload worker reads the same pinned final version for HEAD and every byte range', async () => {
  const { createYouTubeUploadWorker } = await import('../lib/youtube-upload.mjs');
  const source = { type: 'final', asset_id: jobId, sha256: 'a'.repeat(64) },
    bytes = Buffer.from('final');
  const row = {
    id: jobId,
    account_id: jobId,
    video_job_id: jobId,
    kind: 'video',
    status: 'queued',
    attempts: 0,
    metadata: { source, title: 'Reviewed final', tags: [], made_for_kids: false, contains_synthetic_media: false }
  };
  const reads = [];
  let googleCalls = 0;
  const service = {
    encrypt: x => x,
    decrypt: x => x,
    now: () => Date.now(),
    accessToken: async () => 'test-token',
    sql: async (sql, p = []) => {
      if (sql.startsWith('SELECT')) return [{ ...row }];
      if (sql.includes("status='uploading'")) {
        row.lease_token = p[0];
        return { affectedRows: 1 };
      }
      if (sql.includes('SET encrypted_session')) {
        row.encrypted_session = p[0];
        row.total_bytes = p[1];
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
    studio: () => ({
      artifactResponse: async (_job, _kind, options) => {
        reads.push(options);
        assert.deepEqual(options.source, source);
        return options.method === 'HEAD'
          ? new Response(null, { headers: { 'content-length': String(bytes.length) } })
          : new Response(bytes, { status: 206, headers: { 'content-range': `bytes 0-4/${bytes.length}` } });
      }
    }),
    google: async (_url, options) => {
      googleCalls++;
      if (options.method === 'POST') {
        assert.equal(JSON.parse(options.body).status.privacyStatus, 'private');
        return new Response(null, {
          status: 200,
          headers: { location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=test' }
        });
      }
      if (options.headers['content-range'].startsWith('bytes */')) return new Response(null, { status: 308 });
      assert.deepEqual(options.body, bytes);
      return Response.json({ id: 'private001' });
    }
  };
  await createYouTubeUploadWorker(service).tick();
  assert.equal(googleCalls, 3);
  assert.equal(reads.length, 2);
  assert.equal(row.status, 'done');
});
