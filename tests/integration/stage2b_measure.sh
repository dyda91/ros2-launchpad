#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
BASE="${BASE:-http://127.0.0.1:8080}"
COOKIE_A="${COOKIE_A:-/tmp/ros2-launchpad-measure-a.txt}"
COOKIE_B="${COOKIE_B:-/tmp/ros2-launchpad-measure-b.txt}"
rm -f "$COOKIE_A" "$COOKIE_B"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

json_field() {
  local field="$1"
  python3 -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1],""))' "$field"
}

wait_ready() {
  local cookie="$1"
  local attempt state
  for attempt in $(seq 1 90); do
    state="$(curl -fsS -b "$cookie" "$BASE/api/session" | json_field state)"
    if [ "$state" = "ready" ]; then
      return 0
    fi
    if [ "$state" = "error" ]; then
      return 1
    fi
    sleep 1
  done
  return 1
}

start() {
  local cookie="$1"
  curl -fsS -b "$cookie" -c "$cookie" -X POST "$BASE/api/session" \
    >/dev/null
  wait_ready "$cookie"
}

cleanup() {
  curl -fsS -b "$COOKIE_A" -c "$COOKIE_A" -X DELETE "$BASE/api/session" \
    >/dev/null 2>&1 || true
  curl -fsS -b "$COOKIE_B" -c "$COOKIE_B" -X DELETE "$BASE/api/session" \
    >/dev/null 2>&1 || true
}
trap cleanup EXIT

for attempt in $(seq 1 60); do
  if curl -fsS "$BASE/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

START_A="$(date +%s%N)"
start "$COOKIE_A"
END_A="$(date +%s%N)"
START_B="$(date +%s%N)"
start "$COOKIE_B"
END_B="$(date +%s%N)"

HEALTH="$(curl -fsS "$BASE/api/health")"
ACTIVE="$(printf '%s' "$HEALTH" | json_field active)"
MAX="$(printf '%s' "$HEALTH" | json_field max)"
MEMORY="$(docker stats --no-stream --format '{{.Name}} {{.MemUsage}} {{.CPUPerc}}' \
  $(docker ps -q --filter label=launchpad.role=session) | tr '\n' ';')"

printf 'sessao_a_ms=%s\n' "$(( (END_A - START_A) / 1000000 ))"
printf 'sessao_b_ms=%s\n' "$(( (END_B - START_B) / 1000000 ))"
printf 'ativas=%s\n' "$ACTIVE"
printf 'max=%s\n' "$MAX"
printf 'containers=%s\n' "$(docker ps -q --filter label=launchpad.role=session | wc -l)"
printf 'memoria_cpu=%s\n' "$MEMORY"
[[ "$ACTIVE" == "2" ]] || fail "duas sessões não ficaram ativas"
[[ "$MAX" == "2" ]] || fail "MAX_SESSIONS não é 2"

printf '=== MEDIÇÃO 2B: OK ===\n'
