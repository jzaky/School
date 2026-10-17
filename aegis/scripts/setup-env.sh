#!/usr/bin/env bash
# Creates aegis/.env from .env.example with freshly generated secrets. Needs only openssl.
# Safe to re-run: an existing .env is never overwritten (delete it first to start over).
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  echo ".env already exists; leaving it untouched. Delete it to regenerate."
  exit 0
fi
MASTER=$(openssl rand -base64 32)
SESSION=$(openssl rand -base64 32)
SIGNING=$(openssl genpkey -algorithm ed25519 | base64 | tr -d '\n')
# The owner URL is written commented out: application processes must not carry it (they refuse to start in
# production if they do). Pass it inline to the migrate and seed commands instead, see docs/DEPLOY_STEP_BY_STEP.md.
sed \
  -e "s#^MIGRATION_DATABASE_URL=#\# MIGRATION_DATABASE_URL=#" \
  -e "s#^AEGIS_MASTER_KEY=.*#AEGIS_MASTER_KEY=${MASTER}#" \
  -e "s#^AEGIS_SESSION_SECRET=.*#AEGIS_SESSION_SECRET=${SESSION}#" \
  -e "s#^EVIDENCE_SIGNING_KEY=.*#EVIDENCE_SIGNING_KEY=${SIGNING}#" \
  .env.example > .env
echo "wrote .env with new AEGIS_MASTER_KEY, AEGIS_SESSION_SECRET and EVIDENCE_SIGNING_KEY"
echo "Now edit .env: DATABASE_URL (app role password), REDIS_URL, API_PUBLIC_URL, WEB_PUBLIC_URL, API_CORS_ORIGINS, NODE_ENV."
echo "Run migrations and the seed with the owner URL passed inline, for example:"
echo "  MIGRATION_DATABASE_URL=postgresql://aegis_owner:OWNER_PASSWORD@127.0.0.1:5432/aegis AEGIS_APP_PASSWORD=APP_PASSWORD pnpm db:migrate"
