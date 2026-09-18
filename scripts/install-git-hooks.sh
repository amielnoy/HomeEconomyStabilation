#!/bin/sh
# Points git at the hooks this repository keeps under version control.
#
# Run from `npm install` through `prepare`, so a fresh clone gets the pre-push gate without
# anyone having to read about it. A checkout that is not a git repository — a tarball, a
# Docker build context, a Vercel build — simply has nothing to point, and says so quietly
# rather than failing an install over a developer convenience.
set -eu

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  exit 0
fi

git config core.hooksPath .githooks
