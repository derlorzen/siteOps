# SiteOps Video Studio

The SiteOps dashboard now has a Video Studio workspace for creating faceless YouTube tutorials. The main app manages projects and draft jobs in MySQL. The separate Browser Runner renders narrated video.

## What works in this stage

- Project / channel selection and a script editor at /video-studio
- One blank-line-separated paragraph per scene (maximum 24 scenes)
- Offline Kokoro ONNX voice synthesis for English
- Playwright-designed scene slides or real screenshots from allowlisted demo URLs
- FFmpeg renders a landscape or portrait MP4, a vertical short (first 59 seconds), an SRT transcript, and a thumbnail
- Authenticated downloads, progress polling and persistent job metadata
- MCP tools: video_studio_projects, video_studio_create_job, video_studio_render_job, video_studio_job_status

The initial stage produced a narrated slideshow. Later stages add real Playwright-recorded browser actions and German narration for selected scenes. A demo URL without steps still creates a still screenshot. Interactive browser recording, AI script generation within the SiteOps UI, video timeline editing, multiple edited Shorts and YouTube OAuth publication are later stages. ChatGPT can author a script and create a draft through the MCP tools without another paid text-generation API.

## Sprecherstimmen: Kokoro oder OpenAI

**Kokoro ist integriert und standardmäßig vorausgewählt.** Das ONNX-Modell erzeugt die gesprochene Tonspur lokal auf dem Runner, ohne laufende TTS-API-Kosten. Das Docker-Image installiert Kokoro und FFmpeg standardmäßig; die Modelldateien müssen separat und dauerhaft im Volume `/models` bereitgestellt werden.

**OpenAI ist optional pro Videoprojekt.** Statt Kokoro erzeugt `gpt-audio-1.5` mit der OpenAI Audio API die WAV-Sprachspur. Für OpenAI muss `OPENAI_API_KEY` als Secret **auf dem Runner** hinterlegt werden, nicht im SiteOps-Frontend. Die Auswahl von OpenAI verursacht nutzungsabhängige API-Kosten, Kokoro dagegen keine externen TTS-Kosten. Der Schlüssel wird nicht über MCP oder die Video-Studio-API zurückgegeben.

Neue Projekte speichern `voice_provider` (`kokoro` oder `openai`) und `voice` separat. Bestehende Projekte bleiben auf Kokoro. Der Renderer beachtet die Projektentscheidung; ein gesetzter OpenAI-Schlüssel aktiviert OpenAI **nicht automatisch**.

Kokoro: `am_michael`, `am_adam`, `af_heart`, `bf_emma`, `bm_george`.
OpenAI: `alloy`, `coral`, `nova`, `onyx`, `shimmer`, `marin`, `cedar` (weitere unterstützte Stimmen über API möglich).

Für ein kleineres OpenAI-only-Docker-Image ist `--build-arg INSTALL_KOKORO=false` möglich. Der Standard-Build enthält die Kokoro-Python-Abhängigkeiten, aber **nicht** die Sprachmodell-Dateien. Für einen Produktivtest müssen die Modelldateien geladen oder für das Projekt OpenAI ausgewählt werden.

## Runner setup

Build the updated Docker image from runner/Dockerfile. Mount persistent writable /data/video-studio storage and two offline model assets as read-only files in /models:

- kokoro-v1.0.onnx
- voices-v1.0.bin

Download model assets from the Kokoro ONNX project's releases: https://github.com/thewh1teagle/kokoro-onnx. Review and verify assets before installation. Do not put them in Git.

Runner environment:
- BROWSER_RUNNER_TOKEN: existing SiteOps runner token
- VIDEO_OUTPUT_DIR=/data/video-studio
- VIDEO_PYTHON=/opt/video-venv/bin/python3 (Docker default)
- KOKORO_MODEL_PATH=/models/kokoro-v1.0.onnx
- KOKORO_VOICES_PATH=/models/voices-v1.0.bin
- VIDEO_ALLOWED_HOSTS=demo.example.com,shop.example.com (optional trusted HTTPS demo screenshot hosts)

Systemd installation: runner/install-systemd.sh installs FFmpeg and a Python virtualenv with kokoro-onnx and soundfile. Model files still need to be supplied separately with paths configured in /etc/siteops-browser-runner.env. Ensure the output directory is writable by siteops-runner.

For non-production smoke testing, VIDEO_TTS_MODE=silent uses a silent audio track. The production default requires offline Kokoro assets.

In SiteOps > Einstellungen > Synthetic Runner configure the existing HTTPS URL and bearer token. Video Studio reuses those credentials. The renderer has no public endpoints without authentication.

## First video

1. Add a project like Bagisto Tutorials (English).
2. Enter a title and a reviewed voiceover script with blank lines between scenes.
3. Save the draft, then select Video rendern.
4. Refresh the job status while the private runner renders.
5. Download MP4, vertical short, SRT and thumbnail.
6. Review and publish to YouTube manually.

With ChatGPT connected to SiteOps MCP: "List my Video Studio projects. Write a factual 4-minute English Bagisto tutorial script and create a video draft using that script. Do not render before I approve."

## Safety and limits

Jobs use UUID directories, an allowlist of download types and a single active renderer. Demo screenshots accept HTTPS URLs only on hosts explicitly listed in VIDEO_ALLOWED_HOSTS. No arbitrary shell, JavaScript, SQL or filesystem paths are accepted. Avoid live customer data. The default has no automatic video expiration: configure volume limits and backup/retention policy. Large render jobs need CPU, RAM and disk space. Jobs interrupted by runner restart become failed, so create a new draft to retry.

Next stages: optional in-app LLM integration, approved screen-recorded interactions, better Shorts, YouTube OAuth uploads after editorial approval.


## Recorded browser scenes (second stage)

This stage adds real **Playwright screen recording**. A scene can provide `demoUrl` and up to 16 bounded `demoSteps`. For example, submit this payload through `POST /api/video-studio/jobs` or create the same scene via `video_studio_create_job` in the SiteOps MCP connector:

```json
{
  "project_id": "REPLACE-WITH-VIDEO-PROJECT-UUID",
  "title": "Bagisto catalog walkthrough",
  "script": "Open the catalog and locate an example product.\n\nThis demonstration shows the inventory table.",
  "format": "landscape",
  "scenes": [
    {
      "headline": "Bagisto products",
      "narration": "Open the catalog and locate an example product.",
      "demoUrl": "https://demo.example.com/admin/catalog",
      "demoSteps": [
        { "action": "click", "selector": "#products" },
        { "action": "wait", "ms": 600 },
        { "action": "scroll", "pixels": 450 }
      ]
    },
    {
      "headline": "Inventory overview",
      "narration": "This demonstration shows the inventory table."
    }
  ]
}
```

`demoSteps` actions are restricted to `click`, `hover`, `fill`, `press`, `scroll`, `wait` and `goto`. No arbitrary JavaScript, shell commands, script injection, operating system reads, arbitrary keystrokes or credential recording are supported. Supported press keys are Enter, Tab, Escape, ArrowDown and ArrowUp. Password inputs cannot be filled by recorder actions. Each step has bounded parameters and short wait times.

An approved HTTPS host must be listed in the runner's `VIDEO_ALLOWED_HOSTS` comma-separated environment variable; this includes secondary navigation and asset requests, which are blocked unless they use another allowed HTTPS host. Set it to **a dedicated staging demonstration hostname**, not your live shop or customer site. The browser does not bypass a site's authentication: for a protected demo, arrange an approved, safe demo login in staging without recording actual credentials.

The renderer records user-visible interactions in a WebM video, overlays the generated narration, and holds the last frame until the audio is finished. Slides and static screenshots remain available. In the UI, the **Erweiterter Szenenplan (JSON)** editor accepts the `scenes` array from the example (without the outer job fields). You can create it directly from a ChatGPT MCP tool call as well.

Video publishing to YouTube, AI-generated on-screen actions without a reviewed plan, credential vaults and voice synchronization editing remain future work.


## Bilingual German and English production (current)

At project creation, select the video language and narration provider:

| Language | Local (no API usage cost) | Optional paid API |
| --- | --- | --- |
| English (`en`) | Kokoro: `am_michael`, `am_adam`, `af_heart`, `bf_emma`, `bm_george` | OpenAI `gpt-audio-1.5` |
| German (`de`) | Piper: `de_DE-thorsten-medium` (Standard German) | OpenAI `gpt-audio-1.5` |

The language and voice provider are validated together. German cannot be synthesized using English Kokoro and English cannot be synthesized with the German-only Piper model. Narration instructions for the OpenAI mode are sent in the selected language. You can still create different English and German projects for the same channel.

### Voice model setup

Voice model files are no longer a manual prerequisite: for local voices the runner downloads the required English Kokoro or German Piper ONNX assets on the **first render**, verifies their published cryptographic checksums, and caches them in `VIDEO_MODEL_DIR` (`/data/video-studio/models` in Docker). Downloads may initially take time and require outbound HTTPS. Later renders reuse the saved model files.

Kokoro voice assets: thewh1teagle/kokoro-onnx's fixed `model-files-v1.0` release.
Piper German assets: rhasspy/piper-voices, `de_DE-thorsten-medium.onnx` and its `.json` configuration. The published voice model card names its training dataset as CC0. Please review the model card and dependencies before redistributing.

Both local engines run inside the Browser Runner. The default runner Docker image includes `kokoro-onnx`, `piper-tts`, Python virtualenv, eSpeak library and FFmpeg. The Docker Compose example now mounts a persistent named volume `siteops-video-data`; don't remove it during routine redeployments. Never store model files inside Git.

The authenticated `/video/capabilities` runner endpoint and SiteOps's `/api/video-studio/capabilities` proxy report supported languages, availability of cached model assets, and whether the optional OpenAI key has been configured. **Model cached** does not by itself guarantee a successful synthesis; verify the first complete German and English rendering.

For an existing systemd installation, deploy the updated runner code and run `runner/install-systemd.sh` on the VPS (as root); it installs Piper and creates the writable model directory. Existing credentials and the bearer token are preserved.

**Deployment boundary:** SiteOps running a newer web-app revision does not automatically redeploy the separate Browser Runner at `browse.lorzen.de`. The runner must be updated too. If the model download is blocked or the machine lacks free storage, voice generation fails with an error instead of silently falling back to paid OpenAI. No OpenAI API calls are performed unless the project explicitly chooses OpenAI.

## Edited final MP4 and project production knowledge

A completed production can import an edited MP4 via the **Gesamtvorschau → Geschnittene Endfassung** panel or `video_studio_import_final` (job ID, filename, SHA-256, canonical base64). The current limit is **5 MiB**, including the entire MP4 but excluding base64 overhead. This intentionally fits the existing 8 MiB MCP request envelope. Larger files must be exported more compactly; chunked imports are not implemented.

Imports are stored in MySQL with their own immutable asset ID, checksum, dimensions and duration. The MP4 container is structurally inspected for movie metadata, media content, video/audio tracks and orientation. This is not a codec decode or audiovisual review. Original runner files and older final versions remain intact. Video preview and download select the latest imported final; an explicit `original` download still returns the runner video. Shorts and subtitle files remain from the runner and must be checked separately after editing.

Private YouTube upload previews snapshot the exact final asset ID and checksum. The resumable worker reads that version for HEAD and every byte range. Importing a newer final does not silently change an already approved upload. Existing legacy uploads remain bound to the runner source. Thumbnail and metadata review remain separate requirements.

Under **Einstellungen → Produktionsregeln für dein Projekt**, users can read/edit global fallback rules or the selected project's own rules. Project rules replace the global fallback; the inheritance button restores the fallback. The same encrypted settings service supplies the UI, every in-app assistant request, and `video_production_guidelines_get` / `video_production_guidelines_save`. Fetch with `project_id` before planning or producing through MCP. Both tools return local/global revisions; writes require the last-read revisions. Rules are editorial preferences, not permission to bypass approval or evidence that an edit or review has been performed. Brand and language requirements belong in project rules, not unrelated projects' global defaults.
