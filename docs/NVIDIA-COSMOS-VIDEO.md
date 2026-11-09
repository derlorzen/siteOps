# NVIDIA Playground / Cosmos 3 Nano in SiteOps Video Suite

## Status (2026-11-09)

The NVIDIA Build Playground and its public bearer-key API are **not the same thing**.
NVIDIA publishes a Cosmos 3 Nano text-to-video endpoint, but developers reported HTTP 404
with valid Build keys through 2026-11-04. A working live generation has **not** been
verified. This integration fails explicitly on 404 and must not fall back to a slide.
It never automates the website or reuses Playground login cookies/CAPTCHA.

References:
- https://build.nvidia.com/nvidia/cosmos3-nano/modelcard
- https://forums.developer.nvidia.com/t/404-error-missing-api-endpoint-code-for-cosmos3-nano-on-build-nvidia-com/372044

## Setup

1. Update the SiteOps main application and the separate Video Runner to the same revision.
2. Generate a **Build Endpoints API key**, not an NGC registry key, at https://build.nvidia.com.
3. Add `NVIDIA_API_KEY` to the **Video Runner's secret environment** (never to Git, frontend, or a video prompt).
4. Restart the Video Runner. The authenticated `/video/capabilities` endpoint reports
   `nvidiaVideo.version: 1`, `configured: true`, `apiVerified: false`.
   Configured means a key exists, **not** that NVIDIA accepts video requests.
5. In SiteOps Video Suite, create a scene and choose **NVIDIA Cosmos KI-Video**.
   Enter an English prompt and choose ~1/~3/~5/~8-second clip length.
6. Approve the video production to send the selected scenes to NVIDIA and assemble
   the returned MP4 with FFmpeg, subtitles and voiceover.

Only text-to-video is supported in this version. The generated original MP4 is retained
in the Runner's private job directory, while the final exported MP4 is re-encoded in
1080p with the narration. NASA/NVIDIA SynthID and other provenance may change on re-encode.
Do not remove mandatory input screening or provenance controls.

There is no implicit retry if the provider responds with an unknown timeout: a
timed-out request may still have completed remotely. Error status and provider availability
must be checked before submitting a new generation request.

## API and security

The endpoint is pinned to
`POST https://ai.api.nvidia.com/v1/cosmos/nvidia/cosmos3-nano`.
A scene calls `model_mode=text2video` with 480p aspect, 24 fps and 25–197 frames.
SiteOps does not send customer data or Browser Demo login credentials to this provider.
Never include credentials, live customer information, personal data or protected
materials in AI prompts. Only use content and outputs as permitted by NVIDIA's
applicable terms, model license and your account authorization.

The Runner stores the secret only in its process environment. Video jobs store
the approved prompt, not the API key. The authorization is issued with the
server-side request only. A missing or rejected key blocks the job.

## What this does not do

- It does not create a free unlimited production video API.
- It does not guarantee that NVIDIA's advertised API is callable.
- It does not enable image-to-video yet.
- It does not launch NVIDIA GPU inference on Oracle A1; Oracle only runs SiteOps,
  browser capture and FFmpeg, while NVIDIA hosts the actual model.
