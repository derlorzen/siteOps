// A4 service invoices with repeated table headings and immutable archived output.
const euro = value =>
  (Number(value) / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' EUR';
const date = value => {
  const s = typeof value === 'string' ? value.slice(0, 10) : new Date(value).toISOString().slice(0, 10);
  return s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4);
};
function literal(value) {
  return String(value)
    .replace(/[^\u0020-\u00ff]/g, c => (c === '€' ? String.fromCharCode(128) : '-'))
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}
// Conservative Helvetica metrics keep long words and six-decimal quantities inside cells.
function width(value, size) {
  return (
    [...String(value)].reduce(
      (sum, c) => sum + (/[ilI.,:;'!| ]/.test(c) ? 0.28 : /[MW@%]/.test(c) ? 0.9 : /[A-ZÄÖÜ]/.test(c) ? 0.7 : 0.57),
      0
    ) * size
  );
}
function wrap(value, max, size) {
  const lines = [];
  for (const paragraph of String(value ?? '').split(/\n/)) {
    let line = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      if (line && width(line + ' ' + word, size) > max) {
        lines.push(line);
        line = '';
      }
      for (const char of word) {
        if (width(line + char, size) > max) {
          lines.push(line);
          line = '';
        }
        line += char;
      }
      line += ' ';
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
export function renderInvoicePdf(invoice) {
  const s = invoice.sender,
    c = invoice.customer;
  const pages = [];
  let commands = [],
    y = 0;
  const text = (value, x, top, size = 9, bold = false) =>
    commands.push(
      'BT /' +
        (bold ? 'F2' : 'F1') +
        ' ' +
        size +
        ' Tf 0.12 0.15 0.19 rg 1 0 0 1 ' +
        x +
        ' ' +
        (842 - top) +
        ' Tm (' +
        literal(value) +
        ') Tj ET'
    );
  const right = (value, x, top, size = 9, bold = false, max = 70) => {
    size = Math.min(size, max / Math.max(width(value, 1), 1));
    text(value, x - width(value, size), top, size, bold);
  };
  const line = (x1, top, x2, bottom = top) =>
    commands.push('0.76 0.79 0.82 RG 0.5 w ' + x1 + ' ' + (842 - top) + ' m ' + x2 + ' ' + (842 - bottom) + ' l S');
  const rect = (x, top, w, h) =>
    commands.push('0.95 0.96 0.97 rg ' + x + ' ' + (842 - top - h) + ' ' + w + ' ' + h + ' re f');
  const block = (value, x, top, max, size = 9, bold = false) => {
    const lines = wrap(value, max, size);
    lines.forEach((v, i) => text(v, x, top + i * (size + 4), size, bold));
    return lines.length * (size + 4);
  };
  function header(first = false) {
    if (commands.length) pages.push(commands);
    commands = [];
    if (first) {
      let top = 48;
      top += block(s.name, 45, top, 505, 18, true) + 4;
      text([s.street, [s.postal_code, s.city].filter(Boolean).join(' ')].filter(Boolean).join(' · '), 45, top, 9);
      line(45, top + 16, 550);
      text('RECHNUNGSEMPFÄNGER', 45, top + 42, 8, true);
      let addressTop = top + 62;
      addressTop += block(c.name, 45, addressTop, 270, 11, true);
      addressTop += block(c.street, 45, addressTop, 270, 10);
      addressTop += block([c.postal_code, c.city].filter(Boolean).join(' '), 45, addressTop, 270, 10);
      if (c.country && c.country !== 'DE') addressTop += block(c.country, 45, addressTop, 270, 10);
      text('Rechnungsdatum', 355, top + 42, 8);
      text(date(invoice.issued_at), 355, top + 57, 10, true);
      if (!invoice.cancellation_of) {
        text('Zahlbar bis', 355, top + 82, 8);
        text(date(invoice.due_at), 355, top + 97, 10, true);
      }
      y = Math.max(addressTop + 30, top + 133);
      y += block((invoice.cancellation_of ? 'STORNORECHNUNG ' : 'RECHNUNG ') + invoice.number, 45, y, 505, 16, true);
      if (invoice.cancellation_of)
        y +=
          block('Stornierung der Rechnung ' + invoice.cancellation_of + '. Grund: ' + invoice.reason, 45, y, 505, 9) +
          8;
      text('Leistungszeitraum: ' + date(invoice.service_from) + ' - ' + date(invoice.service_to), 45, y, 9);
      y += 24;
    } else {
      text(s.name, 45, 43, 11, true);
      right(invoice.number + ' · Fortsetzung', 550, 43, 9, false, 250);
      y = 65;
    }
  }
  const columns = [45, 73, 322, 367, 408, 478, 550];
  function tableHeader() {
    rect(45, y, 505, 27);
    ['Pos.', 'Leistung / Leistungsdatum', 'Menge', 'Einheit', 'Einzelpreis', 'Betrag'].forEach((v, i) =>
      text(v, columns[i] + 6, y + 17, 8, true)
    );
    line(45, y, 550);
    line(45, y + 27, 550);
    y += 27;
  }
  header(true);
  tableHeader();
  invoice.items.forEach((item, index) => {
    let descriptions = wrap(item.description, 235, 9);
    let first = true;
    while (descriptions.length) {
      const unitHeight = first ? wrap(item.unit || 'Std.', 29, 8).length * 12 + 16 : 0;
      const capacity = Math.floor((740 - y - 24) / 12);
      if (capacity < 1 || y + unitHeight > 740) {
        header();
        tableHeader();
        continue;
      }
      const chunk = descriptions.splice(0, Math.min(capacity, descriptions.length));
      const height = Math.max(36, chunk.length * 12 + 24, unitHeight);
      chunk.forEach((v, i) => text(v, 79, y + 14 + i * 12, 9));
      text(first ? date(item.entry_date) : 'Fortsetzung', 79, y + height - 9, 8);
      if (first) {
        text(index + 1, 51, y + 16, 9);
        const quantity = Number(item.quantity ?? Number(item.duration_seconds) / 3600).toLocaleString('de-DE', {
          maximumFractionDigits: 6
        });
        right(quantity, 361, y + 16, 9, false, 33);
        block(item.unit || 'Std.', 373, y + 16, 29, 8);
        right(euro(item.hourly_cents), 472, y + 16, 9, false, 58);
        right(euro(item.amount_cents), 544, y + 16, 9, true, 60);
      }
      columns.forEach(x => line(x, y, x, y + height));
      line(45, y + height, 550);
      y += height;
      first = false;
      if (descriptions.length) {
        header();
        tableHeader();
      }
    }
  });
  const payment = [];
  if (invoice.cancellation_of) payment.push('Diese Stornorechnung gleicht die Ursprungsrechnung vollständig aus.');
  else {
    payment.push(
      (s.payment_terms_days === '0'
        ? 'Der Rechnungsbetrag ist sofort ohne Abzug fällig. Bitte überweisen Sie bis zum '
        : 'Bitte überweisen Sie den Rechnungsbetrag ohne Abzug bis zum ') +
        date(invoice.due_at) +
        ' unter Angabe der Rechnungsnummer ' +
        invoice.number +
        '.'
    );
    if (s.iban)
      payment.push(
        'Kontoinhaber: ' +
          s.name +
          (s.bank_name ? '\nBank: ' + s.bank_name : '') +
          '\nIBAN: ' +
          s.iban +
          (s.bic ? ' · BIC: ' + s.bic : '')
      );
    if (s.payment_note) payment.push(s.payment_note);
    payment.push('Vielen Dank für Ihren Auftrag.');
  }
  if (y + 112 > 740) header();
  y += 26;
  text('Nettobetrag', 340, y, 10);
  right(euro(invoice.net_cents), 544, y, 10, false, 100);
  y += 23;
  text('Umsatzsteuer (' + invoice.vat_percent + ' %)', 340, y, 10);
  right(euro(invoice.tax_cents), 544, y, 10, false, 100);
  y += 12;
  line(334, y, 550);
  y += 23;
  text('Rechnungsbetrag', 340, y, 11, true);
  right(euro(invoice.gross_cents), 544, y, 11, true, 100);
  y += 34;
  for (const paragraph of payment) {
    for (const row of wrap(paragraph, 505, 9)) {
      if (y > 738) header();
      text(row, 45, y);
      y += 13;
    }
    y += 8;
  }
  pages.push(commands);
  pages.forEach((page, i) => {
    commands = page;
    line(45, 773, 550);
    const footer = [
      s.name,
      s.email,
      s.tax_id ? 'Steuernummer: ' + s.tax_id : '',
      s.vat_id ? 'USt-IdNr.: ' + s.vat_id : ''
    ]
      .filter(Boolean)
      .join(' · ');
    block(footer, 45, 789, 410, 8);
    right('Seite ' + (i + 1) + ' von ' + pages.length, 550, 789, 8, false, 80);
  });
  const objects = [
    null,
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  ];
  const refs = [];
  for (const page of pages) {
    const stream = page.join('\n');
    const content = objects.push(
      '<< /Length ' + Buffer.byteLength(stream, 'latin1') + ' >>\nstream\n' + stream + '\nendstream'
    );
    const ref = objects.push(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' +
        content +
        ' 0 R >>'
    );
    refs.push(ref + ' 0 R');
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = '<< /Type /Pages /Kids [' + refs.join(' ') + '] /Count ' + refs.length + ' >>';
  const parts = ['%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'];
  const offsets = [0];
  let offset = Buffer.byteLength(parts[0], 'latin1');
  objects.forEach((object, i) => {
    offsets.push(offset);
    const part = i + 1 + ' 0 obj\n' + object + '\nendobj\n';
    parts.push(part);
    offset += Buffer.byteLength(part, 'latin1');
  });
  let trailer = 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) trailer += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  parts.push(
    trailer + 'trailer\n<< /Root 1 0 R /Size ' + (objects.length + 1) + ' >>\nstartxref\n' + offset + '\n%%EOF\n'
  );
  return Buffer.from(parts.join(''), 'latin1');
}
export const invoiceMoney = euro;
