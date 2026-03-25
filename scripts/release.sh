#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  VERSION=$(node -p "require('./package.json').version")
fi

TAG="v${VERSION}"

echo "Releasing cereus ${TAG}..."

# Create and push the tag — CI builds binaries and creates the release
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Tag ${TAG} already exists."
  exit 1
fi

git tag "$TAG"
git push origin "$TAG"

echo ""
echo "Tag ${TAG} pushed. GitHub Actions will build binaries and create the release."
echo "Watch progress: gh run watch"
echo "Release URL: https://github.com/adheus/cereus/releases/tag/${TAG}"
