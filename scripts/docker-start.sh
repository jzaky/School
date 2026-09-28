#!/bin/sh
# Web container entry point: migrate (owner role + RLS), seed the demo school if missing, start Next.js.
set -e
cd /app

# Report which settings are present (names only, never values) so a missing variable is obvious in the logs.
for v in MIGRATION_DATABASE_URL DATABASE_URL APP_USER_PASSWORD REDIS_URL AUTH_SECRET AUTH_URL APP_URL FIELD_ENCRYPTION_KEY DEMO_MODE PORT; do
  eval "val=\${$v:-}"
  if [ -n "$val" ]; then echo "[start] $v: set"; else echo "[start] $v: MISSING"; fi
done
case "${MIGRATION_DATABASE_URL:-}" in
  *'${{'*) echo "[start] MIGRATION_DATABASE_URL still contains an unresolved \${{...}} reference. Check the referenced service name." ;;
esac
case "${DATABASE_URL:-}" in
  postgresql://*|postgres://*|"") ;;
  *) echo "[start] DATABASE_URL does not start with postgresql://" ;;
esac

# Show the shape of the database and Redis addresses with passwords hidden.
node -e '
for (const k of ["MIGRATION_DATABASE_URL", "DATABASE_URL", "REDIS_URL"]) {
  const v = process.env[k] || "";
  let shown = v.replace(/:\/\/([^:@\/]*):([^@]*)@/, "://$1:****@");
  console.log("[start] " + k + " looks like: " + (shown || "(empty)"));
}'

echo "[start] applying migrations and RLS"
node --import tsx scripts/db-migrate.ts

if [ "${SEED_ON_START:-true}" = "true" ]; then
  node --import tsx scripts/seed-if-missing.ts
fi

echo "[start] starting web server on ${HOSTNAME:-0.0.0.0}:${PORT:-3000}"
exec node server.js
