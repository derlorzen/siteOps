import Fastify from 'fastify';
import crypto from 'node:crypto';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { chromium } from 'playwright';

const app = Fastify({ logger: true, bodyLimit: 20 * 1024 * 1024 });
const port = Number(process.env.PORT || 3200),
  host = process.env.HOST || '0.0.0.0',
  token = process.env.BROWSER_RUNNER_TOKEN || '';
const safeEqual = (a, b) => {
  const aa = Buffer.from(String(a ?? '')),
    bb = Buffer.from(String(b ?? ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
};
function auth(req, reply) {
  const h = req.headers.authorization || '',
    t = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) {
    reply.code(503).send({ error: 'BROWSER_RUNNER_TOKEN is not configured' });
    return false;
  }
  if (!safeEqual(t, token)) {
    reply.code(401).send({ error: 'unauthorized' });
    return false;
  }
  return true;
}
const hostKey = value =>
  String(value || '')
    .toLowerCase()
    .replace(/^www\./, '');
function sameHost(value, base) {
  const u = new URL(value, base),
    b = new URL(base);
  if (!['http:', 'https:'].includes(u.protocol) || hostKey(u.hostname) !== hostKey(b.hostname))
    throw new Error('Navigation outside target hostname rejected: ' + u.hostname);
  return u.toString();
}
function resolveSelector(page, selector) {
  if (!selector) throw new Error('selector is required');
  return page.locator(selector).first();
}
async function executeStep(page, step, baseUrl) {
  const started = Date.now(),
    action = String(step.action || '');
  if (action === 'goto')
    await page.goto(sameHost(step.url || baseUrl, baseUrl), { waitUntil: step.waitUntil || 'domcontentloaded' });
  else if (action === 'click') await resolveSelector(page, step.selector).click();
  else if (action === 'fill') await resolveSelector(page, step.selector).fill(String(step.value ?? ''));
  else if (action === 'press') await resolveSelector(page, step.selector).press(String(step.key || 'Enter'));
  else if (action === 'select') await resolveSelector(page, step.selector).selectOption(step.value);
  else if (action === 'check') await resolveSelector(page, step.selector).check();
  else if (action === 'uncheck') await resolveSelector(page, step.selector).uncheck();
  else if (action === 'hover') await resolveSelector(page, step.selector).hover();
  else if (action === 'reload') await page.reload({ waitUntil: step.waitUntil || 'domcontentloaded' });
  else if (action === 'waitForLoadState') await page.waitForLoadState(step.state || 'networkidle');
  else if (action === 'waitFor') await resolveSelector(page, step.selector).waitFor({ state: step.state || 'visible' });
  else if (action === 'wait') await page.waitForTimeout(Math.min(10000, Math.max(0, Number(step.ms || 500))));
  else if (action === 'assertText') {
    const text = await resolveSelector(page, step.selector).innerText();
    if (!text.includes(String(step.text ?? ''))) throw new Error('Expected text not found in ' + step.selector);
  } else if (action === 'assertVisible') {
    if (!(await resolveSelector(page, step.selector).isVisible()))
      throw new Error('Expected element is not visible: ' + step.selector);
  } else if (action === 'assertValue') {
    const actual = await resolveSelector(page, step.selector).inputValue();
    if (actual !== String(step.value ?? ''))
      throw new Error(
        'Value assertion failed for ' + step.selector + '. Expected ' + String(step.value ?? '') + ', got ' + actual
      );
  } else if (action === 'assertAttribute') {
    const actual = await resolveSelector(page, step.selector).getAttribute(String(step.name || ''));
    if (actual !== String(step.value ?? ''))
      throw new Error('Attribute assertion failed for ' + step.selector + '[' + step.name + ']');
  } else if (action === 'assertCount') {
    const actual = await page.locator(step.selector).count(),
      expected = Number(step.count);
    if (actual !== expected)
      throw new Error('Count assertion failed for ' + step.selector + '. Expected ' + expected + ', got ' + actual);
  } else if (action === 'assertUrl') {
    const actual = page.url(),
      expected = String(step.contains || step.url || '');
    if (!actual.includes(expected))
      throw new Error('URL assertion failed. Expected to contain ' + expected + ', got ' + actual);
  } else if (action === 'assertTitle') {
    const actual = await page.title(),
      expected = String(step.contains || step.title || '');
    if (!actual.includes(expected))
      throw new Error('Title assertion failed. Expected to contain ' + expected + ', got ' + actual);
  } else throw new Error('Unsupported action: ' + action);
  return { action, selector: step.selector || null, durationMs: Date.now() - started, ok: true };
}
function comparePng(current, baseline) {
  const a = PNG.sync.read(current),
    b = PNG.sync.read(baseline);
  if (a.width !== b.width || a.height !== b.height)
    return { mismatch: 1, width: a.width, height: a.height, dimensionMismatch: true };
  const diff = new PNG({ width: a.width, height: a.height });
  const pixels = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.12, includeAA: false });
  return {
    mismatch: pixels / (a.width * a.height),
    pixels,
    width: a.width,
    height: a.height,
    dimensionMismatch: false
  };
}
app.get('/health', async () => ({ status: 'ok', service: 'siteops-browser-runner', version: '1.0.0' }));
app.get('/auth-test', async (req, reply) => {
  if (!auth(req, reply)) return;
  return { ok: true, version: '1.0.0' };
});
app.post('/run', async (req, reply) => {
  if (!auth(req, reply)) return;
  const body = req.body || {},
    baseUrl = String(body.baseUrl || '');
  if (!baseUrl) throw new Error('baseUrl is required');
  const timeoutMs = Math.min(120000, Math.max(3000, Number(body.timeoutMs || 30000)));
  const viewport = {
    width: Math.min(2560, Math.max(320, Number(body.viewport?.width || 1440))),
    height: Math.min(2000, Math.max(320, Number(body.viewport?.height || 1000)))
  };
  const consoleErrors = [],
    pageErrors = [],
    failedRequests = [],
    httpErrors = [],
    stepResults = [],
    started = Date.now();
  let browser = null,
    page = null,
    error = null,
    screenshot = null,
    visual = null,
    lastUrl = null;
  try {
    browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
    const context = await browser.newContext({
      viewportSize: viewport,
      ignoreHTTPSErrors: false,
      reducedMotion: 'reduce',
      colorScheme: 'light'
    });
    page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    const baseHost = hostKey(new URL(baseUrl).hostname);
    await context.route('**/*', async route => {
      const req = route.request();
      if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
        try {
          const h = hostKey(new URL(req.url()).hostname);
          if (h !== baseHost) return route.abort('blockedbyclient');
        } catch {
          return route.abort('blockedbyclient');
        }
      }
      return route.continue();
    });
    page.on('console', m => {
      if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 1000));
    });
    page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 1000)));
    page.on('requestfailed', r => failedRequests.push({ url: r.url(), error: r.failure()?.errorText || 'failed' }));
    page.on('response', r => {
      if (r.status() >= 400) httpErrors.push({ url: r.url(), status: r.status(), statusText: r.statusText() });
    });
    await page.goto(sameHost(body.startUrl || baseUrl, baseUrl), { waitUntil: 'domcontentloaded' });
    sameHost(page.url(), baseUrl);
    for (let i = 0; i < (Array.isArray(body.steps) ? body.steps : []).length; i++) {
      const step = body.steps[i];
      try {
        stepResults.push({ index: i, ...(await executeStep(page, step, baseUrl)) });
        sameHost(page.url(), baseUrl);
      } catch (e) {
        stepResults.push({
          index: i,
          action: step.action,
          selector: step.selector || null,
          ok: false,
          error: String(e.message || e),
          durationMs: 0
        });
        throw new Error('Step ' + (i + 1) + ' (' + step.action + ') failed: ' + String(e.message || e));
      }
    }
    await page.waitForTimeout(250);
    screenshot = await page.screenshot({ type: 'png', fullPage: Boolean(body.fullPage), animations: 'disabled' });
    if (body.baselineBase64) {
      try {
        visual = comparePng(screenshot, Buffer.from(body.baselineBase64, 'base64'));
      } catch (e) {
        visual = { mismatch: 1, error: 'Baseline comparison failed: ' + String(e.message || e) };
      }
    }
    const threshold = Math.max(0, Math.min(1, Number(body.visualThreshold ?? 0.01)));
    if (body.visualAssert && visual && visual.mismatch > threshold)
      throw new Error(
        'Visual regression ' + (visual.mismatch * 100).toFixed(2) + '% exceeds ' + (threshold * 100).toFixed(2) + '%'
      );
  } catch (e) {
    error = String(e.message || e);
    if (page && !screenshot) {
      try {
        screenshot = await page.screenshot({ type: 'png', fullPage: Boolean(body.fullPage), animations: 'disabled' });
      } catch {}
    }
  } finally {
    if (page) {
      try {
        lastUrl = page.url();
      } catch {}
    }
    if (browser) await browser.close().catch(() => {});
  }
  const ok = !error;
  return {
    ok,
    error,
    durationMs: Date.now() - started,
    finalUrl: lastUrl,
    steps: stepResults,
    consoleErrors: consoleErrors.slice(0, 50),
    pageErrors: pageErrors.slice(0, 50),
    failedRequests: failedRequests.slice(0, 100),
    httpErrors: httpErrors.slice(0, 100),
    visual,
    screenshotHash: screenshot ? crypto.createHash('sha256').update(screenshot).digest('hex') : null,
    screenshotBase64: screenshot && (body.captureScreenshot || !ok) ? screenshot.toString('base64') : null
  };
});
await app.listen({ host, port });
