#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
BASE="${BASE:-http://127.0.0.1:18080}"
CONTAINER="${STAGING_CONTAINER:-ros2-launchpad-staging-api}"
COOKIE="$(mktemp)"
trap 'rm -f "$COOKIE"' EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

json_field() {
  local field="$1"
  python3 -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1],""))' "$field"
}

CODE="$(docker exec "$CONTAINER" python -m app.pilot_admin invite \
  --label staging-expiry --ttl 300 |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["code"])')"
[[ -n "$CODE" ]] || fail "convite de staging não foi criado"

STATUS="$(curl -sS -o /dev/null -w '%{http_code}' -c "$COOKIE" \
  -H 'Content-Type: application/json' \
  -d "{\"code\":\"$CODE\"}" "$BASE/api/pilot/redeem")"
[[ "$STATUS" == "204" ]] || fail "resgate de staging retornou $STATUS"

curl -fsS -b "$COOKIE" -c "$COOKIE" -X POST "$BASE/api/session" >/dev/null
for attempt in $(seq 1 60); do
  STATE="$(curl -fsS -b "$COOKIE" "$BASE/api/session" | json_field state)"
  [[ "$STATE" == "ready" ]] && break
  [[ "$STATE" == "error" ]] && fail "sessão de staging entrou em erro"
  sleep 1
done
[[ "$STATE" == "ready" ]] || fail "sessão de staging não ficou ready"

printf 'aguardando expiração curta do staging\n'
for attempt in $(seq 1 90); do
  STATE="$(curl -fsS -b "$COOKIE" "$BASE/api/session" | json_field state)"
  [[ "$STATE" == "expired" ]] && break
  sleep 1
done
[[ "$STATE" == "expired" ]] || fail "sessão de staging não expirou"

[[ "$(curl -fsS "$BASE/api/health" | json_field active)" == "0" ]] \
  || fail "vaga de staging não foi liberada"
for attempt in $(seq 1 20); do
  COUNT="$(docker ps -aq --filter label=launchpad.role=session \
    --filter label=launchpad.project=staging | wc -l)"
  [[ "$COUNT" -eq 0 ]] && break
  sleep 1
done
[[ "$COUNT" -eq 0 ]] || fail "container de staging permaneceu"

printf '=== STAGING EXPIRAÇÃO: OK ===\n'
