#!/usr/bin/env sh
set -eu

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PROJECT_NAME=${1:-}

case "$PROJECT_NAME" in
  home-economy-local|home-economy-tests) ;;
  *)
    echo "Usage: $0 home-economy-local|home-economy-tests" >&2
    exit 64
    ;;
esac

docker compose \
  --file "$PROJECT_ROOT/docker-compose.yml" \
  --file "$PROJECT_ROOT/docker-compose.manual.yml" \
  --project-directory "$PROJECT_ROOT" \
  --project-name "$PROJECT_NAME" \
  down --remove-orphans
