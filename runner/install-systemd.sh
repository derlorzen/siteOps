#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/siteops-browser-runner}"
ENV_FILE="${ENV_FILE:-/etc/siteops-browser-runner.env}"
SERVICE_FILE="/etc/systemd/system/siteops-browser-runner.service"
SERVICE_USER="${SERVICE_USER:-siteops-runner}"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root (sudo ./install-systemd.sh)." >&2
  exit 1
fi

command -v node >/dev/null || { echo "Node.js is required." >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is required." >&2; exit 1; }

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if [[ "${NODE_MAJOR}" -lt 22 ]]; then
  echo "Node.js >= 22 is required; found $(node -v)." >&2
  exit 1
fi

if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir "${APP_DIR}" --shell /usr/sbin/nologin "${SERVICE_USER}"
fi

install -d -o "${SERVICE_USER}" -g "${SERVICE_USER}" -m 0755 "${APP_DIR}"
install -m 0644 "${SOURCE_DIR}/package.json" "${APP_DIR}/package.json"
install -m 0644 "${SOURCE_DIR}/server.mjs" "${APP_DIR}/server.mjs"
install -m 0644 "${SOURCE_DIR}/video-studio.mjs" "${APP_DIR}/video-studio.mjs"
install -m 0644 "${SOURCE_DIR}/video-demo.mjs" "${APP_DIR}/video-demo.mjs"
install -m 0644 "${SOURCE_DIR}/video-policy.mjs" "${APP_DIR}/video-policy.mjs"
install -m 0644 "${SOURCE_DIR}/video-network.mjs" "${APP_DIR}/video-network.mjs"
install -m 0644 "${SOURCE_DIR}/video-file-range.mjs" "${APP_DIR}/video-file-range.mjs"
install -m 0644 "${SOURCE_DIR}/openai-audio.mjs" "${APP_DIR}/openai-audio.mjs"
install -m 0644 "${SOURCE_DIR}/kokoro-voice.py" "${APP_DIR}/kokoro-voice.py"
install -m 0644 "${SOURCE_DIR}/piper-voice.py" "${APP_DIR}/piper-voice.py"
install -m 0644 "${SOURCE_DIR}/ensure-voice-models.py" "${APP_DIR}/ensure-voice-models.py"
# FFmpeg and Kokoro are needed only for Video Studio rendering.
apt-get update && apt-get install -y --no-install-recommends ffmpeg python3-venv libespeak-ng1
if [[ ! -x "${APP_DIR}/venv/bin/python3" ]]; then python3 -m venv "${APP_DIR}/venv"; fi
"${APP_DIR}/venv/bin/pip" install --upgrade kokoro-onnx soundfile piper-tts
install -d -o "${SERVICE_USER}" -g "${SERVICE_USER}" -m 0750 /var/lib/siteops-video-studio
install -d -o "${SERVICE_USER}" -g "${SERVICE_USER}" -m 0750 /var/lib/siteops-video-studio/models

cd "${APP_DIR}"
PLAYWRIGHT_BROWSERS_PATH=0 npm install --omit=dev
PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install --with-deps chromium
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${APP_DIR}"

if [[ ! -f "${ENV_FILE}" ]]; then
  TOKEN="$(openssl rand -hex 32)"
  umask 077
  cat > "${ENV_FILE}" <<EOF
HOST=127.0.0.1
PORT=3200
BROWSER_RUNNER_TOKEN=${TOKEN}
VIDEO_PYTHON=/opt/siteops-browser-runner/venv/bin/python3
VIDEO_OUTPUT_DIR=/var/lib/siteops-video-studio
VIDEO_MODEL_DIR=/var/lib/siteops-video-studio/models
EOF
  echo
  echo "Generated runner token (store it in SiteOps -> Einstellungen -> Synthetic Runner):"
  echo "${TOKEN}"
  echo
else
  chmod 600 "${ENV_FILE}"
  echo "Keeping existing ${ENV_FILE}."
fi

install -m 0644 "${SOURCE_DIR}/siteops-browser-runner.service" "${SERVICE_FILE}"
systemctl daemon-reload
systemctl enable --now siteops-browser-runner.service

echo
systemctl --no-pager --full status siteops-browser-runner.service || true
echo
echo "Local health check:"
curl -fsS http://127.0.0.1:3200/health || true
echo
echo
echo "Next: publish 127.0.0.1:3200 through HTTPS and enter that URL plus the token in SiteOps."
