FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
FROM node:24-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node","server.js"]
FROM mcr.microsoft.com/playwright:v1.64.0-noble AS worker
WORKDIR /app
# Official Playwright image. Browser launch happens only in this separate service.
RUN groupadd -r dfworker && useradd -r -g dfworker -d /app dfworker
COPY package*.json ./
RUN npm ci
# Real Google Chrome (not the bundled Chromium build) plus an X server, so the
# worker runs a headed browser on a virtual display instead of headless mode.
RUN npx playwright install --with-deps chrome \
  && apt-get update && apt-get install -y --no-install-recommends xvfb \
  && rm -rf /var/lib/apt/lists/*
COPY --chown=dfworker:dfworker . .
RUN mkdir -p internal-debug && chown dfworker:dfworker internal-debug
# DISPLAY is image-wide so `docker compose exec worker npm run browser:probe` also finds Xvfb.
ENV NODE_ENV=production DISPLAY=:99
USER dfworker
ENTRYPOINT ["sh", "/app/deploy/worker-entrypoint.sh"]
CMD ["npm","run","worker"]
