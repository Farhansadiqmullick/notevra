#!/usr/bin/env bash
# Builds an exact git tag in a throwaway worktree and deploys it to production. See ROLLBACK.md.
set -euo pipefail

usage() {
  echo "Usage: npm run deploy:version -- <tag>   e.g. npm run deploy:version -- v0.1.1" >&2
  exit 1
}

[[ $# -eq 1 ]] || usage
tag="$1"

root="$(git rev-parse --show-toplevel)"
cd "$root"

if ! git rev-parse -q --verify "refs/tags/$tag" > /dev/null; then
  echo "No such tag: $tag. Known tags:" >&2
  git tag -l 'v*' --sort=-v:refname | head -10 >&2
  exit 1
fi

# VITE_ values are baked in at build time, so a build without this ships a local-only app
if [[ ! -f .env.production ]]; then
  echo "Missing .env.production — the build would not point at hosted Supabase." >&2
  exit 1
fi

sha="$(git rev-list -n1 "$tag")"
work="$(mktemp -d "${TMPDIR:-/tmp}/notevra-deploy-XXXXXX")"

cleanup() {
  git -C "$root" worktree remove --force "$work" 2> /dev/null || rm -rf "$work"
}
trap cleanup EXIT

echo "Building $tag (${sha:0:7}) in $work"
git worktree add --detach "$work" "$tag" > /dev/null
cp .env.production "$work/.env.production"

cd "$work"
npm ci --no-audit --no-fund
npm run build

if ! grep -rqo 'https://[a-z0-9]*\.supabase\.co' dist/assets/; then
  echo "Refusing: no hosted Supabase URL in the bundle. Check .env.production." >&2
  exit 1
fi

echo "Deploying $tag to Cloudflare Pages (blocnote, production)"
npx wrangler pages deploy dist \
  --project-name blocnote \
  --branch main \
  --commit-hash "$sha" \
  --commit-message "deploy $tag"

echo "Deployed $tag. Open tabs pick it up via the update prompt in Settings."
