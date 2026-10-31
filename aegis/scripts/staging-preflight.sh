#!/bin/bash
# Read-only checks of the Fly.io staging set-up before a deploy (docs/STAGING_CONFIG_REVIEW.md).
# Run from aegis/ with flyctl signed in. It lists and inspects; it creates, changes and deploys nothing.
#   scripts/staging-preflight.sh [app] [database app]
set -u
cd "$(dirname "$0")/.."
APP="${1:-aegis-staging}"; DB="${2:-aegis-staging-db}"; CONFIG=deploy/fly/staging/fly.toml
pass=0; fail=0
check() { if eval "$2" > /dev/null 2>&1; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1"; fail=$((fail+1)); fi; }
command -v fly > /dev/null || { echo "flyctl is not installed (fly.io/docs/flyctl/install)"; exit 2; }
fly auth whoami > /dev/null 2>&1 || { echo "Sign in first: fly auth login"; exit 2; }

echo "== configuration ($CONFIG)"
check "the app name in the config is $APP" 'grep -q "^app = \"$APP\"" $CONFIG'
check "staging is not in demo mode" 'grep -q "AEGIS_DEMO_MODE = \"false\"" $CONFIG'
check "HTTPS is forced on the console" 'grep -q "force_https = true" $CONFIG'
check "the API is served only through TLS on 8443" 'grep -q "handlers = \[\"tls\", \"http\"\]" $CONFIG && ! grep -qE "port = 80$|port = 4000$" $CONFIG'
check "health and readiness checks are configured" 'grep -q "path = \"/health\"" $CONFIG && grep -q "path = \"/ready\"" $CONFIG'

echo "== separation from the demo and from production"
check "the staging app exists" 'fly status -a $APP'
check "the staging database is its own app" 'fly status -a $DB'
check "the staging app is not the demo app" '[ "$APP" != "aegis-demo" ]'
check "the staging database is not the demo database" '[ "$DB" != "aegis-demo-db" ]'

echo "== network isolation"
check "the database has no public IP (reachable only on the private network)" '[ -z "$(fly ips list -a $DB --json | grep -E "\"Type\": *\"(v4|v6)\"")" ]'
check "the upload volume exists in the primary region" 'fly volumes list -a $APP | grep -q aegis_staging_data'

echo "== secrets (names only; values are never printed)"
S=$(fly secrets list -a $APP 2>/dev/null)
for name in DATABASE_URL AEGIS_MASTER_KEY AEGIS_SESSION_SECRET EVIDENCE_SIGNING_KEY API_PUBLIC_URL WEB_PUBLIC_URL API_CORS_ORIGINS AEGIS_METRICS_TOKEN; do
  check "secret $name is set" 'echo "$S" | grep -qw $name'
done
for name in MIGRATION_DATABASE_URL AEGIS_APP_PASSWORD AEGIS_ALLOW_PRIVATE_DESTINATIONS; do
  check "secret $name is NOT set (owner credentials and test switches stay off the app)" '! echo "$S" | grep -qw $name'
done

echo "== backups"
VOL=$(fly volumes list -a $DB --json 2>/dev/null | grep -o '"id": *"vol_[^"]*"' | head -1 | grep -o 'vol_[^"]*')
check "the database volume exists" '[ -n "$VOL" ]'
check "the database volume has at least one snapshot" '[ -n "$VOL" ] && fly volumes snapshots list $VOL | grep -q vs_'
check "the upload volume keeps snapshots" 'grep -q "snapshot_retention = 14" $CONFIG'

echo "== result: $pass passed, $fail failed"
[ "$fail" = 0 ]
