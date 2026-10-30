#!/usr/bin/env bash
# Runs the AEGIS demo on your own computer with Docker Desktop. One command, safe to run again.
#
#   ./scripts/demo-local.sh            start (or restart) the demo and open it in the browser
#   ./scripts/demo-local.sh check      is it up? prints OK or what is wrong
#   ./scripts/demo-local.sh reset      put the demo data back to its starting state
#   ./scripts/demo-local.sh stop       stop it (data is kept)
#   ./scripts/demo-local.sh update     rebuild after pulling new code
#   ./scripts/demo-local.sh logs       show the last log lines if something is wrong
#
# Everything stays on this computer and uses synthetic data only. The containers restart on their own
# whenever Docker Desktop starts, so after the first run the demo is there whenever Docker is running.
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE=(docker compose -f deploy/docker-compose.yml)
WEB=http://localhost:3000
API=http://localhost:4000
KEYS=deploy/seed-output/.demo-keys.json

say() { printf '\n== %s\n' "$*"; }

need_docker() {
  command -v docker >/dev/null 2>&1 || { echo "Docker is not installed. Install Docker Desktop from docker.com, open it, then run this again."; exit 1; }
  docker info >/dev/null 2>&1 || { echo "Docker is not running. Open Docker Desktop, wait until it says it is running, then run this again."; exit 1; }
}

is_up() { curl -sf -o /dev/null "$WEB/login" && curl -sf -o /dev/null "$API/health"; }

wait_up() {
  for _ in $(seq 1 120); do is_up && return 0; sleep 2; done
  return 1
}

seed() {
  say "Loading the demo data (about a minute)"
  mkdir -p deploy/seed-output
  "${COMPOSE[@]}" --profile seed run --rm seed
}

show_ready() {
  cat <<MSG

AEGIS demo is running: $WEB

Sign in (password for all: AegisDemo2026!)
  Approver   lina.mansour@meridian-demo.example   (Approvals: approve a held refund)
  Auditor    hana.youssef@meridian-demo.example   (Evidence: verify the ledger)
  Owner      nadia.haddad@meridian-demo.example   (Overview and everything else)

Use Chrome for the demo. Before a meeting run: ./scripts/demo-local.sh check
MSG
  command -v open >/dev/null 2>&1 && open "$WEB/login" || true
}

case "${1:-start}" in
  start)
    need_docker
    [ -f .env ] || ./scripts/setup-env.sh
    say "Starting AEGIS (the very first run builds it, which takes 15 to 20 minutes)"
    "${COMPOSE[@]}" up -d
    say "Waiting for the console and the API to answer"
    wait_up || { echo "AEGIS did not come up in 4 minutes. Run: ./scripts/demo-local.sh logs"; exit 1; }
    [ -f "$KEYS" ] || seed
    show_ready
    ;;
  check)
    need_docker
    if is_up; then echo "OK: console and API are answering at $WEB"; else echo "NOT RUNNING: run ./scripts/demo-local.sh to start it"; exit 1; fi
    ;;
  reset)
    need_docker
    is_up || { echo "Start the demo first: ./scripts/demo-local.sh"; exit 1; }
    seed
    echo "Demo data reset."
    ;;
  stop)
    need_docker
    "${COMPOSE[@]}" stop
    echo "Stopped. Your demo data is kept; ./scripts/demo-local.sh starts it again."
    ;;
  update)
    need_docker
    "${COMPOSE[@]}" up -d --build
    wait_up && echo "Updated and running at $WEB" || { echo "Not answering after the update. Run: ./scripts/demo-local.sh logs"; exit 1; }
    ;;
  logs)
    "${COMPOSE[@]}" ps
    "${COMPOSE[@]}" logs --tail 40 api web worker migrate
    ;;
  *)
    sed -n '2,10p' "$0"; exit 2 ;;
esac
