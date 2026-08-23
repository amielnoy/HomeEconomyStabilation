#!/usr/bin/env sh
set -eu

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

docker compose \
  --file "$PROJECT_ROOT/docker-compose.yml" \
  --file "$PROJECT_ROOT/docker-compose.manual.yml" \
  --project-directory "$PROJECT_ROOT" \
  --project-name home-economy-local \
  down --remove-orphans
