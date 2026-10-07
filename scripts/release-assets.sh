#!/usr/bin/env bash
# The files attached to a GitHub Release, built for one version.
# .releaserc.json runs it in semantic-release's prepare step:
#
#   bash scripts/release-assets.sh 1.2.3
#
# release-assets/troupe-cli-1.2.3.mjs  the CLI in one file (Node.js 22+), reporting 1.2.3
# release-assets/troupe-web-1.2.3.zip  the browser edition (site/dist), served at /troupe/
# release-assets/SHA256SUMS
set -euo pipefail

version="${1:?usage: scripts/release-assets.sh <version>}"
cd "$(dirname "$0")/.."
out=release-assets
rm -rf "$out"
mkdir -p "$out"

TROUPE_VERSION="$version" pnpm --filter troupe-cli build
reported="$(node cli/dist/troupe.mjs --version)"
if [ "$reported" != "$version" ]; then
  echo "The CLI bundle reports $reported, not $version." >&2
  exit 1
fi
cp cli/dist/troupe.mjs "$out/troupe-cli-$version.mjs"

pnpm site:build
(cd site/dist && zip -qrX "../../$out/troupe-web-$version.zip" .)

(cd "$out" && shasum -a 256 -- * > SHA256SUMS)
ls -l "$out"
