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

The initial stage produced a narrated slideshow. The second stage adds real Playwright-recorded browser actions for selected scenes. A demo URL without steps still creates a still screenshot. Interactive browser recording, AI script generation within the SiteOps UI, video timeline editing, multiple edited Shorts and YouTube OAuth publication are later stages. ChatGPT can author a script and create a draft through the MCP tools without another paid text-generation API.

## Sprecherstimmen: Kokoro oder OpenAI

**Kokoro ist integriert und standardmäßig vorausgewählt.** Das ONNX-Modell erzeugt die gesprochene Tonspur lokal auf dem Runner, ohne laufende TTS-API-Kosten. Das Docker-Image installiert Kokoro und FFmpeg standardmäßig; die Modelldateien müssen separat und dauerhaft im Volume `/models` bereitgestellt werden.

**OpenAI ist optional pro Videoprojekt.** Statt Kokoro erzeugt `gpt-audio-1.5` mit der OpenAI Audio API die WAV-Sprachspur. Für OpenAI muss `OPENAI_API_KEY` als Secret **auf dem Runner** hinterlegt werden, nicht im SiteOps-Frontend. Die Auswahl von OpenAI verursacht nutzungsabhängige API-Kosten, Kokoro dagegen keine externen TTS-Kosten. Der Schlüssel wird nicht über MCP oder die Video-Studio-API zurückgegeben.

Neue Projekte speichern `voice_provider` (`kokoro` oder `openai`) und `voice` separat. Bestehende Projekte bleiben auf Kokoro. Der Renderer beachtet die Projektentscheidung; ein gesetzter OpenAI-Schlüssel aktiviert OpenAI **nicht automatisch**.

Kokoro: `am_michael`, `am_adam`, `af_heart`, `bf_emma`, `bm_george`.
OpenAI: `alloy`, `coral`, `nova`, `onyx`, `shimmer`, `marin`, `cedar` (weitere unterstützte Stimmen über API möglich).

Für ein kleineres OpenAI-only-Docker-Image ist `--build-arg INSTALL_KOKORO=false` möglich. Der Standard-Build enthält die Kokoro-Python-Abhängigkeiten, aber **nicht** die Sprachmodell-Dateien. Für einen Produktivtest müssen die Modelldateien geladen oder für das Projekt OpenAI ausgewählt werden.


## Vollständige zweisprachige Produktion

Die aktuelle Version unterstützt zwei Sprachen und drei TTS-Anbieter:

| Sprache | Lokal, ohne API-Gebühren | OpenAI API |
| --- | --- | --- |
| Englisch | Kokoro: Michael, Adam, Heart, Emma, George | Alloy, Coral, Nova, Onyx, Shimmer, Marin, Cedar |
| Deutsch | Piper: Thorsten (mittel), Kerstin (niedrig) | dieselben OpenAI-Stimmen, mit deutschem Sprecherprompt |

Im Dashboard wählst du pro Projekt die **Sprache**, den **Stimmenanbieter** und die **Stimme**. Bestehende englische Projekte behalten Kokoro. Deutsch voreingestellt: Piper mit Thorsten.

**Lokale Modelle:** Der Docker Runner installiert Kokoro, Piper und FFmpeg. Beim **ersten Containerstart** lädt `runner/setup-voice-models.py` die Modell-Dateien in `/models`. Lege unbedingt ein beschreibbares Docker-Volume auf `/models` und eines auf `/data/video-studio`. Bereits geladene Dateien werden beim Neustart wiederverwendet. Der Download kann mehrere hundert Megabyte betragen. `VIDEO_AUTO_INSTALL_MODELS=false` unterdrückt das Laden, z. B. in reinen CI-Runs oder wenn Modell-Dateien manuell bereitgestellt wurden.

Alternativ installiert `runner/install-systemd.sh` die TTS-Abhängigkeiten; der systemd-Service lädt die Modell-Dateien einmalig nach `/var/lib/siteops-voice-models`. Er benötigt beim ersten Start Zugriff auf GitHub Releases und Hugging Face.

**Beispiel:**

```bash
docker build -t siteops-browser-runner ./runner
docker volume create siteops-video-models
docker volume create siteops-video-output
docker run -d --name siteops-browser-runner \
  --restart unless-stopped \
  -e BROWSER_RUNNER_TOKEN='<VORHANDENES-RUNNER-TOKEN>' \
  -e VIDEO_AUTO_INSTALL_MODELS=true \
  -e VIDEO_ALLOWED_HOSTS='DEIN-TESTSHOP.example' \
  -v siteops-video-models:/models \
  -v siteops-video-output:/data/video-studio \
  -p 127.0.0.1:3200:3200 \
  siteops-browser-runner
```

`OPENAI_API_KEY` nur auf dem Runner hinterlegen, falls API-Sprachausgabe ausdrücklich gewünscht ist. Niemals in Git oder einem Chat teilen. Den existierenden Reverse Proxy unter HTTPS beibehalten.

**Diagnose:** Im Video Studio gibt es unter „Render-Server & Stimmen“ eine Übersicht. Die geschützte SiteOps-API `GET /api/video-studio/capabilities` gibt den Status des konfigurierten Runners wieder; der Runner prüft vorhandene Dateien und meldet die lokale oder optionale API-Sprachausgabe als verfügbar bzw. fehlend. Das UI ermöglicht eine Aktualisierung des Status, bevor ein Videoauftrag gestartet wird.

**Hinweise zur Lizenzierung:** Kokoro ist ein Apache-2.0-Modell, die Wrapper-Bibliothek MIT. Piper-Software hat eigene GPL-Lizenzbedingungen, und einzelne Stimmen besitzen eigene Datensatz-/Modell-Lizenzen. Die hier vorausgewählten deutschen Modelle „Thorsten“ und „Kerstin“ dokumentieren CC0-Datensätze. Bei Weiterverteilung des Runner-Images müssen die jeweiligen Software- und Modelllizenzen gesondert geprüft und beigelegt werden.

**Umfang:** Die Erzeugung von Sprechertext, die Übersetzung von Skripten sowie die Veröffentlichung bei YouTube sind weiterhin Aufgaben für ChatGPT per MCP bzw. die manuelle Freigabe. Die Videoerstellung selbst (Sprachausgabe, Browseraufnahmen, MP4, Shorts, SRT und Vorschaubild) ist in der Render-Pipeline implementiert. Die Sprachwahl übersetzt einen englischen Text nicht automatisch ins Deutsche; für die deutsche Version brauchst du einen deutschen Sprechertext.


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
