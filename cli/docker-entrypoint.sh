#!/bin/sh
# The CLI image's entrypoint (cli/Dockerfile). In the Compose stack the
# studio's data volume is mounted at TROUPE_STUDIO_DATA: its access-code file
# signs the CLI in, unless TROUPE_ACCESS_CODE is set.
set -eu
code_file="${TROUPE_STUDIO_DATA:-/studio}/access-code"
if [ -z "${TROUPE_ACCESS_CODE:-}" ] && [ -r "$code_file" ]; then
  TROUPE_ACCESS_CODE="$(tr -d '\r\n' < "$code_file")"
  export TROUPE_ACCESS_CODE
fi
exec node /usr/local/lib/troupe/troupe.mjs "$@"
