import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionGuidelines, defaultProductionGuidelines } from '../lib/video-production-guidelines.mjs';
const projectA = '11111111-1111-4111-8111-111111111111',
  projectB = '22222222-2222-4222-8222-222222222222';
function setup() {
  const rows = new Map();
  const db = {
    query: async (sql, p) => {
      if (sql.startsWith('SELECT')) return [rows.has(p[0]) ? [{ setting_value: rows.get(p[0]) }] : []];
      if (sql.startsWith('INSERT')) {
        if (rows.has(p[0])) return [{ affectedRows: 0 }];
        rows.set(p[0], p[1]);
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE')) {
        if (rows.get(p[1]) !== p[2]) return [{ affectedRows: 0 }];
        rows.set(p[1], p[0]);
        return [{ affectedRows: 1 }];
      }
      throw Error(sql);
    }
  };
  return createProductionGuidelines({
    db,
    encrypt: JSON.stringify,
    decrypt: JSON.parse,
    getProject: async id => {
      if (![projectA, projectB].includes(id)) throw Error('Projekt nicht gefunden');
      return { id };
    }
  });
}
const save = (service, state, guidelines, inherit = false) =>
  service.save({
    ...(state.project_id ? { project_id: state.project_id } : {}),
    expected_revision: state.revision,
    expected_global_revision: state.global_revision,
    inherit,
    ...(inherit ? {} : { guidelines })
  });
test('global fallback, isolated editable project rules, inheritance reset and stale-write protection', async () => {
  const s = setup();
  const a = await s.get(projectA);
  assert.equal(a.inherited, true);
  assert.deepEqual(a.guidelines, defaultProductionGuidelines);
  assert.ok(!a.guidelines.some(rule => rule.includes('Bagisto-Kanal') || rule.includes('Lorzen-Titelbilder')));
  await save(s, a, ['English narration for this project only.']);
  assert.equal((await s.get(projectA)).source_scope, 'project');
  assert.equal((await s.get(projectB)).inherited, true);
  await assert.rejects(save(s, a, ['Stale edit must fail.']), /inzwischen/);
  const global = await s.get();
  await save(s, global, ['Shared rule for every inheriting project.']);
  assert.deepEqual((await s.get(projectA)).guidelines, ['English narration for this project only.']);
  assert.deepEqual((await s.get(projectB)).guidelines, ['Shared rule for every inheriting project.']);
  await save(s, await s.get(projectA), undefined, true);
  assert.equal((await s.get(projectA)).inherited, true);
  await assert.rejects(s.get('bad-id'));
  await assert.rejects(s.get('33333333-3333-4333-8333-333333333333'), /nicht gefunden/);
});
