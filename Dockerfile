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
RUN apt-get update && apt-get install -y --no-install-recommends xvfb ca-certificates wget \
    && wget -q -O /tmp/google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get install -y --no-install-recommends /tmp/google-chrome.deb \
    && rm -f /tmp/google-chrome.deb \
    && rm -rf /var/lib/apt/lists/*
RUN groupadd -r dfworker && useradd -r -g dfworker -d /app dfworker
COPY package*.json ./
RUN npm ci
COPY --chown=dfworker:dfworker . .
RUN mkdir -p internal-debug browser-profiles && chown -R dfworker:dfworker internal-debug browser-profiles
ENV NODE_ENV=production BROWSER_EXECUTABLE_PATH=/usr/bin/google-chrome BROWSER_PROFILE_DIR=/app/browser-profiles
USER dfworker
CMD ["xvfb-run","-a","npm","run","worker"]
