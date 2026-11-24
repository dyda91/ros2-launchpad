#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
SESSIONS="${1:-2}"
DURATION="${2:-60}"
PROFILE="${3:-idle}"
THINK="${THINK:-10}"
OUT_DIR="${OUT_DIR:-/tmp/launchpad-load}"
mkdir -p "$OUT_DIR"
TAG="${TAG:-run}-${PROFILE}-${SESSIONS}"
STATS="$OUT_DIR/$TAG.stats.csv"
RESULT="$OUT_DIR/$TAG.json"
: > "$STATS"

for attempt in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:8080/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

(
  while true; do
    docker stats --no-stream --format \
      '{{.Name}},{{.CPUPerc}},{{.MemUsage}}' 2>/dev/null |
      grep '^ros2-launchpad-' |
      sed "s/^/$(date +%s),/" >> "$STATS" || true
    sleep 3
  done
) &
SAMPLER=$!
trap 'kill $SAMPLER 2>/dev/null || true' EXIT

START="$(date +%s)"
docker run --rm --network host --user "$(id -u):$(id -g)" \
  -v "$ROOT/tests:/tests:ro" -v "$OUT_DIR:/out" \
  --entrypoint python ros2-launchpad-api:dev \
  /tests/integration/load_sessions.py \
  --sessions "$SESSIONS" --duration "$DURATION" --profile "$PROFILE" \
  --think "$THINK" --out "/out/$TAG.json" > "$OUT_DIR/$TAG.log" 2>&1 || true
END="$(date +%s)"
kill $SAMPLER 2>/dev/null || true

python3 - "$STATS" "$RESULT" "$SESSIONS" <<'PY'
import collections
import json
import re
import sys

stats_path, result_path, sessions = sys.argv[1], sys.argv[2], int(sys.argv[3])
rows = collections.defaultdict(list)
for line in open(stats_path, encoding="utf-8"):
    parts = line.strip().split(",", 3)
    if len(parts) != 4:
        continue
    stamp, name, cpu, mem = parts
    used = re.match(r"([\d.]+)(MiB|GiB|KiB)", mem)
    if not used:
        continue
    value = float(used.group(1)) * {"KiB": 1 / 1024, "MiB": 1, "GiB": 1024}[used.group(2)]
    rows[int(stamp)].append((name, float(cpu.rstrip("%")), value))
stamps = sorted(rows)
steady = stamps[len(stamps) // 2 :]
session_cpu, session_mem, api_cpu, runtime_cpu, count = [], [], [], [], []
for stamp in steady:
    sess = [r for r in rows[stamp] if "-session-" in r[0]]
    count.append(len(sess))
    session_cpu.append(sum(r[1] for r in sess))
    session_mem.append(sum(r[2] for r in sess))
    api_cpu.append(sum(r[1] for r in rows[stamp] if r[0].endswith("-api")))
    runtime_cpu.append(sum(r[1] for r in rows[stamp] if r[0].endswith("-runtime")))
def mean(values):
    return round(sum(values) / len(values), 1) if values else None
result = json.load(open(result_path, encoding="utf-8")) if __import__("os").path.exists(result_path) else {}
docker = {
    "sessions_seen": max(count) if count else 0,
    "sessions_cpu_percent_total_mean": mean(session_cpu),
    "sessions_cpu_percent_per_session": mean([c / n for c, n in zip(session_cpu, count) if n]),
    "sessions_mem_mib_total_mean": mean(session_mem),
    "sessions_mem_mib_per_session": mean([m / n for m, n in zip(session_mem, count) if n]),
    "api_cpu_percent_mean": mean(api_cpu),
    "runtime_cpu_percent_mean": mean(runtime_cpu),
}
result["docker"] = docker
json.dump(result, open(result_path, "w", encoding="utf-8"), indent=2)
print(json.dumps(result, indent=2))
PY
