import { promises as fs } from 'node:fs';
import path from 'node:path';

const ACTIONS = new Set(['click', 'hover', 'fill', 'press', 'scroll', 'wait', 'goto']);
const KEYS = new Set(['Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp']);
const limitText = (value, maximum) => typeof value === 'string' && value.length > 0 && value.length <= maximum;
const allowedHosts = hosts => new Set(hosts.map(host => host.trim().toLowerCase()).filter(Boolean));

export function validatedDemoUrl(value, hosts) {
  const url = new URL(value);
  const allowed = allowedHosts(hosts);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    !allowed.has(url.hostname.toLowerCase())
  )
    throw new Error('Only explicitly allowed HTTPS demo URLs are supported.');
  return url.toString();
}

export function validatedDemoSteps(steps, baseUrl, hosts) {
  if (!Array.isArray(steps) || steps.length > 16)
    throw new Error('Demo requires at most 16 explicitly listed actions.');
  if (steps.length && !baseUrl) throw new Error('Demo steps require demoUrl.');
  if (baseUrl) validatedDemoUrl(baseUrl, hosts);
  return steps.map((step, i) => {
    if (!step || typeof step !== 'object' || !ACTIONS.has(step.action))
      throw new Error('Unsupported demo action at step ' + (i + 1));
    const action = step.action;
    if (['click', 'hover', 'fill', 'press'].includes(action) && !limitText(step.selector, 240))
      throw new Error('A bounded selector is required for ' + action);
    if (action === 'fill' && typeof step.value !== 'string')
      throw new Error('fill requires a text value');
    if (action === 'fill' && step.value.length > 160)
      throw new Error('fill value too long');
    if (action === 'press' && !KEYS.has(step.key))
      throw new Error('Unsupported keyboard key');
    if (action === 'goto')
      return { action, url: validatedDemoUrl(step.url, hosts) };
    if (action === 'scroll') {
      const pixels = Number(step.pixels);
      if (!Number.isInteger(pixels) || Math.abs(pixels) > 1400)
        throw new Error('Scroll must be between -1400 and 1400 pixels.');
      return { action, pixels };
    }
    if (action === 'wait') {
      const ms = Number(step.ms);
      if (!Number.isInteger(ms) || ms < 100 || ms > 4000)
        throw new Error('Wait must be between 100 and 4000 milliseconds.');
      return { action, ms };
    }
    if (action === 'fill') return { action, selector: step.selector, value: step.value };
    if (action === 'press') return { action, selector: step.selector, key: step.key };
    return { action, selector: step.selector };
  });
}

export async function executeDemoStep(page, step) {
  if (step.action === 'goto') await page.goto(step.url, { waitUntil: 'domcontentloaded', timeout: 25000 });
  else if (step.action === 'click') await page.locator(step.selector).first().click({ timeout: 12000 });
  else if (step.action === 'hover') await page.locator(step.selector).first().hover({ timeout: 12000 });
  else if (step.action === 'fill') {
    const input = page.locator(step.selector).first();
    if ((await input.getAttribute('type'))?.toLowerCase() === 'password')
      throw new Error('Password inputs cannot be recorded.');
    await input.fill(step.value, { timeout: 12000 });
  } else if (step.action === 'press') await page.locator(step.selector).first().press(step.key, { timeout: 12000 });
  else if (step.action === 'scroll') await page.mouse.wheel(0, step.pixels);
  else if (step.action === 'wait') await page.waitForTimeout(step.ms);
}

export async function recordDemoScene(browser, scene, filename, { width, height }, hosts, imagePath) {
  const url = validatedDemoUrl(scene.demoUrl, hosts);
  const steps = validatedDemoSteps(scene.demoSteps || [], url, hosts);
  const tmpDir = path.join(path.dirname(filename), 'recording-' + path.basename(filename));
  await fs.mkdir(tmpDir, { recursive: true });
  const context = await browser.newContext({
    viewport: { width, height },
    recordVideo: { dir: tmpDir, size: { width, height } },
    ignoreHTTPSErrors: false,
    reducedMotion: 'reduce',
    colorScheme: 'light'
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const allowed = allowedHosts(hosts);
  await context.route('**/*', route => {
    try {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.protocol !== 'https:' || !allowed.has(requestUrl.hostname.toLowerCase()))
        return route.abort('blockedbyclient');
      return route.continue();
    } catch {
      return route.abort('blockedbyclient');
    }
  });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(700);
    for (const step of steps) {
      await executeDemoStep(page, step);
      if (!allowed.has(new URL(page.url()).hostname.toLowerCase()))
        throw new Error('Navigation outside approved demo host.');
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(700);
    await page.screenshot({ path: imagePath, type: 'png', animations: 'disabled' });
    const video = page.video();
    await context.close();
    await fs.copyFile(await video.path(), filename);
    return filename;
  } finally {
    await context.close().catch(() => {});
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
