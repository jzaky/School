#!/bin/sh
# Web container entry point: migrate (owner role + RLS), seed the demo school if missing, start Next.js.
set -e
cd /app

echo "[start] applying migrations and RLS"
node --import tsx scripts/db-migrate.ts

if [ "${SEED_ON_START:-true}" = "true" ]; then
  node --import tsx scripts/seed-if-missing.ts
fi

echo "[start] starting web server on ${HOSTNAME:-0.0.0.0}:${PORT:-3000}"
exec node server.js
