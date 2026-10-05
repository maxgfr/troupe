# syntax=docker/dockerfile:1
# Troupe — one image: the web app, its database migrations and the background
# job worker. See docs/SELF-HOSTING.md.

FROM node:24-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
ENV SKIP_ENV_VALIDATION=1 \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:24-alpine AS runner
# ffprobe validates every downloaded video.
RUN apk add --no-cache ffmpeg
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TROUPE_DATA_DIR=/app/data \
    TROUPE_INPROCESS_WORKER=1
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
# Applied automatically on start (src/server/boot.ts).
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
# Videos, the generated access code and the encryption key live here.
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data
# Builds DATABASE_URL for the Compose stack when it is not set.
COPY --chmod=755 scripts/docker/app-entrypoint.sh /usr/local/bin/troupe-entrypoint
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
ENTRYPOINT ["troupe-entrypoint"]
CMD ["node", "server.js"]
