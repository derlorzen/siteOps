import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { assessAvSamples, inspectRenderedScene, extractSceneFrame, estimateAudioAlignment } from '../runner/video-av-qa.mjs';

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
const samples = (video = [frame(180), frame(215), frame(245)], voice = -20) => ({
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

test('audio alignment finds matching and visibly shifted signal envelopes', () => {
  const source = Array.from({ length: 150 }, (_, i) => [0.1, 0.8, 0.3, 0, 0.6, 0.95, 0.2][Math.floor(i / 3) % 7]);
  const matched = estimateAudioAlignment(source, [...source]);
  assert.equal(matched.status, 'verified');
  assert.equal(matched.offset_ms, 0);
  const shifted = estimateAudioAlignment(source, [...Array(19).fill(0), ...source]);
  assert.equal(shifted.status, 'misaligned');
  assert.ok(shifted.offset_ms >= 850);
  const uncertain = estimateAudioAlignment(Array(100).fill(0), Array(100).fill(0));
  assert.equal(uncertain.status, 'uncertain');
  const blocked = assessAvSamples({
    ...samples(),
    audio_alignment: shifted
  });
  assert.equal(blocked.status, 'blocked');
  assert.match(blocked.blockers.join(' '), /Audio-Synchronisation/);
});

test('ffmpeg decodes authentic video frames and actual narration audio', { skip: !available }, async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'siteops-av-qa-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const movie = path.join(dir, 'scene.mp4');
  const black = path.join(dir, 'black.mp4');
  const narration = path.join(dir, 'voice.wav');
  // Generate a speech-like changing amplitude envelope with deliberate pauses.
  // A constant sine wave cannot establish a reliable temporal offset.
  const rates = [0.05, 0.8, 0.3, 0, 0.95, 0.2, 0.5, 0.1, 0.7, 0.4, 0, 0.85];
  const pcm = Buffer.alloc(32000 * 2);
  for (let i = 0; i < 32000; i++) {
    const amplitude = rates[Math.floor(i / 1200) % rates.length];
    pcm.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 8000) * amplitude * 24000), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(pcm.length + 36, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  await writeFile(narration, Buffer.concat([header, pcm]));
  const createMovie = (color, output, delayMs = 0) =>
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=' + color + ':s=160x90:r=12:d=6',
      '-i', narration,
      ...(delayMs ? ['-af', 'adelay=' + delayMs + ':all=1'] : []),
      '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', output
    ], { timeout: 30000 });
  createMovie('white', movie);
  createMovie('black', black);
  const real = await inspectRenderedScene({ video: movie, narration, mode: 'screenshot' });
  assert.equal(real.verified_from_media, true);
  assert.equal(real.audio_alignment.status, 'verified');
  assert.equal(real.status, 'passed');
  assert.equal(real.frame_samples.length, 3);
  assert.equal(real.resolution.width, 160);
  assert.ok(real.narration_dbfs > -40);
  const dark = await inspectRenderedScene({ video: black, narration, mode: 'screenshot' });
  assert.equal(dark.status, 'blocked');
  const jpg = await extractSceneFrame(movie, 'end');
  assert.equal(jpg[0], 0xff);
  assert.equal(jpg[1], 0xd8);
  const delayed = path.join(dir, 'delayed.mp4');
  createMovie('white', delayed, 950);
  const badlyAligned = await inspectRenderedScene({ video: delayed, narration, mode: 'screenshot' });
  assert.equal(badlyAligned.audio_alignment.status, 'misaligned');
  assert.equal(badlyAligned.status, 'blocked');
  assert.match(badlyAligned.blockers.join(' '), /Audio-Synchronisation/);
});
