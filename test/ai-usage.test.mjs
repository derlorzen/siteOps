import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiUsage, aiLimitsSchema } from '../lib/ai-usage.mjs';

function fixture({ calls = 0, monthlyUsd = null, prices = {}, unknownCosts = 0 } = {}) {
  const statements = [];
  let reservations = 0;
  const query = async (sql, params) => {
    statements.push({ sql, params });
    if (sql.includes('FROM ai_usage_policy'))
      return [
        [{ monthly_calls: 1, monthly_tokens: 100000, monthly_usd: monthlyUsd, prices_json: JSON.stringify(prices) }]
      ];
    if (sql.includes('COUNT(*) calls'))
      return [
        [
          {
            calls: calls + reservations,
            measured_tokens: 0,
            accounted_tokens: 0,
            unknown_costs: unknownCosts,
            estimated_usd: 0
          }
        ]
      ];
    if (sql.startsWith('INSERT')) reservations++;
    return [[]];
  };
  const connection = {
    query,
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {}
  };
  return { service: createAiUsage({ db: { query, getConnection: async () => connection } }), statements };
}
test('AI call limit blocks the provider before execution and stores no prompts or credentials', async () => {
  const { service, statements } = fixture({ calls: 1 });
  let executed = false;
  await assert.rejects(
    service.run(
      { operation: 'responses', body: { model: 'configured-model', input: 'private prompt', max_output_tokens: 100 } },
      async () => {
        executed = true;
      }
    ),
    { publicCode: 'AI_LIMIT_REACHED' }
  );
  assert.equal(executed, false);
  assert.ok(!JSON.stringify(statements).includes('private prompt'));
});
test('cost-limited calls fail closed on missing prices and previous unknown costs', async () => {
  for (const options of [
    { monthlyUsd: 1 },
    { monthlyUsd: 1, unknownCosts: 1, prices: { test: { input_per_million: 1, output_per_million: 1 } } }
  ]) {
    const { service } = fixture(options);
    await assert.rejects(
      service.run({ operation: 'responses', body: { model: 'test', max_output_tokens: 1 } }, () =>
        assert.fail('must not call provider')
      ),
      { publicCode: 'AI_LIMIT_REACHED' }
    );
  }
});
test('measured usage replaces the reservation while prices remain explicit estimates', async () => {
  const { service, statements } = fixture({ prices: { test: { input_per_million: 2, output_per_million: 5 } } });
  const payload = { usage: { input_tokens: 30, output_tokens: 10 }, output: [] };
  assert.equal(
    await service.run(
      { operation: 'responses', body: { model: 'test', input: 'text', max_output_tokens: 100 } },
      async () => payload
    ),
    payload
  );
  const update = statements.find(row => row.sql.includes("state='completed'"));
  assert.deepEqual(update.params.slice(0, 3), [30, 10, 40]);
  assert.ok(Math.abs(update.params[3] - 0.00011) < 0.0000001);
  assert.ok(statements.some(row => row.sql.includes('FOR UPDATE')));
});
test('uncertain failures keep a recorded reservation and are not replayed', async () => {
  const { service, statements } = fixture();
  let calls = 0;
  await assert.rejects(
    service.run({ operation: 'responses', body: { model: 'test' } }, async () => {
      calls++;
      throw Error('network timeout');
    })
  );
  assert.equal(calls, 1);
  assert.ok(statements.some(row => row.sql.includes("state='unconfirmed'")));
  assert.equal(aiLimitsSchema.safeParse({ monthly_calls: 0, monthly_tokens: 100, monthly_usd: null }).success, false);
});
