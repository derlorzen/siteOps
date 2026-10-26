/* global document, location, innerWidth */
import test from 'node:test';
import * as fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

test(
  'Video Suite: agent adoption, scene editing, draft reload and responsive navigation',
  { skip: process.env.RUN_SUITE_BROWSER_TESTS !== '1', timeout: 60000 },
  async t => {
    const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
    const { chromium } = await import('../runner/node_modules/playwright/index.mjs');
    const { renderVideoStudio } = await import(root + '/lib/video-studio-ui.mjs');
    const { renderYouTube } = await import(root + '/lib/youtube-ui.mjs');
    const browser = await chromium.launch({
      executablePath: process.env.SUITE_CHROMIUM_EXECUTABLE || undefined,
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    let draft = null,
      conversations = [];
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const project = '11111111-1111-4111-8111-111111111111';
    const proposal = {
      reply: 'Here is your tutorial plan.',
      draft: {
        title: 'Manage your store',
        script: 'Start with a concrete store problem. Here is how to solve it.',
        scenes: [
          { headline: 'The problem', narration: 'Start with a concrete store problem. Here is how to solve it.' }
        ],
        youtube: {
          title: 'Manage your store',
          description: 'A verified tutorial.',
          keywords: ['Bagisto'],
          hashtags: ['#Bagisto'],
          chapters: [{ start_seconds: 0, title: 'The problem' }],
          thumbnail_concept: 'Original navy illustration',
          sources: []
        }
      },
      thumbnail_prompt: 'Navy and orange original illustration.',
      social_posts: []
    };
    await page.route('https://suite.test/**', async route => {
      const req = route.request(),
        url = new URL(req.url());
      if (url.pathname.startsWith('/assets/')) {
        try {
          return route.fulfill({
            body: await fs.readFile(root + '/public/' + url.pathname.slice(8)),
            contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript'
          });
        } catch {
          return route.fulfill({ body: '' });
        }
      }
      if (url.pathname === '/video-suite' || url.pathname === '/video-studio' || url.pathname === '/youtube')
        return route.fulfill({
          contentType: 'text/html',
          body:
            '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/app.css"><link rel="stylesheet" href="/assets/ops-workspace.css"><body class="ops-mode"><main>' +
            (url.pathname === '/youtube' ? renderYouTube() : renderVideoStudio()) +
            '</main><script src="/assets/ops-workspace.js"></script></body>'
        });
      let body = [];
      if (url.pathname === '/api/video-studio/projects')
        body = [
          {
            id: project,
            name: 'Bagisto Tutorials',
            channel: 'Lorzen',
            language: 'en',
            voice_provider: 'kokoro',
            voice: 'am_adam'
          }
        ];
      else if (url.pathname === '/api/video-studio/jobs')
        body = [
          {
            id: project,
            project_id: project,
            title: 'Manage Bagisto with ChatGPT',
            status: 'done',
            created_at: new Date().toISOString()
          }
        ];
      else if (url.pathname.endsWith('/demo-policy'))
        body = { supported: true, source: 'environment', environmentPolicy: { hosts: [] } };
      else if (url.pathname.endsWith('/capabilities')) body = { offlineModels: { kokoro: true, piper: true } };
      else if (url.pathname === '/api/video-suite/settings')
        body = { configured: true, model: 'gpt-4.1', image_model: 'gpt-image-1' };
      else if (url.pathname.startsWith('/api/video-suite/drafts/')) {
        if (req.method() === 'POST') {
          draft = req.postDataJSON();
          body = { saved: true };
        } else body = draft;
      } else if (url.pathname === '/api/video-suite/conversations') body = conversations;
      else if (url.pathname === '/api/video-suite/chat') {
        conversations = [{ id: project, title: 'Plan a video' }];
        body = { ...proposal, conversation_id: project };
      } else if (url.pathname === '/api/youtube/status')
        body = { configured: false, accounts: [], redirect_uri: 'https://suite.test/api/youtube/oauth/callback' };
      else if (url.pathname === '/api/youtube/catalog') body = { operations: [] };
      return route.fulfill({ json: body });
    });
    await page.goto('https://suite.test/video-suite');
    await page.waitForFunction(() => document.querySelector('#suite-draft-state').textContent === 'Neuer Entwurf');

    await page.locator('[data-suite-nav=agent]').click();
    await page.locator('#suite-prompt').fill('Plan a video');
    await page.locator('#suite-send').click();
    await page.waitForTimeout(500);
    await page.getByText('Vorschlag ansehen & übernehmen').click();
    await page.getByText('In aktuellen Entwurf übernehmen', { exact: true }).click();
    await page.waitForFunction(() => location.hash === '#script');
    if ((await page.locator('#suite-scene-list .suite-scene-card').count()) !== 1) throw Error('Scene adoption failed');
    await page.locator('#suite-add-scene').click();
    const last = page.locator('#suite-scene-list .suite-scene-card').last();
    await last.locator('textarea').first().fill('A second narration scene for our tutorial.');
    await page.waitForFunction(
      () => document.querySelector('#suite-draft-state').textContent === 'Entwurf online gespeichert'
    );
    await page.reload();
    await page.waitForFunction(
      () => document.querySelector('#suite-draft-state').textContent === 'Entwurf online geladen'
    );
    if ((await page.locator('#suite-scene-list .suite-scene-card').count()) !== 2) throw Error('Draft reload failed');
    await page.locator('[data-suite-nav=agent]').click();
    await page.setViewportSize({ width: 390, height: 844 });
    for (const pane of ['overview', 'agent', 'script', 'assets', 'production', 'settings']) {
      await page.goto('https://suite.test/video-suite#' + pane);
      await page.waitForTimeout(150);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      if (overflow) throw Error('Mobile horizontal overflow: ' + pane);
    }
    await page.goto('https://suite.test/video-suite#overview');
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.goto('https://suite.test/youtube');
    if (errors.length) throw Error(errors.join('\n'));
  }
);
