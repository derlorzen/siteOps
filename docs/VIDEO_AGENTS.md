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
  persists in `captures` with scene number, mode, bytes, SHA-256, dimensions,
  capture attempts, and the number of runner actions that returned successfully.
- **Quality boundary:** Before marking a job `done`, reconcile all expected
  scenes against the evidence and require non-empty video, short, subtitles and
  thumbnail. Probe both MP4 files for **video and audio streams**. Failure
  leaves the job `failed`, not `done`, with an actionable error.
- **Honest status:** Persist `quality.technical_status`,
  `quality.audio_visual_status`, `quality.visual_status` and
  `agent_workflow`. A text/audio codec check is NOT a semantic validation.
  Existing jobs without these fields remain readable.
  The current publisher keeps its separate human approval process.

This protects against missing files and silent recording-to-slide fallback.
It does **not** certify a visibly correct interaction, time-aligned voice,
good cuts, or a reviewed final upload.

## Actual audiovisual QA (phase 2)

The runner decodes **three real samples** from each rendered scene clip using
FFmpeg and measures whether the samples are all nearly black or unexpectedly
unchanged. It also decodes the narration audio to PCM, measures audio level,
probes actual scene/voice durations and checks for truncated narration.
A completely black scene, missing/truncated sound, or invalid media blocks
the render. A nearly static browser recording produces a *human-review
warning*, not a fabricated claim that actions were not executed. The
intentionally silent CI TTS fixture always reports `needs_review` rather
than `passed`.

A successful scene probe is **not** proof that the correct product action is
visible or that narration matches the on-screen state. The separate Video Suite
final review now offers an **opt-in OpenAI visual review**. With an explicit
checkbox/submit action, it fetches at most two authentic rendered JPEG frames
per selected scene, at most three scenes per request, over the authenticated
runner bridge. Images and the scene narration are sent to OpenAI with
`store:false`. The AI returns structured `matches`, `mismatch`, or
`uncertain` findings; they are saved on that video job. The status remains
`ai_reviewed_human_approval_pending` or `ai_flagged_for_human_review`;
the reviewer is **never** allowed to approve publication or claim full-motion
or full-audio verification. Users must personally watch the rendered video.

## Speech timing verification

Every rendered scene now compares the **decoded narration WAV** with the
**actual muxed MP4 audio** using 50-ms RMS amplitude windows from the first
12 seconds of both media tracks. The resulting scene report records
`audio_alignment.status`, the estimated offset (milliseconds), and an
observed correlation. A confident shift above 700 ms blocks rendering; a
possible shift above 250 ms or an inconclusive sample requires human review.
The deliberately silent CI narration fixture is marked `not_checked`, never
as verified speech.

This validates the timing of the sampled **audio signal** in the encoded
scene, not whether the spoken words match the authored narration, and not
the complete video beyond the sampled time range. A transcript/word-level
verification would require an additional explicitly approved transcription
workflow. Users must review audio and the whole final MP4 themselves.

Reused narration WAV and already assembled scene MP4 files now have their
**own SHA-256 digests**, in addition to the original capture digest.
The runner verifies the copied file against the original digest. A mismatched
file is discarded and the repair stops rather than trusting an unverified
copy. A missing legacy digest prevents that asset from being reused.

SiteOps requires the runner capability `audiovisualQaVersion:1` before it
submits **any** new render. This prevents an older deployed runner from
silently reporting `done` without the required QA. The new runner must be
deployed before the SiteOps changes are enabled in production.

## Scene-specific repair

For a completed or failed video, the dashboard action
**„Einzelne Szenen neu aufnehmen“** asks for up to six scene numbers and
requires explicit confirmation that any configured demo actions may be replayed
**with test data only**. A new independent draft is created; it **does not**
automatically render or change the original job. The normal explicit render
approval is still required.

The new runner can then `resumeFrom` the old runner job while
`recaptureScenes` explicitly lists changed scenes. It verifies a content
fingerprint of the original immutable scene/policy/voice snapshot. The other
scene recordings are copied and checked against their persisted SHA-256
receipts, and existing scene audio/assembled parts are reused where available.
Unselected scenes missing integrity evidence fail closed instead of silently
executing unexpected browser actions. Every new render uses its own UUID
and media directory; the original remains available. At most three recording
attempts per scene and six selected scenes per repair are permitted. Legacy
productions without a fingerprint/digests require a full new render.

This is **manual, bounded scene repair**, not a background agent that
repeatedly clicks unknown controls or automatically changes production data.

## Next: actual LLM agent orchestration

1. Wire a server-side orchestration service to the configured OpenAI account,
   preferably using the Agents SDK in a separate service. Never ship API keys
   to the browser or the video runner except its existing scoped narration key.
2. Give Producer, Recording and Quality explicit tool grants. Producer may read
   project context and propose the shot list; Recording may use approved
   demo-only capture tools; Quality may read evidence and inspect authorized
   actual media. None may publish or change live customer data.
3. Extend the existing scene fingerprints, artifact hashes, attempt counts
   and per-job states into an externally queryable persistent task graph.
4. Build synchronized full-video vision + speech-transcription review, including
   sampled transitions and action outcome verification. Current frame sampling
   and audio-level probing do not validate exact speech/content alignment.
   Optional scene repair remains a user-approved, bounded action.
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

## Autopilot (prompt to rendered video)

`lib/video-autopilot.mjs` connects the existing parts into one persistent run
(`video_autopilot_runs`): the producer agent with the skill `video-komplett`
writes script and storyboard; the **Recording Agent** then plans browser actions
per recorded scene; the existing job, renderer and audiovisual QA produce the
video. State lives in the database and a worker advances one stage per tick, so
a run survives reloads and restarts.

- **No invented selectors.** The planning model never sees or writes selectors
  or URLs. Runner 1.6.0 adds `POST /video/inspect` (`pageInspectVersion: 1`),
  a read-only inventory of visible controls whose selectors match exactly one
  element. The Recording Agent refers to elements by index; the server maps the
  index to the verified selector. Addresses or actions returned by the
  storyboard model are discarded.
- **Proof run.** Before a scene is accepted, all planned actions are executed
  once on the demo. A failing action fails the run instead of being replaced.
- **No data changes.** The Recording Agent may only click, hover, scroll, wait
  and follow links. Submit buttons and controls whose name suggests saving,
  deleting, installing, uploading, paying or logging out are skipped and
  logged. Typing into fields and file uploads are not available yet, so a flow
  such as "upload an extension" is shown up to that control only.
- **Honest status.** `completed` is set only when the renderer reports `done`.
  A failed render leaves the run `failed` with the renderer's error; `retry`
  repeats the failed stage and reuses the same production.
- **Older runner.** Without `pageInspectVersion` the run records the real start
  page with scrolling only and says so in its log.
- **Modes.** `auto` renders directly; `review` stops before rendering until
  `approve`. Publishing is never part of a run.

Same functions over MCP: `video_autopilot_start`, `video_autopilot_status`,
`video_autopilot_action`, `video_page_inspect`.
