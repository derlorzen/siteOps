/* global document */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { renderYouTube } from '../lib/youtube-ui.mjs';
import { publicYouTubeCatalog } from '../lib/youtube-contract.mjs';

test(
  'Shared sidebar exposes YouTube from Video Studio and marks the YouTube workspace active',
  { skip: process.env.RUN_VIDEO_BROWSER_TESTS !== '1', timeout: 30000 },
  async t => {
    const { chromium } = await import('../runner/node_modules/playwright/index.mjs');
    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    page.setDefaultTimeout(2000);
    const script = await fs.readFile(new URL('../public/ops-workspace.js', import.meta.url), 'utf8');
    await page.route('https://siteops.test/**', route =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<body class="ops-mode"><nav class="topnav"><a href="/youtube">YouTube</a></nav><main>Workspace</main></body>'
      })
    );
    await page.goto('https://siteops.test/video-studio');
    await page.addScriptTag({ content: script });
    const link = page
      .getByRole('navigation', { name: 'SiteOps-Navigation' })
      .getByRole('link', { name: 'YouTube', exact: true });
    assert.equal(await link.getAttribute('href'), '/youtube');
    assert.equal(await link.getAttribute('aria-current'), null);
    await link.click();
    await page.addScriptTag({ content: script });
    assert.equal(await link.getAttribute('aria-current'), 'page');
    assert.equal(await page.locator('.ops-workspace-bar strong').textContent(), 'YouTube');
    assert.equal(await page.locator('.ops-side-links [aria-current="page"]').count(), 1);
  }
);

test(
  'YouTube UI edits videos, blocks automatic execution, handles errors and works on mobile',
  { skip: process.env.RUN_VIDEO_BROWSER_TESTS !== '1', timeout: 30000 },
  async t => {
    const { chromium } = await import('../runner/node_modules/playwright/index.mjs');
    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const context = await browser.newContext({ viewport: { width: 1300, height: 1000 } });
    t.after(() => context.close());
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.setDefaultNavigationTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let previews = 0,
      executions = 0,
      lastRequest,
      quota = false;
    const accountId = '11111111-1111-4111-8111-111111111111';
    await context.route('https://siteops.test/**', async route => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.pathname === '/youtube')
        return route.fulfill({
          contentType: 'text/html; charset=utf-8',
          body: '<meta charset="utf-8">' + renderYouTube()
        });
      if (url.pathname === '/assets/youtube.js')
        return route.fulfill({
          contentType: 'text/javascript',
          body: await fs.readFile(new URL('../public/youtube.js', import.meta.url), 'utf8')
        });
      if (url.pathname === '/assets/youtube.css')
        return route.fulfill({
          contentType: 'text/css',
          body: await fs.readFile(new URL('../public/youtube.css', import.meta.url), 'utf8')
        });
      if (url.pathname.endsWith('/status'))
        return route.fulfill({
          json: {
            configured: true,
            client_id: 'test-id',
            redirect_uri: 'https://siteops.test/api/youtube/oauth/callback',
            accounts: [{ id: accountId, channel_id: 'UCowned', title: 'A real test channel' }]
          }
        });
      if (url.pathname.endsWith('/catalog'))
        return route.fulfill({ json: publicYouTubeCatalog(Object.fromEntries(url.searchParams)) });
      if (url.pathname.endsWith('/read')) {
        const x = request.postDataJSON();
        if (quota) return route.fulfill({ status: 429, json: { message: 'YouTube-Kontingent erreicht.' } });
        const items =
          x.action === 'channels.list'
            ? [
                {
                  id: 'UCowned',
                  etag: 'channel-etag',
                  snippet: { title: 'A real test channel' },
                  statistics: { videoCount: '1' },
                  brandingSettings: { channel: { title: 'A real test channel' } },
                  contentDetails: { relatedPlaylists: { uploads: 'UUowned' } }
                }
              ]
            : x.action === 'playlistItems.list'
              ? [
                  {
                    id: 'playlist-item',
                    snippet: { title: 'An existing video' },
                    contentDetails: { videoId: 'existing001' }
                  }
                ]
              : x.action === 'videos.list'
                ? [
                    {
                      id: 'existing001',
                      etag: 'video-etag',
                      snippet: {
                        title: 'An existing video',
                        description: 'Keep this text',
                        categoryId: '28',
                        tags: ['Bagisto'],
                        defaultLanguage: 'de'
                      },
                      status: { privacyStatus: 'private', embeddable: true, license: 'youtube' }
                    }
                  ]
                : [];
        return route.fulfill({ json: { items } });
      }
      if (url.pathname.endsWith('/previews')) {
        previews++;
        lastRequest = request.postDataJSON();
        return route.fulfill({
          json: {
            preview_token: 'x'.repeat(43),
            warning: 'Prüfe diese konkrete Änderung.',
            action: lastRequest.action,
            body: lastRequest.body
          }
        });
      }
      if (url.pathname.endsWith('/execute')) {
        executions++;
        assert.equal(request.postDataJSON().approved, true);
        return route.fulfill({ json: { status: 'done', result: { id: 'existing001' } } });
      }
      return route.fulfill({ json: [] });
    });
    await page.goto('https://siteops.test/youtube');
    await page.waitForFunction(() =>
      document.getElementById('yt-channel-summary').textContent.includes('A real test channel')
    );
    await page.locator('[data-tab="videos"]').click();
    await page.locator('#yt-load-videos').click();
    await page.getByRole('button', { name: 'An existing video · existing001' }).click();
    await page.locator('#yt-video-title').fill('Geprüfter neuer Videotitel');
    await page.getByRole('button', { name: 'Videoänderung prüfen', exact: true }).click();
    await page.locator('#yt-review-content').waitFor({ state: 'visible' });
    assert.equal(previews, 1);
    assert.equal(executions, 0, 'preview must never execute automatically');
    assert.equal(lastRequest.body.snippet.description, 'Keep this text');
    assert.equal(lastRequest.body.status.embeddable, true);
    assert.equal(lastRequest.etag, 'video-etag');
    await page.locator('#yt-execute').click();
    await page.waitForFunction(() =>
      document.getElementById('yt-review-result').textContent.includes('Änderung bestätigt')
    );
    assert.equal(executions, 1);
    quota = true;
    await page.locator('#yt-load-videos').click();
    await page.waitForFunction(() => document.getElementById('yt-message').textContent.includes('Kontingent'));
    quota = false;
    await page.locator('[data-tab="advanced"]').click();
    await page.locator('#yt-resource').selectOption('liveBroadcasts');
    await page.waitForFunction(() => document.getElementById('yt-operation').options.length > 1);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      true
    );
    assert.deepEqual(errors, []);
  }
);
