import test from 'node:test';
import assert from 'node:assert/strict';
import { searchConsoleSetup } from '../lib/search-console-setup.mjs';
import { renderSearchConsoleOverview } from '../lib/search-console-ui.mjs';
import { searchConsoleFixture } from './search-console-fixture.mjs';

const account = { id: 'account', email: 'studio@example.test' };
const connected = {
  configured: true,
  accounts: [account],
  site_enabled: true,
  linkage: {
    account_id: 'account',
    property: 'sc-domain:example.test',
    permission_level: 'siteOwner',
    live_approved_at: '2026-10-01',
    verified_at: '2026-10-01',
    last_sync_at: '2026-10-30',
    sitemap_status: 'processed'
  }
};
test('setup distinguishes credentials, actual Google account consent and project assignment', () => {
  const missing = searchConsoleSetup({ site_enabled: true });
  assert.equal(missing.next_step, 'client');
  assert.ok(missing.missing_steps.includes('account'));
  assert.equal(missing.steps.find(s => s.id === 'dns').state, 'conditional');
  const credentials = searchConsoleSetup({ configured: true, site_enabled: true });
  assert.equal(credentials.next_step, 'account');
  assert.equal(credentials.connected, false);
  const accountOnly = searchConsoleSetup({ configured: true, accounts: [account], site_enabled: true });
  assert.equal(accountOnly.next_step, 'link');
  assert.ok(!accountOnly.missing_steps.includes('client'));
  assert.ok(!accountOnly.missing_steps.includes('account'));
});
test('existing readable properties skip ownership work and optional sitemap never blocks analytics', () => {
  for (const permission_level of ['siteOwner', 'siteFullUser', 'siteRestrictedUser']) {
    const setup = searchConsoleSetup({
      ...connected,
      linkage: { ...connected.linkage, permission_level, verified_at: null, sitemap_status: 'not_submitted' }
    });
    assert.equal(setup.complete, true);
    assert.equal(setup.can_sync, true);
    assert.deepEqual(setup.missing_steps, []);
    assert.equal(setup.steps.find(s => s.id === 'dns').state, 'not_required');
    assert.equal(setup.steps.find(s => s.id === 'sitemap').state, 'optional');
  }
  const firstSync = searchConsoleSetup({
    ...connected,
    linkage: { ...connected.linkage, last_sync_at: null, sitemap_status: 'not_submitted' }
  });
  assert.equal(firstSync.next_step, 'sync');
});
test('new domain has independent DNS, verification, registration and approval states', () => {
  const draft = {
    ...connected,
    linkage: { property: 'sc-domain:example.test', permission_level: null, dns_applied: false }
  };
  const live = searchConsoleSetup(draft);
  assert.equal(live.next_step, 'live');
  assert.equal(live.steps.find(s => s.id === 'dns').can_start, false);
  const unknown = searchConsoleSetup({ ...draft, linkage: { ...draft.linkage, dns_applied: undefined } });
  assert.equal(unknown.steps.find(step => step.id === 'dns').state, 'unknown');
  assert.match(unknown.steps.find(step => step.id === 'dns').description, /noch nicht geprüft/);
  draft.linkage.live_approved_at = '2026-10-01';
  const dns = searchConsoleSetup(draft);
  assert.equal(dns.next_step, 'dns');
  assert.match(dns.steps.find(s => s.id === 'dns').description, /kein ausgeführter/);
  draft.linkage.dns_applied = true;
  const verify = searchConsoleSetup(draft);
  assert.equal(verify.next_step, 'verify');
  assert.equal(verify.steps.find(s => s.id === 'dns').state, 'complete');
  assert.equal(verify.can_sync, false);
  draft.linkage.verified_at = '2026-10-01';
  const property = searchConsoleSetup(draft);
  assert.equal(property.next_step, 'property');
  assert.equal(property.can_sync, false);
});
test('changed domains, disabled websites and failed sync do not report a completed workflow', () => {
  assert.equal(searchConsoleSetup({ ...connected, linkage: { invalidated: true } }).next_step, 'link');
  assert.equal(searchConsoleSetup({ ...connected, site_enabled: false }).next_step, 'active');
  const failed = searchConsoleSetup({
    ...connected,
    linkage: { ...connected.linkage, sync_error: 'Provider timeout' }
  });
  assert.equal(failed.next_step, 'sync');
  assert.equal(failed.complete, false);
  assert.equal(failed.connected, true);
});
test('central overview removes setup instructions once connected and names the next missing website step', () => {
  const site = { id: 'site', slug: 'demo', name: 'Studio', domain: 'example.test' };
  const ready = renderSearchConsoleOverview([site], connected, [
    { site_id: site.id, setup: searchConsoleSetup(connected) }
  ]);
  assert.doesNotMatch(ready, /Google Cloud Console|Google-Verbindung einrichten|gsc-overview-onboarding/);
  assert.match(ready, /Google-Verbindung verwalten/);
  assert.match(ready, /Suchleistung öffnen/);
  assert.match(ready, /noch nicht synchronisiert/, 'a connected website without a sync says what to do');
  assert.match(ready, /Verbundene Websites<\/dt><dd><span>1 von 1/);
  // With synced reports the overview becomes a dashboard: totals first, busiest website first.
  const quiet = { id: 'quiet', slug: 'quiet', name: 'Quiet', domain: 'quiet.test' },
    open = { id: 'open', slug: 'open', name: 'Open <b>', domain: 'open.test' };
  const report = (clicks, previous) => ({
    clicks,
    impressions: clicks * 20,
    ctr: 0.05,
    position: 7.26,
    previous_clicks: previous,
    daily_clicks: [1, 4, 2, 8]
  });
  const dashboard = renderSearchConsoleOverview([open, quiet, site], connected, [
    { site_id: quiet.id, setup: searchConsoleSetup(connected), performance: report(100, 200) },
    { site_id: site.id, setup: searchConsoleSetup(connected), performance: report(1500, 1000) }
  ]);
  assert.match(dashboard, /Verbundene Websites<\/dt><dd><span>2 von 3<\/span><small>1 noch einzurichten/);
  assert.match(dashboard, /Klicks<\/dt><dd><span>1\.600<\/span>/);
  assert.match(dashboard, /Impressionen<\/dt><dd><span>32\.000<\/span>/);
  assert.match(dashboard, /data-tone="up">\+50,0\s?% zum Vorzeitraum/);
  assert.match(dashboard, /data-tone="down">-50,0\s?% zum Vorzeitraum/);
  assert.match(dashboard, /Ø Position<\/dt><dd>7,3/);
  assert.equal((dashboard.match(/class="gsc-spark"/g) || []).length, 2);
  assert.ok(dashboard.indexOf('>Studio<') < dashboard.indexOf('>Quiet<'), 'most clicks first');
  assert.ok(dashboard.indexOf('>Quiet<') < dashboard.indexOf('Open &lt;b&gt;'), 'websites to set up come last');
  assert.doesNotMatch(dashboard, /Open <b>/);
  assert.match(dashboard, /Nächster Schritt: Website zuordnen\./);
  const missing = renderSearchConsoleOverview([site], { configured: true, accounts: [] }, []);
  assert.doesNotMatch(missing, /gsc-kpis/, 'no totals before Google is connected');
  assert.match(missing, /Google-Konto noch nicht verbunden/);
  assert.match(missing, /Client-ID allein verbindet noch kein Konto/);
  assert.match(missing, /\/sites\/demo\/search-console#settings/);
});
test('status exposes the same guidance through the shared service without secrets or writes', async () => {
  const f = searchConsoleFixture();
  await f.link();
  const before = f.requests.length;
  const status = await f.service.status('demo');
  assert.equal(status.setup.next_step, 'live');
  assert.equal(status.setup.can_sync, false);
  assert.equal(f.requests.length, before);
  const overview = await f.service.overview();
  assert.equal(overview[0].setup.next_step, status.setup.next_step);
  assert.equal(overview[0].property, status.linkage.property);
  assert.equal(overview[0].performance, null, 'no figures before the first sync');
  assert.ok(!JSON.stringify(status.setup).includes('refresh-test'));
  await f.approve('live');
  const approved = await f.service.status('demo');
  assert.equal(approved.setup.next_step, 'sync');
  assert.equal(approved.setup.can_sync, true);
  f.setSubject('another-user');
  assert.deepEqual(await f.service.overview(), []);
});
