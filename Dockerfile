# syntax=docker/dockerfile:1
# One image for both Railway services:
#   web:    default CMD (migrate, seed demo if missing, node server.js)
#   worker: start command "npm run worker"

ARG NODE_VERSION=22

# ---------------------------------------------------------------------------
# 1. Dependencies (including dev: prisma CLI and tsx are needed at runtime for
#    migrations, seeding and the worker)
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS deps
WORKDIR /app
# OpenSSL must be present before install so Prisma picks the matching engines.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
# 2. Build: Prisma client + Next.js standalone output
# ---------------------------------------------------------------------------
FROM deps AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Railway passes the commit as a build argument. It becomes the Next.js deployment id, so a browser
# still holding a page from the previous deploy reloads instead of mixing old and new versions.
ARG RAILWAY_GIT_COMMIT_SHA
ENV NEXT_DEPLOYMENT_ID=${RAILWAY_GIT_COMMIT_SHA}
COPY . .
RUN mkdir -p public \
  && npx prisma generate \
  && npx next build

# ---------------------------------------------------------------------------
# 3. Runtime
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS runner
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Full node_modules (with the generated Prisma client) for migrations, seed and worker,
# then the standalone server on top (same package versions, traced subset).
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

# Sources used at runtime by tsx (migrate, seed, worker) and by the app (fonts for PDFs, messages).
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json /app/tsconfig.json ./
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/assets ./assets
COPY --from=build --chown=node:node /app/messages ./messages

# Local upload fallback when R2 is not configured (ephemeral, see docs/deploy.md).
RUN mkdir -p /app/.uploads && chown node:node /app/.uploads && chmod +x /app/scripts/docker-start.sh

USER node
EXPOSE 3000
CMD ["/app/scripts/docker-start.sh"]
