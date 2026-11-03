import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChangeApplyJobs } from '../lib/change-apply-jobs.mjs';

// Minimal in-memory stand-in for the SQL used by change-apply-jobs. Time is a counter in
// seconds so heartbeat staleness can be simulated without waiting.
function fakeDb(rows) {
  const db = { now: 1000, previews: new Map(rows.map(r => [r.id, { ...r }])), changes: [] };
  const age = t => (t === null || t === undefined ? null : db.now - t);
  db.q = async (sql, params) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith("update change_previews set status='applying'")) {
      const [id, stale] = params;
      const p = db.previews.get(id);
      const ok =
        p &&
        ((['pending', 'failed'].includes(p.status) && p.expires > db.now) ||
          (p.status === 'applying' && (p.heartbeat == null || db.now - p.heartbeat > stale)));
      if (ok) {
        p.status = 'applying';
        p.apply_error = null;
        p.apply_attempts = (p.apply_attempts || 0) + 1;
        p.started ??= db.now;
        p.heartbeat = db.now;
        p.apply_stage ??= 'queued';
      }
      return { rows: [], meta: { affectedRows: ok ? 1 : 0 } };
    }
    if (s.startsWith('update change_previews set apply_heartbeat_at=now()')) {
      const id = params[params.length - 1];
      const p = db.previews.get(id);
      if (p?.status === 'applying') {
        p.heartbeat = db.now;
        if (params.length === 2) p.apply_stage = params[0];
      }
      return { rows: [], meta: {} };
    }
    if (s.startsWith("update change_previews set status='failed'")) {
      const [error, id] = params;
      const p = db.previews.get(id);
      if (p?.status === 'applying') Object.assign(p, { status: 'failed', apply_error: error, heartbeat: db.now });
      return { rows: [], meta: {} };
    }
    if (s.startsWith('select id,site_id,status')) {
      const p = db.previews.get(params[0]);
      return {
        rows: p
          ? [
              {
                ...p,
                not_expired: p.expires > db.now ? 1 : 0,
                started_age: age(p.started),
                heartbeat_age: age(p.heartbeat)
              }
            ]
          : []
      };
    }
    if (s.startsWith('select id,pre_commit,post_commit')) {
      return { rows: db.changes.filter(c => c.preview_id === params[0]) };
    }
    if (s.startsWith("select id from change_previews where status='applying'")) {
      const [stale] = params;
      return {
        rows: [...db.previews.values()]
          .filter(p => p.status === 'applying' && (p.heartbeat == null || db.now - p.heartbeat > stale))
          .map(p => ({ id: p.id }))
      };
    }
    throw new Error('unexpected SQL in test: ' + s);
  };
  // What runPreviewApply does at the end of a successful run.
  db.finish = (id, changeId = 'change-' + id) => {
    db.changes.push({
      id: changeId,
      preview_id: id,
      pre_commit: 'pre',
      post_commit: 'post',
      files: '["a.php"]',
      status: 'deployed'
    });
    Object.assign(db.previews.get(id), { status: 'applied', change_id: changeId, apply_stage: 'done' });
    return { changeId, status: 'deployed' };
  };
  return db;
}
const quiet = { error() {}, info() {} };
const preview = (id, extra = {}) => ({ id, status: 'pending', expires: 99999, apply_attempts: 0, ...extra });

test('a fast apply returns the result directly', async () => {
  const db = fakeDb([preview('p1')]);
  const jobs = createChangeApplyJobs({ q: db.q, log: quiet, execute: async id => db.finish(id) });
  const result = await jobs.apply('p1');
  assert.equal(result.changeId, 'change-p1');
  assert.equal(db.previews.get('p1').status, 'applied');
});

test('a slow apply answers "applying" in time and keeps running in the background', async () => {
  const db = fakeDb([preview('p1')]);
  let release;
  const gate = new Promise(r => (release = r));
  let runs = 0;
  const jobs = createChangeApplyJobs({
    q: db.q,
    log: quiet,
    waitMs: 20,
    execute: async (id, { stage }) => {
      runs++;
      await stage('write');
      await gate;
      return db.finish(id);
    }
  });
  const first = await jobs.apply('p1');
  assert.equal(first.status, 'applying');
  assert.equal(first.stage, 'write');
  // Retrying while it runs must not start a second execution.
  const second = await jobs.apply('p1', { wait: 5 });
  assert.equal(second.status, 'applying');
  assert.equal(runs, 1);
  release();
  await new Promise(r => setTimeout(r, 5));
  const done = await jobs.status('p1');
  assert.equal(done.status, 'deployed');
  assert.equal(done.alreadyApplied, true);
  assert.equal(done.changeId, 'change-p1');
  // change_apply on an applied preview is answered with the recorded change, not "stale".
  assert.equal((await jobs.apply('p1')).changeId, 'change-p1');
  assert.equal(runs, 1);
});

test('an apply interrupted by a dead process is resumed once its heartbeat is stale', async () => {
  // Process A claimed and died: status applying, heartbeat 10 min old, no in-memory job.
  const db = fakeDb([
    preview('p1', { status: 'applying', started: 400, heartbeat: 400, apply_stage: 'post_snapshot', apply_attempts: 1 })
  ]);
  const executed = [];
  const jobs = createChangeApplyJobs({
    q: db.q,
    log: quiet,
    staleSeconds: 180,
    execute: async id => {
      executed.push(id);
      return db.finish(id);
    }
  });
  assert.deepEqual(await jobs.recoverStale(), ['p1']);
  await new Promise(r => setTimeout(r, 5));
  assert.deepEqual(executed, ['p1']);
  assert.equal(db.previews.get('p1').status, 'applied');
  assert.equal(db.previews.get('p1').apply_attempts, 2);
});

test('a fresh heartbeat from another process is not taken over', async () => {
  const db = fakeDb([preview('p1', { status: 'applying', started: 990, heartbeat: 995 })]);
  let runs = 0;
  const jobs = createChangeApplyJobs({ q: db.q, log: quiet, execute: async () => runs++ });
  assert.deepEqual(await jobs.recoverStale(), []);
  const r = await jobs.apply('p1');
  assert.equal(r.status, 'applying');
  assert.equal(runs, 0);
});

test('change_status resumes an orphaned apply', async () => {
  const db = fakeDb([preview('p1', { status: 'applying', started: 100, heartbeat: 100 })]);
  const jobs = createChangeApplyJobs({ q: db.q, log: quiet, execute: async id => db.finish(id) });
  const r = await jobs.status('p1');
  assert.equal(r.resumed, true);
  await new Promise(r2 => setTimeout(r2, 5));
  assert.equal(db.previews.get('p1').status, 'applied');
});

test('a failed apply is reported and can be retried while the preview is valid', async () => {
  const db = fakeDb([preview('p1')]);
  let attempt = 0;
  const jobs = createChangeApplyJobs({
    q: db.q,
    log: quiet,
    execute: async id => {
      attempt++;
      if (attempt === 1) throw Object.assign(new Error('ETIMEDOUT ftp'), { code: 'ETIMEDOUT' });
      return db.finish(id);
    }
  });
  await assert.rejects(jobs.apply('p1'), /ETIMEDOUT/);
  const failed = await jobs.status('p1');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.retryable, true);
  assert.match(failed.error, /ETIMEDOUT/);
  assert.equal((await jobs.apply('p1')).changeId, 'change-p1');
});

test('expired and unknown previews are rejected as stale', async () => {
  const db = fakeDb([preview('old', { expires: 10 })]);
  const jobs = createChangeApplyJobs({ q: db.q, log: quiet, execute: async () => assert.fail('must not run') });
  await assert.rejects(jobs.apply('old'), /Preview not found or expired/);
  await assert.rejects(jobs.apply('missing'), /Preview not found or expired/);
});
