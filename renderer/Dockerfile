# syntax=docker/dockerfile:1
# Troupe's local renderer (docs/LOCAL-MODELS.md): Kokoro voices, captions and
# ffmpeg on the CPU. Built from the repository root:
#
#   docker compose --profile renderer up -d --build
#
# Debian rather than Alpine: the ONNX runtime behind Kokoro needs glibc.
FROM node:24-bookworm-slim
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY renderer/package.json renderer/
# pnpm always installs the workspace root's dependencies too (the whole web
# app). Drop them from the root manifest first: the renderer's own packages
# keep the versions pinned in the lockfile.
RUN node -e 'const fs = require("fs"); const p = JSON.parse(fs.readFileSync("package.json")); fs.writeFileSync("package.json", JSON.stringify({ name: p.name, private: true, type: p.type, packageManager: p.packageManager, pnpm: p.pnpm }))' \
 && pnpm install --prod --filter @troupe/renderer
# The scene module is shared with the app; the renderer imports it from src/.
COPY src/modules/scene src/modules/scene
COPY renderer/src renderer/src
# The actors' pictures drawn in the card (renderer/src/portraits.ts).
COPY public/actors public/actors
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8078 \
    OUT_DIR=/data/renders \
    KOKORO_CACHE=/data/kokoro
# Renders and the Kokoro weights (downloaded on first start) live here.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
WORKDIR /app/renderer
EXPOSE 8078
# Any answer, 401 included when a token is set, means the server is up.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:8078/health').then((r) => process.exit(r.status < 500 ? 0 : 1), () => process.exit(1))"
CMD ["node_modules/.bin/tsx", "src/main.ts"]
