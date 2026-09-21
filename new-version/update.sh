#!/bin/bash
# Deploy script for the live server. Invoked over SSH by
# .github/workflows/deploy.yml, but safe to run by hand too.
#
# Always resolves paths relative to its own location, so it works
# regardless of what directory it's invoked from.
set -euo pipefail

# Non-interactive SSH sessions don't source .bashrc/.profile, so a
# user-level bun install (~/.bun/bin) isn't on PATH by default - add it
# explicitly rather than relying on the shell environment.
export PATH="$HOME/.bun/bin:$PATH"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Syncing $REPO_ROOT to origin/main"
git fetch origin main
git checkout main
# Hard reset, not `git pull` - a deploy box should always become exactly
# what's on origin/main, never try to reconcile local drift (that's what
# produced the "divergent branches" failure the first time around).
git reset --hard origin/main

cd new-version

echo "==> Installing backend dependencies"
bun install --frozen-lockfile

echo "==> Generating Prisma client"
bunx prisma generate

echo "==> Pushing schema changes (fails loudly instead of prompting if a"
echo "    change looks lossy - rerun by hand with --accept-data-loss if"
echo "    that's actually intended)"
bunx prisma db push --skip-generate

echo "==> Restarting familyn.service"
sudo systemctl restart familyn.service

echo "==> Deployed $(git rev-parse --short HEAD)"
