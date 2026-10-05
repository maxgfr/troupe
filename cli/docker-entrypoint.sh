#!/bin/sh
# The CLI image's entrypoint (cli/Dockerfile). In the Compose stack the
# studio shares the access code it generated in a volume of its own, mounted
# read-only at /run/troupe-access (TROUPE_ACCESS_CODE_FILE): it signs the CLI
# in, unless TROUPE_ACCESS_CODE is set.
set -eu
code_file="${TROUPE_ACCESS_CODE_FILE:-/run/troupe-access/access-code}"
if [ -z "${TROUPE_ACCESS_CODE:-}" ] && [ -r "$code_file" ]; then
  TROUPE_ACCESS_CODE="$(tr -d '\r\n' < "$code_file")"
  export TROUPE_ACCESS_CODE
fi
exec node /usr/local/lib/troupe/troupe.mjs "$@"
