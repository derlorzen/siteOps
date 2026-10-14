import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderInvoicePdf } from '../lib/billing-pdf.mjs';
import { price, dateValue } from '../lib/billing.mjs';

test('time quantities are priced in integer cents without binary rounding', () => {
  assert.equal(price(3600, 7500), 7500);
  assert.equal(price(1800, 7500), 3750);
  assert.equal(price(600, 7500), 1250);
  assert.equal(price(1, 7500), 2);
});
test('date handling accepts MySQL DATE values', () => {
  assert.equal(dateValue('2026-10-14'), '2026-10-14');
  assert.equal(dateValue(new Date('2026-10-14T00:00:00Z')), '2026-10-14');
});
test('service invoice PDF has valid catalog, page, cross-reference and totals', () => {
  const pdf = renderInvoicePdf({
    sender: {
      name: 'Beispiel Webdesign',
      street: 'Beispielstraße 1',
      postal_code: '24392',
      city: 'Süderbrarup',
      email: 'rechnung@example.de',
      tax_id: '12/345/67890',
      vat_id: '',
      iban: 'DE12345678901234567890',
      bic: '',
      payment_note: ''
    },
    customer: {
      name: 'Gartenbau Muster',
      street: 'Gartenstraße 3',
      postal_code: '24376',
      city: 'Kappeln',
      country: 'DE'
    },
    number: 'RE-2026-00001',
    issued_at: '2026-10-14T10:00:00Z',
    due_at: '2026-10-28',
    service_from: '2026-10-01',
    service_to: '2026-10-14',
    items: [
      {
        entry_date: '2026-10-04',
        description: 'Layout entwerfen',
        duration_seconds: 5400,
        hourly_cents: 7500,
        amount_cents: 11250
      }
    ],
    net_cents: 11250,
    tax_cents: 2138,
    gross_cents: 13388,
    vat_percent: 19
  });
  assert.equal(pdf.subarray(0, 8).toString(), '%PDF-1.4');
  const str = pdf.toString('latin1');
  assert.match(str, /xref\n0 [0-9]+\n/);
  assert.match(str, /\/Type \/Catalog/);
  assert.match(str, /\/Type \/Page/);
  assert.match(str, /RE-2026-00001/);
  assert.match(str, /133,88 EUR/);
  assert.match(str, /%%EOF/);
  assert.ok(pdf.length > 500);
});

test('cancellation renders a separate negative service invoice', () => {
  const pdf=renderInvoicePdf({
    sender:{name:'Beispiel Webdesign',street:'Musterweg 1',postal_code:'24392',city:'Süderbrarup',tax_id:'12345'},
    customer:{name:'Gartenbau Muster',street:'Gartenstraße 3',postal_code:'24376',city:'Kappeln',country:'DE'},
    number:'RE-2026-00002',cancellation_of:'RE-2026-00001',reason:'Falscher Leistungsumfang',
    issued_at:'2026-10-14T12:00:00Z',due_at:'2026-10-28',
    service_from:'2026-10-01',service_to:'2026-10-14',
    items:[{entry_date:'2026-10-04',description:'Storno: Layout entwerfen',duration_seconds:5400,hourly_cents:7500,amount_cents:-11250}],
    vat_percent:19,net_cents:-11250,tax_cents:-2138,gross_cents:-13388
  });
  assert.match(pdf.toString('latin1'),/STORNORECHNUNG RE-2026-00002/);
  assert.match(pdf.toString('latin1'),/-133,88 EUR/);
  assert.match(pdf.toString('latin1'),/RE-2026-00001/);
});
