import test from 'node:test';
import assert from 'node:assert/strict';
import { monitoringState, createWorkspaceOverview } from '../lib/workspace-overview.mjs';
import { renderWebsiteList, renderWorkHome } from '../lib/product-ui.mjs';

const now = Date.parse('2026-10-30T12:00:00Z');
const site = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'studio',
  name: 'Studio & Partner',
  domain: 'studio.example.test',
  monitor_enabled: 1,
  monitor_interval_seconds: 60,
  last_check_ok: 1,
  last_checked_at: '2026-10-30T11:59:00Z'
};
test('website health distinguishes disabled, unknown, stale, failed and verified checks', () => {
  assert.equal(monitoringState(site, now).code, 'online');
  assert.equal(monitoringState({ ...site, last_check_ok: 0 }, now).code, 'attention');
  assert.equal(monitoringState({ ...site, last_check_ok: null }, now).code, 'unknown');
  assert.equal(monitoringState({ ...site, last_checked_at: null }, now).code, 'unknown');
  assert.equal(monitoringState({ ...site, last_checked_at: 'invalid' }, now).code, 'unknown');
  assert.equal(monitoringState({ ...site, last_checked_at: '2026-10-29T12:00:00Z' }, now).code, 'unknown');
  assert.equal(monitoringState({ ...site, monitor_enabled: 0 }, now).code, 'paused');
});
test('portfolio filters relationships, sorts and paginates the same model for UI and MCP', async () => {
  const service = createWorkspaceOverview({
    db: {
      query: async sql => {
        assert.doesNotMatch(sql, /credentials|password|SELECT s\.\*/);
        return [[site, { ...site, id: '22222222-2222-4222-8222-222222222222', name: 'Atelier', last_check_ok: 0 }]];
      }
    },
    activity: { list: async () => ({ entries: [] }) },
    dueTasks: async () => [],
    now: () => now
  });
  const first = await service.portfolio({ sort: 'status', limit: 1 });
  assert.equal(first.items[0].name, 'Atelier');
  assert.equal(first.next_offset, 1);
  assert.equal(first.counts.online, 1);
  assert.equal((await service.portfolio({ query: 'Partner' })).total, 1);
  assert.equal((await service.portfolio({ status: 'unknown' })).total, 0);
  assert.equal((await service.portfolio({ offset: 1, limit: 1 })).next_offset, null);
  await assert.rejects(service.portfolio({ limit: 10000 }));
  assert.match(renderWebsiteList(first), /<table class="ui-data-table">/);
});
test('partial dashboard outages do not become empty successful sources; embedded JSON cannot close its script', async () => {
  const service = createWorkspaceOverview({
    db: {
      query: async () => {
        throw Error('db-secret');
      }
    },
    activity: { list: async () => ({ entries: [] }) },
    dueTasks: async () => [],
    now: () => now
  });
  const data = await service.overview();
  assert.equal(data.websites, null);
  assert.equal(data.sources.websites.status, 'unavailable');
  assert.doesNotMatch(JSON.stringify(data), /db-secret/);
  assert.match(renderWorkHome(data), /nicht verfügbar/);
  const loaded = createWorkspaceOverview({
    db: { query: async () => [[{ ...site, name: '</script><script>alert(1)</script>' }]] },
    activity: {},
    dueTasks: async () => [],
    now: () => now
  });
  const html = renderWebsiteList(await loaded.portfolio());
  assert.doesNotMatch(html, /<script>alert/);
  const json = html.match(/id="websiteInitialData">([\s\S]*?)<\/script>/)[1];
  assert.equal(JSON.parse(json).items[0].name, '</script><script>alert(1)</script>');
});
