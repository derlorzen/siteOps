/* global window, document */
import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDemoContext, recordDemoScene, demoBrowserArgs } from '../runner/video-demo.mjs';
import { createDemoProxy } from '../runner/video-network.mjs';
import { renderVideoStudio } from '../lib/video-studio-ui.mjs';

const enabled = process.env.RUN_VIDEO_BROWSER_TESTS === '1';
test(
  'real Chromium: guarded stills/recordings, redirects, assets, private DNS, WebSockets and GUI errors',
  { skip: !enabled, timeout: 90000 },
  async t => {
    const { chromium } = await import('../runner/node_modules/playwright/index.mjs');
    const { captureSceneScreenshot } = await import('../runner/video-studio.mjs');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'siteops-video-policy-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const openssl =
      process.env.TEST_OPENSSL ||
      (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
    execFileSync(
      openssl,
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        path.join(dir, 'key.pem'),
        '-out',
        path.join(dir, 'cert.pem'),
        '-days',
        '1',
        '-subj',
        '/CN=demo.lorzen.de'
      ],
      { stdio: 'pipe' }
    );
    const key = await fs.readFile(path.join(dir, 'key.pem'));
    const cert = await fs.readFile(path.join(dir, 'cert.pem'));
    const received = [];
    const server = https.createServer({ key, cert }, (req, res) => {
      received.push({ host: req.headers.host, url: req.url });
      if (req.url === '/redirect') {
        res.writeHead(302, { location: 'https://evil.test/secret' });
        res.end();
        return;
      }
      if (req.url === '/redirect-private') {
        res.writeHead(302, { location: 'https://private.lorzen.de/secret' });
        res.end();
        return;
      }
      if (req.url === '/redirect-port') {
        res.writeHead(302, { location: 'https://demo.lorzen.de:8443/secret' });
        res.end();
        return;
      }
      if (req.url === '/redirect-loopback') {
        res.writeHead(302, { location: 'https://127.0.0.1:' + server.address().port + '/secret' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(
        '<!doctype html><title>Safe demo</title><button id="go">Demo</button>' +
          '<script src="https://evil.test/asset"></script><iframe src="https://evil.test/frame"></iframe>' +
          '<img src="https://private.lorzen.de/private"><script>window.wsOpened=false;' +
          'const ws=new WebSocket("wss://demo.lorzen.de/socket");ws.onopen=()=>window.wsOpened=true;</script>'
      );
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => {
      server.closeAllConnections();
      return new Promise(resolve => server.close(resolve));
    });
    const connectOptions = [];
    const factory = hosts =>
      createDemoProxy(hosts, {
        resolve: async host => [{ address: host === 'private.lorzen.de' ? '127.0.0.1' : '8.8.8.8' }],
        connect: options => {
          connectOptions.push(options);
          // Test-only mapping of an approved public IP to the local HTTPS fixture.
          return net.connect({ host: '127.0.0.1', port: server.address().port });
        }
      });
    // Only this local fixture browser trusts the ephemeral self-signed test server.
    // Production uses demoBrowserArgs without a certificate bypass.
    const browser = await chromium.launch({
      headless: true,
      args: [...demoBrowserArgs, '--ignore-certificate-errors']
    });
    t.after(() => browser.close());
    const hosts = ['*.lorzen.de'];
    const guarded = await createDemoContext(browser, { viewport: { width: 640, height: 360 } }, hosts, factory);
    t.after(() => guarded.close());
    const page = await guarded.context.newPage();
    await page.goto('https://demo.lorzen.de/', { waitUntil: 'networkidle' }).catch(error => {
      throw new Error(
        error.message +
          ' fixture connections=' +
          JSON.stringify(connectOptions) +
          ' received=' +
          JSON.stringify(received)
      );
    });
    assert.equal(await page.title(), 'Safe demo');
    assert.equal(await page.evaluate(() => window.wsOpened), false);
    for (const route of ['/redirect', '/redirect-private', '/redirect-port', '/redirect-loopback'])
      await assert.rejects(page.goto('https://demo.lorzen.de' + route, { timeout: 5000 }));
    assert.equal(
      received.some(
        x => x.host !== 'demo.lorzen.de' || ['/secret', '/asset', '/frame', '/private', '/socket'].includes(x.url)
      ),
      false
    );
    assert.ok(connectOptions.length > 0);
    assert.ok(connectOptions.every(x => x.host === '8.8.8.8' && x.port === 443));
    const job = { title: 'Demo', scenes: [{}], format: 'landscape', demoPolicy: { version: 1, hosts } };
    await captureSceneScreenshot(browser, { demoUrl: 'https://demo.lorzen.de/' }, job, 0, dir, factory);
    assert.ok((await fs.stat(path.join(dir, 'scene-00.png'))).size > 100);
    await recordDemoScene(
      browser,
      { demoUrl: 'https://demo.lorzen.de/', demoSteps: [{ action: 'click', selector: '#go' }] },
      path.join(dir, 'demo.webm'),
      { width: 640, height: 360 },
      hosts,
      path.join(dir, 'demo.png'),
      factory
    );
    assert.ok((await fs.stat(path.join(dir, 'demo.webm'))).size > 100);

    const context = await browser.newContext();
    t.after(() => context.close());
    const ui = await context.newPage();
    let saved = null;
    const id = '11111111-1111-4111-8111-111111111111';
    const state = () => ({
      policy: saved,
      source: saved ? 'siteops' : 'environment',
      supported: true,
      environmentPolicy: { version: 1, hosts: [] }
    });
    await context.route('https://siteops.test/**', async route => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: renderVideoStudio() });
      if (url.pathname === '/assets/video-studio.js')
        return route.fulfill({
          contentType: 'text/javascript',
          body: await fs.readFile(new URL('../public/video-studio.js', import.meta.url), 'utf8')
        });
      let body = {};
      if (url.pathname.endsWith('/demo-policy')) {
        if (request.method() === 'POST') saved = request.postDataJSON().policy;
        body = state();
      } else if (url.pathname.endsWith('/capabilities')) body = {};
      else if (url.pathname.endsWith('/projects')) body = [];
      else if (url.pathname.endsWith('/jobs')) body = [{ id, title: 'A demo', status: 'draft' }];
      else if (url.pathname.endsWith('/render'))
        return route.fulfill({
          status: 422,
          json: {
            error: 'Unprocessable Entity',
            message: 'Renderauftrag abgelehnt (422): Demo-Domains prüfen.'
          }
        });
      return route.fulfill({ json: body });
    });
    await ui.goto('https://siteops.test/');
    await ui.locator('#vs-policy-suggest').click();
    assert.equal(saved, null, 'suggestion is not an implicit grant');
    await ui.locator('#vs-policy-save').click();
    await ui.waitForFunction(() =>
      document.querySelector('#vs-policy-status').textContent.includes('SiteOps-Datenbank')
    );
    assert.deepEqual(saved.hosts, ['*.lorzen.de', 'shop.lorzen.link']);
    await ui.reload();
    await ui.waitForFunction(() => document.querySelector('#vs-policy-hosts').value.includes('shop.lorzen.link'));
    await ui.locator('#vs-policy-hosts').fill('');
    await ui.locator('#vs-policy-save').click();
    await ui.waitForFunction(() =>
      document.querySelector('#vs-policy-status').textContent.includes('alle Demos gesperrt')
    );
    assert.deepEqual(saved.hosts, []);
    await ui.locator('#vs-policy-reset').click();
    await ui.waitForFunction(() =>
      document.querySelector('#vs-policy-status').textContent.includes('VIDEO_ALLOWED_HOSTS')
    );
    assert.equal(saved, null);
    await ui.locator('[data-render]').click();
    await ui.waitForFunction(() => document.querySelector('#vs-message').textContent.includes('Demo-Domains prüfen'));
    assert.match(await ui.locator('#vs-message').innerText(), /Renderauftrag abgelehnt \(422\)/);
    assert.doesNotMatch(await ui.locator('#vs-message').innerText(), /Unprocessable Entity|Bad Gateway/);
  }
);
