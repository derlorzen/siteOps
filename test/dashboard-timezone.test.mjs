// The dashboard is rendered server-side; a bare toLocaleString('de-DE') with no timeZone
// option uses the Node process's own timezone (UTC on most hosting), not German local time -
// the locale only governs date/number formatting conventions. This verifies the fix applies
// the correct CEST/CET offset regardless of the host's own timezone.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SITEOPS_MASTER_KEY ||= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
process.env.DASHBOARD_USER ||= 'test';
process.env.DASHBOARD_PASSWORD ||= 'test-password';
process.env.SITEOPS_TEST_NO_AUTOSTART = '1';
const { fmtDateTime, fmtDate } = await import('../app.mjs');

test('fmtDateTime applies CEST (UTC+2) in summer regardless of process timezone', () => {
  // 2026-10-01 13:05:25 UTC is still within German summer time (CEST ends late October).
  assert.equal(fmtDateTime('2026-10-01T13:05:25Z'), '1.10.2026, 15:05:25');
});

test('fmtDateTime applies CET (UTC+1) in winter', () => {
  assert.equal(fmtDateTime('2026-01-15T13:05:25Z'), '15.1.2026, 14:05:25');
});

test('fmtDate formats in German day.month.year order using Berlin time', () => {
  // 23:30 UTC on Dec 31 is already Jan 1 in Berlin (CET, UTC+1) - the date, not just the
  // time, must shift too, not just be reformatted in UTC.
  assert.equal(fmtDate('2025-12-31T23:30:00Z'), '1.1.2026');
});

test('fmtDate defaults to the current date when called without an argument', () => {
  const today = new Date().toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
  assert.equal(fmtDate(), today);
});
