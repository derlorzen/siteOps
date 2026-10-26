import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { authenticateDemo } from '../runner/video-login.mjs';
import { recordDemoScene, demoBrowserArgs } from '../runner/video-demo.mjs';
import { createDemoProxy } from '../runner/video-network.mjs';
import { verifyVideoDimensions } from '../runner/video-studio.mjs';

test(
  'real browser logs in off camera, records protected screen at Full HD and rejects expired sessions',
  { skip: process.env.RUN_SUITE_BROWSER_TESTS !== '1', timeout: 60000 },
  async t => {
    const { chromium } = await import('../runner/node_modules/playwright/index.mjs');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'siteops-login-test-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    execFileSync(
      'openssl',
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
        '/CN=demo.example.com'
      ],
      { stdio: 'ignore' }
    );
    let logins = 0;
    const server = https.createServer(
      { key: await fs.readFile(path.join(dir, 'key.pem')), cert: await fs.readFile(path.join(dir, 'cert.pem')) },
      async (req, res) => {
        if (req.url === '/login' && req.method === 'POST') {
          let body = '';
          for await (const chunk of req) body += chunk;
          const p = new URLSearchParams(body);
          if (p.get('email') !== 'demo@example.com' || p.get('password') !== 'fixture-secret') {
            res.writeHead(401);
            res.end('No');
            return;
          }
          logins++;
          res.writeHead(302, {
            'set-cookie': 'demo_session=verified; Secure; HttpOnly; SameSite=Strict; Path=/',
            location: '/admin/products'
          });
          res.end();
          return;
        }
        if (req.url === '/login') {
          res.setHeader('content-type', 'text/html');
          res.end(
            '<form method="POST" action="/login"><input name="email"><input name="password" type="password"><button>Sign in</button></form>'
          );
          return;
        }
        if (!req.headers.cookie?.includes('demo_session=verified')) {
          res.writeHead(302, { location: '/login' });
          res.end();
          return;
        }
        res.setHeader('content-type', 'text/html');
        res.end(
          '<h1 id="ready">Demo products</h1><button id="open" onclick="document.querySelector(\"h1\").textContent=\"A verified screen recording\"">Open demo</button>'
        );
      }
    );
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => {
      server.closeAllConnections();
      return new Promise(resolve => server.close(resolve));
    });
    const factory = hosts =>
      createDemoProxy(hosts, {
        resolve: async () => [{ address: '8.8.8.8' }],
        connect: () => net.connect({ host: '127.0.0.1', port: server.address().port })
      });
    const browser = await chromium.launch({
      executablePath: process.env.SUITE_CHROMIUM_EXECUTABLE || undefined,
      headless: true,
      args: [
        ...demoBrowserArgs,
        '--ignore-certificate-errors',
        '--no-sandbox',
        '--disable-gpu',
        '--no-zygote',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader'
      ]
    });
    t.after(() => browser.close());
    const hosts = ['demo.example.com'];
    const profile = {
      id: 'fixture',
      login_url: 'https://demo.example.com/login',
      landing_url: 'https://demo.example.com/admin/products',
      username: 'demo@example.com',
      password: 'fixture-secret',
      username_selector: 'input[name=email]',
      password_selector: 'input[name=password]',
      submit_selector: 'form button',
      ready_selector: '#ready',
      test_data_only: true
    };
    const state = await authenticateDemo(browser, profile, hosts, factory);
    assert.equal(logins, 1);
    assert.equal(
      (await fs.readdir(dir)).some(x => x.endsWith('.webm')),
      false
    );
    const scene = { demoUrl: profile.landing_url, demoSteps: [{ action: 'click', selector: '#open' }] };
    const video = path.join(dir, 'capture.webm');
    await recordDemoScene(
      browser,
      scene,
      video,
      { width: 1920, height: 1080 },
      hosts,
      path.join(dir, 'capture.png'),
      factory,
      state
    );
    assert.deepEqual(await verifyVideoDimensions(video, 1920, 1080), { width: 1920, height: 1080 });
    await assert.rejects(verifyVideoDimensions(video, 1280, 720), /Full-HD/);
    await assert.rejects(
      recordDemoScene(
        browser,
        scene,
        path.join(dir, 'expired.webm'),
        { width: 1920, height: 1080 },
        hosts,
        path.join(dir, 'expired.png'),
        factory,
        { cookies: [], origins: [] }
      ),
      /Demo-Sitzung/
    );
    await assert.rejects(fs.access(path.join(dir, 'expired.webm')));
  }
);
