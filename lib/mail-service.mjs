import { randomUUID } from 'node:crypto';

const clip = (value, length) =>
  String(value ?? '')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ')
    .replaceAll('\0', ' ')
    .slice(0, length);
const statuses = ['sending', 'accepted', 'failed', 'partial'];
const list = value => (Array.isArray(value) ? value : value == null ? [] : [value]);
const addresses = value =>
  JSON.stringify(
    list(value)
      .slice(0, 100)
      .map(x => clip(typeof x === 'object' ? x.address : x, 500))
  );
const count = value => Math.min(65535, Array.isArray(value) ? value.length : 0);

export function repeatAlertDue({ alertCount, lastAlert, repeatMinutes, maxAlerts = 3, now = Date.now() }) {
  const sent = Math.max(0, Number(alertCount) || 0);
  if (sent >= maxAlerts) return false;
  if (sent === 0 || !lastAlert) return true;
  const minimum = sent === 1 ? 360 : 1440;
  return now - lastAlert >= Math.max(minimum, Number(repeatMinutes) || 60) * 60000;
}

function errorCode(value) {
  const code = String(value || '');
  return /^[A-Z0-9_]{2,40}$/.test(code) ? code : 'DELIVERY_FAILED';
}

function smtpCode(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 100 && n <= 599 ? n : null;
}

export function createMailService({ q, config, createTransport, warn = console.warn }) {
  async function send(message, metadata = {}) {
    const cfg = config();
    const id = randomUUID();
    const from = message.from || cfg.smtpFrom || '';
    const attachments = list(message.attachments);
    await q(
      'INSERT INTO mail_log(id,created_at,source,reference_id,sender,recipients,cc,bcc,subject,attachment_names,attachment_count) VALUES(?,UTC_TIMESTAMP(3),?,?,?,?,?,?,?,?,?)',
      [
        id,
        clip(metadata.source || 'system', 32),
        clip(metadata.referenceId, 191) || null,
        clip(typeof from === 'object' ? from.address : from, 500),
        addresses(message.to),
        addresses(message.cc),
        addresses(message.bcc),
        clip(message.subject, 500),
        JSON.stringify(attachments.slice(0, 100).map(x => clip(x?.filename, 255))),
        Math.min(65535, attachments.length)
      ]
    );
    let info;
    let failure;
    try {
      if (!cfg.smtpHost || !from || String(from).includes('@localhost')) {
        throw Object.assign(new Error('SMTP-Konfiguration fehlt.'), { code: 'SMTP_NOT_CONFIGURED' });
      }
      const transport = createTransport({
        host: cfg.smtpHost,
        port: cfg.smtpPort,
        secure: cfg.smtpSecure,
        auth: cfg.smtpUser ? { user: cfg.smtpUser, pass: cfg.smtpPassword } : undefined,
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 60000
      });
      info = await transport.sendMail({ ...message, from });
      if (!count(info?.accepted) || count(info?.rejected)) {
        throw Object.assign(new Error('SMTP hat nicht alle Empfänger angenommen.'), { code: 'EENVELOPE' });
      }
    } catch (error) {
      failure = Object.assign(new Error('E-Mail-Versand fehlgeschlagen: ' + errorCode(error?.code)), {
        code: errorCode(error?.code),
        responseCode: smtpCode(error?.responseCode)
      });
    }
    const accepted = count(info?.accepted);
    const rejected = count(info?.rejected);
    const status = failure ? (accepted ? 'partial' : 'failed') : 'accepted';
    try {
      await q(
        'UPDATE mail_log SET completed_at=UTC_TIMESTAMP(3),status=?,message_id=?,smtp_code=?,error_code=?,accepted_count=?,rejected_count=? WHERE id=?',
        [
          status,
          clip(info?.messageId, 255) || null,
          failure?.responseCode || smtpCode(String(info?.response || '').match(/^\d{3}/)?.[0]),
          failure?.code || null,
          accepted,
          rejected,
          id
        ]
      );
    } catch {
      // SMTP may already have accepted the message. Never retry just because the audit update failed.
      warn('Mail archive finalization failed', { id, status });
    }
    if (failure) throw failure;
    return info;
  }

  async function search(filters = {}, max = 100) {
    const clauses = [];
    const params = [];
    if (statuses.includes(filters.status)) {
      clauses.push('status=?');
      params.push(filters.status);
    }
    if (filters.source) {
      clauses.push('source=?');
      params.push(clip(filters.source, 32));
    }
    if (filters.referenceId) {
      clauses.push('reference_id=?');
      params.push(clip(filters.referenceId, 191));
    }
    if (filters.query) {
      const term = clip(filters.query, 200);
      clauses.push(
        '(LOCATE(?,subject)>0 OR LOCATE(?,recipients)>0 OR LOCATE(?,sender)>0 OR LOCATE(?,cc)>0 OR LOCATE(?,bcc)>0)'
      );
      params.push(term, term, term, term, term);
    }
    const limit = Math.min(max, Math.max(1, Math.floor(Number(filters.limit) || 50)));
    const offset = Math.min(1000000, Math.max(0, Math.floor(Number(filters.offset) || 0)));
    const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
    const result = await q('SELECT * FROM mail_log' + where + ' ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?', [
      ...params,
      limit,
      offset
    ]);
    return result.rows;
  }

  async function cleanup() {
    const days = Math.min(3650, Math.max(1, Math.floor(Number(config().mailRetentionDays) || 365)));
    await q('DELETE FROM mail_log WHERE created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)', [days]);
  }
  return { send, search, cleanup };
}

function csvField(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export function mailArchiveCsv(rows) {
  const columns = [
    'created_at',
    'completed_at',
    'source',
    'reference_id',
    'sender',
    'recipients',
    'cc',
    'bcc',
    'subject',
    'status',
    'message_id',
    'smtp_code',
    'error_code',
    'accepted_count',
    'rejected_count',
    'attachment_count',
    'attachment_names'
  ];
  return (
    '\uFEFF' + [columns.join(';'), ...rows.map(row => columns.map(key => csvField(row[key])).join(';'))].join('\r\n')
  );
}
