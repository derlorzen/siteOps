import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createThemeService, registerThemeRoutes, DEFAULT_ACCENT } from '../lib/siteops-theme.mjs';

const fakeService = (persisted = null) => {
  const statements = [];
  const store = [];
  const service = createThemeService({
    q: async (sql, params) => {
      statements.push({ sql, params });
      return { rows: persisted == null ? [] : [{ setting_value: persisted }] };
    },
    storeSetting: async (key, value) => {
      store.push({ key, value });
    }
  });
  return { service, statements, store };
};

test('theme defaults to the existing accent and reads a saved hex color', async () => {
  assert.deepEqual(await fakeService().service.get(), { accent: DEFAULT_ACCENT });
  assert.deepEqual(await fakeService('#0f766e').service.get(), { accent: '#0F766E' });
  assert.deepEqual(await fakeService('<script>').service.get(), { accent: DEFAULT_ACCENT });
});

test('valid accents are saved uppercase in existing app_settings', async () => {
  const { service, store } = fakeService();
  assert.deepEqual(await service.save({ accent: '#1d4ed8' }), { accent: '#1D4ED8' });
  assert.deepEqual(store, [{ key: 'ui_accent_color', value: '#1D4ED8' }]);
});

test('reject malformed or injected colors with no database writes', async () => {
  const { service, store } = fakeService();
  for (const color of ['red', '#fff', '#12345678', '#12345g', 'var(--x)', 'url(javascript:alert(1))']) {
    await assert.rejects(service.save({ accent: color }), e => e.statusCode === 400);
  }
  await assert.rejects(service.save({ accent: '#1D4ED8', unsafe: '<style>' }), e => e.statusCode === 400);
  assert.equal(store.length, 0);
});

test('theme routes enforce JSON, same origin and same-site fetch policy', async () => {
  const handlers = {};
  const app = {
    get(path, handler) {
      handlers['GET ' + path] = handler;
    },
    put(path, handler) {
      handlers['PUT ' + path] = handler;
    }
  };
  const { service } = fakeService();
  registerThemeRoutes(app, service, () => 'https://siteops.example');
  assert.equal(typeof handlers['GET /api/ui-theme'], 'function');
  assert.deepEqual(await handlers['GET /api/ui-theme'](), { accent: DEFAULT_ACCENT });
  const handler = handlers['PUT /api/ui-theme'];
  const makeReply = () => ({
    status: null,
    code(value) {
      this.status = value;
      return this;
    },
    send(value) {
      return { status: this.status, ...value };
    }
  });
  const wrongOrigin = await handler(
    {
      headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
      body: { accent: '#1D4ED8' }
    },
    makeReply()
  );
  assert.equal(wrongOrigin.status, 403);
  const wrongType = await handler(
    {
      headers: { 'content-type': 'text/plain' },
      body: { accent: '#1D4ED8' }
    },
    makeReply()
  );
  assert.equal(wrongType.status, 415);
  const crossSite = await handler(
    {
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
      body: { accent: '#1D4ED8' }
    },
    makeReply()
  );
  assert.equal(crossSite.status, 403);
  assert.deepEqual(
    await handler(
      {
        headers: {
          'content-type': 'application/json',
          origin: 'https://siteops.example',
          'sec-fetch-site': 'same-origin'
        },
        body: { accent: '#0F766E' }
      },
      makeReply()
    ),
    { accent: '#0F766E' }
  );
});

test('picker script parses; offers presets, live preview, cancellation and persistence', async () => {
  const source = await readFile(new URL('../public/siteops-theme.js', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new vm.Script(source));
  assert.doesNotMatch(source, /querySelector\('\.crm-topbar'\)/);
  assert.match(source, /document\.addEventListener\('click'/);
  for (const requirement of [
    'type="color"',
    'siteopsThemeHex',
    'preview(',
    'dialog.addEventListener',
    '/api/ui-theme',
    'localStorage',
    '--siteops-accent',
    '[data-siteops-theme-open]'
  ]) {
    assert.ok(source.includes(requirement), requirement);
  }
});

test('both UI stylesheets reference the shared accent palette, not hardcoded violet', async () => {
  const shared = await readFile(new URL('../public/siteops-theme.css', import.meta.url), 'utf8');
  assert.match(shared, /--siteops-accent-strong/);
  assert.match(shared, /--siteops-accent-soft/);
  for (const path of ['../public/crm-app.css', '../public/ops-workspace.css']) {
    const stylesheet = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.match(stylesheet, /var\(--siteops-accent/);
    assert.doesNotMatch(stylesheet, /#6856da/i);
  }
});
