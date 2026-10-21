import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzePhpVersion,
  isPublicIpv4,
  normalizeScanTarget,
  normalizeToolUrl,
  PHP_FIXES,
  renderToolsPage
} from '../lib/tools.mjs';

test('the documented PHP2Shell fixes are used for every supported branch', () => {
  assert.deepEqual(PHP_FIXES, {
    8.2: '8.2.35',
    8.3: '8.3.36',
    8.4: '8.4.27',
    8.5: '8.5.12'
  });
  for (const version of Object.values(PHP_FIXES)) {
    assert.equal(analyzePhpVersion(version).status, 'reported-patched');
    const [major, minor, patch] = version.split('.').map(Number);
    assert.equal(analyzePhpVersion([major, minor, patch - 1].join('.')).status, 'outdated');
  }
  assert.equal(analyzePhpVersion(null).status, 'unknown');
  assert.equal(analyzePhpVersion('8.4').status, 'unknown');
});

test('PHP scanner only accepts public hostnames on standard HTTP ports', () => {
  assert.equal(normalizeScanTarget('example.org/admin?private=1').href, 'https://example.org/');
  assert.equal(normalizeScanTarget('http://www.example.org').href, 'http://www.example.org/');
  for (const url of [
    'http://127.0.0.1',
    'http://10.0.0.1',
    'http://localhost',
    'http://internal.local',
    'http://metadata.google.internal',
    'file:///etc/passwd',
    'https://example.org:8443/',
    'ftp://example.org'
  ])
    assert.throws(() => normalizeScanTarget(url), Error);
});

test('PHP scanner refuses private, reserved and metadata-service IPv4 destinations', () => {
  for (const ip of [
    '127.0.0.1',
    '10.5.0.3',
    '169.254.169.254',
    '172.20.1.2',
    '192.168.0.1',
    '100.100.100.200',
    '0.0.0.0',
    '224.0.0.1',
    '203.0.113.10'
  ])
    assert.equal(isPublicIpv4(ip), false, ip);
  for (const ip of ['1.1.1.1', '8.8.8.8', '85.13.140.246']) assert.equal(isPublicIpv4(ip), true, ip);
});

test('bookmarked tool links only permit standard web protocols', () => {
  assert.equal(normalizeToolUrl('https://example.com/path'), 'https://example.com/path');
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,hello',
    'file:///etc/shadow',
    'https://me:secret@example.com'
  ])
    assert.throws(() => normalizeToolUrl(url));
});

test('the Tools workspace contains a native PHP check, registry and accessible edit controls', () => {
  const html = renderToolsPage();
  assert.match(html, /id="tools-check-form"/);
  assert.match(html, /id="tools-list"/);
  assert.match(html, /id="tools-dialog"/);
  assert.match(html, /\/assets\/tools.js/);
});
