import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { launchGuarded, browserCapacityStatus } from '../runner/browser-capacity.mjs';

class FakeBrowser extends EventEmitter {
  connected = true;
  isConnected() { return this.connected; }
  async close() {
    this.connected = false;
    this.emit('disconnected');
  }
}
const newBrowser = async () => new FakeBrowser();

test('concurrent Chromium launches have one shared cap and release on close', async () => {
  const before = browserCapacityStatus();
  assert.equal(before.active, 0);
  assert.equal(before.max, 2); // default; deployment can override BROWSER_MAX_SESSIONS
  const first = await launchGuarded(newBrowser, {});
  const second = await launchGuarded(newBrowser, {});
  assert.equal(browserCapacityStatus().active, 2);
  await assert.rejects(launchGuarded(newBrowser, {}), { statusCode: 503 });
  assert.equal(browserCapacityStatus().active, 2);
  await first.close();
  assert.equal(browserCapacityStatus().active, 1);
  const third = await launchGuarded(newBrowser, {});
  assert.equal(browserCapacityStatus().active, 2);
  await second.close();
  await third.close();
  assert.equal(browserCapacityStatus().active, 0);
});

test('failed browser launches never leak an active slot', async () => {
  await assert.rejects(launchGuarded(async () => { throw Error('spawn failure'); }, {}), /spawn failure/);
  assert.equal(browserCapacityStatus().active, 0);
});

test('unexpected browser disconnect releases only once', async () => {
  const browser = await launchGuarded(newBrowser, {});
  browser.connected = false;
  browser.emit('disconnected');
  browser.emit('disconnected');
  assert.equal(browserCapacityStatus().active, 0);
});

test('Docker image has a real PID 1 reaper and ships the guard', () => {
  const dockerfile = readFileSync(new URL('../runner/Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /ENTRYPOINT \["\/usr\/bin\/tini", "-g", "--"\]/);
  assert.match(dockerfile, /COPY server\.mjs browser-capacity\.mjs/);
});
