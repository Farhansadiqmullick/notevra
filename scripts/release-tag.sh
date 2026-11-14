#!/usr/bin/env bash
# Tags HEAD as v<package.json version>. Run after the release commit; pushing is left to you.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

version="$(node -p "require('./package.json').version")"
tag="v$version"

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "Refusing: uncommitted changes. Commit the release first." >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/$tag" > /dev/null; then
  echo "Refusing: $tag already exists (on $(git rev-list -n1 "$tag" | cut -c1-7)). Bump the version first." >&2
  exit 1
fi

git tag -a "$tag" -m "Notevra $version"
echo "Tagged $tag on $(git rev-parse --short HEAD)."
echo "Push it with: git push origin $tag"
