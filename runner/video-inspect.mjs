/* global document, getComputedStyle, innerHeight */
import { createDemoContext, executeDemoStep, validatedDemoSteps, validatedDemoUrl } from './video-demo.mjs';

// Read-only page inventory for planning screen recordings. It lists what is really on the page
// (visible controls with selectors that were verified against the live DOM), so that a planner
// never has to guess a selector or a URL. It records nothing and stores nothing.
const MAX_ELEMENTS = 90;

// Runs inside the page. Returns candidates; selectors are verified from Node afterwards.
/* c8 ignore start */
function collect(limit) {
  const clean = (value, max) =>
    String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);
  const quote = value => '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  const visible = node => {
    const box = node.getBoundingClientRect();
    if (box.width < 4 || box.height < 4) return false;
    const style = getComputedStyle(node);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05;
  };
  const roleOf = node => {
    const explicit = node.getAttribute('role');
    if (explicit) return explicit;
    const tag = node.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const type = (node.getAttribute('type') || 'text').toLowerCase();
      if (['button', 'submit', 'reset'].includes(type)) return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      return 'textbox';
    }
    return tag;
  };
  const nameOf = node =>
    clean(
      node.getAttribute('aria-label') ||
        node.innerText ||
        node.value ||
        node.getAttribute('title') ||
        node.getAttribute('placeholder') ||
        node.getAttribute('name') ||
        node.querySelector('img[alt]')?.getAttribute('alt'),
      80
    );
  const stable = value => /^[A-Za-z][\w-]{1,60}$/.test(value) && !/\d{4,}/.test(value);
  const nodes = document.querySelectorAll(
    'a[href],button,summary,select,textarea,input:not([type=hidden]):not([type=password]):not([type=file]),[role=button],[role=link],[role=tab],[role=menuitem]'
  );
  const elements = [];
  for (const node of nodes) {
    if (elements.length >= limit) break;
    if (!visible(node) || node.disabled || node.getAttribute('aria-disabled') === 'true') continue;
    const role = roleOf(node),
      name = nameOf(node),
      tag = node.tagName.toLowerCase();
    if (!name && !node.id) continue;
    const candidates = [];
    if (node.id && stable(node.id)) candidates.push('#' + node.id);
    for (const attribute of ['data-testid', 'data-test', 'name', 'aria-label'])
      if (node.getAttribute(attribute) && node.getAttribute(attribute).length <= 80)
        candidates.push(tag + '[' + attribute + '=' + quote(node.getAttribute(attribute)) + ']');
    const href = tag === 'a' ? node.getAttribute('href') : null;
    if (href && href.length <= 160 && !href.startsWith('javascript:') && href !== '#')
      candidates.push('a[href=' + quote(href) + ']');
    if (name && name.length <= 60 && ['button', 'link', 'tab', 'menuitem', 'checkbox', 'radio'].includes(role))
      candidates.push('role=' + role + '[name=' + quote(name) + ']');
    if (!candidates.length) continue;
    const box = node.getBoundingClientRect();
    elements.push({
      role,
      name,
      href: tag === 'a' && node.href && /^https:/.test(node.href) ? node.href.split('#')[0] : null,
      type: tag === 'input' ? (node.getAttribute('type') || 'text').toLowerCase() : null,
      submits: (tag === 'button' || tag === 'input') && (node.getAttribute('type') || '').toLowerCase() === 'submit',
      in_view: box.top >= 0 && box.bottom <= innerHeight,
      candidates
    });
  }
  return {
    title: clean(document.title, 160),
    headings: [...document.querySelectorAll('h1,h2,h3')]
      .filter(visible)
      .slice(0, 14)
      .map(node => clean(node.innerText, 120))
      .filter(Boolean),
    text: clean(document.querySelector('main')?.innerText || document.body.innerText, 1200),
    scroll_height: document.documentElement.scrollHeight,
    elements
  };
}
/* c8 ignore stop */

export async function inspectPage(page) {
  const raw = await page.evaluate(collect, MAX_ELEMENTS * 2);
  const elements = [];
  const used = new Set();
  for (const item of raw.elements) {
    if (elements.length >= MAX_ELEMENTS) break;
    let chosen = null;
    for (const selector of item.candidates) {
      const count = await page
        .locator(selector)
        .count()
        .catch(() => 0);
      // executeDemoStep uses .first(); only a unique match is guaranteed to hit this element.
      if (count === 1) {
        chosen = selector;
        break;
      }
    }
    if (!chosen || used.has(chosen) || chosen.length > 240) continue;
    used.add(chosen);
    elements.push({
      selector: chosen,
      role: item.role,
      name: item.name,
      href: item.href,
      type: item.type,
      submits: item.submits,
      in_view: item.in_view
    });
  }
  return {
    url: page.url(),
    title: raw.title,
    headings: raw.headings,
    text: raw.text,
    scroll_height: raw.scroll_height,
    elements
  };
}

export async function inspectDemoPage(browser, { url, steps = [] }, hosts, storageState, proxyFactory) {
  const start = validatedDemoUrl(url, hosts);
  const prefix = validatedDemoSteps(steps, start, hosts);
  let guarded;
  try {
    guarded = await createDemoContext(
      browser,
      {
        viewport: { width: 1920, height: 1080 },
        ...(storageState ? { storageState } : {}),
        reducedMotion: 'reduce',
        colorScheme: 'light'
      },
      hosts,
      proxyFactory
    );
    const page = await guarded.context.newPage();
    page.setDefaultTimeout(12000);
    const response = await page.goto(start, { waitUntil: 'domcontentloaded', timeout: 25000 });
    if (!response?.ok()) throw Error('Demo-Zielseite hat einen HTTP-Fehler geliefert.');
    const loginVisible = () => page.locator('input[type="password"]').first().isVisible();
    if (await loginVisible()) throw Error('Demo-Sitzung nicht gültig: Login-Seite statt Zielseite.');
    await page.waitForTimeout(700);
    let executed = 0;
    for (const [index, step] of prefix.entries()) {
      try {
        await executeDemoStep(page, step);
      } catch {
        throw Error(
          'Demo-Aktion ' + (index + 1) + ' (' + step.action + ') fehlgeschlagen. Selektor oder Zielzustand prüfen.'
        );
      }
      validatedDemoUrl(page.url().split('#')[0], hosts);
      if (await loginVisible()) throw Error('Demo-Sitzung abgelaufen.');
      executed += 1;
      await page.waitForTimeout(500);
    }
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
    return { ...(await inspectPage(page)), actions_executed: executed };
  } finally {
    await guarded?.close().catch(() => {});
  }
}
