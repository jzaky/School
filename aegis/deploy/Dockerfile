# Multi-stage build for every AEGIS process. Build with:
#   docker build -f deploy/Dockerfile --target api    -t aegis-api .
#   docker build -f deploy/Dockerfile --target worker -t aegis-worker .
#   docker build -f deploy/Dockerfile --target web    -t aegis-web .
# Runs as a non-root user. No secrets are baked in; everything comes from the environment.
FROM node:22-bookworm-slim AS base
# pnpm is installed into a shared, read-only location at build time. The runtime user has no writable cache,
# so without this corepack tries to download pnpm on every start and fails.
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1 COREPACK_HOME=/opt/corepack COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate && chmod -R a+rX /opt/corepack && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/core/package.json packages/core/
COPY packages/sdk/package.json packages/sdk/
COPY packages/mcp-gateway/package.json packages/mcp-gateway/
RUN pnpm install --frozen-lockfile

FROM deps AS source
COPY . .
RUN pnpm --filter @aegis/db generate

# ---- API (Action Gateway) ----
FROM source AS api
RUN addgroup --system aegis && adduser --system --ingroup aegis --home /home/aegis aegis && chown -R aegis:aegis /app && mkdir -p /data/uploads && chown aegis:aegis /data/uploads
USER aegis
ENV NODE_ENV=production API_PORT=4000 AEGIS_STORAGE_DIR=/data/uploads AEGIS_PROCESS=api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@aegis/api", "start"]

# ---- Worker ----
FROM source AS worker
RUN addgroup --system aegis && adduser --system --ingroup aegis --home /home/aegis aegis && chown -R aegis:aegis /app && mkdir -p /data/uploads && chown aegis:aegis /data/uploads
USER aegis
ENV NODE_ENV=production AEGIS_STORAGE_DIR=/data/uploads AEGIS_PROCESS=worker
CMD ["pnpm", "--filter", "@aegis/worker", "start"]

# ---- Migrations (run once per deploy, the only image that receives owner credentials) ----
FROM source AS migrate
ENV AEGIS_PROCESS=migrate
CMD ["pnpm", "--filter", "@aegis/db", "migrate"]

# ---- Web console ----
FROM source AS web-build
ENV NODE_ENV=production
RUN pnpm --filter @aegis/web build

FROM web-build AS web
RUN addgroup --system aegis && adduser --system --ingroup aegis --home /home/aegis aegis && chown -R aegis:aegis /app && mkdir -p /data/uploads && chown aegis:aegis /data/uploads
USER aegis
ENV AEGIS_STORAGE_DIR=/data/uploads AEGIS_PROCESS=web
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@aegis/web", "start"]
