// Durable, resumable execution of change_apply.
//
// Applying a preview takes a pre-change Git snapshot, writes the files over FTP/SFTP, takes a
// post-change snapshot, runs a health check and records the change. That regularly takes
// longer than the reverse proxy in front of SiteOps allows for one request, so the client saw
// "Bad Gateway" while the work either finished unseen or stopped half way when the process was
// recycled (files live, no post snapshot, no history entry, preview still "pending").
//
// Now the preview row itself is the job record:
//   pending/failed --claim--> applying --(execute)--> applied | failed
// A request waits at most `waitMs` and then answers "applying"; the work continues in the
// background and keeps a heartbeat. If the process dies, the heartbeat goes stale and the
// job is reclaimed (on startup, by the periodic worker, or by the next change_apply /
// change_status call) and resumed. `execute` must be idempotent: it skips files that already
// have the target content and reuses the stored pre-change snapshot.
const TIMEOUT = Symbol('timeout');

export function createChangeApplyJobs({
  q,
  execute,
  waitMs = 20000,
  staleSeconds = 180,
  heartbeatMs = 30000,
  log = console
}) {
  const running = new Map();

  async function load(id) {
    return (
      (
        await q(
          `select id,site_id,status,apply_stage,apply_error,apply_attempts,change_id,expires_at>now() not_expired,
            timestampdiff(second,apply_started_at,now()) started_age,
            timestampdiff(second,apply_heartbeat_at,now()) heartbeat_age
           from change_previews where id=?`,
          [id]
        )
      ).rows[0] || null
    );
  }

  // Atomic claim: fresh/failed previews that have not expired, or an applying job whose
  // heartbeat is stale (its process is gone). Only one caller/process wins the update.
  async function claim(id) {
    const r = await q(
      `update change_previews
         set status='applying', apply_error=null, apply_attempts=apply_attempts+1,
             apply_started_at=coalesce(apply_started_at,now()), apply_heartbeat_at=now(),
             apply_stage=coalesce(apply_stage,'queued')
       where id=? and (
         (status in ('pending','failed') and expires_at>now())
         or (status='applying' and (apply_heartbeat_at is null or apply_heartbeat_at < now() - interval ? second))
       )`,
      [id, staleSeconds]
    );
    return Number(r.meta?.affectedRows || 0) === 1;
  }

  async function beat(id, stage) {
    await q(
      `update change_previews set apply_heartbeat_at=now()${stage ? ',apply_stage=?' : ''} where id=? and status='applying'`,
      stage ? [stage, id] : [id]
    );
  }

  function launch(id) {
    if (running.has(id)) return running.get(id);
    const timer = setInterval(() => beat(id).catch(() => {}), heartbeatMs);
    timer.unref?.();
    const job = (async () => {
      try {
        return await execute(id, { stage: stage => beat(id, stage).catch(() => {}) });
      } catch (error) {
        await q(
          `update change_previews set status='failed', apply_error=?, apply_heartbeat_at=now() where id=? and status='applying'`,
          [String(error?.message || error).slice(0, 2000), id]
        ).catch(() => {});
        throw error;
      } finally {
        clearInterval(timer);
        running.delete(id);
      }
    })();
    running.set(id, job);
    job.catch(error => log.error?.('change apply failed', id, error?.message || error));
    return job;
  }

  async function appliedResult(row) {
    const change = (
      await q(
        'select id,pre_commit,post_commit,files,status,health_result from changes where preview_id=? order by created_at desc limit 1',
        [row.id]
      )
    ).rows[0];
    return {
      status: change?.status || 'deployed',
      previewStatus: 'applied',
      alreadyApplied: true,
      changeId: change?.id || row.change_id || null,
      preCommit: change?.pre_commit || null,
      postCommit: change?.post_commit || null,
      files: parseMaybe(change?.files),
      health: parseMaybe(change?.health_result)
    };
  }

  function runningResult(row) {
    return {
      status: 'applying',
      previewId: row.id,
      stage: row.apply_stage || 'queued',
      attempts: row.apply_attempts ?? null,
      runningForSeconds: row.started_age ?? null,
      message:
        'Die Änderung läuft im Hintergrund weiter. Stand mit change_status(preview_id) abfragen; ein erneuter change_apply-Aufruf ist gefahrlos und startet nichts doppelt.'
    };
  }

  async function waitFor(job, id, ms) {
    let timer;
    const timeout = new Promise(resolve => {
      timer = setTimeout(() => resolve(TIMEOUT), ms);
    });
    try {
      const value = await Promise.race([job, timeout]);
      if (value !== TIMEOUT) return value;
    } finally {
      clearTimeout(timer);
    }
    return runningResult(await load(id));
  }

  async function apply(id, { wait = waitMs } = {}) {
    if (running.has(id)) return waitFor(running.get(id), id, wait);
    if (await claim(id)) return waitFor(launch(id), id, wait);
    const row = await load(id);
    if (!row) throw new Error('Preview not found or expired');
    if (row.status === 'applied') return appliedResult(row);
    if (row.status === 'applying') return runningResult(row);
    if (row.status === 'failed' && !row.not_expired)
      throw new Error('Preview not found or expired: ' + (row.apply_error || 'apply failed'));
    throw new Error('Preview not found or expired');
  }

  async function status(id) {
    const row = await load(id);
    if (!row) throw new Error('Preview not found');
    if (row.status === 'applied') return appliedResult(row);
    if (row.status === 'applying') {
      if (!running.has(id) && (row.heartbeat_age === null || row.heartbeat_age >= staleSeconds) && (await claim(id))) {
        launch(id);
        return { ...runningResult(await load(id)), resumed: true };
      }
      return runningResult(row);
    }
    if (row.status === 'failed')
      return {
        status: 'failed',
        previewId: id,
        stage: row.apply_stage,
        error: row.apply_error,
        retryable: Boolean(row.not_expired),
        message: row.not_expired
          ? 'Erneuter change_apply-Aufruf setzt dort fort, wo es gescheitert ist (bereits geschriebene Dateien werden erkannt).'
          : 'Vorschau abgelaufen. Aktuelle Dateien lesen und eine neue Vorschau erstellen.'
      };
    return { status: row.status, previewId: id, expired: !row.not_expired };
  }

  async function recoverStale() {
    const rows = (
      await q(
        `select id from change_previews where status='applying' and (apply_heartbeat_at is null or apply_heartbeat_at < now() - interval ? second) order by apply_started_at limit 20`,
        [staleSeconds]
      )
    ).rows;
    const resumed = [];
    for (const { id } of rows) {
      if (running.has(id)) continue;
      if (await claim(id)) {
        launch(id);
        resumed.push(id);
      }
    }
    if (resumed.length) log.info?.('resumed interrupted change applies', resumed);
    return resumed;
  }

  function startWorker(intervalMs = 60000) {
    recoverStale().catch(error => log.error?.('change apply recovery', error));
    const timer = setInterval(
      () => recoverStale().catch(error => log.error?.('change apply recovery', error)),
      intervalMs
    );
    timer.unref?.();
    return timer;
  }

  return { apply, status, recoverStale, startWorker, isRunning: id => running.has(id) };
}

function parseMaybe(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
