#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  VERSION=$(node -p "require('./package.json').version")
fi

TAG="v${VERSION}"
DIST="dist/release"
TARGETS=(
  "bun-darwin-arm64"
  "bun-darwin-x64"
  "bun-linux-arm64"
  "bun-linux-x64"
)

echo "Building cereus ${TAG} for ${#TARGETS[@]} targets..."

rm -rf "$DIST"
mkdir -p "$DIST"

for target in "${TARGETS[@]}"; do
  # Extract os and arch from target string (e.g., bun-darwin-arm64 -> darwin-arm64)
  suffix="${target#bun-}"
  outfile="${DIST}/cereus-${suffix}"

  echo "  Building ${suffix}..."
  bun build --compile --minify --target="$target" src/index.ts --outfile "$outfile"
done

echo ""
echo "Binaries:"
ls -lh "$DIST"/

echo ""
echo "Creating GitHub release ${TAG}..."

# Create the tag if it doesn't exist
if ! git rev-parse "$TAG" >/dev/null 2>&1; then
  git tag "$TAG"
  git push origin "$TAG"
fi

# Create the release and upload all binaries
gh release create "$TAG" \
  --title "cereus ${TAG}" \
  --generate-notes \
  "${DIST}"/cereus-*

echo ""
echo "Release ${TAG} created!"
echo "https://github.com/adheus/cereus/releases/tag/${TAG}"
