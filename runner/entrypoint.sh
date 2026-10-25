#!/usr/bin/env bash
set -euo pipefail
if [[ "${VIDEO_AUTO_INSTALL_MODELS:-true}" == "true" ]]; then
  "${VIDEO_PYTHON:-/opt/video-venv/bin/python3}" /app/setup-voice-models.py \
    --models-dir "${VIDEO_MODELS_DIR:-/models}" \
    --language all
fi
exec node /app/server.mjs
