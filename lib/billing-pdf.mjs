// Dependency-free PDF generator for simple German service invoices.
// PDF is generated once and archived byte-for-byte; later downloads use that original.
const euro = value =>
  (Number(value) / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' EUR';
const date = value => {
  const s = typeof value === 'string' ? value.slice(0, 10) : new Date(value).toISOString().slice(0, 10);
  return s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4);
};
function wrap(value, length = 88) {
  const words = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if (current && (current + ' ' + word).length > length) {
      lines.push(current);
      current = '';
    }
    current += (current ? ' ' : '') + word;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}
function pdfLiteral(value) {
  // Standard Helvetica with WinAnsiEncoding (including German umlauts and euro).
  return String(value)
    .replace(/[^\u0020-\u00ff]/g, c => (c === '€' ? String.fromCharCode(128) : '-'))
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}
export function renderInvoicePdf(invoice) {
  const s = invoice.sender;
  const c = invoice.customer;
  const lines = [];
  const add = (value = '', size = 10) => {
    for (const line of wrap(value, size === 10 ? 88 : 65)) lines.push({ line, size });
  };
  add(s.name, 16);
  add([s.street, s.postal_code, s.city].filter(Boolean).join(' | '));
  add(
    [s.email, s.tax_id ? 'Steuernummer: ' + s.tax_id : '', s.vat_id ? 'USt-ID: ' + s.vat_id : '']
      .filter(Boolean)
      .join(' | ')
  );
  add('');
  add('Rechnung an:');
  add(c.name);
  add([c.street, [c.postal_code, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', '));
  if (c.country && c.country !== 'DE') add(c.country);
  add('');
  add((invoice.cancellation_of ? 'STORNORECHNUNG ' : 'RECHNUNG ') + invoice.number, 16);
  if (invoice.cancellation_of) add('Vollständige Stornierung der Rechnung ' + invoice.cancellation_of + '. Grund: ' + invoice.reason);
  add('Rechnungsdatum: ' + date(invoice.issued_at));
  add('Leistungszeitraum: ' + date(invoice.service_from) + ' - ' + date(invoice.service_to));
  if (!invoice.cancellation_of) add('Faellig am: ' + date(invoice.due_at));
  add('');
  add('DIENSTLEISTUNGEN');
  for (const item of invoice.items) {
    add(date(item.entry_date) + ' | ' + item.description);
    add(
      '    ' +
        (Number(item.duration_seconds) / 3600).toLocaleString('de-DE', { maximumFractionDigits: 3 }) +
        ' Std. x ' +
        euro(item.hourly_cents) +
        '/Std. = ' +
        euro(item.amount_cents)
    );
  }
  add('');
  add('Netto: ' + euro(invoice.net_cents));
  add('Umsatzsteuer (' + invoice.vat_percent + '%): ' + euro(invoice.tax_cents));
  add('RECHNUNGSBETRAG: ' + euro(invoice.gross_cents), 13);
  add('');
  if (!invoice.cancellation_of && s.iban) add('Bitte ueberweisen Sie den Betrag auf IBAN ' + s.iban + (s.bic ? ', BIC ' + s.bic : '') + '.');
  if (!invoice.cancellation_of && s.payment_note) add(s.payment_note);
  if (invoice.cancellation_of) add('Diese Stornorechnung gleicht die Ursprungsrechnung vollständig aus.');
  else add('Vielen Dank fuer Ihren Auftrag.');
  const pageHeight = 842;
  const pages = [];
  let commands = [];
  let y = 787;
  function next() {
    if (commands.length) pages.push(commands.join('\n'));
    commands = [];
    y = 787;
  }
  for (const item of lines) {
    const gap = item.line ? item.size + 7 : 13;
    if (y - gap < 65) next();
    const safe = pdfLiteral(item.line);
    commands.push('BT /F1 ' + item.size + ' Tf 50 ' + y + ' Td (' + safe + ') Tj ET');
    y -= gap;
  }
  next();
  const objects = [null, null, null];
  const pageRefs = [];
  for (const stream of pages) {
    const streamBytes = Buffer.from(stream, 'latin1');
    const streamObj = objects.push('<< /Length ' + streamBytes.length + ' >>\nstream\n' + stream + '\nendstream');
    const pageObj = objects.push(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 ' +
        pageHeight +
        '] /Resources << /Font << /F1 3 0 R >> >> /Contents ' +
        streamObj +
        ' 0 R >>'
    );
    pageRefs.push(pageObj + ' 0 R');
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = '<< /Type /Pages /Kids [' + pageRefs.join(' ') + '] /Count ' + pageRefs.length + ' >>';
  objects[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  const parts = ['%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'];
  const offsets = [0];
  let offset = Buffer.byteLength(parts[0], 'latin1');
  for (let i = 0; i < objects.length; i++) {
    offsets.push(offset);
    const part = i + 1 + ' 0 obj\n' + objects[i] + '\nendobj\n';
    parts.push(part);
    offset += Buffer.byteLength(part, 'latin1');
  }
  const xref = offset;
  let trailer = 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) trailer += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  trailer += 'trailer\n<< /Root 1 0 R /Size ' + (objects.length + 1) + ' >>\nstartxref\n' + xref + '\n%%EOF\n';
  parts.push(trailer);
  return Buffer.from(parts.join(''), 'latin1');
}
export const invoiceMoney = euro;
