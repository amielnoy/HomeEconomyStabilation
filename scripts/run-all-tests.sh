#!/usr/bin/env sh
set -u

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PROJECT_NAME=home-economy-tests
APP_PORT=${APP_PORT:-18766}
API_PORT=${API_PORT:-13002}
PROMETHEUS_PORT=${PROMETHEUS_PORT:-19091}
GRAFANA_PORT=${GRAFANA_PORT:-13001}
ALLURE_PORT=${ALLURE_PORT:-15050}
export APP_PORT API_PORT PROMETHEUS_PORT GRAFANA_PORT ALLURE_PORT

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Desktop or Docker Engine and try again." >&2
  exit 127
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required. Update Docker Desktop or install the compose plugin." >&2
  exit 127
fi

compose() {
  docker compose \
    --file "$PROJECT_ROOT/docker-compose.yml" \
    --file "$PROJECT_ROOT/docker-compose.manual.yml" \
    --project-directory "$PROJECT_ROOT" \
    --project-name "$PROJECT_NAME" \
    "$@"
}

echo "Building the API, web and test images"
compose build api web tests || exit $?

echo "Starting the application and monitoring servers"
compose up --detach api web prometheus grafana || exit $?

echo "Running all tests in the test service against the separate web and API services"
test_status=0
compose run --rm tests || test_status=$?

echo "Publishing the generated Allure report"
report_status=0
compose up --detach --wait allure || report_status=$?

echo
echo "Running servers"
echo "  Application: http://127.0.0.1:$APP_PORT"
echo "  Architecture: http://127.0.0.1:$APP_PORT/Architecture.html"
echo "  Swagger UI:  http://127.0.0.1:$APP_PORT/api-docs.html"
echo "  API health:  http://127.0.0.1:$API_PORT/health"
echo "  Prometheus:  http://127.0.0.1:$PROMETHEUS_PORT"
echo "  Grafana:     http://127.0.0.1:$GRAFANA_PORT"
echo "  Allure:      http://127.0.0.1:$ALLURE_PORT"
echo
echo "Stop this stack with: npm run test:docker:stop"

if [ "$test_status" -ne 0 ] || [ "$report_status" -ne 0 ]; then
  echo "Docker test pipeline failed: tests=$test_status report_server=$report_status" >&2
  exit 1
fi

echo "Docker test pipeline passed."
