// Pure, dependency-free helpers with no module-level side effects, kept
// separate from app.mjs so they can be unit-tested without importing (and
// thereby booting) the whole application.
import crypto from 'node:crypto';

export function safeEqual(a, b) {
  const aa = Buffer.from(String(a ?? '')),
    bb = Buffer.from(String(b ?? ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

export function encryptWithKey(value, keyBuf) {
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv('aes-256-gcm', keyBuf, iv);
  const data = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value))), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(x => x.toString('base64url')).join('.');
}

export function decryptWithKey(value, keyBuf) {
  const [iv, tag, data] = value.split('.');
  const d = crypto.createDecipheriv('aes-256-gcm', keyBuf, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString());
}

export function joinRemote(root, path = '') {
  const clean = String(path).replaceAll('\\', '/').replace(/^\/+/, '');
  if (clean.split('/').includes('..')) throw new Error('Path traversal rejected');
  return `${root.replace(/\/+$/, '')}/${clean}`.replace(/\/$/, '') || '/';
}
