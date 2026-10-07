#!/usr/bin/env bash
# The CLI as standalone binaries (no Node.js on the machine), what Homebrew
# installs. The release workflow runs it once per runner, after the release:
#
#   bash scripts/cli-binaries.sh 1.2.3 macos-arm64 macos-x64
#   bash scripts/cli-binaries.sh 1.2.3 linux-x64 linux-arm64
#
# cli-binaries/troupe-<os>-<arch>  one per target, reporting 1.2.3
#
# Each is Bun's runtime with the CLI bundle appended (`bun build --compile`).
# x64 uses Bun's baseline runtime, which runs on CPUs without AVX2. Appending
# leaves a macOS binary's signature stale, and macOS kills such a binary: the
# macOS ones are re-signed ad hoc, so they are built on macOS.
set -euo pipefail

version="${1:?usage: scripts/cli-binaries.sh <version> <target>...}"
shift
[ "$#" -gt 0 ] || set -- macos-arm64 macos-x64 linux-arm64 linux-x64
cd "$(dirname "$0")/.."
out=cli-binaries
rm -rf "$out"
mkdir -p "$out"

TROUPE_VERSION="$version" pnpm --filter troupe-cli build

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) native=macos-arm64 ;;
  Darwin-x86_64) native=macos-x64 ;;
  Linux-aarch64) native=linux-arm64 ;;
  Linux-x86_64) native=linux-x64 ;;
  *) native="" ;;
esac

for target in "$@"; do
  case "$target" in
    macos-arm64) bun=bun-darwin-arm64 ;;
    macos-x64) bun=bun-darwin-x64-baseline ;;
    linux-arm64) bun=bun-linux-arm64 ;;
    linux-x64) bun=bun-linux-x64-baseline ;;
    *)
      echo "Unknown target $target (macos-arm64, macos-x64, linux-arm64, linux-x64)." >&2
      exit 2
      ;;
  esac
  file="$out/troupe-$target"
  bun build --compile --minify --target="$bun" cli/dist/troupe.mjs --outfile "$file"
  case "$target" in
    macos-*)
      if [ "$(uname -s)" != Darwin ]; then
        echo "$target is built on macOS only (codesign)." >&2
        exit 2
      fi
      codesign --force --sign - "$file"
      codesign --verify --strict "$file"
      ;;
  esac
  # The one this machine runs: its version, and a studio that is not there
  # reported as unreachable (exit 4), as the Node.js CLI does.
  if [ "$target" = "$native" ]; then
    reported="$("$file" --version)"
    if [ "$reported" != "$version" ]; then
      echo "$file reports $reported, not $version." >&2
      exit 1
    fi
    code=0
    TROUPE_CONFIG_DIR="$(mktemp -d)" "$file" whoami --url http://127.0.0.1:9 >/dev/null 2>&1 || code=$?
    if [ "$code" != 4 ]; then
      echo "$file exits $code, not 4, when the studio is unreachable." >&2
      exit 1
    fi
  fi
done
rm -f .*.bun-build
ls -l "$out"
