import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMonitorControl } from '../lib/site-monitor-ui.mjs';
import { renderCoolifySite } from '../lib/coolify-deployer-ui.mjs';

const esc = value => String(value ?? '');
const site = { slug: 'ci', name: 'CI', domain: 'ci.example.invalid', enabled: 1, monitor_enabled: 1 };

test('monitoring control is visible with explicit action in either state', () => {
  assert.match(renderMonitorControl(site, esc), /Überwachung pausieren/);
  assert.match(renderMonitorControl({ ...site, monitor_enabled: 0 }, esc), /Überwachung aktivieren/);
});

test('Coolify monitoring history and settings are initially hidden in separate views', () => {
  const html = renderCoolifySite(site, [], esc);
  assert.match(html, /data-site-view="overview"/);
  assert.match(html, /data-site-view="history" hidden/);
  assert.match(html, /data-site-view="settings" hidden/);
  assert.match(html, /data-monitor-toggle/);
  assert.match(html, /Prüfregeln speichern/);
  assert.match(html, /url\+'\/status'/);
});
