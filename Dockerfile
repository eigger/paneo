# Paneo server — single portable container (docs/design.md §10/§11, B1).
# No build step (no bundler/TS) — install deps and run node directly, so the
# same image works whether it's co-located on a display Pi or run on
# separate always-on hardware (§10).
FROM node:22-alpine

WORKDIR /app

# Install deps in their own layer so code-only changes don't bust the cache.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Runtime data (SQLite DB, uploaded photos, installed plugins) lives outside
# the image so it survives container recreation — PANEO_DATA_DIR is read by
# src/store.js, src/plugins.js and the photo-upload routes in src/server.js.
ENV PANEO_DATA_DIR=/data
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]

USER node
EXPOSE 4321

# No curl/wget in alpine by default — reuse Node's own fetch instead of
# adding a package just for the healthcheck.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||4321)+'/api/version').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
