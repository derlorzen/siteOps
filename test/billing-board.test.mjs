import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { validateKanbanOrder, KANBAN_STATUSES, createBillingBoard } from '../lib/billing-board.mjs';

const ids = [randomUUID(), randomUUID(), randomUUID()];
const projectId = randomUUID();

const empty = () => Object.fromEntries(KANBAN_STATUSES.map(status => [status, []]));
const ordered = () => ({ ...empty(), open: [ids[0]], in_progress: [ids[1]], done: [ids[2]] });

function fakeBoard() {
  const tasks = ids.map((id, i) => ({
    id,
    project_id: projectId,
    name: 'Task ' + i,
    status: ['open', 'in_progress', 'done'][i],
    sort_position: i * 1000,
    created_at: '2026-10-14',
    tracked_seconds: i * 600
  }));
  const changes = [];
  let revision = 7;
  let commits = 0;
  let rollbacks = 0;
  const query = async (sql, params = []) => {
    if (sql.includes('FROM customer_projects p JOIN customers c'))
      return [
        [
          {
            id: projectId,
            name: 'Homepage',
            customer_id: randomUUID(),
            customer_name: 'Gartenbau',
            board_revision: revision
          }
        ]
      ];
    if (sql.includes('FROM project_tasks t LEFT JOIN')) return [tasks];
    if (sql.startsWith('SELECT id,board_revision FROM customer_projects'))
      return [[{ id: projectId, board_revision: revision }]];
    if (sql.startsWith('SELECT id FROM project_tasks WHERE project_id')) return [tasks.map(({ id }) => ({ id }))];
    if (sql.startsWith('UPDATE project_tasks SET')) {
      changes.push(params);
      const task = tasks.find(x => x.id === params[2]);
      task.status = params[0];
      task.sort_position = params[1];
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('UPDATE customer_projects SET board_revision')) {
      revision += 1;
      return [{ affectedRows: 1 }];
    }
    return [[]];
  };
  const db = {
    query,
    getConnection: async () => ({
      query,
      beginTransaction: async () => {},
      commit: async () => {
        commits++;
      },
      rollback: async () => {
        rollbacks++;
      },
      release: () => {}
    })
  };
  return {
    board: createBillingBoard({ db }),
    changes,
    get revision() {
      return revision;
    },
    get commits() {
      return commits;
    },
    get rollbacks() {
      return rollbacks;
    }
  };
}

test('all 5 Kanban statuses exist', () => {
  assert.deepEqual(KANBAN_STATUSES, ['backlog', 'open', 'in_progress', 'review', 'done']);
});

test('reject missing, foreign and duplicate task ids across columns', () => {
  assert.equal(validateKanbanOrder(ids, ordered()), true);
  assert.equal(validateKanbanOrder(ids, { ...empty(), open: [ids[0], ids[1]] }), false);
  assert.equal(validateKanbanOrder(ids, { ...empty(), open: [ids[0], ids[1], ids[1]] }), false);
  assert.equal(validateKanbanOrder(ids, { ...empty(), open: [ids[0], ids[1], randomUUID()] }), false);
});

test('board move persists status and column order within one transaction', async () => {
  const fake = fakeBoard();
  const input = { ...empty(), open: [ids[2], ids[0]], done: [ids[1]] };
  const response = await fake.board.saveBoard(projectId, { revision: 7, columns: input });
  assert.equal(fake.commits, 1);
  assert.equal(fake.rollbacks, 0);
  assert.equal(fake.revision, 8);
  assert.deepEqual(fake.changes, [
    ['open', 1000, ids[2], projectId],
    ['open', 2000, ids[0], projectId],
    ['done', 1000, ids[1], projectId]
  ]);
  assert.deepEqual(response.columns.open.map(x => x.id).sort(), [ids[0], ids[2]].sort());
});

test('stale revision causes conflict before any task is moved', async () => {
  const fake = fakeBoard();
  await assert.rejects(
    fake.board.saveBoard(projectId, { revision: 6, columns: ordered() }),
    error => error.statusCode === 409
  );
  assert.equal(fake.commits, 0);
  assert.equal(fake.rollbacks, 1);
  assert.equal(fake.changes.length, 0);
});

test('foreign tasks are rejected, project membership cannot be changed by reorder', async () => {
  const fake = fakeBoard();
  const invalid = { ...empty(), open: [ids[0], ids[1], randomUUID()] };
  await assert.rejects(
    fake.board.saveBoard(projectId, { revision: 7, columns: invalid }),
    error => error.statusCode === 409
  );
  assert.equal(fake.commits, 0);
  assert.equal(fake.rollbacks, 1);
  assert.equal(fake.changes.length, 0);
});

test('Kanban browser file has valid JavaScript syntax', async () => {
  const code = await readFile(new URL('../public/billing-board.js', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new vm.Script(code));
});
