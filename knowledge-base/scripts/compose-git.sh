#!/usr/bin/env bash
set -euo pipefail
KB_SOURCE_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
export KB_APP_IMAGE=${KB_APP_IMAGE:-survey-kb:git-$(git -C "$KB_SOURCE_DIR" rev-parse --short HEAD)}
export KB_STATE_DIR=${KB_STATE_DIR:-/root/survey-kb/knowledge-base}
export BGE_MODEL_DIR=${BGE_MODEL_DIR:-/root/survey-kb/bge-m3}
test -f "$KB_STATE_DIR/.env"
test -d "$KB_STATE_DIR/config"
test -f "$BGE_MODEL_DIR/config.json"
exec docker compose --project-name survey-kb --project-directory "$KB_SOURCE_DIR" \
  --env-file "$KB_STATE_DIR/.env" -f "$KB_SOURCE_DIR/compose.yaml" -f "$KB_SOURCE_DIR/compose.existing.yaml" "$@"
