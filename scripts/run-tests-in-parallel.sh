#!/usr/bin/env sh
set -u

VITEST_SCRIPT=${VITEST_SCRIPT:-test}
SERVER_TEST_SCRIPT=${SERVER_TEST_SCRIPT:-test:server}
vitest_status=0
playwright_status=0
server_status=0
vitest_pid=
playwright_pid=
server_pid=

stop_children() {
  if [ -n "$vitest_pid" ]; then
    kill "$vitest_pid" 2>/dev/null || true
  fi
  if [ -n "$playwright_pid" ]; then
    kill "$playwright_pid" 2>/dev/null || true
  fi
  if [ -n "$server_pid" ]; then
    kill "$server_pid" 2>/dev/null || true
  fi
}

trap 'stop_children; exit 130' INT TERM HUP

echo "Starting Vitest, Pytest and Playwright in parallel"
npm run "$VITEST_SCRIPT" &
vitest_pid=$!
npm run "$SERVER_TEST_SCRIPT" &
server_pid=$!
npm run test:e2e &
playwright_pid=$!

wait "$vitest_pid" || vitest_status=$?
vitest_pid=
wait "$server_pid" || server_status=$?
server_pid=
wait "$playwright_pid" || playwright_status=$?
playwright_pid=
trap - INT TERM HUP

if [ "$vitest_status" -ne 0 ] || [ "$server_status" -ne 0 ] || [ "$playwright_status" -ne 0 ]; then
  echo "Parallel test run failed: vitest=$vitest_status pytest=$server_status playwright=$playwright_status" >&2
  exit 1
fi

echo "Vitest, Pytest and Playwright passed in parallel."
