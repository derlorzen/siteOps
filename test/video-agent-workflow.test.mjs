import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  producerAgentPlan,
  recordingAgentEvidence,
  qualityAgentAudit,
  requireTechnicalQuality
} from '../runner/video-agent-workflow.mjs';

const recording = {
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

test('producer refuses browser scenes without a real capture plan', () => {
  assert.throws(
    () => producerAgentPlan([{ ...recording, demoSteps: [] }]),
    /Kein ausführbarer Aufnahme-Ablauf/
  );
  assert.throws(
    () => producerAgentPlan([{ ...recording, test_data_only: false }]),
    /Testkonto und Testdaten/
  );
  const plan = producerAgentPlan([recording]);
  assert.equal(plan.length, 1);
  assert.deepEqual(
    { scene: plan[0].scene, mode: plan[0].mode, expected_actions: plan[0].expected_actions, requires_moving_capture: plan[0].requires_moving_capture },
    { scene: 1, mode: 'recording', expected_actions: 1, requires_moving_capture: true }
  );
});

test('recording agent verifies an actual nonempty file', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'siteops-agent-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const task = producerAgentPlan([recording])[0];
  const filename = path.join(dir, 'scene.webm');
  await writeFile(filename, 'test-bytes');
  const evidence = await recordingAgentEvidence(task, filename, { resolution: { width: 1920, height: 1080 } });
  assert.equal(evidence.status, 'captured');
  assert.equal(evidence.bytes, 10);
  assert.equal(evidence.actions_executed, 1);
  await writeFile(filename, '');
  await assert.rejects(recordingAgentEvidence(task, filename), /fehlt oder ist leer/);
});

test('quality agent blocks missing captures and missing video soundtracks', () => {
  const plan = producerAgentPlan([recording]);
  const missing = qualityAgentAudit({ plan, captures: [], media: media() });
  assert.equal(missing.technical_status, 'failed');
  assert.match(missing.issues.join(' '), /Aufnahmenachweis/);
  assert.throws(() => requireTechnicalQuality(missing), /Video-QA fehlgeschlagen/);

  const evidence = [{
    scene: 1,
    mode: 'recording',
    status: 'captured',
    bytes: 100,
    actions_executed: 1,
    resolution: { width: 1920, height: 1080 }
  }];
  const incompleteMedia = media();
  incompleteMedia.video.streams = ['video'];
  const failed = qualityAgentAudit({ plan, captures: evidence, media: incompleteMedia });
  assert.equal(failed.technical_status, 'failed');
  assert.match(failed.issues.join(' '), /Bild- und Tonspur/);

  const passed = requireTechnicalQuality(qualityAgentAudit({ plan, captures: evidence, media: media() }));
  assert.equal(passed.technical_status, 'passed');
  // This is a technical verification, not a claim that the onscreen workflow was understood.
  assert.equal(passed.visual_status, 'pending');
  assert.equal(passed.scenes_captured, 1);
});

test('quality agent rejects duplicate, mismatched and unplanned scene evidence', () => {
  const plan = producerAgentPlan([recording]);
  const captured = { scene: 1, mode: 'screenshot', status: 'captured', bytes: 12, actions_executed: 0 };
  const report = qualityAgentAudit({
    plan,
    captures: [captured, captured, { ...captured, scene: 3 }],
    media: media()
  });
  assert.equal(report.technical_status, 'failed');
  assert.match(report.issues.join(' '), /genau ein Aufnahmenachweis/);
  assert.match(report.issues.join(' '), /Unerwarteter Aufnahmenachweis/);
});
