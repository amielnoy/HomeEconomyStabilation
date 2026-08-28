#!/usr/bin/env sh
# Local debugging: the compiler in watch mode with source maps, and a static server for
# the page. The source maps are the point — without them the browser shows the compiled
# output in dist/ and a breakpoint cannot be set in the TypeScript that was actually
# written. They are emitted only here, never by `npm run build`.
set -u

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
APP_PORT=${APP_PORT:-8765}

tsc_pid=
server_pid=

stop_children() {
  if [ -n "$tsc_pid" ]; then kill "$tsc_pid" 2>/dev/null || true; fi
  if [ -n "$server_pid" ]; then kill "$server_pid" 2>/dev/null || true; fi
}

trap 'stop_children; exit 130' INT TERM HUP

cd "$PROJECT_ROOT" || exit 1

# preserveWatchOutput keeps the compiler from clearing the screen on every rebuild, which
# would otherwise wipe the server log this shares a terminal with.
npx tsc -p tsconfig.app.json --watch --preserveWatchOutput --sourceMap &
tsc_pid=$!

# The browser tests start a server on this port too, and leave it running. Reusing it
# keeps a second one from failing to bind and dying silently.
if curl -fsS -o /dev/null "http://127.0.0.1:${APP_PORT}/mazan-habait.html" 2>/dev/null; then
  echo "Reusing the static server already listening on ${APP_PORT}"
else
  # Served from the project root rather than public/, so that dist/*.js.map resolves
  # src/*.ts and the debugger has the original source to show.
  python3 -m http.server "$APP_PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
  server_pid=$!
fi

echo ""
echo "Application:  http://127.0.0.1:${APP_PORT}/mazan-habait.html"
echo "Breakpoints:  DevTools → Sources → top → 127.0.0.1:${APP_PORT} → src/"
echo "Watching:     src/**/*.ts — save and refresh, no restart needed"
echo "Stop:         Ctrl-C"
echo ""

wait
