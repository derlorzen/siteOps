import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as agent from '../runner/video-agent-workflow.mjs';

const scene = {
  headline: 'Feature walkthrough',
  narration: 'Show how the real product workflow works.',
  capture_mode: 'recording',
  demoUrl: 'https://demo.example.com/product',
  demoSteps: [{ action: 'click', selector: '#start' }],
  test_data_only: true
};

const media = () => ({
  video: { bytes: 1234, streams: ['video', 'audio'] },
  short: { bytes: 567, streams: ['video', 'audio'] },
  subtitles: { bytes: 120 },
  thumbnail: { bytes: 300 }
});

test('producer rejects a missing recording plan', () => {
  assert.throws(() => agent.producerAgentPlan([{ ...scene, demoSteps: [] }]), /Kein ausführbarer Aufnahme-Ablauf/);
  assert.throws(() => agent.producerAgentPlan([{ ...scene, test_data_only: false }]), /Testkonto und Testdaten/);
  const plan = agent.producerAgentPlan([scene]);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].mode, 'recording');
  assert.equal(plan[0].expected_actions, 1);
  assert.equal(plan[0].requires_moving_capture, true);
});

test('recording requires an actual nonempty file', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'siteops-agent-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const task = agent.producerAgentPlan([scene])[0];
  const filename = path.join(dir, 'scene.webm');
  await writeFile(filename, 'test-bytes');
  await assert.rejects(agent.recordingAgentEvidence(task, filename), /bestätigte Browseraktionen fehlen/);
  const evidence = await agent.recordingAgentEvidence(task, filename, {
    resolution: { width: 1920, height: 1080 },
    actions_executed: 1
  });
  assert.equal(evidence.status, 'captured');
  assert.equal(evidence.bytes, 10);
  assert.equal(evidence.actions_executed, 1);
  await writeFile(filename, '');
  await assert.rejects(agent.recordingAgentEvidence(task, filename), /fehlt oder ist leer/);
});

test('reused scene media is SHA-256 verified and corrupted copies are rejected', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'siteops-reuse-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'voice.wav');
  const reused = path.join(dir, 'copied.wav');
  await writeFile(source, Buffer.from('Original generated narration data.'));
  const digest = await agent.fileSha256(source);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(await agent.verifiedArtifactCopy(source, reused, digest), digest);
  assert.equal(await agent.fileSha256(reused), digest);
  await writeFile(source, Buffer.from('Unexpected changed narration.'));
  await assert.rejects(
    agent.verifiedArtifactCopy(source, reused, digest),
    /stimmt nicht mit dem Original-Prüfnachweis/
  );
  await assert.rejects(agent.fileSha256(reused), { code: 'ENOENT' });
  await assert.rejects(agent.verifiedArtifactCopy(source, reused, 'invalid checksum'), /SHA-256-Prüfsumme/);
});

test('quality requires every capture and every media stream', () => {
  const plan = agent.producerAgentPlan([scene]);
  const missing = agent.qualityAgentAudit({ plan, captures: [], media: media() });
  assert.equal(missing.technical_status, 'failed');
  assert.match(missing.issues.join(' '), /Aufnahmenachweis/);
  assert.throws(() => agent.requireTechnicalQuality(missing), /Video-QA fehlgeschlagen/);

  const evidence = [
    {
      scene: 1,
      mode: 'recording',
      status: 'captured',
      bytes: 100,
      actions_executed: 1,
      resolution: { width: 1920, height: 1080 }
    }
  ];
  const bad = media();
  bad.video.streams = ['video'];
  const failed = agent.qualityAgentAudit({ plan, captures: evidence, media: bad });
  assert.equal(failed.technical_status, 'failed');
  assert.match(failed.issues.join(' '), /Bild- und Tonspur/);

  const passed = agent.requireTechnicalQuality(agent.qualityAgentAudit({ plan, captures: evidence, media: media() }));
  assert.equal(passed.technical_status, 'passed');
  assert.equal(passed.visual_status, 'pending');
  assert.equal(passed.scenes_captured, 1);
});

test('quality detects duplicate and unexpected scenes', () => {
  const plan = agent.producerAgentPlan([scene]);
  const captured = {
    scene: 1,
    mode: 'screenshot',
    status: 'captured',
    bytes: 12,
    actions_executed: 0
  };
  const report = agent.qualityAgentAudit({
    plan,
    captures: [captured, captured, { ...captured, scene: 3 }],
    media: media()
  });
  assert.equal(report.technical_status, 'failed');
  assert.match(report.issues.join(' '), /genau ein Aufnahmenachweis/);
  assert.match(report.issues.join(' '), /Unerwarteter Aufnahmenachweis/);
});
