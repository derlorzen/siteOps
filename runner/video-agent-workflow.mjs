import { stat } from 'node:fs/promises';
import { requireCapturePlan } from './video-capture.mjs';

// Production control-plane: a producer specifies required evidence before a runner
// executes anything. This deterministic layer can be called by an LLM agent later;
// an LLM's claim of success must never replace evidence from the runner.
export function producerAgentPlan(scenes) {
  return requireCapturePlan(scenes).map(item => ({
    scene: item.scene,
    headline: item.headline,
    mode: item.mode,
    expected_actions: item.actions,
    requires_moving_capture: item.mode === 'recording'
  }));
}

// Recording-agent boundary: only a real, non-empty local file counts as captured.
// The caller must separately validate video resolution and browser action results.
export async function recordingAgentEvidence(task, filename, { resolution, actions_executed } = {}) {
  const file = await stat(filename);
  if (!file.isFile() || file.size <= 0)
    throw new Error('Szene ' + task.scene + ': Aufnahmedatei fehlt oder ist leer.');
  if (task.mode === 'recording' && (!Number.isSafeInteger(actions_executed) || actions_executed < 0))
    throw new Error('Szene ' + task.scene + ': bestätigte Browseraktionen fehlen.');
  return {
    scene: task.scene,
    mode: task.mode,
    status: 'captured',
    bytes: file.size,
    actions_executed: task.mode === 'recording' ? actions_executed : 0,
    ...(resolution ? { resolution } : {})
  };
}

// Quality-agent boundary: a technical audit, not an LLM's visual assessment.
// "visual_status: pending" is intentional; passing ffprobe does not prove that
// a button, on-screen action or result was shown correctly.
export function qualityAgentAudit({ plan, captures, media }) {
  const issues = [];
  if (!Array.isArray(plan) || !Array.isArray(captures)) throw new TypeError('Invalid scene evidence.');
  if (!plan.length) issues.push('Kein Szenenplan vorhanden.');
  for (const expected of plan) {
    const matches = captures.filter(item => item.scene === expected.scene);
    if (matches.length !== 1) {
      issues.push('Szene ' + expected.scene + ': genau ein Aufnahmenachweis erforderlich.');
      continue;
    }
    const capture = matches[0];
    if (capture.status !== 'captured' || capture.mode !== expected.mode || !Number.isSafeInteger(capture.bytes) || capture.bytes <= 0)
      issues.push('Szene ' + expected.scene + ': Aufnahme fehlt, ist leer oder hat den falschen Typ.');
    if (capture.actions_executed !== expected.expected_actions)
      issues.push('Szene ' + expected.scene + ': ausgeführte Aktionen stimmen nicht mit dem Plan überein.');
    if (expected.requires_moving_capture && (!capture.resolution?.width || !capture.resolution?.height))
      issues.push('Szene ' + expected.scene + ': Videoauflösung nicht bestätigt.');
  }
  for (const capture of captures) {
    if (!plan.some(item => item.scene === capture.scene))
      issues.push('Unerwarteter Aufnahmenachweis für Szene ' + capture.scene + '.');
  }
  for (const kind of ['video', 'short', 'subtitles', 'thumbnail']) {
    const artifact = media?.[kind];
    if (!artifact || !Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0) {
      issues.push('Ausgabedatei ' + kind + ' fehlt oder ist leer.');
      continue;
    }
    if (kind === 'video' || kind === 'short') {
      if (!Array.isArray(artifact.streams) || !artifact.streams.includes('video') || !artifact.streams.includes('audio'))
        issues.push('Ausgabedatei ' + kind + ' benötigt Bild- und Tonspur.');
    }
  }
  return {
    technical_status: issues.length ? 'failed' : 'passed',
    visual_status: 'pending',
    scenes_expected: plan.length,
    scenes_captured: captures.filter(item => item.status === 'captured').length,
    checked_at: new Date().toISOString(),
    issues
  };
}

export function requireTechnicalQuality(audit) {
  if (audit.technical_status !== 'passed') {
    const error = new Error('Technische Video-QA fehlgeschlagen: ' + audit.issues.join(' '));
    error.code = 'VIDEO_QUALITY_FAILED';
    throw error;
  }
  return audit;
}
