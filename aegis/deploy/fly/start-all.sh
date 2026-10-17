#!/bin/bash
# Demo only: runs the api, worker and web console in one machine so they share one volume for
# uploads (AEGIS_STORAGE_DIR). Production runs them as separate services (docs/DEPLOYMENT.md).
# Started as root only to give the freshly mounted volume to the aegis user, then drops to it.
# If any of the three processes exits, the script exits and the platform restarts the machine.
set -euo pipefail
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$AEGIS_STORAGE_DIR"
  chown -R aegis:aegis "$AEGIS_STORAGE_DIR"
  HOME=/home/aegis exec setpriv --reuid aegis --regid aegis --init-groups "$0" "$@"
fi
AEGIS_PROCESS=api pnpm --filter @aegis/api start &
AEGIS_PROCESS=worker pnpm --filter @aegis/worker start &
AEGIS_PROCESS=web pnpm --filter @aegis/web start &
wait -n || true
echo "A demo process exited; stopping so the machine restarts" >&2
exit 1
