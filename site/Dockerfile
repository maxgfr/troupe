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

FROM node:24-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG TROUPE_WEB_BASE=/troupe/
RUN VITE_BASE="$TROUPE_WEB_BASE" pnpm site:build

FROM nginxinc/nginx-unprivileged:1.29-alpine
ARG TROUPE_WEB_BASE=/troupe/
# Read by the configuration template when the container starts.
ENV TROUPE_WEB_BASE=${TROUPE_WEB_BASE}
USER root
RUN rm -f /etc/nginx/conf.d/default.conf
COPY site/docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build --chown=nginx:nginx /app/site/dist /usr/share/nginx/html${TROUPE_WEB_BASE}
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=4 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
