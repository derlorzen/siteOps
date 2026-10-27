/* global document, location, innerWidth */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { renderVideoStudio } from '../lib/video-studio-ui.mjs';
test(
  'guided workflow keeps the rendered video, metadata and thumbnail together through review and private upload',
  { skip: process.env.RUN_SUITE_BROWSER_TESTS !== '1', timeout: 60000 },
  async t => {
    const { chromium } = await import('../runner/node_modules/playwright/index.mjs');
    const browser = await chromium.launch({
      executablePath: process.env.SUITE_CHROMIUM_EXECUTABLE,
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-zygote',
        '--single-process',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader'
      ],
      headless: true
    });
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } }),
      id = '11111111-1111-4111-8111-111111111111';
    const meta = {
      title: 'Original title',
      description: 'A complete description.',
      keywords: ['Bagisto'],
      hashtags: ['#Bagisto'],
      chapters: [{ start_seconds: 0, title: 'Introduction' }],
      thumbnail_concept: 'An authentic screenshot of the product.',
      sources: []
    };
    const job = {
      id,
      project_id: id,
      title: 'My production',
      script: 'This is the actual narration from the completed video.',
      status: 'done',
      format: 'landscape',
      scenes: [{ headline: 'Demo', narration: 'A demonstration of the actual product.', capture_mode: 'recording' }],
      render_settings: { language: 'en' },
      youtube: meta,
      result: {
        resolution: { width: 1920, height: 1080 },
        files: ['video', 'short'],
        captures: [{ scene: 1, mode: 'recording', status: 'captured' }]
      }
    };
    let selectedImage,
      revision = 0,
      approved = false,
      uploads = [],
      savedDraft = null;
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const publication = () => ({
      job_id: id,
      project_id: id,
      youtube: job.youtube,
      resolution: job.result.resolution,
      captures: job.result.captures,
      has_thumbnail: !!selectedImage,
      thumbnail_url: selectedImage ? '/api/video-studio/jobs/' + id + '/publication/thumbnail?v=' + revision : null,
      description: job.youtube.description + '\n\n00:00 Introduction\n\n#Bagisto',
      status: 'done',
      ready: !!selectedImage
    });
    await page.route('https://workflow.test/**', async route => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.pathname.startsWith('/assets/'))
        return route.fulfill({
          body: await readFile(new URL('../public/' + url.pathname.slice(8), import.meta.url)).catch(() => ''),
          contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript'
        });
      if (url.pathname === '/video-suite')
        return route.fulfill({
          contentType: 'text/html',
          body:
            '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/app.css"><link rel="stylesheet" href="/assets/ops-workspace.css"><link rel="stylesheet" href="/assets/siteops-theme.css"><link rel="stylesheet" href="/assets/workspace-shell.css"><body class="ops-mode"><main>' +
            renderVideoStudio() +
            '</main><script src="/assets/ops-workspace.js"></script></body>'
        });
      if (url.pathname.endsWith('/publication/thumbnail'))
        return route.fulfill({ body: Buffer.from(selectedImage, 'base64'), contentType: 'image/jpeg' });
      let data = [];
      if (url.pathname === '/api/video-studio/projects')
        data = [
          { id, name: 'Tutorials', language: 'en', voice_provider: 'kokoro', voice: 'am_adam', channel: 'Lorzen' }
        ];
      else if (url.pathname === '/api/video-studio/jobs') data = [job];
      else if (url.pathname === '/api/video-studio/jobs/' + id) data = job;
      else if (url.pathname.endsWith('/publication')) {
        if (request.method() === 'POST') {
          const payload = request.postDataJSON();
          job.youtube = payload.youtube;
          if (payload.thumbnail) {
            selectedImage = payload.thumbnail;
            revision++;
          }
        }
        data = publication();
      } else if (url.pathname === '/api/youtube/status') data = { accounts: [{ id, title: 'Lorzen Software' }] };
      else if (url.pathname === '/api/youtube/uploads') data = uploads;
      else if (url.pathname === '/api/youtube/upload-preview')
        data = {
          preview_token: 'x'.repeat(43),
          channel: { title: 'Lorzen Software' },
          body: { title: job.youtube.title, has_thumbnail: !!selectedImage }
        };
      else if (url.pathname === '/api/youtube/execute') {
        approved = request.postDataJSON().approved;
        uploads = [{ video_job_id: id, kind: 'video', status: 'queued' }];
        data = { status: 'done' };
      } else if (url.pathname.includes('/drafts/')) {
        if (request.method() === 'POST') savedDraft = request.postDataJSON();
        data = savedDraft;
      } else if (url.pathname === '/api/video-suite/settings')
        data = { configured: false, model: 'gpt-4.1', image_model: 'gpt-image-1' };
      else if (url.pathname === '/api/video-suite/knowledge') data = { plugins: [] };
      else if (url.pathname.endsWith('/demo-policy'))
        data = { supported: true, source: 'environment', environmentPolicy: { hosts: [] } };
      else if (url.pathname.endsWith('/capabilities')) data = {};
      return route.fulfill({ json: data });
    });
    await page.goto('https://workflow.test/video-suite#assets');
    await page.getByLabel('Du arbeitest an dieser Produktion', { exact: true }).selectOption(id);
    await page.waitForFunction(() => document.querySelector('#suite-seo-title').value === 'Original title');
    await page.getByLabel('Veröffentlichungstitel', { exact: true }).fill('Reviewed production title');
    await page.getByLabel('Eigenes Titelbild oder Screenshot auswählen', { exact: true }).setInputFiles({
      name: 'real-screenshot.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6gS8AAAAASUVORK5CYII=',
        'base64'
      )
    });
    await page.waitForFunction(() =>
      document.querySelector('#suite-package-state').textContent.includes('Titelbild ausgewählt')
    );
    await page.getByRole('button', { name: 'Speichern & Gesamtvorschau öffnen →', exact: true }).click();
    await page.waitForFunction(
      () =>
        location.hash === '#review' &&
        document.querySelector('#suite-review-title').textContent === 'Reviewed production title'
    );
    assert.equal(job.youtube.title, 'Reviewed production title');
    assert.ok(selectedImage);
    assert.equal(approved, false);
    assert.match(await page.locator('#suite-review-description').textContent(), /#Bagisto/);
    assert.equal(
      await page.getByRole('button', { name: 'Alles geprüft · weiter zu YouTube →', exact: true }).isEnabled(),
      true
    );
    await mkdir('/tmp/siteops-qa/screenshots', { recursive: true });
    await page.screenshot({ path: '/tmp/siteops-qa/screenshots/video-review-desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'Alles geprüft · weiter zu YouTube →', exact: true }).click();
    await page.getByRole('button', { name: 'Upload mit diesen Angaben prüfen', exact: true }).click();
    await page.locator('#suite-upload-confirm').waitFor({ state: 'visible' });
    assert.equal(approved, false);
    assert.match(await page.locator('#suite-upload-confirm-title').textContent(), /Reviewed production title/);
    await page.getByRole('button', { name: 'Jetzt privat zu YouTube hochladen', exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('#suite-upload-list').textContent.includes('Upload wartet')
    );
    assert.equal(approved, true);
    for (const step of ['ideas', 'storyboard', 'editing', 'script', 'assets', 'review', 'publish', 'repurpose']) {
      await page.goto('https://workflow.test/video-suite#' + step);
      await page.waitForTimeout(100);
      if (['ideas', 'storyboard', 'editing'].includes(step))
        assert.equal(
          await page.locator('#suite-agent-mode').inputValue(),
          { ideas: 'strategy', storyboard: 'script', editing: 'edit' }[step]
        );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    for (const step of ['overview', 'ideas', 'script', 'assets', 'review', 'publish', 'repurpose']) {
      await page.goto('https://workflow.test/video-suite#' + step);
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, step);
    }
    await page.screenshot({ path: '/tmp/siteops-qa/screenshots/video-workflow-mobile.png', fullPage: true });
    assert.deepEqual(errors, []);
  }
);
