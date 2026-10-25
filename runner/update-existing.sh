#!/usr/bin/env bash
# Upgrade the EXISTING SiteOps Browser Runner, never create a replacement.
# Usage:
# bash runner/update-existing.sh --check
# sudo bash runner/update-existing.sh --apply --systemd
# SITEOPS_RUNNER_COMPOSE_DIR=/existing/dir bash runner/update-existing.sh --apply --compose
set -euo pipefail
ACTION=""; MODE=""
for arg in "$@"; do
  case "$arg" in
    --check|--apply) ACTION="$arg" ;;
    --systemd|--compose) MODE="$arg" ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done
if [[ -z "$ACTION" ]]; then
  echo "Usage: bash runner/update-existing.sh --check [--compose|--systemd]" >&2
  echo "       bash runner/update-existing.sh --apply --compose" >&2
  echo "       sudo bash runner/update-existing.sh --apply --systemd" >&2
  exit 2
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_DIR="${SITEOPS_RUNNER_COMPOSE_DIR:-$SCRIPT_DIR}"
SERVICE="${SITEOPS_RUNNER_COMPOSE_SERVICE:-siteops-browser-runner}"
is_systemd=false; is_compose=false
if command -v systemctl >/dev/null 2>&1 &&
   systemctl is-active --quiet siteops-browser-runner.service; then
  is_systemd=true
fi
if command -v docker >/dev/null 2>&1 &&
   docker compose version >/dev/null 2>&1 &&
   [[ -f "$COMPOSE_DIR/docker-compose.yml" ]]; then
  if docker compose --project-directory "$COMPOSE_DIR" -f "$COMPOSE_DIR/docker-compose.yml" \
    ps --status running --services 2>/dev/null | grep -Fxq "$SERVICE"; then
    is_compose=true
  fi
fi
echo "Repository: $REPO_DIR"
echo "Existing systemd runner: $is_systemd"
echo "Existing Docker Compose runner: $is_compose"
echo "Compose directory: $COMPOSE_DIR"
if [[ "$ACTION" == "--check" ]]; then
  echo "No changes made. Standalone Docker/Hostinger Docker Manager require their existing management UI."
  exit 0
fi
if [[ -z "$MODE" ]]; then
  echo "Specify exactly one existing deployment type: --systemd or --compose." >&2
  exit 2
fi
if [[ "$MODE" == "--systemd" ]]; then
  if [[ "$is_systemd" != true || "$is_compose" == true ]]; then
    echo "Cannot uniquely identify an active systemd-only runner. Refusing replacement." >&2
    exit 3
  fi
  if [[ "$EUID" -ne 0 ]]; then
    echo "systemd upgrade requires sudo/root." >&2; exit 3
  fi
  if [[ ! -s /etc/siteops-browser-runner.env ]] ||
     ! grep -q '^BROWSER_RUNNER_TOKEN=.' /etc/siteops-browser-runner.env; then
    echo "Existing runner credentials missing. Refusing to replace authentication." >&2
    exit 3
  fi
  BACKUP="/root/siteops-runner-env-$(date -u +%Y%m%dT%H%M%SZ).bak"
  install -m 0600 /etc/siteops-browser-runner.env "$BACKUP"
  echo "Existing credentials backed up under /root (not printed)."
  bash "$SCRIPT_DIR/install-systemd.sh"
  # Preload both checksum-verified local voice models using the same
  # restricted service user as the runner.
  MODEL_DIR="$(sed -n 's/^VIDEO_MODEL_DIR=//p' /etc/siteops-browser-runner.env | head -n 1)"
  MODEL_DIR="${MODEL_DIR:-/var/lib/siteops-video-studio/models}"
  runuser -u siteops-runner -- /opt/siteops-browser-runner/venv/bin/python3 \
    /opt/siteops-browser-runner/ensure-voice-models.py --provider kokoro --directory "$MODEL_DIR"
  runuser -u siteops-runner -- /opt/siteops-browser-runner/venv/bin/python3 \
    /opt/siteops-browser-runner/ensure-voice-models.py --provider piper --directory "$MODEL_DIR"
  systemctl restart siteops-browser-runner.service
  systemctl is-active --quiet siteops-browser-runner.service
  curl -fsS --max-time 10 http://127.0.0.1:3200/health >/dev/null
  TOKEN="$(sed -n 's/^BROWSER_RUNNER_TOKEN=//p' /etc/siteops-browser-runner.env | head -n 1)"
  curl -fsS --max-time 15 -H "Authorization: Bearer $TOKEN" \
    http://127.0.0.1:3200/video/capabilities |
    python3 -c 'import json,sys; x=json.load(sys.stdin); assert "de" in x.get("languages",[]); assert "en" in x.get("languages",[]); print("Runner: German and English supported.")'
  unset TOKEN
  echo "Upgrade completed. Existing bearer token preserved."
  exit 0
fi
if [[ "$MODE" == "--compose" ]]; then
  if [[ "$is_compose" != true || "$is_systemd" == true ]]; then
    echo "Cannot uniquely identify an existing Docker Compose runner." >&2; exit 3
  fi
  COMPOSE=(docker compose --project-directory "$COMPOSE_DIR" -f "$COMPOSE_DIR/docker-compose.yml")
  "${COMPOSE[@]}" config --format json | python3 -c '
import json,sys
cfg=json.load(sys.stdin)
service=sys.argv[1]
root=sys.argv[2]
app=cfg["services"].get(service)
if not app: raise SystemExit("Runner not present in Compose.")
if not any(v.get("target")=="/data/video-studio" for v in app.get("volumes",[])):
    raise SystemExit("Persistent /data/video-studio volume missing. Configure first.")
env=app.get("environment") or {}
token=env.get("BROWSER_RUNNER_TOKEN")
if not token or token.startswith("replace-with-") or token.startswith("<"):
    raise SystemExit("Runner token missing or a placeholder.")
build=app.get("build") or {}
if not build or build.get("context")!=root:
    raise SystemExit("Compose must build from this checked-out runner directory.")
print("Existing credentials, persistent volume and build directory verified.")
' "$SERVICE" "$SCRIPT_DIR"
  "${COMPOSE[@]}" build "$SERVICE"
  "${COMPOSE[@]}" up -d --no-deps "$SERVICE"
  # Model weights are installed only once into the existing persistent volume.
  "${COMPOSE[@]}" exec -T "$SERVICE" sh -c '
    set -e
    models="${VIDEO_MODEL_DIR:-/data/video-studio/models}"
    /opt/video-venv/bin/python3 /app/ensure-voice-models.py --provider kokoro --directory "$models"
    /opt/video-venv/bin/python3 /app/ensure-voice-models.py --provider piper --directory "$models"
  '
  "${COMPOSE[@]}" exec -T "$SERVICE" node -e '
const base="http://127.0.0.1:"+(process.env.PORT||3200);
(async()=>{
  const health=await fetch(base+"/health");
  if(!health.ok)throw Error("Runner health check failed.");
  const cap=await fetch(base+"/video/capabilities",{headers:{Authorization:"Bearer "+process.env.BROWSER_RUNNER_TOKEN}});
  if(!cap.ok)throw Error("Bilingual endpoint failed (HTTP "+cap.status+").");
  const info=await cap.json();
  if(!info.languages?.includes("de")||!info.languages?.includes("en"))throw Error("Missing German or English support");
  console.log("Runner healthy. German and English supported.");
})().catch(e=>{console.error(e.message);process.exit(1);});
'
  echo "Upgrade completed. Existing Compose credentials and video volume preserved."
  exit 0
fi
