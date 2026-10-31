#!/bin/bash
# Production-like deployment checks against a running Docker Compose stack: real containers, real HTTP.
# Usage (from aegis/, after `docker compose -f deploy/docker-compose.yml up -d` and the seed profile has run):
#   scripts/deployment-check.sh
# Set AEGIS_COMPOSE to the full compose command if you use extra files or an --env-file.
# It restarts the api and postgres containers: run it only against a disposable deployment.
# Results and their meaning: docs/DEPLOYMENT_VALIDATION.md.
set -u
cd "$(dirname "$0")/.."
DC="${AEGIS_COMPOSE:-docker compose -f deploy/docker-compose.yml}"
API="${AEGIS_API:-http://localhost:4000}"; WEB="${AEGIS_WEB:-http://localhost:3000}"
KEY=$(python3 -c "import json;print(json.load(open('deploy/seed-output/.demo-keys.json'))['agents']['support-refund-agent'])")
WORKER=$($DC ps -q worker)
pass=0; fail=0
check() { if eval "$2"; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1"; fail=$((fail+1)); fi; }

echo "== 1 health and readiness over HTTP"
check "api /health 200" '[ "$(curl -s -o /dev/null -w %{http_code} $API/health)" = 200 ]'
check "api /ready 200" '[ "$(curl -s -o /dev/null -w %{http_code} $API/ready)" = 200 ]'
check "web /login 200" '[ "$(curl -s -o /dev/null -w %{http_code} $WEB/login)" = 200 ]'

echo "== 2 database roles"
ROLES=$($DC exec -T postgres psql -U aegis_owner -d aegis -tAc "SELECT string_agg(DISTINCT usename, ',') FROM pg_stat_activity WHERE datname='aegis' AND usename IS NOT NULL AND pid <> pg_backend_pid()")
echo "   connected roles: $ROLES"
check "app services connect only as aegis_app" '[ "$ROLES" = "aegis_app" ]'
check "aegis_app is not superuser and cannot bypass RLS" '[ "$($DC exec -T postgres psql -U aegis_owner -d aegis -tAc "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname='"'"'aegis_app'"'"'")" = f ]'
check "no owner credential in api, web or worker environment" '! $DC exec -T api env | grep -q "aegis_owner" && ! $DC exec -T web env | grep -q "aegis_owner" && ! $DC exec -T worker env | grep -q "aegis_owner"'
GUARD=$(mktemp)
check "an app service refuses to start with an owner URL" '! timeout 120 $DC run --rm --no-deps -e MIGRATION_DATABASE_URL=postgresql://aegis_owner:x@postgres:5432/aegis api > $GUARD 2>&1'
grep -iE "owner|refus" $GUARD | head -2 | sed 's/^/   /'; rm -f $GUARD

echo "== 3 headers and exposure"
H=$(curl -sI $WEB/login)
check "console sends a Content-Security-Policy" 'echo "$H" | grep -qi "^content-security-policy:"'
check "console refuses framing" 'echo "$H" | grep -qiE "^x-frame-options:|frame-ancestors"'
check "console sends nosniff" 'echo "$H" | grep -qi "^x-content-type-options: nosniff"'
check "api sends nosniff" 'curl -sI $API/health | grep -qi "^x-content-type-options: nosniff"'
check "metrics refused from outside the host" '[ "$(curl -s -o /dev/null -w %{http_code} $API/metrics)" != 200 ]'
check "unauthenticated agent list refused" '[ "$(curl -s -o /dev/null -w %{http_code} $API/v1/agents)" = 401 ]'
check "error bodies carry no stack trace" '! curl -s -X POST $API/v1/gateway/actions -H "authorization: Bearer $KEY" -H "content-type: application/json" -d "{bad json" | grep -qiE "at .*\.(js|ts):[0-9]+"'

echo "== 4 the gateway end to end with the seeded refund agent"
sub() { curl -s -o /dev/null -w %{http_code} -X POST $API/v1/gateway/actions -H "authorization: Bearer $KEY" -H "content-type: application/json" -d "{\"tool\":\"issue-refund\",\"resource\":\"support-tickets\",\"executionMode\":\"agent\",\"idempotencyKey\":\"deploy-$(date +%s%N)\",\"params\":{\"orderId\":\"ORD-DEPLOY-$RANDOM$RANDOM\",\"customerId\":\"CUST-1\",\"amount\":$1,\"currency\":\"AED\"}}"; }
check "a small refund is allowed (200)" '[ "$(sub 120)" = 200 ]'
check "a refund in the approval band is held (202)" '[ "$(sub 1200)" = 202 ]'
check "a refund above the ceiling is refused (403)" '[ "$(sub 9000)" = 403 ]'
check "a bad key is refused (401)" '[ "$(curl -s -o /dev/null -w %{http_code} -X POST $API/v1/gateway/actions -H "authorization: Bearer aegis_ak_bad_bad" -H "content-type: application/json" -d "{}")" = 401 ]'

echo "== 5 the worker"
check "worker is running" '[ "$($DC ps --format "{{.Service}}={{.State}}" | grep worker)" = "worker=running" ]'
check "worker process never crashed (no container restarts, no uncaught exception)" '[ "$(docker inspect -f "{{.RestartCount}}" $WORKER)" = 0 ] && ! $DC logs worker 2>&1 | grep -qiE "uncaught|unhandledrejection"'
JOBS=$($DC exec -T postgres psql -U aegis_owner -d aegis -tAc "SELECT string_agg(status||':'||n, ' ') FROM (SELECT status, count(*) n FROM jobs GROUP BY status) x")
echo "   jobs by status: $JOBS"

echo "== 6 restart resilience"
$DC restart api > /dev/null 2>&1
for i in $(seq 1 60); do [ "$(curl -s -o /dev/null -w %{http_code} $API/ready)" = 200 ] && break; sleep 2; done
check "api ready again after a restart" '[ "$(curl -s -o /dev/null -w %{http_code} $API/ready)" = 200 ]'
check "gateway decides after the api restart" '[ "$(sub 110)" = 200 ]'
$DC restart postgres > /dev/null 2>&1
for i in $(seq 1 60); do [ "$(curl -s -o /dev/null -w %{http_code} $API/ready)" = 200 ] && break; sleep 2; done
check "api ready again after a database restart" '[ "$(curl -s -o /dev/null -w %{http_code} $API/ready)" = 200 ]'
check "gateway decides after the database restart" '[ "$(sub 105)" = 200 ]'
check "console serves after the database restart" '[ "$(curl -s -o /dev/null -w %{http_code} $WEB/login)" = 200 ]'
JAR=$(mktemp)
curl -s -c $JAR -o /dev/null -X POST $API/v1/auth/login -H "content-type: application/json" -d '{"email":"nadia.haddad@meridian-demo.example","password":"AegisDemo2026!"}'
VER=$(curl -s -b $JAR -X POST $API/v1/assurance/evidence/verify -H "content-type: application/json" -d '{}')
echo "   chain verification: $(echo "$VER" | cut -c1-200)"
check "evidence chain verifies after the restarts" 'echo "$VER" | grep -qE "\"ok\":true|\"valid\":true"'
DONE0=$($DC exec -T postgres psql -U aegis_owner -d aegis -tAc "SELECT count(*) FROM jobs WHERE status='done'")
sub 130 > /dev/null; sub 1300 > /dev/null
for i in $(seq 1 45); do [ "$($DC exec -T postgres psql -U aegis_owner -d aegis -tAc "SELECT count(*) FROM jobs WHERE status='done'")" -gt "$DONE0" ] && break; sleep 4; done
check "worker completes new jobs after the database restart" '[ "$($DC exec -T postgres psql -U aegis_owner -d aegis -tAc "SELECT count(*) FROM jobs WHERE status='"'"'done'"'"'")" -gt "$DONE0" ]'
rm -f $JAR
echo "== result: $pass passed, $fail failed"
[ "$fail" = 0 ]
