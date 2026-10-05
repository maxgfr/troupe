# syntax=docker/dockerfile:1
# Troupe's local renderer (docs/LOCAL-MODELS.md): Kokoro voices, captions and
# ffmpeg on the CPU. Built from the repository root; docker-compose.yml runs
# it as the `renderer` service:
#
#   docker compose up -d --build renderer
#
# The `ltx` target adds the AI video mode (LTX-Video, renderer/ltx) and its
# Python environment, for the `ltx` Compose profiles: PyTorch's Linux build,
# with NVIDIA's CUDA libraries, running on the GPU when the container has one
# and on the CPU otherwise. Containers on a Mac cannot reach the Apple GPU:
# run that mode natively there.
#
# Debian rather than Alpine: the ONNX runtime behind Kokoro needs glibc.

FROM node:24-bookworm-slim AS deps
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY renderer/package.json renderer/
# pnpm always installs the workspace root's dependencies too (the whole web
# app). Drop them from the root manifest first: the renderer's own packages
# keep the versions pinned in the lockfile.
RUN node -e 'const fs = require("fs"); const p = JSON.parse(fs.readFileSync("package.json")); fs.writeFileSync("package.json", JSON.stringify({ name: p.name, private: true, type: p.type, packageManager: p.packageManager, pnpm: p.pnpm }))' \
 && pnpm install --prod --filter @troupe/renderer \
 # The ONNX runtime ships binaries for every OS and CPU: keep this one's.
 && arch="$(node -p process.arch)" \
 && for bin in node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v*; do \
      find "$bin" -mindepth 1 -maxdepth 1 ! -name linux -exec rm -rf {} + \
      && find "$bin/linux" -mindepth 1 -maxdepth 1 ! -name "$arch" -exec rm -rf {} +; \
    done

FROM node:24-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/renderer/node_modules renderer/node_modules
COPY renderer/package.json renderer/
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

# The AI video mode on top: Python 3.11 (Debian's), uv and the locked
# environment from renderer/ltx/uv.lock (PyTorch, diffusers, transformers).
# The weights are not in the image: they download into /data/huggingface.
FROM runtime AS ltx
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# ghcr.io/astral-sh/uv:0.9
COPY --from=ghcr.io/astral-sh/uv:0.9@sha256:538e0b39736e7feae937a65983e49d2ab75e1559d35041f9878b7b7e51de91e4 /uv /usr/local/bin/uv
COPY renderer/ltx/pyproject.toml renderer/ltx/uv.lock renderer/ltx/generate.py /app/renderer/ltx/
RUN cd /app/renderer/ltx \
 && UV_PYTHON_DOWNLOADS=never UV_PYTHON=python3 UV_LINK_MODE=copy uv sync --frozen --no-cache \
 && chown -R node:node /app/renderer/ltx
ENV LTX_ENABLED=1 \
    LTX_COMMAND="/app/renderer/ltx/.venv/bin/python /app/renderer/ltx/generate.py" \
    LTX_PROMPT_CACHE=/data/ltx-prompts \
    HF_HOME=/data/huggingface
USER node

# The default target: the fast renderer alone.
FROM runtime AS renderer
