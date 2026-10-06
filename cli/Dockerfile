# syntax=docker/dockerfile:1
# The troupe CLI (docs/CLI.md) in a container, built from the repository root.
# docker-compose.yml runs it as the `cli` service, next to the studio:
#
#   docker compose run --rm cli doctor
#
# Inside the stack it reaches the studio at http://app:3000 and signs in with
# the copy of the access code the studio shares in the troupe-cli-access
# volume (mounted read-only), never the data volume, which holds secret.key.

# One JavaScript bundle for every platform: built once, natively, for a
# multi-platform image.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
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
# The studio modules the CLI shares (export file names, AI labels and the
# providers' list prices for doctor --live).
COPY src/app/_components/download-name.ts src/app/_components/
COPY src/modules/export/disclosure.ts src/modules/export/
COPY src/modules/models/list-price.ts src/modules/models/http-defaults.ts src/modules/models/
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
