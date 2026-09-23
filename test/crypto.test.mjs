import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { safeEqual, encryptWithKey, decryptWithKey, joinRemote } from '../lib/crypto.mjs';

const key = crypto.randomBytes(32);

test('encryptWithKey/decryptWithKey round-trips strings, numbers, objects and arrays', () => {
  for (const value of ['hello', 42, { a: 1, b: [1, 2, 3] }, null, ['x', 'y']]) {
    const encrypted = encryptWithKey(value, key);
    assert.deepEqual(decryptWithKey(encrypted, key), value);
  }
});

test('encryptWithKey produces a different ciphertext every time (random IV)', () => {
  const a = encryptWithKey('same value', key);
  const b = encryptWithKey('same value', key);
  assert.notEqual(a, b);
});

test('decryptWithKey rejects a tampered ciphertext (GCM auth tag)', () => {
  const [iv, tag, data] = encryptWithKey('secret', key).split('.');
  const tamperedByte = Buffer.from(data, 'base64url');
  tamperedByte[0] ^= 0xff;
  const tampered = [iv, tag, tamperedByte.toString('base64url')].join('.');
  assert.throws(() => decryptWithKey(tampered, key));
});

test('decryptWithKey rejects the wrong key', () => {
  const encrypted = encryptWithKey('secret', key);
  const wrongKey = crypto.randomBytes(32);
  assert.throws(() => decryptWithKey(encrypted, wrongKey));
});

test('safeEqual matches equal strings and rejects different ones', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'ab'), false);
  assert.equal(safeEqual('', ''), true);
});

test('safeEqual coerces nullish values to empty strings instead of throwing', () => {
  assert.equal(safeEqual(undefined, ''), true);
  assert.equal(safeEqual(null, 'x'), false);
});

test('joinRemote joins a relative path onto the remote root', () => {
  assert.equal(joinRemote('/home/site/public', 'wp-content/themes'), '/home/site/public/wp-content/themes');
  assert.equal(joinRemote('/home/site/public/', 'index.php'), '/home/site/public/index.php');
  assert.equal(joinRemote('/home/site/public'), '/home/site/public');
});

test('joinRemote rejects path traversal attempts', () => {
  assert.throws(() => joinRemote('/home/site/public', '../../../etc/passwd'), /Path traversal rejected/);
  assert.throws(() => joinRemote('/home/site/public', 'wp-content/../../../etc/passwd'), /Path traversal rejected/);
});

test('joinRemote normalizes backslashes and leading slashes in the requested path', () => {
  assert.equal(joinRemote('/home/site/public', '\\wp-content\\uploads'), '/home/site/public/wp-content/uploads');
  assert.equal(joinRemote('/home/site/public', '///etc/passwd'), '/home/site/public/etc/passwd');
});
