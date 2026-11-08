import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { assessAvSamples, inspectRenderedScene, extractSceneFrame } from '../runner/video-av-qa.mjs';

const available = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const frame = intensity => Buffer.alloc(96 * 54, intensity);
const samples = (video = [frame(180), frame(190), frame(200)], voice = -20) => ({
  mode: 'recording',
  frames: video,
  narration_dbfs: voice,
  rendered_seconds: 2,
  narration_seconds: 1.5
});

test('audiovisual decisions distinguish missing footage, black screens, audio silence and no motion', () => {
  assert.equal(assessAvSamples(samples()).status, 'passed');
  const staticScreen = assessAvSamples(samples([frame(180), frame(180), frame(180)]));
  assert.equal(staticScreen.status, 'needs_review');
  assert.match(staticScreen.warnings.join(' '), /kaum Bildänderungen/);
  const black = assessAvSamples(samples([frame(0), frame(0), frame(0)]));
  assert.equal(black.status, 'blocked');
  assert.match(black.blockers.join(' '), /schwarz/);
  const silent = assessAvSamples(samples(undefined, -90));
  assert.equal(silent.status, 'blocked');
  assert.match(silent.blockers.join(' '), /Tonspur/);
  const fixture = assessAvSamples({ ...samples(undefined, -90), silent_fixture: true });
  assert.equal(fixture.status, 'needs_review');
  const cutoff = assessAvSamples({ ...samples(), rendered_seconds: 0.5 });
  assert.equal(cutoff.status, 'blocked');
  assert.match(cutoff.blockers.join(' '), /kürzer/);
});

test('ffmpeg decodes authentic video frames and actual narration audio', { skip: !available }, async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'siteops-av-qa-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const movie = path.join(dir, 'scene.mp4');
  const black = path.join(dir, 'black.mp4');
  const narration = path.join(dir, 'voice.wav');
  const createMovie = (color, output) => execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=' + color + ':s=160x90:r=12:d=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=8000:duration=2',
    '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', output
  ], { timeout: 30000 });
  createMovie('white', movie);
  createMovie('black', black);
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=8000:duration=2',
    '-ac', '1', '-ar', '8000', narration
  ], { timeout: 30000 });
  const real = await inspectRenderedScene({ video: movie, narration, mode: 'screenshot' });
  assert.equal(real.verified_from_media, true);
  assert.equal(real.status, 'passed');
  assert.equal(real.frame_samples.length, 3);
  assert.equal(real.resolution.width, 160);
  assert.ok(real.narration_dbfs > -40);
  const dark = await inspectRenderedScene({ video: black, narration, mode: 'screenshot' });
  assert.equal(dark.status, 'blocked');
  const jpg = await extractSceneFrame(movie, 'end');
  assert.equal(jpg[0], 0xff);
  assert.equal(jpg[1], 0xd8);
});
