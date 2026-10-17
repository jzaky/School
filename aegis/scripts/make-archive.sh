#!/usr/bin/env bash
# Builds a reviewable archive of the AEGIS source: no dependencies, build output, secrets or demo keys,
# and includes the CI workflow, which GitHub requires to live at the repository root (.github/workflows).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-/tmp/aegis-source.zip}"
cd "$ROOT"
rm -f "$OUT"
zip -qr "$OUT" aegis .github/workflows/aegis-ci.yml \
  -x "aegis/node_modules/*" "aegis/*/node_modules/*" "aegis/*/*/node_modules/*" \
     "aegis/apps/web/.next/*" "aegis/.env" "aegis/.demo-keys.json" \
     "aegis/apps/web/test-results/*" "aegis/apps/web/playwright-report/*" "aegis/.uploads/*"
echo "wrote $OUT ($(du -h "$OUT" | cut -f1))"
