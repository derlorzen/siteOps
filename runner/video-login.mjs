import { createDemoContext, validatedDemoUrl } from './video-demo.mjs';

const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
export function validateDemoLogin(raw, hosts) {
  if (!raw || !/^[a-zA-Z0-9_-]{1,80}$/.test(raw.id || '') || raw.test_data_only !== true)
    throw Error('Ein bestätigtes Demo-Konto mit gültiger Profil-ID ist erforderlich.');
  const login_url = validatedDemoUrl(raw.login_url, hosts),
    landing_url = validatedDemoUrl(raw.landing_url, hosts);
  if (new URL(login_url).origin !== new URL(landing_url).origin || login_url === landing_url)
    throw Error('Login und geschützte Zielseite müssen verschiedene URLs derselben Herkunft sein.');
  for (const key of ['username', 'password']) if (!text(raw[key], 500)) throw Error('Demo-Zugangsdaten fehlen.');
  for (const key of ['username_selector', 'password_selector', 'submit_selector', 'ready_selector'])
    if (!text(raw[key], 240))
      throw Error('Login-Selektoren und Erkennungsmerkmal der geschützten Seite sind erforderlich.');
  return Object.fromEntries(
    [
      'id',
      'login_url',
      'landing_url',
      'username',
      'password',
      'username_selector',
      'password_selector',
      'submit_selector',
      'ready_selector',
      'test_data_only'
    ].map(key => [key, raw[key]])
  );
}

// The login context has no recorder, trace, screenshot, or disk-based cookie file.
export async function authenticateDemo(browser, profile, hosts, proxyFactory) {
  const login = validateDemoLogin(profile, hosts),
    target = new URL(login.login_url);
  let guarded,
    phase = 'Login-Seite';
  try {
    guarded = await createDemoContext(
      browser,
      { viewport: { width: 1920, height: 1080 } },
      [target.hostname],
      proxyFactory
    );
    const page = await guarded.context.newPage();
    page.setDefaultTimeout(12000);
    await page.goto(login.login_url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    if (new URL(page.url()).origin !== target.origin) throw Error('Origin changed');
    // Check the actual form destination before entering credentials.
    const password = page.locator(login.password_selector).first();
    if ((await password.getAttribute('type')) !== 'password') throw Error('Password field required');
    const action = await password.evaluate(el => el.form?.action || null);
    if (!action || new URL(action).origin !== target.origin) throw Error('Unexpected form destination');
    phase = 'Zugangsdaten';
    await page.locator(login.username_selector).first().fill(login.username);
    await password.fill(login.password);
    await page.locator(login.submit_selector).first().click();
    phase = 'Anmeldebestätigung';
    await page.waitForURL(url => url.origin === target.origin && url.pathname !== target.pathname, { timeout: 20000 });
    const landing = await page.goto(login.landing_url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    if (!landing?.ok()) throw Error('Protected page returned an error.');
    if (
      new URL(page.url()).origin !== target.origin ||
      new URL(page.url()).pathname !== new URL(login.landing_url).pathname
    )
      throw Error('Protected page not reached');
    await page.locator(login.ready_selector).first().waitFor({ state: 'visible', timeout: 12000 });
    if (await page.locator('input[type="password"]').isVisible()) throw Error('Login still visible');
    const state = await guarded.context.storageState();
    return {
      cookies: state.cookies
        .filter(
          c =>
            target.hostname === c.domain.replace(/^\./, '') ||
            target.hostname.endsWith('.' + c.domain.replace(/^\./, ''))
        )
        .map(c => ({ ...c, domain: target.hostname })),
      origins: state.origins.filter(o => o.origin === target.origin)
    };
  } catch {
    throw Error(
      'Demo-Anmeldung fehlgeschlagen (' +
        phase +
        '). Konto, Login-Selektoren und geschützte Zielseite prüfen. Es wurde keine Aufnahme gestartet.'
    );
  } finally {
    await guarded?.close().catch(() => {});
  }
}
