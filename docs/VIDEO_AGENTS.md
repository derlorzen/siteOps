# Video Studio multi-agent production (incremental rollout)

## Scope of the first implementation

The producer / recording / quality execution boundaries live in
`runner/video-agent-workflow.mjs`. They are deterministic safeguards, not
three remotely running OpenAI Agents SDK sessions. In particular, the
technical gate **does not claim to inspect images or understand the recorded UI**.

## Two real AI specialists in Video Suite

The Creative Agent now has a **Team-Review: Producer + Qualität** mode. This
uses the existing SiteOps-managed encrypted OpenAI credential and usage limits,
with two separate, structured Responses API calls:

1. The **Producer** assesses the supplied script, scene intent and recording
   configuration without access to browser tools.
2. The **Quality** reviewer independently challenges the Producer's assessment
   using both the original plan and the Producer's findings.

The server enforces this handoff deterministically, including a list of
non-AI capture blockers. The resulting advice is saved in the existing
project-scoped conversation store. Neither role can edit a production,
launch a recording, publish, or approve a final video. Each Team-Review
makes two billable OpenAI text calls; it does not analyze the actual video
or attached chat images. SiteOps currently orchestrates these roles directly
using its existing Responses API adapter; an Agents SDK runtime is not deployed.

Screen-recording evidence now includes a count incremented **after** each
browser action successfully executes, not a copy of the planned action count.

- **Producer boundary:** Build a numbered capture plan from the exact approved
  scene definitions. Reject missing approved demo URLs, unconfirmed test data,
  or missing actions for a requested screen recording. No conversion of a
  requested recording into a text slide.
- **Recording boundary:** For every scene, only accept evidence of a real,
  non-empty file produced by the existing browser runner. Recording scenes
  continue to undergo the runner's video-resolution verification. The result
  persists in `captures` with scene number, mode, bytes, dimensions, and the
  number of runner actions that returned successfully.
- **Quality boundary:** Before marking a job `done`, reconcile all expected
  scenes against the evidence and require non-empty video, short, subtitles and
  thumbnail. Probe both MP4 files for **video and audio streams**. Failure
  leaves the job `failed`, not `done`, with an actionable error.
- **Honest status:** Persist `quality.technical_status` and
  `quality.visual_status` (currently always `pending`) plus
  `agent_workflow`. Existing jobs without the new fields remain readable.
  The current publisher keeps its separate human approval process.

This protects against missing files and silent recording-to-slide fallback.
It does **not** certify a visibly correct interaction, time-aligned voice,
good cuts, or a reviewed final upload.

## Next: actual LLM agent orchestration

1. Wire a server-side orchestration service to the configured OpenAI account,
   preferably using the Agents SDK in a separate service. Never ship API keys
   to the browser or the video runner except its existing scoped narration key.
2. Give Producer, Recording and Quality explicit tool grants. Producer may read
   project context and propose the shot list; Recording may use approved
   demo-only capture tools; Quality may read evidence and inspect authorized
   actual media. None may publish or change live customer data.
3. Persist a job/scene task graph, immutable input snapshots, output artifact
   IDs, artifact hashes, attempt counts and state transitions. Retrying an
   individual recording must create a new version and preserve its predecessor.
4. Add a *visual* QA pass on sampled actual frames and synchronized audio
   instead of interpreting only metadata. Missing scenes trigger a bounded
   re-capture request. Never automatically replay potentially mutating browser
   actions without explicit safe/idempotent approval.
5. Only after verified edits and an explicit human review may the existing
   private YouTube upload flow be invoked. Public publication requires its
   existing separate approval.

## Safety and compatibility

Demo domains and test-only sessions use the existing SiteOps policy. The QA
metadata contains file sizes and statuses, not login credentials, local file
paths, or customer records. A runner without the new response fields is still
compatible with the existing SiteOps response parser, but cannot claim a
technical QA pass.

Run `node --test test/video-agent-workflow.test.mjs`, `npm test`, and the
existing browser-runner CI workflow before deployment. Keep changes behind
review until tests and actual demo recordings have passed.
