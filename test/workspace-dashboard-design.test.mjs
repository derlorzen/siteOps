import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const script = await readFile(new URL('../public/ops-workspace.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../public/ops-workspace.css', import.meta.url), 'utf8');
const shell = await readFile(new URL('../public/workspace-shell.css', import.meta.url), 'utf8');

test('website portfolio exposes search, status filters and meaningful zero-results feedback', () => {
  for (const part of [
    'ops-portfolio-search',
    'ops-portfolio-filter',
    'ops-portfolio-result-count',
    'Keine Websites passen zu deiner Suche',
    'portfolioSearch.trim()',
    "portfolioFilter==='attention'"
  ])
    assert.ok(script.includes(part), part);
  assert.match(script, /visible\.map\(portfolioCard\)/);
  assert.match(styles, /\.ops-portfolio-controls/);
});

test('portfolio KPIs do not conflate OAuth account with verified Search Console properties', () => {
  assert.match(script, /searchConsoleStatus\(site\)\?\.verified/);
  assert.match(script, /searchConsoleStatus\(site\)\?\.invalidated/);
  assert.match(script, /GSC · Status unbekannt/);
  assert.match(script, /Search Console bestätigt/);
});

test('individual website tabs link to Search Console and shared workspaces support keyboard access', () => {
  assert.match(script, /'search-console','Search Console','\/search-console'/);
  assert.match(shell, /focus-visible/);
  assert.match(shell, /prefers-reduced-motion/);
  assert.match(shell, /overflow-x:auto/);
});
