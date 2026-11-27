// Browser-based SEO / quality audit for the SiteOps SEO suite.
//
// - Accessibility: axe-core (MPL-2.0, https://github.com/dequelabs/axe-core) through
//   @axe-core/playwright, on the rendered page.
// - Lighthouse (Apache-2.0, https://github.com/GoogleChrome/lighthouse) runs locally against the
//   same Chromium through its debugging port. No Google PageSpeed API key or quota is needed.
//
// One request audits one URL and uses one browser session from the shared capacity limit.
import net from 'node:net';
import { chromium } from 'playwright';
import { launchGuarded } from './browser-capacity.mjs';

export const SEO_AUDIT_VERSION = 1;
const LIGHTHOUSE_CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
const IMPACT_ORDER = ['minor', 'moderate', 'serious', 'critical'];

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

let lighthouseModule;
async function loadLighthouse() {
  if (lighthouseModule === undefined) {
    try {
      const [core, desktop] = await Promise.all([
        import('lighthouse'),
        import('lighthouse/core/config/desktop-config.js')
      ]);
      lighthouseModule = { run: core.default, desktopConfig: desktop.default };
    } catch {
      lighthouseModule = null;
    }
  }
  return lighthouseModule;
}
let axeModule;
async function loadAxe() {
  if (axeModule === undefined) {
    try {
      axeModule = (await import('@axe-core/playwright')).AxeBuilder;
    } catch {
      axeModule = null;
    }
  }
  return axeModule;
}

export async function seoAuditCapabilities() {
  return {
    seoAuditVersion: SEO_AUDIT_VERSION,
    lighthouse: Boolean(await loadLighthouse()),
    axe: Boolean(await loadAxe()),
    privacy: true
  };
}

// Same result shape as SiteOps' PageSpeed Insights mapping, so reports need no second format.
export function mapLighthouseResult(lhr, strategy) {
  const cats = lhr?.categories || {},
    audits = lhr?.audits || {},
    score = k => (cats[k]?.score == null ? null : Math.round(cats[k].score * 100)),
    num = id => audits[id]?.numericValue ?? null;
  return {
    strategy,
    source: 'runner',
    fetchTime: lhr?.fetchTime,
    finalUrl: lhr?.finalDisplayedUrl || lhr?.finalUrl,
    lighthouseVersion: lhr?.lighthouseVersion,
    scores: {
      performance: score('performance'),
      accessibility: score('accessibility'),
      bestPractices: score('best-practices'),
      seo: score('seo')
    },
    metrics: {
      fcp: num('first-contentful-paint'),
      lcp: num('largest-contentful-paint'),
      tbt: num('total-blocking-time'),
      cls: num('cumulative-layout-shift'),
      speedIndex: num('speed-index'),
      tti: num('interactive')
    },
    field: null,
    runtimeError: lhr?.runtimeError?.message || null
  };
}

export function summarizeAxe(results) {
  const violations = (results?.violations || []).map(v => ({
    id: v.id,
    impact: v.impact || 'minor',
    help: v.help,
    helpUrl: v.helpUrl,
    nodes: (v.nodes || []).length,
    targets: (v.nodes || [])
      .slice(0, 3)
      .map(n => (Array.isArray(n.target) ? n.target.join(' ') : String(n.target || '')))
  }));
  violations.sort((a, b) => IMPACT_ORDER.indexOf(b.impact) - IMPACT_ORDER.indexOf(a.impact) || b.nodes - a.nodes);
  const byImpact = Object.fromEntries(IMPACT_ORDER.map(i => [i, violations.filter(v => v.impact === i).length]));
  return {
    engine: 'axe-core',
    version: results?.testEngine?.version || null,
    violations: violations.slice(0, 50),
    violationCount: violations.length,
    nodeCount: violations.reduce((n, v) => n + v.nodes, 0),
    byImpact,
    passes: (results?.passes || []).length,
    incomplete: (results?.incomplete || []).length
  };
}

// Third-party requests and cookies of a first visit in a fresh context, before any click: what a
// visitor's browser sends before the consent banner was answered.
export function createPrivacyRecorder(pageUrl) {
  const site = new URL(pageUrl).hostname,
    byHost = new Map();
  return {
    onRequest(request) {
      let u;
      try {
        u = new URL(request.url());
      } catch {
        return;
      }
      if (!/^https?:$/.test(u.protocol)) return;
      const entry = byHost.get(u.hostname) || { host: u.hostname, count: 0, types: new Set(), url: '' };
      entry.count++;
      entry.types.add(request.resourceType());
      // Keep one URL per host (path only, no query) for consent tool detection on the own host.
      if (!entry.url || (u.hostname === site && /cookie|consent|borlabs|complianz|klaro/i.test(u.pathname)))
        entry.url = u.origin + u.pathname;
      byHost.set(u.hostname, entry);
    },
    result(cookies = []) {
      return {
        requests: [...byHost.values()]
          .slice(0, 200)
          .map(e => ({ host: e.host, url: e.url, type: [...e.types].join(','), count: e.count })),
        cookies: cookies.slice(0, 100).map(c => ({ name: c.name, domain: c.domain }))
      };
    }
  };
}

function normalizeStrategies(value) {
  if (value === true) return ['mobile', 'desktop'];
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(list.map(String).filter(s => s === 'mobile' || s === 'desktop'))];
}

export function registerSeoAudit(app, auth, { launch = chromium.launch.bind(chromium) } = {}) {
  app.get('/seo/capabilities', async (req, reply) => {
    if (!auth(req, reply)) return;
    return seoAuditCapabilities();
  });
  app.post('/seo/audit', async (req, reply) => {
    if (!auth(req, reply)) return;
    const body = req.body || {};
    let parsed;
    try {
      parsed = new URL(String(body.url || ''));
    } catch {
      return reply.code(400).send({ error: 'url is invalid' });
    }
    if (!['http:', 'https:'].includes(parsed.protocol))
      return reply.code(400).send({ error: 'Only http/https URLs are supported' });
    const url = parsed.toString(),
      timeoutMs = Math.min(90000, Math.max(5000, Number(body.timeoutMs || 45000))),
      strategies = normalizeStrategies(body.lighthouse),
      wantAxe = Boolean(body.axe),
      wantPrivacy = Boolean(body.privacy),
      started = Date.now(),
      result = { ok: true, url, axe: null, privacy: null, lighthouse: {}, errors: [] };
    const [lighthouse, AxeBuilder] = await Promise.all([
      strategies.length ? loadLighthouse() : null,
      wantAxe ? loadAxe() : null
    ]);
    if (strategies.length && !lighthouse) result.errors.push('Lighthouse ist im Runner nicht installiert.');
    if (wantAxe && !AxeBuilder) result.errors.push('axe-core ist im Runner nicht installiert.');
    let browser = null;
    try {
      const port = await freePort();
      browser = await launchGuarded(launch, {
        headless: true,
        args: ['--disable-dev-shm-usage', '--remote-debugging-port=' + port]
      });
      if (AxeBuilder || wantPrivacy) {
        // Fresh context: no cookies, no stored consent. Nothing is clicked before both checks.
        const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'de-DE' });
        const recorder = wantPrivacy ? createPrivacyRecorder(url) : null;
        if (recorder) context.on('request', request => recorder.onRequest(request));
        try {
          const page = await context.newPage();
          page.setDefaultTimeout(timeoutMs);
          await page.goto(url, { waitUntil: 'domcontentloaded' });
          await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 8000) }).catch(() => {});
          if (recorder) {
            try {
              result.privacy = { finalUrl: page.url(), ...recorder.result(await context.cookies()) };
            } catch (e) {
              result.errors.push('Datenschutz: ' + String(e.message || e).slice(0, 300));
            }
          }
          if (AxeBuilder) {
            try {
              result.axe = summarizeAxe(
                await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
              );
              result.axe.finalUrl = page.url();
            } catch (e) {
              result.errors.push('axe: ' + String(e.message || e).slice(0, 300));
            }
          }
        } catch (e) {
          result.errors.push((AxeBuilder ? 'axe: ' : 'Datenschutz: ') + String(e.message || e).slice(0, 300));
        } finally {
          await context.close().catch(() => {});
        }
      }
      if (lighthouse)
        for (const strategy of strategies) {
          try {
            const run = await lighthouse.run(
              url,
              {
                port,
                output: 'json',
                logLevel: 'error',
                onlyCategories: LIGHTHOUSE_CATEGORIES,
                maxWaitForLoad: timeoutMs
              },
              strategy === 'desktop' ? lighthouse.desktopConfig : undefined
            );
            result.lighthouse[strategy] = mapLighthouseResult(run?.lhr, strategy);
          } catch (e) {
            result.errors.push('Lighthouse ' + strategy + ': ' + String(e.message || e).slice(0, 300));
          }
        }
    } catch (e) {
      if (e.statusCode === 503) return reply.code(503).send({ error: e.message });
      result.errors.push(String(e.message || e).slice(0, 300));
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
    result.ok = !result.errors.length;
    result.durationMs = Date.now() - started;
    return result;
  });
}
