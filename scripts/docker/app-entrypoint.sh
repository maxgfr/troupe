#!/bin/sh
# The app image's entrypoint. Without DATABASE_URL, it is built for the
# Compose stack's `db` service, from POSTGRES_PASSWORD or, when that is empty,
# from the password the `db` service generated on its first start
# (POSTGRES_PASSWORD_FILE, docker-compose.yml). Then it runs the command.
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  password="${POSTGRES_PASSWORD:-}"
  if [ -z "$password" ] && [ -n "${POSTGRES_PASSWORD_FILE:-}" ] && [ -r "$POSTGRES_PASSWORD_FILE" ]; then
    password="$(cat "$POSTGRES_PASSWORD_FILE")"
  fi
  if [ -z "$password" ]; then
    echo "Troupe: set DATABASE_URL, or POSTGRES_PASSWORD, or mount the stack's generated password at POSTGRES_PASSWORD_FILE." >&2
    exit 1
  fi
  export DATABASE_URL="postgresql://${POSTGRES_USER:-postgres}:${password}@${POSTGRES_HOST:-db}:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-troupe}"
fi

exec "$@"
