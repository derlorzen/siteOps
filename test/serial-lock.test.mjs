import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSerialLock } from '../lib/serial-lock.mjs';

test('serial lock runs operations one at a time in call order', async () => {
  const lock = createSerialLock({ maxHoldMs: 1000 });
  const order = [];
  let active = 0;
  const op = (name, ms) => async () => {
    active++;
    assert.equal(active, 1, 'never two holders at once');
    order.push('start ' + name);
    await new Promise(r => setTimeout(r, ms));
    order.push('end ' + name);
    active--;
    return name;
  };
  const results = await Promise.all([lock(op('a', 20)), lock(op('b', 5)), lock(op('c', 1))]);
  assert.deepEqual(results, ['a', 'b', 'c']);
  assert.deepEqual(order, ['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
});

test('a failing holder does not block the queue', async () => {
  const lock = createSerialLock({ maxHoldMs: 1000 });
  await assert.rejects(
    lock(async () => {
      throw new Error('boom');
    }),
    /boom/
  );
  assert.equal(await lock(async () => 'next'), 'next');
});

test('a hung holder is released after its hold time and later operations still run', async () => {
  const timeouts = [];
  const lock = createSerialLock({ maxHoldMs: 1000, onTimeout: info => timeouts.push(info) });
  const hung = lock(() => new Promise(() => {}), { maxHoldMs: 30, label: 'stuck snapshot' });
  const next = lock(async () => 'ran');
  await assert.rejects(hung, err => err.code === 'LOCK_HOLD_TIMEOUT' && /stuck snapshot/.test(err.message));
  assert.equal(await next, 'ran');
  assert.deepEqual(timeouts, [{ label: 'stuck snapshot', maxHoldMs: 30 }]);
});

test('active() reports the current holder', async () => {
  const lock = createSerialLock();
  assert.equal(lock.active(), null);
  let seen;
  await lock(
    async () => {
      seen = lock.active();
    },
    { label: 'full backup x' }
  );
  assert.equal(seen.label, 'full backup x');
  assert.equal(lock.active(), null);
});
