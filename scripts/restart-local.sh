#!/usr/bin/env bash
# Local helper: restart the production server on port 3000 (development only).
cd "$(dirname "$0")/.."
if [ -f /tmp/claude-0/next.pid ]; then kill "$(cat /tmp/claude-0/next.pid)" 2>/dev/null; fi
for p in $(ps -eo pid,comm | awk '$2 ~ /next-server/ {print $1}'); do kill "$p" 2>/dev/null; done
sleep 1
set -a; . ./.env; set +a
nohup npx next start -p 3000 > /tmp/claude-0/start.log 2>&1 &
echo $! > /tmp/claude-0/next.pid
for i in $(seq 1 30); do curl -s -o /dev/null localhost:3000/login && break; sleep 1; done
echo "server up"
