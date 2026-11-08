import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTeamReviewContext, runVideoTeamReview } from '../lib/video-multi-agent.mjs';

const project = { name: 'Bagisto', channel: 'Tutorials', language: 'en' };
const context = {
  title: 'Converter tutorial',
  topic: 'Browser tutorial',
  script: 'Show the converter on a real browser screen.',
  format: 'landscape',
  scenes: [
    {
      headline: 'Converter',
      narration: 'Show the converter on a real browser screen.',
      capture_mode: 'recording',
      visual_directions: 'Upload a ZIP and show the export result.'
    }
  ]
};

const assessment = (summary, findings = []) => ({
  summary,
  findings,
  next_step: 'Complete the missing browser recording configuration.'
});

test('producer sees blocked recording configuration as evidence, not a successful clip', () => {
  const input = buildTeamReviewContext({ project, context, guidelines: [], request: 'Review this.' });
  assert.equal(input.deterministic_capture_plan.length, 1);
  assert.equal(input.deterministic_capture_plan[0].ok, false);
  assert.equal(input.scenes[0].has_demo_url, false);
  assert.match(input.deterministic_capture_plan[0].issues.join(' '), /Keine Demo-URL/);
});

test('server runs independent Producer and Quality roles in order, without executing tools', async () => {
  const calls = [];
  const invoke = async (role, instructions, input) => {
    calls.push({ role, instructions, input });
    return role === 'producer'
      ? assessment('The script needs a real browser clip.')
      : assessment('The Producer did not verify any footage.');
  };
  const result = await runVideoTeamReview({
    project,
    context,
    guidelines: ['Use authentic recordings.'],
    request: 'Review this',
    invoke
  });
  assert.deepEqual(calls.map(call => call.role), ['producer', 'quality']);
  assert.equal(calls[1].input.producer_assessment.summary, 'The script needs a real browser clip.');
  assert.equal(result.status, 'blocked');
  assert.match(result.reply, /Aufnahmeplan noch blockiert/);
  assert.match(result.reply, /Quality-Agent/);
  assert.doesNotMatch(result.reply, /visuell geprüft\./);
});

test('the team cannot turn an unreviewed plan into a published or approved video', async () => {
  const invoke = async () => assessment('No blocking issues reported.');
  const review = await runVideoTeamReview({
    project,
    context: {
      ...context,
      scenes: [{
        ...context.scenes[0],
        demoUrl: 'https://demo.example.com/converter',
        demoSteps: [{ action: 'click', selector: '#upload' }],
        test_data_only: true
      }]
    },
    guidelines: [],
    request: 'Review',
    invoke
  });
  assert.equal(review.status, 'review_needed');
  assert.match(review.reply, /nicht visuell geprüft/);
});
