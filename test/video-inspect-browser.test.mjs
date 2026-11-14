import test from 'node:test';
import assert from 'node:assert/strict';

test(
  'page inventory lists only visible controls with selectors that match exactly one element',
  { skip: process.env.RUN_SUITE_BROWSER_TESTS !== '1', timeout: 30000 },
  async t => {
    const { chromium } = await import('../runner/node_modules/playwright/index.mjs');
    const { inspectPage } = await import('../runner/video-inspect.mjs');
    const browser = await chromium.launch({
      executablePath: process.env.SUITE_CHROMIUM_EXECUTABLE || undefined,
      headless: true
    });
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.setContent(`<title>Packages</title><main><h1>Package Manager</h1>
      <nav><a href="/admin/packages">Packages</a><a href="/admin/settings">Settings</a></nav>
      <button id="upload-open">Upload extension</button>
      <button>Save</button><button>Save</button>
      <button style="display:none">Hidden</button>
      <button disabled>Disabled</button>
      <input name="search" placeholder="Search packages">
      <input type="password" name="secret"><input type="file" name="zip">
      <div role="tab" aria-label="Installed">Installed</div>
      <a href="/item/1">Open</a><a href="/item/2">Open</a></main>`);
    const result = await inspectPage(page);
    assert.equal(result.title, 'Packages');
    assert.deepEqual(result.headings, ['Package Manager']);
    const bySelector = Object.fromEntries(result.elements.map(item => [item.selector, item]));
    assert.equal(bySelector['#upload-open'].name, 'Upload extension');
    assert.equal(bySelector['a[href="/admin/packages"]'].role, 'link');
    assert.equal(bySelector['input[name="search"]'].role, 'textbox');
    assert.ok(bySelector['div[aria-label="Installed"]']);
    // Two identical "Save" buttons cannot be told apart, so neither is offered.
    assert.ok(!result.elements.some(item => item.name === 'Save'));
    assert.ok(!result.elements.some(item => /Hidden|Disabled/.test(item.name)));
    assert.ok(!result.elements.some(item => /secret|zip/.test(item.selector)));
    // Same label, different target: told apart by their href.
    assert.equal(result.elements.filter(item => item.name === 'Open').length, 2);
    for (const item of result.elements) assert.equal(await page.locator(item.selector).count(), 1);
  }
);
