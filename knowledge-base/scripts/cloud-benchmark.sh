#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p reports
container=$(docker compose ps -q embedding)
if [[ -z "$container" ]]; then echo 'embedding is not running' >&2; exit 1; fi
sample() {
  while true; do
    docker stats --no-stream --format '{{json .}}' "$container"
    sleep 2
  done
}
sample > reports/embedding-memory-samples.jsonl &
sampler=$!
trap 'kill "$sampler" 2>/dev/null || true; wait "$sampler" 2>/dev/null || true' EXIT
docker compose run --rm -T --no-deps --entrypoint node client dist/benchmark.js
docker compose exec -T embedding sh -c 'cat /sys/fs/cgroup/memory.peak 2>/dev/null || echo "cgroup v2 memory.peak unavailable; inspect sampled docker stats"' > reports/embedding-memory-peak.txt
echo 'Results: reports/benchmark.json, embedding-memory-samples.jsonl, embedding-memory-peak.txt'
