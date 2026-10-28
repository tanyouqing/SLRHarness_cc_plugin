#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v jq >/dev/null
if [[ "${KB_ALLOW_FAULT_TESTS:-}" != "yes" ]]; then
  echo 'This test recreates the worker with failing dependencies. Run only on an idle test deployment: KB_ALLOW_FAULT_TESTS=yes bash scripts/cloud-faults.sh' >&2
  exit 2
fi
base=(-f compose.yaml)
if [[ -n "${BGE_MODEL_DIR:-}" ]]; then base+=(-f compose.offline.yaml); fi
dc() { docker compose "${base[@]}" "$@"; }
restore() { dc up -d --no-deps --force-recreate worker; }
trap restore EXIT
mkdir -p reports
for scenario in embedding model; do
  docker compose "${base[@]}" -f "tests/cloud/fault-${scenario}.yaml" up -d --no-deps --force-recreate worker
  if [[ "$scenario" == embedding ]]; then mode=submit-paper; else mode=submit-trajectory; fi
  receipt=$(dc run --rm -T --no-deps --entrypoint node client dist/cloud-case.js "$mode")
  printf '%s\n' "$receipt" > "reports/fault-${scenario}-receipt.json"
  job_id=$(printf '%s' "$receipt" | jq -er .job_id)
  dc run --rm -T --no-deps --entrypoint node client dist/cloud-case.js await-state "$job_id" failed > "reports/fault-${scenario}-failed.json"
  restore
  dc exec -T worker node dist/admin.js retry "$job_id"
  dc run --rm -T --no-deps --entrypoint node client dist/cloud-case.js await-state "$job_id" succeeded > "reports/fault-${scenario}-recovered.json"
done
echo 'Fault injection and task recovery passed. See reports/fault-*.json.'
