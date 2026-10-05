#!/usr/bin/env bash
# Makes the small copies of each actor's front picture that the browser
# edition's landing page shows in its cast grid: front-160.webp and
# front-320.webp beside <actor>/v1/front.webp. Run it after replacing the
# pictures (docs/ACTORS.md). Without them the landing page falls back to
# front.webp.
#
#   scripts/actors/thumbnails.sh [cast folder]   # default: public/actors
#
# Needs cwebp (libwebp: `brew install webp`, `apt install webp`).
set -euo pipefail

DIR="${1:-$(cd "$(dirname "$0")/../.." && pwd)/public/actors}"
command -v cwebp >/dev/null || { echo "thumbnails.sh needs cwebp (libwebp) on the PATH" >&2; exit 1; }

count=0
for front in "$DIR"/*/v1/front.webp; do
  [ -e "$front" ] || { echo "No <actor>/v1/front.webp in $DIR" >&2; exit 1; }
  for width in 160 320; do
    cwebp -quiet -q 80 -m 6 -sharp_yuv -metadata none -resize "$width" "$width" "$front" -o "${front%.webp}-$width.webp"
  done
  count=$((count + 1))
done
echo "Thumbnails for $count actors in $DIR"
