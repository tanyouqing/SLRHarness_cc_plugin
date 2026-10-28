#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "${KB_ALLOW_RESTART_TEST:-}" != "yes" ]]; then
  echo 'This test restarts the deployment. Run KB_ALLOW_RESTART_TEST=yes bash scripts/cloud-persistence.sh on an idle test deployment.' >&2
  exit 2
fi
docker compose restart db embedding api worker
docker compose up -d --wait db embedding api worker
docker compose run --rm -T --no-deps --entrypoint node client dist/cloud-case.js persistence
