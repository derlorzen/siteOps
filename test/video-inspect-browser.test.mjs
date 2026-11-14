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
    assert.ok(!result.elements.some(item => /secret/.test(item.selector)));
    // File inputs are offered for upload steps, with their own role.
    assert.equal(result.elements.find(item => /zip/.test(item.selector)).role, 'file');
    // Same label, different target: told apart by their href.
    assert.equal(result.elements.filter(item => item.name === 'Open').length, 2);
    for (const item of result.elements) assert.equal(await page.locator(item.selector).count(), 1);
  }
);

test(
  'file inputs are listed even when hidden and the upload step hands the exact test file to the page',
  { skip: process.env.RUN_SUITE_BROWSER_TESTS !== '1', timeout: 30000 },
  async t => {
    const crypto = await import('node:crypto');
    const os = await import('node:os');
    const path = await import('node:path');
    const fs = await import('node:fs/promises');
    process.env.VIDEO_DEMO_FILES_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'demo-files-test-'));
    const { chromium } = await import('../runner/node_modules/playwright/index.mjs');
    const { inspectPage } = await import('../runner/video-inspect.mjs');
    const { executeDemoStep, validatedDemoSteps } = await import('../runner/video-demo.mjs');
    const { storeDemoFiles } = await import('../runner/video-files.mjs');
    const browser = await chromium.launch({
      executablePath: process.env.SUITE_CHROMIUM_EXECUTABLE || undefined,
      headless: true
    });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent(`<main><h1>Convert</h1><label for="zip" class="button">Select original ZIP</label>
      <input id="zip" type="file" accept=".zip" style="display:none"><output id="out"></output>
      <script>zip.onchange = () => out.textContent = zip.files[0].name + ':' + zip.files[0].size;</script></main>`);
    const inventory = await inspectPage(page);
    const input = inventory.elements.find(item => item.role === 'file');
    assert.equal(input.name, 'Select original ZIP (.zip)');
    const data = Buffer.from('PK example extension');
    const sha256 = crypto.createHash('sha256').update(data).digest('hex');
    await assert.rejects(
      storeDemoFiles([{ name: 'example.zip', sha256: 'b'.repeat(64), data: data.toString('base64') }]),
      /Prüfsumme/
    );
    await assert.rejects(storeDemoFiles([{ name: '../evil.zip', sha256, data: data.toString('base64') }]), /Dateiname/);
    await storeDemoFiles([{ name: 'example.zip', sha256, data: data.toString('base64') }]);
    const [step] = validatedDemoSteps(
      [{ action: 'upload', selector: input.selector, sha256, name: 'example.zip' }],
      'https://shop.test/',
      ['shop.test']
    );
    await executeDemoStep(page, step);
    assert.equal(await page.locator('#out').textContent(), 'example.zip:' + data.length);
    assert.throws(
      () => validatedDemoSteps([{ action: 'upload', selector: '#zip' }], 'https://shop.test/', ['shop.test']),
      /test file/
    );
  }
);
