# syntax=docker/dockerfile:1
# The browser edition (site/) and its landing page, built from the repository
# root and served by nginx. docker-compose.yml runs it as the `web` service:
#
#   docker compose up -d --build web      # http://localhost:3101/troupe/
#
# The site is served under TROUPE_WEB_BASE (default /troupe/, as on GitHub
# Pages): a build argument, since the path is written into the bundle. The
# site's other settings (site/.env.example) are read from site/.env when the
# file exists, or from VITE_* build arguments passed through the environment.

# The site is the same files on every platform: build it once, natively,
# for a multi-platform image.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG TROUPE_WEB_BASE=/troupe/
RUN VITE_BASE="$TROUPE_WEB_BASE" pnpm site:build \
 && node site/docker/csp.mjs site/dist > site/csp.conf

# nginxinc/nginx-unprivileged:1.29-alpine
FROM nginxinc/nginx-unprivileged:1.29-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6
ARG TROUPE_WEB_BASE=/troupe/
# Read by the configuration template when the container starts.
ENV TROUPE_WEB_BASE=${TROUPE_WEB_BASE}
USER root
RUN rm -f /etc/nginx/conf.d/default.conf
COPY site/docker/nginx.conf.template /etc/nginx/templates/default.conf.template
# The Content-Security-Policy, with the built pages' inline script hashes.
COPY --from=build /app/site/csp.conf /etc/nginx/troupe-csp.conf
COPY --from=build --chown=nginx:nginx /app/site/dist /usr/share/nginx/html${TROUPE_WEB_BASE}
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=4 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
