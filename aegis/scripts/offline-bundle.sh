#!/usr/bin/env bash
# Builds the offline (air-gapped) installation bundle on a machine WITH internet access.
# The result is one archive the entity copies to its offline server and installs with ./install.sh.
#
#   ./scripts/offline-bundle.sh [version]      default version: the current git commit
#
# Output: dist/aegis-offline-<version>.tar and its .sha256
# Contents: images.tar.gz (AEGIS api, worker, web, migrate, plus PostgreSQL, Redis and Caddy), the compose
# file, Caddyfile, database role script, install.sh, VERSION and SHA256SUMS. No secrets are included;
# install.sh generates them on the target machine.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="${1:-$(git rev-parse --short HEAD)}"
POSTGRES_IMAGE=postgres:16
REDIS_IMAGE=redis:7-alpine
CADDY_IMAGE=caddy:2-alpine
OUT=dist/aegis-offline-${VERSION}
# Optional overrides for build machines behind a proxy: another Dockerfile, and extra docker build flags.
DOCKERFILE="${AEGIS_DOCKERFILE:-deploy/Dockerfile}"
read -r -a BUILD_FLAGS <<< "${AEGIS_BUILD_FLAGS:-}"
rm -rf "$OUT" && mkdir -p "$OUT"

# AEGIS_SKIP_BUILD=1 packages images already built and tagged with this version.
for target in api worker web migrate; do
  if [ "${AEGIS_SKIP_BUILD:-0}" = 1 ]; then docker image inspect "aegis-${target}:${VERSION}" >/dev/null || { echo "missing aegis-${target}:${VERSION}" >&2; exit 1; }; continue; fi
  echo "building aegis-${target}:${VERSION}"
  docker build -q "${BUILD_FLAGS[@]}" -f "$DOCKERFILE" --target "$target" -t "aegis-${target}:${VERSION}" . >/dev/null
done
for img in "$POSTGRES_IMAGE" "$REDIS_IMAGE" "$CADDY_IMAGE"; do docker image inspect "$img" >/dev/null 2>&1 || docker pull -q "$img" >/dev/null; done

echo "saving images (compressed)"
docker save \
  "aegis-api:${VERSION}" "aegis-worker:${VERSION}" "aegis-web:${VERSION}" "aegis-migrate:${VERSION}" \
  "$POSTGRES_IMAGE" "$REDIS_IMAGE" "$CADDY_IMAGE" | gzip -1 > "$OUT/images.tar.gz"

cp deploy/offline/docker-compose.yml deploy/offline/Caddyfile deploy/offline/install.sh deploy/postgres-init.sql "$OUT/"
cp docs/OFFLINE_INSTALL.md "$OUT/README.md"
echo "$VERSION" > "$OUT/VERSION"
(cd "$OUT" && sha256sum images.tar.gz docker-compose.yml Caddyfile install.sh postgres-init.sql VERSION > SHA256SUMS)

echo "packing"
# The images are already compressed; --remove-files keeps peak disk use close to one copy.
tar -C dist --remove-files -cf "dist/aegis-offline-${VERSION}.tar" "aegis-offline-${VERSION}"
(cd dist && sha256sum "aegis-offline-${VERSION}.tar" > "aegis-offline-${VERSION}.tar.sha256")
ls -lh "dist/aegis-offline-${VERSION}.tar"
echo "Copy the .tar and the .sha256 to the offline server, then: tar xf aegis-offline-${VERSION}.tar && cd aegis-offline-${VERSION} && ./install.sh"
