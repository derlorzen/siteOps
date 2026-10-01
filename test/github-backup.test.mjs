// Covers the pieces that make GitHub backups resilient against the hourly API rate limit:
// preferring inline tree content over a separate blob-creation call for ordinary text files
// (cuts request count roughly in half on a large first backup), and surfacing a clear,
// actionable error with the actual reset time instead of a bare 500 when the limit is hit.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SITEOPS_MASTER_KEY ||= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
process.env.DASHBOARD_USER ||= 'test';
process.env.DASHBOARD_PASSWORD ||= 'test-password';
process.env.SITEOPS_TEST_NO_AUTOSTART = '1';
const { isUtf8Text, gitTreeEntryPayload, githubRateLimitMessage, githubRetryDelayMs, gitBlobSha } = await import(
  '../app.mjs'
);

test('isUtf8Text accepts plain and multi-byte UTF-8 text', () => {
  assert.equal(isUtf8Text(Buffer.from('<?php echo "hello";', 'utf8')), true);
  assert.equal(isUtf8Text(Buffer.from('Über Größe äöüß', 'utf8')), true);
  assert.equal(isUtf8Text(Buffer.from('', 'utf8')), true);
});

test('isUtf8Text rejects binary content', () => {
  // PNG magic bytes - not valid UTF-8.
  assert.equal(isUtf8Text(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xd8])), false);
  // A NUL byte should never be treated as text even if the rest happens to decode.
  assert.equal(isUtf8Text(Buffer.from('abc\0def', 'utf8')), false);
});

test('gitTreeEntryPayload inlines small text content', () => {
  const payload = gitTreeEntryPayload(Buffer.from('<h1>Hallo</h1>', 'utf8'));
  assert.deepEqual(payload, { content: '<h1>Hallo</h1>' });
});

test('gitTreeEntryPayload returns null for binary content (caller must create a blob)', () => {
  const jpegLike = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  assert.equal(gitTreeEntryPayload(jpegLike), null);
});

test('gitTreeEntryPayload returns null for text larger than the inline threshold', () => {
  const big = Buffer.from('a'.repeat(1024 * 1024 + 1), 'utf8');
  assert.equal(gitTreeEntryPayload(big), null);
});

test('gitTreeEntryPayload content round-trips to the same git blob SHA as an explicit blob would', () => {
  const content = Buffer.from('console.log("hi");\n', 'utf8');
  const payload = gitTreeEntryPayload(content);
  // What GitHub would hash for a blob created from this inline content is identical to
  // hashing the raw bytes directly - Git blob SHAs are content-addressed, not
  // creation-path-addressed, so a later incremental backup's unchanged-file check
  // (comparing against gitBlobSha()) keeps working regardless of which path created it.
  assert.equal(Buffer.from(payload.content, 'utf8').toString('utf8'), content.toString('utf8'));
  assert.equal(gitBlobSha(Buffer.from(payload.content, 'utf8')), gitBlobSha(content));
});

test('githubRateLimitMessage reports the reset time from response headers', () => {
  const resetUnix = 1790857021;
  const headers = new Headers({ 'x-ratelimit-reset': String(resetUnix), 'x-ratelimit-remaining': '0' });
  const msg = githubRateLimitMessage(headers);
  assert.ok(msg.includes(new Date(resetUnix * 1000).toISOString()));
  assert.ok(msg.toLowerCase().includes('rate limit'));
});

test('githubRateLimitMessage returns null without a reset header', () => {
  assert.equal(githubRateLimitMessage(new Headers({})), null);
});

test('githubRetryDelayMs only retries short secondary-rate-limit waits', () => {
  assert.equal(githubRetryDelayMs(new Headers({ 'retry-after': '5' })), 5000);
  assert.equal(githubRetryDelayMs(new Headers({ 'retry-after': '60' })), 60000);
  assert.equal(githubRetryDelayMs(new Headers({ 'retry-after': '61' })), null);
  assert.equal(githubRetryDelayMs(new Headers({})), null);
});
