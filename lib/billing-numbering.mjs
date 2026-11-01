import { renderInvoicePdf } from './billing-pdf.mjs';
// Both normal and cancellation invoices share a transaction-locked number circle.
export async function allocateInvoiceNumber(conn, sender, year) {
  const prefix = sender.invoice_prefix || 'RE',
    start = Number(sender.invoice_start_number || 1);
  await conn.query(
    'INSERT INTO invoice_number_sequences(prefix,invoice_year,last_number) VALUES(?,?,0) ON DUPLICATE KEY UPDATE prefix=VALUES(prefix)',
    [prefix, year]
  );
  const [[sequence]] = await conn.query(
    'SELECT last_number FROM invoice_number_sequences WHERE prefix=? AND invoice_year=? FOR UPDATE',
    [prefix, year]
  );
  let next = Math.max(Number(sequence.last_number) + 1, start),
    number;
  for (; ; next++) {
    if (next > 999999999) throw Object.assign(Error('Rechnungsnummernkreis ist ausgeschöpft.'), { statusCode: 409 });
    number = prefix + '-' + year + '-' + String(next).padStart(5, '0');
    const [used] = await conn.query(
      'SELECT invoice_number FROM invoices WHERE invoice_number=? UNION ALL SELECT cancellation_number FROM invoice_cancellations WHERE cancellation_number=?',
      [number, number]
    );
    if (!used.length) break;
  }
  await conn.query('UPDATE invoice_number_sequences SET last_number=? WHERE prefix=? AND invoice_year=?', [
    next,
    prefix,
    year
  ]);
  return number;
}
export function renderDraftPreview(invoice, sender, customer, issuedAt, dueAt) {
  const net = invoice.items.reduce((sum, item) => sum + Number(item.amount_cents), 0),
    tax = Math.round(net * 0.19);
  return renderInvoicePdf({
    ...invoice,
    sender,
    customer,
    number: 'ENTWURF',
    issued_at: issuedAt,
    due_at: dueAt,
    preview: true,
    vat_percent: 19,
    net_cents: net,
    tax_cents: tax,
    gross_cents: net + tax
  });
}
