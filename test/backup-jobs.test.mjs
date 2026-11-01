import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackupJobs } from '../lib/backup-jobs.mjs';

test('persistent backup starts once per intent, reports real phases and only completes after the backup resolves', async () => {
  const rows = new Map();
  let calls = 0,
    finish;
  const completed = new Promise(resolve => {
    finish = resolve;
  });
  const db = {
    query: async (sql, p) => {
      if (sql.startsWith('INSERT')) {
        const existing = [...rows.values()].find(row => row.hash === p[2]);
        if (existing) return [{ affectedRows: 0 }];
        rows.set(p[0], {
          id: p[0],
          site_id: p[1],
          hash: p[2],
          state: 'waiting',
          phase: 'Wartet',
          heartbeat_at: new Date(),
          heartbeat_age_seconds: 0
        });
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('WHERE idempotency_hash')) return [[...[...rows.values()].filter(row => row.hash === p[0])]];
      if (sql.startsWith('SELECT')) return [[rows.get(p[0])].filter(Boolean)];
      if (sql.includes("state='running'") && sql.includes('SET state')) {
        const row = rows.get(p[1]);
        if (row.state !== 'waiting') return [{ affectedRows: 0 }];
        row.state = 'running';
        row.worker_id = p[0];
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("state='completed'")) {
        const row = rows.get(p[1]);
        row.state = 'completed';
        row.result_json = p[0];
        row.phase = 'Sicherung erstellt';
        return [{ affectedRows: 1 }];
      }
      throw Error('Unexpected SQL');
    }
  };
  const service = createBackupJobs({
    db,
    getSite: async () => ({ id: 'website-id' }),
    backup: async () => {
      calls++;
      await completed;
      return { backupId: 'backup-id', file_count: 2 };
    }
  });
  const input = { site: 'demo', idempotency_key: 'one-intended-backup' };
  const first = await service.start(input, 'owner');
  const second = await service.start(input, 'owner');
  assert.equal(first.id, second.id);
  assert.equal(first.status, 'waiting');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal((await service.get(first.id)).status, 'running');
  finish();
  await new Promise(resolve => setImmediate(resolve));
  const result = await service.get(first.id);
  assert.equal(result.status, 'completed');
  assert.equal(result.result.backupId, 'backup-id');
});
test('missing heartbeat is unknown and never reported as success or silently replayed', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const service = createBackupJobs({
    db: {
      query: async () => [
        [
          {
            id,
            site_id: 'site',
            state: 'running',
            phase: 'Reading',
            heartbeat_at: '2020-01-01T00:00:00Z',
            heartbeat_age_seconds: 1000000
          }
        ]
      ]
    },
    getSite: async () => {},
    backup: async () => assert.fail()
  });
  const result = await service.get(id);
  assert.equal(result.status, 'unknown');
  assert.equal(result.result, null);
});
