import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { renderAllInklWorkspace } from '../lib/allinkl-ui.mjs';

const account = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'ALL-INKL',
  login: 'w0137d60',
  profileId: '22222222-2222-4222-8222-222222222222'
};

test('ALL-INKL account table uses named fields and preserves account controls', () => {
  const html = renderAllInklWorkspace([account], [], value => String(value));
  for (const label of ['Konto', 'KAS-Login', 'FTP-Profil', 'Aktionen']) {
    assert.match(html, new RegExp('data-label="' + label + '"'));
  }
  assert.match(html, /data-allinkl-remove=/);
  assert.match(html, /Noch keine ALL-INKL-Konten/);
});

test('ALL-INKL table and forms use stacked mobile cards without sideways scrolling', () => {
  const html = renderAllInklWorkspace([account], [], value => String(value));
  assert.match(html, /@media\s*\(max-width:\s*800px\)/);
  assert.match(html, /\.hosting-layout\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(html, /\.hosting-table\{overflow-x:visible/);
  assert.match(html, /\.hosting-table tr\{display:grid/);
  assert.match(html, /\.hosting-table td\{display:grid/);
  assert.match(html, /content:attr\(data-label\)/);
  assert.match(html, /\.hosting-actions\{display:grid/);
  assert.match(html, /\.hosting-domain-list\{display:grid/);
});

test('DNS rows expose mobile labels and retain read-only protections and buttons', async () => {
  const script = await readFile(new URL('../public/allinkl.js', import.meta.url), 'utf8');
  for (const label of ['Typ', 'Name', 'Wert', 'Prio']) {
    assert.match(script, new RegExp("\\['" + label + "', r\\."));
  }
  assert.match(script, /td\.dataset\.label = label/);
  assert.match(script, /td\.dataset\.label = 'Aktionen'/);
  assert.match(script, /td\.textContent = 'Nur lesen'/);
  assert.match(script, /r\.changeable !== false/);
  assert.match(script, /r\.deleteable !== false/);
});
