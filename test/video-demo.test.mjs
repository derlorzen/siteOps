import test from 'node:test';
import assert from 'node:assert/strict';
import { validatedDemoUrl, validatedDemoSteps, executeDemoStep } from '../runner/video-demo.mjs';

const hosts = ['demo.example.com'];

test('browser video capture only permits explicit HTTPS demo hosts', () => {
  assert.equal(validatedDemoUrl('https://demo.example.com/admin/products', hosts), 'https://demo.example.com/admin/products');
  for (const url of [
    'http://demo.example.com',
    'https://bad.example.com',
    'https://demo.example.com@evil.example',
    'file:///etc/passwd',
    'https://demo.example.com/#secret'
  ]) {
    assert.throws(() => validatedDemoUrl(url, hosts));
  }
});

test('browser action schema rejects navigation outside demo host, oversized and unapproved steps', () => {
  const base = 'https://demo.example.com/';
  assert.deepEqual(validatedDemoSteps([
    { action: 'click', selector: '#open' },
    { action: 'fill', selector: '#name', value: 'Sample Product' },
    { action: 'scroll', pixels: 300 },
    { action: 'wait', ms: 500 }
  ], base, hosts).map(s => s.action), ['click', 'fill', 'scroll', 'wait']);
  for (const bad of [
    [{ action: 'evaluate', script: 'alert(1)' }],
    [{ action: 'goto', url: 'https://other.example.com' }],
    [{ action: 'press', selector: '#name', key: 'Control+Shift+P' }],
    [{ action: 'scroll', pixels: 100000 }],
    [{ action: 'wait', ms: 800000 }],
    [{ action: 'fill', selector: '#name', value: 'x'.repeat(200) }],
    Array.from({ length: 17 }, () => ({ action: 'click', selector: '#open' }))
  ]) {
    assert.throws(() => validatedDemoSteps(bad, base, hosts));
  }
  assert.throws(() => validatedDemoSteps([{ action: 'click', selector: '#open' }], null, hosts));
});

test('demo executor does not fill password inputs', async () => {
  let filled = false;
  const page = {
    locator: () => ({
      first: () => ({
        getAttribute: async () => 'password',
        fill: async () => { filled = true; }
      })
    })
  };
  await assert.rejects(executeDemoStep(page, { action: 'fill', selector: '#password', value: 'secret' }), /Password/);
  assert.equal(filled, false);
});
