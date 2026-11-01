import test from 'node:test';
import assert from 'node:assert/strict';
import { renderWebsiteList } from '../lib/product-ui.mjs';
import { monitoringState } from '../lib/workspace-overview.mjs';
import { readFile } from 'node:fs/promises';

test('website collection has one table, labelled search, filter, sort and a useful empty state', () => {
  const html = renderWebsiteList({
    items: [],
    total: 0,
    total_sites: 0,
    counts: {},
    filters: { query: '', status: 'all', sort: 'name', offset: 0 },
    next_offset: null
  });
  for (const part of ['type="search"', 'name="status"', 'name="sort"', 'role="status"', 'Die erste Website hinzufügen'])
    assert.ok(html.includes(part));
  assert.equal((html.match(/<table/g) || []).length, 1);
});
test('a connected Google account does not imply a verified website or a current monitoring check', () => {
  const state = monitoringState({ monitor_enabled: 1, connected: true, verified: true, last_check_ok: null });
  assert.equal(state.code, 'unknown');
});
test('shared website navigation and motion retain accessible overflow and keyboard focus', async () => {
  const script = await readFile(new URL('../public/ops-workspace.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/workspace-shell.css', import.meta.url), 'utf8');
  assert.match(script, /search-console/);
  for (const value of ['focus-visible', 'prefers-reduced-motion', 'overflow-x:auto']) assert.ok(css.includes(value));
});
