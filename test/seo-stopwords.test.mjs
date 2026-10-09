// Verifies that common German stop- and filler words are excluded from both the general
// tokenizer (seoTokens, used for word counts/thin-content detection) and WDF*IDF, while
// genuine content terms survive.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SITEOPS_MASTER_KEY ||= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
process.env.DASHBOARD_USER ||= 'test';
process.env.DASHBOARD_PASSWORD ||= 'test-password';
process.env.SITEOPS_TEST_NO_AUTOSTART = '1';
const { seoTokens, calcWdfIdf } = await import('../app.mjs');

test('seoTokens drops grammatical stopwords', () => {
  const tokens = seoTokens('Wir haben das Angebot für unsere Kunden, weil es sehr wichtig ist.');
  for (const stop of ['wir', 'haben', 'das', 'für', 'unsere', 'weil', 'sehr', 'ist'])
    assert.ok(!tokens.includes(stop), `expected "${stop}" to be filtered`);
  assert.ok(tokens.includes('angebot'));
  assert.ok(tokens.includes('kunden'));
  assert.ok(tokens.includes('wichtig'));
});

test('seoTokens drops common discourse/filler words', () => {
  const tokens = seoTokens('Eigentlich ist unser Service natürlich einfach quasi immer sehr zuverlässig.');
  for (const filler of ['eigentlich', 'natürlich', 'einfach', 'quasi', 'immer'])
    assert.ok(!tokens.includes(filler), `expected filler word "${filler}" to be filtered`);
  assert.ok(tokens.includes('service'));
  assert.ok(tokens.includes('zuverlässig'));
});

test('seoTokens still keeps content-bearing adjectives/adverbs (not over-aggressive)', () => {
  const tokens = seoTokens('Unsere Produkte sind hochwertig, nachhaltig und regional produziert.');
  assert.ok(tokens.includes('produkte'));
  assert.ok(tokens.includes('hochwertig'));
  assert.ok(tokens.includes('nachhaltig'));
  assert.ok(tokens.includes('regional'));
  assert.ok(tokens.includes('produziert'));
});

test('calcWdfIdf never surfaces stopwords in the ranked term list', () => {
  const pages = [
    { text: 'Wir bieten eine nachhaltige Lösung für unsere Kunden, weil das sehr wichtig ist und wir das können.' },
    { text: 'Diese Lösung ist für alle Kunden verfügbar, weil wir das wirklich sehr gut können und wollen.' }
  ];
  const [terms] = calcWdfIdf(pages);
  const grammaticalStopwords = ['wir', 'das', 'für', 'unsere', 'weil', 'sehr', 'ist', 'und', 'diese', 'alle'];
  for (const row of terms)
    assert.ok(!grammaticalStopwords.includes(row.term), `"${row.term}" should not appear in WDF*IDF terms`);
  assert.ok(terms.some(row => row.term === 'lösung'));
  assert.ok(terms.some(row => row.term === 'kunden'));
});
