# SiteOps Browser Runner

Video demo domains can be managed under **SiteOps → Video Studio → Demo-Domains**.
Rules support exact DNS names and `*.domain.tld` for true subdomains (excluding the
apex). No allow-all rule is accepted. The authenticated backend transmits a
versioned policy with each new job over HTTPS; there is no Docker configuration
write or runner restart when saving rules. Until explicitly saved, the runner
uses `VIDEO_ALLOWED_HOSTS` as a fallback. An explicitly empty GUI list denies all
demos. See [policy architecture, migration and rollout](../docs/VIDEO_DEMO_POLICY.md)
before deploying. This requires an updated runner image; preserve the existing
token, HTTPS proxy and persistent `/data/video-studio` volume in Docker Manager.

Optional Playwright execution service for SiteOps synthetic journeys and visual regression checks.

## Production install on a VPS (systemd, no Docker)

Requirements: Ubuntu/Debian-compatible VPS, Node.js 22+, npm, root/sudo access and an HTTPS reverse proxy.

From a checkout of the SiteOps repository:

```bash
cd runner
sudo bash install-systemd.sh
```

The installer:

- creates the restricted `siteops-runner` system user,
- installs the runner into `/opt/siteops-browser-runner`,
- installs Playwright + Chromium and required OS packages,
- generates `/etc/siteops-browser-runner.env` with a random bearer token,
- installs and enables `siteops-browser-runner.service`,
- binds the runner to `127.0.0.1:3200` by default.

The generated token is printed once. Store it in **SiteOps → Einstellungen → Synthetic Runner** together with the public HTTPS URL.

Useful commands:

```bash
sudo systemctl status siteops-browser-runner
sudo journalctl -u siteops-browser-runner -f
curl http://127.0.0.1:3200/health
```

For HTTPS, proxy a dedicated hostname to `http://127.0.0.1:3200`. See `nginx-siteops-browser-runner.conf.example`. If the VPS already has another reverse proxy, use the same upstream and timeout values rather than running a second proxy stack.

After publishing the hostname, enter the URL and token in SiteOps and click **Browser Runner testen**.

## Docker

```bash
cd runner
docker build -t siteops-browser-runner .
docker run -d --name siteops-browser-runner \
  -e BROWSER_RUNNER_TOKEN="$(openssl rand -base64 32)" \
  -p 127.0.0.1:3200:3200 \
  --restart unless-stopped \
  siteops-browser-runner
```

Or with Compose:

```bash
cd runner
cp docker-compose.yml.example docker-compose.yml
# edit BROWSER_RUNNER_TOKEN in docker-compose.yml
docker compose up -d
```

The image runs as a non-root user, same as the systemd install. It binds to
`127.0.0.1:3200` by default (via the `-p 127.0.0.1:3200:3200` port mapping) -
put your own reverse proxy in front for HTTPS (Nginx, Caddy, Traefik, or
whatever your Docker host already uses), exactly as in the VPS setup above.
`nginx-siteops-browser-runner.conf.example` still applies if you're using
Nginx.

Update: rebuild the image (`docker build ...` / `docker compose build`) and
recreate the container - this re-runs `npx playwright install` and picks up
both the latest code and a matching Chromium build.

```bash
docker logs -f siteops-browser-runner
curl http://127.0.0.1:3200/health
```

## Update des vorhandenen Browser Runners (Stand Oktober 2026)

Der SiteOps-Webserver und der Browser Runner auf `browse.lorzen.de` werden
getrennt bereitgestellt. Ein neuer Commit auf `main` aktualisiert den Browser
Runner **nicht** automatisch.

Dieses Repository enthält `runner/update-existing.sh`. Es erkennt eine
aktive systemd- oder Docker-Compose-Installation. Das Skript aktualisiert nur
einen **bereits laufenden** Runner mit bekannten Zugangsdaten. Es kopiert
keine Kennwörter in Git und ersetzt bestehende Docker-Volumes nicht.

**Vorbereitung auf dem tatsächlichen Runner-Host:**

1. Stelle fest, ob `browse.lorzen.de` über Hostinger Docker Manager,
   Docker Compose, einen einzelnen Docker-Container oder systemd läuft.
2. Öffne die Konsole **dieses Hosts**, nicht die SiteOps-Webkonsole.
3. Aktualisiere die vorhandene lokale Git-Arbeitskopie:
   `git -C /PFAD/ZU/siteOps pull --ff-only origin main`.
4. Zuerst schreibgeschützt prüfen:

```bash
cd /PFAD/ZU/siteOps
bash runner/update-existing.sh --check
```

**Bei einer bestehenden systemd-Installation:**

```bash
sudo bash runner/update-existing.sh --apply --systemd
```

**Bei einer bestehenden Docker-Compose-Installation:** Stelle sicher, dass der
`build.context` des bereits laufenden Compose-Stacks auf
`/PFAD/ZU/siteOps/runner` zeigt und `/data/video-studio` als Volume
eingehängt ist. Im gleichen Compose-Verzeichnis/Projekt:

```bash
SITEOPS_RUNNER_COMPOSE_DIR=/PFAD/ZUM/BESTEHENDEN-COMPOSE-VERZEICHNIS \
  bash runner/update-existing.sh --apply --compose
```

Das Skript verweigert den Vorgang, falls kein passender laufender Dienst
gefunden wird, der Zugriffstoken fehlt, der Compose-Build-Kontext auf
anderen Quellcode zeigt oder persistenter Speicher fehlt. Es führt
anschließend einen Health- und Fähigkeitencheck durch. Sprachmodelle werden
vorab heruntergeladen und geprüft. Das erste Laden benötigt zusätzliche
Festplattenkapazität und Netzwerkzugang.

**Hostinger Docker Manager / einzeln gestarteter Container:**
Dort dürfen die obigen Befehle nicht auf gut Glück verwendet werden. Öffne
den bestehenden Container/Stack in Hostinger und aktualisiere **dessen**
Build-Quelle auf `derlorzen/siteOps` Branch `main`, Dockerfile
`runner/Dockerfile`. Erhalte die bestehende
`BROWSER_RUNNER_TOKEN`-Umgebungsvariable und das bisherige HTTPS-Routing.
Konfiguriere einen dauerhaften Mount für `/data/video-studio` und
`VIDEO_ALLOWED_HOSTS` nur für vertrauenswürdige Testseiten. Starte den
bereits verwalteten Stack neu. Kein zweiter Container auf dem gleichen Port.

Nach dem Update: `https://siteops.lorzen.cloud/video-studio` öffnen und
Deutsch (Piper/Thorsten) und Englisch (Kokoro) jeweils mit einem kurzen
Testvideo kontrollieren. Die SiteOps-API fragt den unter Einstellungen
konfigurierten Runner ab. Der öffentliche Health-Endpunkt allein beweist
nicht, dass TTS und Video-Export funktionieren.


## Manual / development install

```bash
cd runner
npm install
npx playwright install --with-deps chromium
export BROWSER_RUNNER_TOKEN='<long random token>'
npm start
```

## Security

- `/run`, `/render` and `/auth-test` require `Authorization: Bearer <BROWSER_RUNNER_TOKEN>`.
- `/run` navigation steps are restricted to the hostname of the configured SiteOps test URL. `/render` only restricts the scheme to `http`/`https`.
- The runner does not accept arbitrary JavaScript/eval steps.
- Keep the service itself on localhost/private networking and expose it only through HTTPS.
- Keep the token in `/etc/siteops-browser-runner.env` (or your Docker env var) or another secret store, never in Git.

Supported `/run` actions: `goto`, `click`, `fill`, `press`, `select`, `check`, `uncheck`, `hover`, `reload`, `waitFor`, `waitForLoadState`, `wait`, `assertText`, `assertVisible`, `assertValue`, `assertAttribute`, `assertCount`, `assertUrl`, `assertTitle`.

`/render` takes `{ "url": "https://...", "timeoutMs": 20000 }`, navigates once, waits for the network to go quiet (or the timeout, whichever comes first) and returns the rendered `html`. SiteOps' SEO crawler uses this as a fallback for pages that look too thin in the raw HTTP response (client-rendered content, e.g. Next.js).

The runner also captures console errors, uncaught page errors, failed network requests and HTTP 4xx/5xx responses. Visual screenshots run with reduced motion and disabled animations to reduce false-positive pixel diffs.

### Authenticated demo recordings (Runner 1.1.0)

Update this existing service from the current repository; preserve its token, output/model volumes and other environment settings. Docker builds include `video-login.mjs`; the systemd installer copies it too. `/health` reports version 1.1.0, and authenticated `/video/capabilities` advertises `demoLoginVersion: 1` and the Full-HD output sizes.

SiteOps passes only the demo profiles referenced by a reviewed job. Login occurs without a recorder, using one allowlisted HTTPS origin, a checked form destination, and a successful protected landing-page check. Credentials and cookies stay in RAM on the Runner and are removed at job completion. Browser recordings receive the resulting same-origin session, never login actions or passwords. Password inputs remain forbidden in recorded steps. Failed/expired sessions fail production. Login test requests are rate-limited; no CAPTCHA or 2FA bypass is supported.

Final MP4 and Short dimensions are checked by FFprobe before completion. Both are at least Full HD: 1920×1080 landscape and 1080×1920 portrait.

### Shared Suite key and audio test (Runner 1.1.1)

The `/health` and `/auth-test` versions share the package version. `openaiKeyForwardingVersion: 1` advertises per-job credentials. Only authenticated OpenAI narration jobs accept `openaiApiKey`; it is removed from the request body and retained in memory, outside the persisted job object, until completion/failure. `OPENAI_API_KEY` remains a fallback. `/video/openai-audio-test` performs a small real generation with a transient key and removes the temporary WAV. Never log request bodies containing credentials.

After updating the Runner, use **Video Suite → Einstellungen → Sprachausgabe testen**. A successful Responses API test alone does not establish audio-model access.
