# syntax=docker/dockerfile:1
# Troupe's local renderer (docs/LOCAL-MODELS.md): Kokoro voices, captions and
# ffmpeg on the CPU. Built from the repository root; docker-compose.yml runs
# it as the `renderer` service:
#
#   docker compose up -d --build renderer
#
# Both targets carry transcription for the studio's inspiration library
# (faster-whisper on the CPU, renderer/whisper, at /transcribe), on unless
# WHISPER_ENABLED=0; its weights download into /data/huggingface on first use.
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
# `pnpm deploy` installs the renderer's production dependencies alone, at the
# versions in the lockfile (--frozen-lockfile fails the build when it is out
# of step with the manifests), into /deploy. inject-workspace-packages is
# only what pnpm 10 asks of a deploy: the renderer depends on no workspace
# package, and the lockfile stays as it is.
RUN pnpm --filter @troupe/renderer deploy --prod --frozen-lockfile --config.inject-workspace-packages=true /deploy \
 # The ONNX runtime ships binaries for every OS and CPU: keep this one's.
 && arch="$(node -p process.arch)" \
 && for bin in /deploy/node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v*; do \
      find "$bin" -mindepth 1 -maxdepth 1 ! -name linux -exec rm -rf {} + \
      && find "$bin/linux" -mindepth 1 -maxdepth 1 ! -name "$arch" -exec rm -rf {} +; \
    done

FROM node:24-bookworm-slim AS runtime
# eSpeak NG (in kokoro-js) makes the renderer a GPL-3.0-or-later work as a
# whole (THIRD_PARTY_NOTICES.md).
LABEL org.opencontainers.image.licenses="GPL-3.0-or-later"
# Troupe's license, the third-party notices and the GNU GPL's text
# (THIRD_PARTY_NOTICES.md says which parts carry it).
COPY LICENSE THIRD_PARTY_NOTICES.md LICENSES/GPL-3.0.txt /usr/share/doc/troupe/
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /deploy/node_modules renderer/node_modules
COPY renderer/package.json renderer/
# The scene module is shared with the app; the renderer imports it from src/,
# and how it reads its version from scripts/.
COPY src/modules/scene src/modules/scene
COPY scripts/release-version.mjs scripts/
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

# Python 3.11 (Debian's), uv, and transcription's locked environment from
# renderer/whisper/uv.lock (faster-whisper on CTranslate2; no PyTorch).
FROM runtime AS python
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# ghcr.io/astral-sh/uv:0.9
COPY --from=ghcr.io/astral-sh/uv:0.9@sha256:538e0b39736e7feae937a65983e49d2ab75e1559d35041f9878b7b7e51de91e4 /uv /usr/local/bin/uv
COPY renderer/whisper/pyproject.toml renderer/whisper/uv.lock renderer/whisper/transcribe.py /app/renderer/whisper/
RUN cd /app/renderer/whisper \
 && UV_PYTHON_DOWNLOADS=never UV_PYTHON=python3 UV_LINK_MODE=copy uv sync --frozen --no-cache \
 && chown -R node:node /app/renderer/whisper
ENV WHISPER_ENABLED=1 \
    WHISPER_COMMAND="/app/renderer/whisper/.venv/bin/python /app/renderer/whisper/transcribe.py" \
    HF_HOME=/data/huggingface
USER node

# The AI video mode on top: the locked environment from renderer/ltx/uv.lock
# (PyTorch, diffusers, transformers). The weights are not in the image: they
# download into /data/huggingface.
FROM python AS ltx
USER root
COPY renderer/ltx/pyproject.toml renderer/ltx/uv.lock renderer/ltx/generate.py /app/renderer/ltx/
RUN cd /app/renderer/ltx \
 && UV_PYTHON_DOWNLOADS=never UV_PYTHON=python3 UV_LINK_MODE=copy uv sync --frozen --no-cache \
 && chown -R node:node /app/renderer/ltx
ENV LTX_ENABLED=1 \
    LTX_COMMAND="/app/renderer/ltx/.venv/bin/python /app/renderer/ltx/generate.py" \
    LTX_PROMPT_CACHE=/data/ltx-prompts
USER node
# The released version (scripts/release-version.mjs), from the release
# workflow; empty in a local build, which then reports package.json's.
ARG TROUPE_VERSION=
ENV TROUPE_VERSION=${TROUPE_VERSION}

# The default target: the fast renderer, with transcription.
FROM python AS renderer
# The released version (scripts/release-version.mjs), from the release
# workflow; empty in a local build, which then reports package.json's.
ARG TROUPE_VERSION=
ENV TROUPE_VERSION=${TROUPE_VERSION}
