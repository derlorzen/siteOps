# ChatGPT → SiteOps Video Studio

Video Studio remains the single project/job/file store. New English projects use
Kokoro Adam (`am_adam`); German projects use Piper Thorsten
(`de_DE-thorsten-medium`). Both languages can explicitly choose OpenAI Audio.
Existing project voices, jobs and runner files are preserved. New jobs save an
immutable voice/language snapshot; older jobs fall back to their project settings.

## Authoring workflow for an MCP client

1. Ask for the topic, audience and desired language/format if not already clear.
2. Research the subject and check actual product functions through read-only
   connected product tools, repository documentation and primary sources. Never
   invent a feature or demonstrate it against customer data. Keep source URLs and
   verification notes with the video metadata.
3. Call `video_studio_projects`; reuse a matching project, or call
   `video_studio_create_project`. Check `video_studio_runner_status` for supported
   voices, offline models, connectivity and optional OpenAI configuration.
4. Call `video_studio_demo_templates` to reuse an approved demonstration. Author
   narration and `visual_directions` for each scene. Browser actions require
   `test_data_only:true` and must pass the active demo-domain policy. Password
   recording remains blocked. Never place account secrets in scenes or templates.
5. Call `video_studio_create_job` with `format:landscape` (16:9) or `portrait`
   (9:16), the script, scene plan and `youtube` preparation: localized SEO title,
   description, keywords, hashtags, planned chapter timestamps, thumbnail concept
   and verified sources. No LLM is secretly invoked on the server. When metadata
   is omitted, SiteOps creates an editable language-aware starting suggestion.
6. Show the exact draft to the user and ask for rendering approval. Only then call
   `video_studio_render_job` with `approved:true`. Never infer that creating a
   draft authorizes rendering. This new explicit field is required; legacy tool
   names remain available and existing stored drafts are supported.
7. Poll `video_studio_job_status` at a reasonable interval. On completion call
   `video_studio_downloads`. Its signed per-file links expire in five minutes and
   never expose runner/OAuth tokens. Request fresh links when needed.

`video_studio_list_jobs` is scoped to a project and paginated (`limit`, `offset`);
continue until an empty page to retrieve all history. `video_studio_update_project`
changes future defaults. `video_studio_save_demo_template` snapshots reusable
actions into new jobs; later template changes do not mutate existing jobs.
`video_studio_update_metadata` edits YouTube preparation without triggering a
render/upload/publication. Chapter marks are initially estimates based on the
scene plan; review them against the final narration/video before publishing.

## Downloads and storage

The existing dashboard-authenticated `/api/video-studio/jobs/:id/file` remains
available. MCP downloads issue HMAC-authenticated, job/file-bound HTTPS capability
links. The one dedicated download route verifies the signature/expiry before
contacting the runner; other dashboard routes retain session authentication.
Capability request logging is disabled and responses prohibit caching/referrers.

Migration `20261026_video_production.mjs` only adds nullable JSON columns and a
template table. It does not rewrite existing voices or delete any jobs/files.
Metadata is stored separately from rendered result paths, so publication adapters
can consume it without creating a second production system. Rendering and YouTube
publishing remain separate explicit operations.
