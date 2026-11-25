import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeAlertResults } from '../lib/alert-delivery.mjs';

test('SMTP success reports accepted recipients and message id', () => {
  const result = summarizeAlertResults(
    [{ channel: 'email' }],
    [{ status: 'fulfilled', value: { accepted: ['test@example.com'], rejected: [], messageId: '<id@example.com>', response: '250 queued' } }]
  );
  assert.deepEqual(result, [
    {
      channel: 'email',
      ok: true,
      acceptedCount: 1,
      rejectedCount: 0,
      messageId: '<id@example.com>',
      smtpResponse: '250 queued',
      error: null
    }
  ]);
});

test('SMTP authentication rejection does not count as success or leak raw provider error', () => {
  const result = summarizeAlertResults(
    [{ channel: 'email' }],
    [{ status: 'rejected', reason: Object.assign(new Error('secret-value-here'), { code: 'EAUTH', responseCode: 535 }) }]
  );
  assert.equal(result[0].ok, false);
  assert.equal(result[0].code, 'EAUTH');
  assert.equal(result[0].responseCode, 535);
  assert.match(result[0].error, /Anmeldung abgelehnt/);
  assert.doesNotMatch(JSON.stringify(result), /secret-value-here/);
});

test('SMTP zero accepted or partially rejected recipients count as failures', () => {
  const result = summarizeAlertResults(
    [{ channel: 'email' }, { channel: 'email' }],
    [
      { status: 'fulfilled', value: { accepted: [], rejected: ['test@example.com'] } },
      { status: 'fulfilled', value: { accepted: ['one@example.com'], rejected: ['two@example.com'] } }
    ]
  );
  assert.equal(result[0].ok, false);
  assert.equal(result[1].ok, false);
  assert.equal(result[1].acceptedCount, 1);
  assert.equal(result[1].rejectedCount, 1);
});

test('webhook HTTP failure does not count as success', () => {
  const result = summarizeAlertResults(
    [{ channel: 'webhook' }, { channel: 'webhook' }],
    [
      { status: 'fulfilled', value: { ok: false, status: 500 } },
      { status: 'fulfilled', value: { ok: true, status: 204 } }
    ]
  );
  assert.equal(result[0].ok, false);
  assert.equal(result[0].httpStatus, 500);
  assert.equal(result[1].ok, true);
  assert.equal(result[1].httpStatus, 204);
});
