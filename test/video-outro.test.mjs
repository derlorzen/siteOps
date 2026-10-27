import test from 'node:test';
import assert from 'node:assert/strict';
import { outroSettings, validateOutroScenes, outroDuration, outroPage } from '../runner/video-outro.mjs';
import { sceneSchema } from '../lib/video-production.mjs';
import { createVideoStudio } from '../lib/video-studio.mjs';
const id = '11111111-1111-4111-8111-111111111111';
const ending = {
  headline: 'Thanks for watching.',
  narration: 'Thanks for watching. Subscribe for more tutorials. See you next time!',
  capture_mode: 'text',
  outro: { duration_seconds: 20, channel: 'Lorzen', website: 'https://example.com/tutorials' }
};
test('outro is bounded, uses safe links and can only be the last scene', () => {
  assert.equal(sceneSchema.parse(ending).outro.duration_seconds, 20);
  validateOutroScenes([{ narration: 'An introduction.' }, ending]);
  assert.throws(() => validateOutroScenes([ending, {}]), /letzte Szene/);
  assert.throws(() => validateOutroScenes([ending, ending]), /Nur ein Outro/);
  assert.throws(() => validateOutroScenes([{ ...ending, demoUrl: 'https://example.com' }]), /Browser-Demo/);
  for (const website of ['javascript:alert(1)', 'http://example.com', 'https://user:pass@example.com', 'invalid'])
    assert.throws(() => outroSettings({ ...ending.outro, website }), /HTTPS/);
  assert.throws(() => outroSettings({ ...ending.outro, duration_seconds: 30 }), /Dauer/);
});
test('outro holds the end screen without cutting spoken words or extending captions into silence', () => {
  assert.equal(outroDuration(ending, 12.5), 20);
  assert.equal(outroDuration({ ...ending, outro: { ...ending.outro, duration_seconds: 15 } }, 12.5), 15);
  assert.throws(() => outroDuration(ending, 20.1), /Sprechertext/);
  assert.equal(outroDuration({ narration: 'Normal scene' }, 22.7), 22.7);
});
test('end-card HTML escapes text, keeps reserved areas and supports portrait layout', () => {
  const page = outroPage({
    ...ending,
    headline: '<script>unsafe</script>',
    outro: { ...ending.outro, channel: '<img src=x>' }
  });
  assert.ok(page.includes('&lt;script&gt;'));
  assert.ok(page.includes('&lt;img'));
  assert.ok(!page.includes('<script>'));
  assert.match(page, /class="video one"/);
  assert.match(page, /class="video two"/);
  assert.match(outroPage({ ...ending, language: 'de' }, 'portrait'), /\.two\{display:none\}/);
});
test('old runner cannot silently render an outro as an ordinary slide', async t => {
  let queued = false;
  const db = {
    query: async sql =>
      sql.startsWith('SELECT * FROM video_studio_jobs') ? [[{ id, status: 'draft', scenes: [ending] }]] : [[]]
  };
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.endsWith('/video/jobs')) queued = true;
    return Response.json({ outroVersion: 0 });
  });
  const studio = createVideoStudio({ db, runnerUrl: () => 'https://runner.example.com', runnerToken: () => 'token' });
  await assert.rejects(studio.renderJob(id), /1.3.0/);
  assert.equal(queued, false);
});
