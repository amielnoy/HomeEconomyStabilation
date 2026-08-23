#!/usr/bin/env sh
set -eu

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker with Compose v2 is required." >&2
  exit 127
fi

docker compose \
  --file "$PROJECT_ROOT/docker-compose.yml" \
  --file "$PROJECT_ROOT/docker-compose.manual.yml" \
  --project-directory "$PROJECT_ROOT" \
  --project-name home-economy-local \
  up --build --detach api web prometheus grafana

echo "Application: http://127.0.0.1:${APP_PORT:-8765}"
echo "Swagger:     http://127.0.0.1:${APP_PORT:-8765}/api-docs.html"
echo "API health:  http://127.0.0.1:${API_PORT:-3001}/health"
echo "Prometheus:  http://127.0.0.1:${PROMETHEUS_PORT:-9090}"
echo "Grafana:     http://127.0.0.1:${GRAFANA_PORT:-3000}"
