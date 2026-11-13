import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzePhpVersion,
  isPublicIpv4,
  normalizeScanTarget,
  normalizeToolUrl,
  PHP_FIXES,
  registerToolsRoutes,
  renderToolsPage,
  withDeadline
} from '../lib/tools.mjs';
import Fastify from 'fastify';

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

test('PHP scanner resolves quickly or returns a controlled timeout for stalled DNS lookups', async () => {
  const started = Date.now();
  await assert.rejects(
    withDeadline(new Promise(() => {}), 25, 'DNS-Antwort dauert zu lange.'),
    /DNS-Antwort dauert zu lange/
  );
  assert.ok(Date.now() - started < 2000);
});

test('tool link writes reach the service and are guarded by content type and origin', async t => {
  const calls = [];
  const app = Fastify();
  t.after(() => app.close());
  registerToolsRoutes(app, {
    db: null,
    page: (_title, body) => body,
    publicBaseUrl: () => 'https://siteops.example.org',
    service: {
      create: async body => (calls.push(['create', body.title]), { id: 'new' }),
      update: async id => (calls.push(['update', id]), { id }),
      remove: async id => (calls.push(['remove', id]), { ok: true })
    }
  });
  const json = { 'content-type': 'application/json' };
  // A hanging hook would never answer; fail fast instead of stalling the suite.
  const send = options =>
    Promise.race([
      app.inject(options),
      new Promise((_, reject) => setTimeout(() => reject(new Error('request hung: ' + options.url)), 2000).unref())
    ]);
  assert.equal(
    (await send({ method: 'POST', url: '/api/tools', headers: json, payload: { title: 'A' } })).statusCode,
    200
  );
  assert.equal((await send({ method: 'PUT', url: '/api/tools/7', headers: json, payload: {} })).statusCode, 200);
  // The dashboard deletes without a body or content type.
  assert.equal((await send({ method: 'DELETE', url: '/api/tools/7' })).statusCode, 200);
  assert.deepEqual(calls, [
    ['create', 'A'],
    ['update', '7'],
    ['remove', '7']
  ]);
  assert.equal((await send({ method: 'POST', url: '/api/tools', payload: 'x' })).statusCode, 415);
  for (const method of ['POST', 'DELETE'])
    assert.equal(
      (
        await send({
          method,
          url: '/api/tools' + (method === 'DELETE' ? '/7' : ''),
          headers: { ...(method === 'POST' ? json : {}), origin: 'https://evil.example' },
          payload: method === 'POST' ? {} : undefined
        })
      ).statusCode,
      403
    );
  assert.equal(calls.length, 3);
});
