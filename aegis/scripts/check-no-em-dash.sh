#!/usr/bin/env bash
# Fails when an em dash appears in source, docs, config or seed data (project rule: hyphens or rewrite).
set -euo pipefail
cd "$(dirname "$0")/.."
if grep -rIl --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=screens --exclude-dir=playwright-report --exclude-dir=test-results $'\xe2\x80\x94' . ; then
  echo "em dash found in the files above" >&2
  exit 1
fi
echo "no em dashes"
