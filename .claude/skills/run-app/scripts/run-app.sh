#!/usr/bin/env bash
# Rebuild and start the ticket-tracker stack, wait until healthy, print URLs.
# Runs INSIDE WSL (Docker is only available there). Usage:
#   bash .claude/skills/run-app/scripts/run-app.sh            # rebuild + start, keep data
#   bash .claude/skills/run-app/scripts/run-app.sh --clean    # wipe DB volume first (fresh, empty DB)
set -uo pipefail

# Repo root = 4 levels up from this script (.claude/skills/run-app/scripts/)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT" || exit 1
echo "Repo: $ROOT"

APP_URL="http://localhost:8080"
HEALTH_URL="$APP_URL/api/health"
DOCS_URL="$APP_URL/api/docs"
MAIL_URL="http://localhost:8025"

if ! command -v docker >/dev/null 2>&1; then
  echo "FAIL: docker not found in this WSL distro."; exit 2
fi
if [ ! -f docker-compose.yml ] && [ ! -f compose.yaml ]; then
  echo "FAIL: no docker-compose.yml yet - the walking skeleton (ROADMAP Phase 4) has not been built."; exit 3
fi
if [ ! -f .env ]; then
  echo "FAIL: .env is missing. Create it with:  cp .env.example .env"; exit 4
fi

if [ "${1:-}" = "--clean" ]; then
  echo "== docker compose down -v (wiping database volume)"
  docker compose down -v --remove-orphans
fi

echo "== docker compose up --build -d --wait"
if ! docker compose up --build -d --wait --wait-timeout 180; then
  echo "FAIL: stack did not become healthy."
  docker compose ps
  echo "== last 40 log lines per service"
  docker compose logs --tail 40
  exit 5
fi

echo "== container status"
docker compose ps

echo "== health check: $HEALTH_URL"
for i in $(seq 1 30); do
  body="$(curl -fsS "$HEALTH_URL" 2>/dev/null)" && { echo "$body"; ok=1; break; }
  sleep 2
done
if [ "${ok:-0}" != 1 ]; then
  echo "FAIL: $HEALTH_URL did not answer within 60 s."
  docker compose logs --tail 40 backend
  exit 6
fi

cat <<EOF

OK - stack is up.
  App:       $APP_URL
  API docs:  $DOCS_URL
  Mailpit:   $MAIL_URL
EOF
