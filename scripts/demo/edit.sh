#!/usr/bin/env bash
# Cuts the footage scripts/demo/record.ts captured into the presentation
# video: title cards, the steps with their captions, waits sped up (and
# marked so), a punch-in on the chat proposal and the player, and the
# render's own soundtrack under its playback.
#
#   pnpm demo:edit
#
# Reads DEMO_OUT (default: <os tmp>/troupe-demo, as record.ts) and writes
# site/public/demo/troupe-demo.mp4 (H.264 + AAC), troupe-demo.webm (VP9 +
# Opus), troupe-demo.jpg (the poster) and troupe-demo-chapters.vtt (where
# each step starts; the landing page's step list jumps there),
# troupe-demo-captions.vtt (what the actor says during the playback), and copies
# the social preview record.ts drew to site/public/social.png. DEMO_MAX_MB caps each video's size
# (default 7.5); the bitrate is worked out from the cut's length.
set -euo pipefail
# Decimal points, whatever the machine's locale (awk prints the numbers).
export LC_ALL=C

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IN="${DEMO_OUT:-${TMPDIR:-/tmp}}"
[ -n "${DEMO_OUT:-}" ] || IN="${IN%/}/troupe-demo"
DEST="${DEMO_DEST:-$ROOT/site/public/demo}"
MAX_MB="${DEMO_MAX_MB:-7.5}"
OPEN_S=3
CLOSE_S=3.5
FPS=30
W=1920
H=1080
# The stage colour (DESIGN.md background, oklch(0.15 0.02 255)), for fades.
STAGE="0x060c13"

for tool in ffmpeg ffprobe awk; do
  command -v "$tool" >/dev/null || { echo "edit.sh needs $tool on the PATH" >&2; exit 1; }
done
for file in frames.txt edl.txt meta.txt captions.tsv lines.txt render.mp4 cards/open.png cards/close.png cards/social.png cards/poster.png; do
  [ -e "$IN/$file" ] || { echo "Missing $IN/$file: run pnpm demo:record first." >&2; exit 1; }
done

WORK="$IN/edit"
rm -rf "$WORK"
mkdir -p "$WORK" "$DEST"
ff() { ffmpeg -nostdin -hide_banner -loglevel error -y "$@"; }
# Near-lossless intermediates: every cut is re-encoded once more at the end.
MEZZ=(-c:v libx264 -preset veryfast -crf 12 -pix_fmt yuv420p -r "$FPS" -an)

# The footage at a constant frame rate, at the captured size (twice the page).
if [ ! -s "$IN/raw.mp4" ] || [ "$IN/frames.txt" -nt "$IN/raw.mp4" ]; then
  echo "Assembling the footage…"
  (cd "$IN" && ff -f concat -safe 0 -i frames.txt -fps_mode cfr "${MEZZ[@]}" raw.mp4)
fi

# A title card, faded in from and out to the stage.
card() { # <png> <seconds> <out>
  ff -loop 1 -framerate "$FPS" -t "$2" -i "$1" -f lavfi -t "$2" -i "color=c=$STAGE:s=${W}x${H}:r=$FPS" \
    -filter_complex "[1:v][0:v]overlay=0:0,fade=t=in:st=0:d=0.4:color=$STAGE,fade=t=out:st=$(awk "BEGIN{print $2-0.4}"):d=0.4:color=$STAGE,format=yuv420p" \
    "${MEZZ[@]}" "$3"
}

echo "Cutting…"
card "$IN/cards/open.png" "$OPEN_S" "$WORK/000-open.mp4"
echo "file '000-open.mp4'" > "$WORK/list.txt"

# The one value the cut needs from meta.txt, read as data (never sourced).
PLAY_SEGMENT="$(sed -n 's/^PLAY_SEGMENT=//p' "$IN/meta.txt" | head -n 1)"
case "$PLAY_SEGMENT" in
  '' | *[!0-9]*) echo "meta.txt has no valid PLAY_SEGMENT." >&2; exit 1 ;;
esac
i=0
offset="$OPEN_S"     # where the next segment starts in the cut
play_at=""
chapters=()          # "<step> <start>" each time the step changes
last_step=""
while read -r start end speed crop caption; do
  i=$((i + 1))
  out="$(printf '%03d' "$i").mp4"
  length=$(awk "BEGIN{print ($end-$start)/$speed}")
  if [ "$crop" = "-" ]; then
    frame="scale=$W:$H:flags=lanczos"
  else
    IFS=: read -r cx cy cw ch <<<"$crop"
    # A punch-in: the region as large as the frame allows, on the stage.
    frame="crop=$cw:$ch:$cx:$cy,scale=$W:$H:force_original_aspect_ratio=decrease:flags=lanczos,pad=$W:$H:(ow-iw)/2:(oh-ih)/2:color=$STAGE"
  fi
  # A caption fades in when it changes, and stays put across its segments.
  fade=""
  [ "$caption" = "${previous:-}" ] || fade=",fade=t=in:st=0:d=0.3:alpha=1"
  ff -ss "$start" -to "$end" -i "$IN/raw.mp4" -loop 1 -framerate "$FPS" -i "$IN/cards/$caption.png" \
    -filter_complex "[0:v]$frame,setpts=(PTS-STARTPTS)/$speed,fps=$FPS[v];[1:v]format=rgba$fade[c];[v][c]overlay=0:0:shortest=1,format=yuv420p" \
    -t "$length" "${MEZZ[@]}" "$WORK/$out"
  echo "file '$out'" >> "$WORK/list.txt"
  [ "$((i - 1))" = "$PLAY_SEGMENT" ] && play_at="$offset"
  step="${caption#cap-}"
  step="${step%-x*}"
  [ "$step" = "$last_step" ] || chapters+=("$step $offset")
  last_step="$step"
  offset=$(awk "BEGIN{print $offset+$length}")
  previous="$caption"
done < "$IN/edl.txt"
card "$IN/cards/close.png" "$CLOSE_S" "$WORK/999-close.mp4"
echo "file '999-close.mp4'" >> "$WORK/list.txt"
total=$(awk "BEGIN{print $offset+$CLOSE_S}")
[ -n "$play_at" ] || { echo "No playback segment in the cut." >&2; exit 1; }

ff -f concat -safe 0 -i "$WORK/list.txt" -c copy "$WORK/silent.mp4"

# Chapters: one cue per step, named as the captions name it.
timecode() { awk -v t="$1" 'BEGIN{h=int(t/3600); m=int((t-h*3600)/60); printf "%02d:%02d:%06.3f", h, m, t-h*3600-m*60}'; }
{
  echo "WEBVTT"
  for n in "${!chapters[@]}"; do
    read -r step start <<<"${chapters[$n]}"
    end="$offset"
    [ "$n" -lt "$((${#chapters[@]} - 1))" ] && end="${chapters[$((n + 1))]#* }"
    # Cue text is WebVTT: &, < and > are escaped.
    title="$(awk -F'\t' -v s="$step" '$1==s{print $2}' "$IN/captions.tsv" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g')"
    printf '\n%s\n%s --> %s\n%s\n' "$step" "$(timecode "$start")" "$(timecode "$end")" "$title"
  done
} > "$DEST/troupe-demo-chapters.vtt"

# The render's soundtrack, where the player starts in the cut; silence
# elsewhere. Its loudness is evened out for laptop speakers. (The silence is
# real samples: a delayed timestamp alone does not survive the encoders.)
ff -i "$WORK/silent.mp4" -i "$IN/render.mp4" \
  -filter_complex "[1:a]loudnorm=I=-16:TP=-1.5,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=N/SR/TB[voice];anullsrc=r=48000:cl=stereo:d=$play_at[lead];[lead][voice]concat=n=2:v=0:a=1,apad=whole_dur=$total[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a pcm_s16le "$WORK/cut.mov"

# Bitrates that keep each file under MAX_MB.
audio_k=96
video_k=$(awk "BEGIN{printf \"%d\", ($MAX_MB*8*1024*0.97/$total) - $audio_k}")
echo "Cut: ${total}s, ${video_k} kbit/s video."

echo "Encoding MP4…"
(cd "$WORK" && ff -i cut.mov -c:v libx264 -preset slow -b:v "${video_k}k" -pass 1 -an -f mp4 /dev/null &&
  ff -i cut.mov -c:v libx264 -preset slow -b:v "${video_k}k" -maxrate "$((video_k * 3))k" -bufsize "$((video_k * 4))k" -pass 2 \
    -pix_fmt yuv420p -profile:v high -c:a aac -b:a "${audio_k}k" -movflags +faststart "$DEST/troupe-demo.mp4")

echo "Encoding WebM…"
(cd "$WORK" && ff -i cut.mov -c:v libvpx-vp9 -b:v "${video_k}k" -deadline good -cpu-used 2 -row-mt 1 -pass 1 -an -f webm /dev/null &&
  ff -i cut.mov -c:v libvpx-vp9 -b:v "${video_k}k" -deadline good -cpu-used 2 -row-mt 1 -pass 2 \
    -pix_fmt yuv420p -c:a libopus -b:a "$((audio_k * 2 / 3))k" "$DEST/troupe-demo.webm")

# Captions for what is said: the render's lines, where its voice says them in
# the cut. Pauses of 1.2 s or more separate the lines (Kokoro pauses about
# 1.4 s between lines, under 1 s at commas); if that does not give one stretch
# of speech per line, one cue carries the whole script.
{
  echo "WEBVTT"
  ffmpeg -nostdin -i "$IN/render.mp4" -vn -af silencedetect=n=-40dB:d=1.2 -f null - 2>&1 |
    awk -v at="$play_at" -v lines="$IN/lines.txt" -v total="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN/render.mp4")" '
      function tc(t) { h = int(t / 3600); m = int((t - h * 3600) / 60); return sprintf("%02d:%02d:%06.3f", h, m, t - h * 3600 - m * 60) }
      function esc(s) { gsub(/&/, "\\&amp;", s); gsub(/</, "\\&lt;", s); gsub(/>/, "\\&gt;", s); return s }
      /silence_start/ { s = $0; sub(/.*silence_start: /, "", s); if (s + 0 > 0.05) { ends[++n] = s + 0 } }
      /silence_end/ { e = $0; sub(/.*silence_end: /, "", e); sub(/ .*/, "", e); starts[++k] = e + 0 }
      END {
        while ((getline line < lines) > 0) if (line != "") text[++count] = line
        # Speech runs from 0 (or the end of a leading silence) to each silence.
        first = (k > 0 && starts[1] < ends[1]) ? 1 : 0
        speech_start[1] = first ? starts[1] : 0
        for (i = 1; i <= n; i++) { speech_end[i] = ends[i]; speech_start[i + 1] = starts[i + first] }
        if (n != count) { printf "\n%s --> %s\n", tc(at + speech_start[1]), tc(at + total); for (i = 1; i <= count; i++) print esc(text[i]); exit }
        for (i = 1; i <= count; i++) printf "\n%s --> %s\n%s\n", tc(at + speech_start[i]), tc(at + speech_end[i]), esc(text[i])
      }'
} > "$DEST/troupe-demo-captions.vtt"

# The poster, drawn by record.ts.
ff -i "$IN/cards/poster.png" -vf "scale=1280:720:flags=lanczos" -q:v 3 "$DEST/troupe-demo.jpg"

# The landing page's social preview, drawn by record.ts.
cp "$IN/cards/social.png" "$DEST/../social.png"

for file in "$DEST"/troupe-demo.{mp4,webm,jpg} "$DEST"/troupe-demo-{chapters,captions}.vtt "$DEST/../social.png"; do
  printf '%6.2f MB  %s\n' "$(awk -v b="$(wc -c <"$file")" 'BEGIN{print b/1048576}')" "$file"
done
ffprobe -v error -show_entries stream=codec_name,width,height:format=duration -of compact "$DEST/troupe-demo.mp4"
