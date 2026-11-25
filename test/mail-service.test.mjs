import assert from 'node:assert/strict';
import test from 'node:test';
import { createMailService, mailArchiveCsv, repeatAlertDue } from '../lib/mail-service.mjs';
import { renderMailArchive } from '../lib/mail-archive-ui.mjs';

const hour = 3600000;

test('monitoring repeats obey the incident cap and minimum delays', () => {
  const due = (alertCount, hours, maxAlerts = 3, repeatMinutes = 60) =>
    repeatAlertDue({ alertCount, lastAlert: 1000, now: 1000 + hours * hour, maxAlerts, repeatMinutes });
  assert.equal(due(0, 0), true);
  assert.equal(due(1, 5), false);
  assert.equal(due(1, 6), true);
  assert.equal(due(2, 23), false);
  assert.equal(due(2, 24), true);
  assert.equal(due(3, 200), false);
  assert.equal(due(1, 200, 1), false);
  assert.equal(due(1, 6, 3, 720), false);
  assert.equal(due(1, 12, 3, 720), true);
});

const config = () => ({
  smtpHost: 'smtp.example.test',
  smtpFrom: 'from@example.test',
  smtpPort: 587,
  smtpUser: 'user',
  smtpPassword: 'password-secret',
  mailRetentionDays: 365
});
function fixture(sendMail, qOverride) {
  const calls = [];
  const mail = createMailService({
    config,
    createTransport: () => ({ sendMail }),
    q: async (sql, params) => {
      calls.push({ sql, params });
      return qOverride ? qOverride(sql, params) : { rows: [] };
    },
    warn: () => {}
  });
  return { mail, calls };
}

test('archive logs metadata only, and preserves the actual SMTP payload', async () => {
  const message = {
    to: 'recipient@example.test',
    cc: 'copy@example.test',
    subject: 'Invoice',
    text: 'body-secret',
    html: '<p>html-secret</p>',
    attachments: [{ filename: 'invoice.pdf', content: Buffer.from('pdf-secret') }]
  };
  const { mail, calls } = fixture(async sent => {
    assert.equal(sent.text, message.text);
    assert.equal(sent.attachments[0].content.toString(), 'pdf-secret');
    return { accepted: [message.to], rejected: [], response: '250 queued', messageId: '<id>' };
  });
  await mail.send(message, { source: 'invoice', referenceId: 'reference' });
  assert.equal(calls.length, 2);
  const serialized = JSON.stringify(calls);
  for (const secret of ['body-secret', 'html-secret', 'pdf-secret', 'password-secret']) {
    assert.equal(serialized.includes(secret), false);
  }
  for (const metadata of ['recipient@example.test', 'copy@example.test', 'invoice.pdf', 'Invoice', 'reference']) {
    assert.equal(serialized.includes(metadata), true);
  }
  assert.deepEqual(calls[1].params.slice(0, 6), ['accepted', '<id>', 250, null, 1, 0]);
});

test('SMTP rejection is recorded without the raw provider error', async () => {
  const { mail, calls } = fixture(async () => {
    throw Object.assign(new Error('provider-secret'), { code: 'EAUTH', responseCode: 535 });
  });
  await assert.rejects(mail.send({ to: 'recipient@example.test', subject: 'Test' }), /EAUTH/);
  assert.deepEqual(calls[1].params.slice(0, 6), ['failed', null, 535, 'EAUTH', 0, 0]);
  assert.equal(JSON.stringify(calls).includes('provider-secret'), false);
});

test('partial acceptance is not presented as successful', async () => {
  const { mail, calls } = fixture(async () => ({
    accepted: ['ok@example.test'],
    rejected: ['bad@example.test'],
    messageId: '<id>'
  }));
  await assert.rejects(mail.send({ to: ['ok@example.test', 'bad@example.test'] }), /EENVELOPE/);
  assert.equal(calls[1].params[0], 'partial');
});

test('audit finalization failure does not trigger a duplicate delivery', async () => {
  let sends = 0;
  const { mail } = fixture(
    async () => {
      sends++;
      return { accepted: ['ok@example.test'], rejected: [] };
    },
    sql => {
      if (sql.startsWith('UPDATE')) throw new Error('db unavailable');
      return { rows: [] };
    }
  );
  await mail.send({ to: 'ok@example.test' });
  assert.equal(sends, 1);
});

test('archive reads are bounded and CSV neutralizes spreadsheet formulas', async () => {
  const { mail, calls } = fixture(async () => ({}));
  await mail.search({ query: 'x', limit: 100000, offset: -5 });
  assert.deepEqual(calls[0].params.slice(-2), [100, 0]);
  await mail.cleanup();
  assert.deepEqual(calls[1].params, [365]);
  assert.ok(mailArchiveCsv([{ subject: '=SUM(1;2)' }]).includes('"\'=SUM(1;2)"'));
});

test('mail archive renders metadata as escaped text', () => {
  const esc = s => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  const html = renderMailArchive({
    rows: [{ subject: '<script>alert(1)</script>', recipients: '["a@example.test"]', status: 'failed' }],
    filters: { query: 'a@example.test' },
    esc,
    fmtDateTime: () => '25.11.2026',
    retentionDays: 365
  });
  assert.ok(html.includes('&lt;script>'));
  assert.ok(html.includes('a@example.test'));
  assert.ok(html.includes('Fehlgeschlagen'));
  assert.ok(!html.includes('<script>'));
});
