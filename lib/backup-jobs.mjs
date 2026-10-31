import crypto from 'node:crypto';
import * as z from 'zod/v4';
import { publicError } from './capability-registry.mjs';

export const backupJobInput = z.object({
  site: z.string().min(1).max(255),
  idempotency_key: z.string().min(8).max(100)
});
const parse = value => (typeof value === 'string' ? JSON.parse(value) : value);
export function createBackupJobs({ db, getSite, backup }) {
  const worker = crypto.randomUUID(),
    running = new Set();
  const key = (actor, input) =>
    crypto
      .createHash('sha256')
      .update(actor + '\n' + input.idempotency_key)
      .digest('hex');
  async function get(id) {
    const [rows] = await db.query(
      'SELECT id,site_id,state,phase,result_json,error_json,heartbeat_at,TIMESTAMPDIFF(SECOND,heartbeat_at,NOW()) heartbeat_age_seconds,created_at,completed_at FROM backup_jobs WHERE id=?',
      [z.uuid().parse(id)]
    );
    const row = rows[0];
    if (!row) throw Object.assign(Error('Job missing'), { statusCode: 404 });
    const stale =
      ['waiting', 'running'].includes(row.state) &&
      (!Number.isFinite(Number(row.heartbeat_age_seconds)) || Number(row.heartbeat_age_seconds) > 120);
    return {
      id: row.id,
      site_id: row.site_id,
      status: stale ? 'unknown' : row.state,
      phase: stale
        ? 'Der Server hat länger keinen Auftragszustand bestätigt. Vor einer Wiederholung den Sicherungsverlauf prüfen.'
        : row.phase,
      result: row.result_json ? parse(row.result_json) : null,
      error: row.error_json ? parse(row.error_json) : null,
      created_at: row.created_at,
      completed_at: row.completed_at
    };
  }
  async function execute(id, site) {
    if (running.has(id)) return;
    running.add(id);
    let heartbeat;
    try {
      const [claim] = await db.query(
        "UPDATE backup_jobs SET state='running',phase='Quelldateien lesen und Sicherung erstellen',worker_id=?,heartbeat_at=NOW() WHERE id=? AND state='waiting'",
        [worker, id]
      );
      if (claim.affectedRows !== 1) return;
      heartbeat = setInterval(
        () =>
          db
            .query("UPDATE backup_jobs SET heartbeat_at=NOW() WHERE id=? AND worker_id=? AND state='running'", [
              id,
              worker
            ])
            .catch(() => {}),
        30000
      );
      heartbeat.unref();
      const result = await backup(site);
      await db.query(
        "UPDATE backup_jobs SET state='completed',phase='Sicherung erstellt',result_json=?,completed_at=NOW(),heartbeat_at=NOW() WHERE id=? AND worker_id=?",
        [JSON.stringify(result), id, worker]
      );
    } catch (error) {
      await db
        .query(
          "UPDATE backup_jobs SET state='failed',phase='Sicherung konnte nicht abgeschlossen werden',error_json=?,completed_at=NOW(),heartbeat_at=NOW() WHERE id=? AND worker_id=?",
          [JSON.stringify(publicError(error, { capability: 'backup_start' })), id, worker]
        )
        .catch(() => {});
    } finally {
      clearInterval(heartbeat);
      running.delete(id);
    }
  }
  async function start(raw, actor) {
    const input = backupJobInput.parse(raw),
      site = await getSite(input.site),
      dedup = key(actor, input),
      id = crypto.randomUUID();
    const [insert] = await db.query(
      "INSERT IGNORE INTO backup_jobs(id,site_id,idempotency_hash,state,phase,heartbeat_at) VALUES(?,?,?,'waiting','Sicherung wartet auf Ausführung',NOW())",
      [id, site.id, dedup]
    );
    const [rows] = await db.query('SELECT id,site_id FROM backup_jobs WHERE idempotency_hash=?', [dedup]);
    if (!rows[0] || rows[0].site_id !== site.id)
      throw Object.assign(Error('Idempotency key conflicts with website'), { statusCode: 409 });
    if (insert.affectedRows === 1) setImmediate(() => execute(id, site));
    return get(rows[0].id);
  }
  return { start, get };
}
