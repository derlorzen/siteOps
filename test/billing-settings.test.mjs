import test from 'node:test';
import assert from 'node:assert/strict';
import { createBillingController, paymentDueDate, inputSender } from '../lib/billing.mjs';

test('invoice settings default to fourteen days and save bank and all payment presets', async () => {
  const values = new Map();
  const db = {
    query: async (sql, args) => {
      if (sql.startsWith('SELECT setting_key'))
        return [[...values].map(([setting_key, setting_value]) => ({ setting_key, setting_value }))];
      values.set(args[0], args[1]);
      return [{ affectedRows: 1 }];
    }
  };
  const api = createBillingController({ db, archive: async () => ({}) });
  assert.equal((await api.settings()).payment_terms_days, '14');
  for (const days of ['0', '7', '14', '30']) {
    const result = await api.saveSettings({ bank_name: 'Meine Bank', payment_terms_days: days });
    assert.equal(result.payment_terms_days, days);
    assert.equal(result.bank_name, 'Meine Bank');
  }
  for (const days of ['-1', '1.5', '365', 'garbage'])
    assert.equal(inputSender.safeParse({ payment_terms_days: days }).success, false);
});
test('payment due dates use invoice dates across months, years and leap days', () => {
  assert.equal(paymentDueDate('2026-11-02T23:59:00Z', '0'), '2026-11-02');
  assert.equal(paymentDueDate('2026-11-02', '7'), '2026-11-09');
  assert.equal(paymentDueDate('2026-12-25', '14'), '2027-01-08');
  assert.equal(paymentDueDate('2028-02-28', '30'), '2028-03-29');
});
