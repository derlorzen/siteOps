/* global document, getComputedStyle, innerWidth */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderYouTube } from '../lib/youtube-ui.mjs';
import { publicYouTubeCatalog } from '../lib/youtube-contract.mjs';
import { renderWorkspaceShell } from '../lib/workspace-shell.mjs';

test('YouTube CSS and JavaScript share the deployment version to invalidate old browser assets', () => {
  const html = renderYouTube('build-123');
  assert.match(html, /href="\/assets\/youtube\.css\?v=build-123"/);
  assert.match(html, /src="\/assets\/youtube\.js\?v=build-123"/);
  assert.match(html, /href="\/assets\/analytics\.css\?v=build-123"/);
  assert.match(html, /src="\/assets\/analytics\.js\?v=build-123"/);
});

test(
  'Shared sidebar exposes YouTube from Video Studio and marks the YouTube workspace active',
  { skip: process.env.RUN_VIDEO_BROWSER_TESTS !== '1', timeout: 30000 },
  async t => {
    const { chromium } = await import('../runner/node_modules/playwright/index.mjs');
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.SUITE_CHROMIUM_EXECUTABLE || undefined
    });
    t.after(() => browser.close());
    const page = await browser.newPage();
    page.setDefaultTimeout(2000);
    const script = await fs.readFile(new URL('../public/ops-workspace.js', import.meta.url), 'utf8');
    await page.route('https://siteops.test/**', route =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body:
          '<body class="ops-mode siteops-workspace">' +
          renderWorkspaceShell('<h1>Workspace</h1>', 'Workspace') +
          '</body>'
      })
    );
    await page.goto('https://siteops.test/video-studio');
    await page.addScriptTag({ content: script });
    const link = page.getByRole('navigation', { name: 'SiteOps-Navigation' }).locator('a[href="/youtube"]');
    assert.equal(await link.getAttribute('href'), '/youtube');
    assert.equal(await link.getAttribute('aria-current'), null);
    await page
      .getByRole('navigation', { name: 'SiteOps-Navigation' })
      .getByText('Integrationen', { exact: true })
      .click();
    await link.click();
    await page.addScriptTag({ content: script });
    assert.equal(await link.getAttribute('aria-current'), 'page');
    assert.equal(await page.locator('.ops-workspace-bar strong').textContent(), 'Integrationen / YouTube & Kanäle');
    assert.equal(await page.locator('.ops-side-links [aria-current="page"]').count(), 1);
  }
);

test(
  'YouTube UI edits videos, blocks automatic execution, handles errors and works on mobile',
  { skip: process.env.RUN_VIDEO_BROWSER_TESTS !== '1', timeout: 30000 },
  async t => {
    const { chromium } = await import('../runner/node_modules/playwright/index.mjs');
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.SUITE_CHROMIUM_EXECUTABLE || undefined
    });
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
          body:
            '<meta charset="utf-8"><link rel="stylesheet" href="/assets/app.css"><link rel="stylesheet" href="/assets/ops-workspace.css"><link rel="stylesheet" href="/assets/siteops-theme.css"><link rel="stylesheet" href="/assets/workspace-shell.css"><body class="ops-mode siteops-workspace"><main class="ops-main">' +
            renderYouTube() +
            '</main></body>'
        });
      if (['/assets/youtube.js', '/assets/analytics.js'].includes(url.pathname))
        return route.fulfill({
          contentType: 'text/javascript',
          body: await fs.readFile(new URL('../public/' + url.pathname.split('/').pop(), import.meta.url), 'utf8')
        });
      if (url.pathname === '/assets/youtube.css')
        return route.fulfill({
          contentType: 'text/css',
          body: await fs.readFile(new URL('../public/youtube.css', import.meta.url), 'utf8')
        });
      if (
        [
          '/assets/analytics.css',
          '/assets/app.css',
          '/assets/ops-workspace.css',
          '/assets/siteops-theme.css',
          '/assets/workspace-shell.css'
        ].includes(url.pathname)
      )
        return route.fulfill({
          contentType: 'text/css',
          body: await fs.readFile(new URL('../public/' + url.pathname.split('/').pop(), import.meta.url), 'utf8')
        });
      if (url.pathname.endsWith('/status'))
        return route.fulfill({
          json: {
            configured: true,
            client_id: 'test-id',
            redirect_uri: 'https://siteops.test/api/youtube/oauth/callback',
            accounts: [
              { id: accountId, channel_id: 'UCowned', title: 'A real test channel' },
              { id: '22222222-2222-4222-8222-222222222222', channel_id: 'UCother', title: 'Other channel' }
            ]
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
                  id: x.account_id === accountId ? 'UCowned' : 'UCother',
                  etag: 'channel-etag',
                  snippet: { title: 'A real test channel' },
                  statistics: { videoCount: '1' },
                  brandingSettings: { channel: { title: 'A real test channel' } },
                  contentDetails: { relatedPlaylists: { uploads: x.account_id === accountId ? 'UUowned' : 'UUother' } }
                }
              ]
            : x.action === 'playlistItems.list'
              ? x.account_id !== accountId
                ? []
                : [
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
                        defaultLanguage: 'de',
                        thumbnails: { high: { url: 'https://i.ytimg.com/vi/existing001/hqdefault.jpg' } }
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
    await context.route('https://i.ytimg.com/**', route =>
      route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
          'base64'
        )
      })
    );
    await context.route('https://www.youtube-nocookie.com/**', route =>
      route.fulfill({ contentType: 'text/html', body: '<p>Embedded YouTube player fixture</p>' })
    );
    await page.goto('https://siteops.test/youtube');
    await page.waitForFunction(() =>
      document.getElementById('yt-channel-summary').textContent.includes('A real test channel')
    );
    assert.equal(await page.locator('[data-tab="videos"]').getAttribute('aria-current'), 'page');
    const card = page.getByRole('button', { name: 'An existing video', exact: true });
    await card.waitFor({ state: 'visible' });
    assert.match(await card.locator('img').getAttribute('src'), /^https:\/\/i.ytimg.com\//);
    await page.locator('#yt-video-search').fill('nothing matches');
    assert.equal(await card.count(), 0);
    await page.locator('#yt-video-search').fill('');
    await card.click();
    await page.locator('#yt-video-editor').waitFor({ state: 'visible' });
    assert.equal(await card.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#yt-player iframe').count(), 0, 'player only loads on user action');
    const cardStyle = await card.evaluate(el => ({
      color: getComputedStyle(el).color,
      background: getComputedStyle(el).backgroundColor
    }));
    assert.notEqual(
      cardStyle.color,
      'rgb(255, 255, 255)',
      'shared theme must not turn video cards into white text buttons'
    );
    await fs.mkdir(new URL('../.test-runtime/', import.meta.url), { recursive: true });
    await page.screenshot({
      path: fileURLToPath(new URL('../.test-runtime/youtube-workspace-desktop.png', import.meta.url)),
      fullPage: true
    });
    await page.getByRole('button', { name: 'Video abspielen: An existing video', exact: true }).click();
    assert.equal(
      await page.locator('#yt-player iframe').getAttribute('src'),
      'https://www.youtube-nocookie.com/embed/existing001?autoplay=1&playsinline=1&rel=0'
    );
    assert.equal(
      await page.locator('#yt-player iframe').getAttribute('referrerpolicy'),
      'strict-origin-when-cross-origin'
    );
    assert.match(await page.locator('#yt-player-note').textContent(), /Privates Video/);
    await page.locator('#yt-edit-assets').click();
    assert.equal(await page.locator('#yt-player iframe').count(), 0, 'leaving videos stops playback');
    assert.equal(await page.locator('#yt-current-thumbnail').isVisible(), true);
    await page.locator('#yt-thumbnail').setInputFiles({
      name: 'thumbnail.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
        'base64'
      )
    });
    assert.equal(await page.locator('#yt-new-thumbnail').isVisible(), true);
    assert.equal(previews, 0, 'local thumbnail preview must not upload anything');
    await page.locator('[data-tab="videos"]').click();
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
    await page.locator('[data-tab="videos"]').click();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      true,
      JSON.stringify(
        await page.evaluate(() =>
          [...document.querySelectorAll('main *')]
            .filter(el => el.getBoundingClientRect().right > innerWidth + 1 && el.getBoundingClientRect().width > 0)
            .slice(0, 10)
            .map(el => ({ tag: el.tagName, id: el.id, class: el.className, width: el.getBoundingClientRect().width }))
        )
      )
    );
    await page.locator('#yt-account').selectOption('22222222-2222-4222-8222-222222222222');
    await page.waitForFunction(() =>
      document.getElementById('yt-video-list-status').textContent.includes('Noch keine Videos')
    );
    assert.equal(await page.locator('#yt-video-editor').isVisible(), false);
    assert.equal(await page.locator('#yt-player iframe').count(), 0);
    assert.equal(await page.locator('#yt-new-thumbnail-box').isVisible(), false);
    assert.deepEqual(errors, []);
  }
);
