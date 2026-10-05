# syntax=docker/dockerfile:1
# The troupe CLI (docs/CLI.md) in a container, built from the repository root.
# docker-compose.yml runs it as the `cli` service, next to the studio:
#
#   docker compose run --rm cli doctor
#
# Inside the stack it reaches the studio at http://app:3000 and signs in with
# the access code the studio saved in its data volume (mounted read-only).

FROM node:24-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY cli/package.json cli/
# Only the CLI's packages: drop the web app's from the root manifest (the
# lockfile keeps the CLI's versions).
RUN node -e 'const fs = require("fs"); const p = JSON.parse(fs.readFileSync("package.json")); fs.writeFileSync("package.json", JSON.stringify({ name: p.name, private: true, type: p.type, packageManager: p.packageManager, pnpm: p.pnpm }))' \
 && pnpm install --filter troupe-cli
COPY cli/src cli/src
# The two studio modules the CLI shares (export file names and AI labels).
COPY src/app/_components/download-name.ts src/app/_components/
COPY src/modules/export/disclosure.ts src/modules/export/
RUN pnpm --filter troupe-cli build

FROM node:24-alpine
COPY --from=build /app/cli/dist/troupe.mjs /usr/local/lib/troupe/troupe.mjs
COPY --chmod=755 cli/docker-entrypoint.sh /usr/local/bin/troupe-cli-entrypoint
# The CLI's profiles (~/.config/troupe) and where downloads land.
RUN mkdir -p /home/node/.config/troupe /work && chown -R node:node /home/node/.config /work
USER node
WORKDIR /work
ENV NODE_ENV=production
ENTRYPOINT ["troupe-cli-entrypoint"]
CMD ["--help"]
