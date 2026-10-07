# syntax=docker/dockerfile:1
# Troupe — one image: the web app, its database migrations and the background
# job worker. See docs/SELF-HOSTING.md.

FROM node:26-alpine AS base
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

FROM node:26-alpine AS runner
LABEL org.opencontainers.image.licenses="MIT"
# Troupe's license, the third-party notices and the GNU GPL's text
# (THIRD_PARTY_NOTICES.md says which parts carry it).
COPY LICENSE THIRD_PARTY_NOTICES.md LICENSES/GPL-3.0.txt /usr/share/doc/troupe/
# ffprobe validates every downloaded video; ffmpeg takes the library's
# pictures and sound.
RUN apk add --no-cache ffmpeg
# yt-dlp saves links to video platforms into the library (Unlicense; its
# self-contained musl build, pinned and checked). TROUPE_YTDLP=0 leaves it
# out; the library then takes uploads, pages and direct links only.
ARG TROUPE_YTDLP=1
ARG YTDLP_VERSION=2026.08.19
ARG YTDLP_SHA256_AMD64=f3dec9cfeaf304cec98290fe41c6ad465d4b747d302473559643e7af24929722
ARG YTDLP_SHA256_ARM64=17b164c4d258be92bb1ad146cb7c336b783aedb380814aabbcb7d52937f77e57
ARG TARGETARCH
RUN if [ "$TROUPE_YTDLP" = "1" ]; then \
      case "$TARGETARCH" in \
        amd64) file=yt-dlp_musllinux; sum="$YTDLP_SHA256_AMD64" ;; \
        arm64) file=yt-dlp_musllinux_aarch64; sum="$YTDLP_SHA256_ARM64" ;; \
        *) echo "No yt-dlp build for $TARGETARCH; build with TROUPE_YTDLP=0." >&2; exit 1 ;; \
      esac \
      && wget -q -O /usr/local/bin/yt-dlp "https://github.com/yt-dlp/yt-dlp/releases/download/$YTDLP_VERSION/$file" \
      && echo "$sum  /usr/local/bin/yt-dlp" | sha256sum -c - \
      && chmod 755 /usr/local/bin/yt-dlp; \
    fi
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
RUN mkdir -p /app/data /app/cli-access && chown node:node /app/data /app/cli-access
VOLUME /app/data
# /app/cli-access: a copy of the generated access code for the Compose
# stack's CLI container, written only when TROUPE_ACCESS_CODE_SHARE_DIR points
# there. docker-compose.yml mounts its own named volume on it; it is no VOLUME
# here, so a plain `docker run` does not leave an anonymous volume behind.
# Builds DATABASE_URL for the Compose stack when it is not set.
COPY --chmod=755 scripts/docker/app-entrypoint.sh /usr/local/bin/troupe-entrypoint
# The released version (scripts/release-version.mjs), from the release
# workflow; empty in a local build, which then reports package.json's.
ARG TROUPE_VERSION=
ENV TROUPE_VERSION=${TROUPE_VERSION}
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
ENTRYPOINT ["troupe-entrypoint"]
CMD ["node", "server.js"]
