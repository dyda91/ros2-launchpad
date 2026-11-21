#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
BASE="${BASE:-http://127.0.0.1:8080}"
COMPOSE=(docker compose -f compose.yaml -f compose.pilot.yaml)
COOKIE_A="${COOKIE_A:-/tmp/ros2-launchpad-pilot-a.txt}"
COOKIE_B="${COOKIE_B:-/tmp/ros2-launchpad-pilot-b.txt}"
COOKIE_C="${COOKIE_C:-/tmp/ros2-launchpad-pilot-c.txt}"
COOKIE_D="${COOKIE_D:-/tmp/ros2-launchpad-pilot-d.txt}"
rm -f "$COOKIE_A" "$COOKIE_B" "$COOKIE_C" "$COOKIE_D"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

json_field() {
  local field="$1"
  python3 -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1],""))' "$field"
}

wait_state() {
  local cookie="$1"
  local wanted="$2"
  local attempt body state
  for attempt in $(seq 1 90); do
    body="$(curl -fsS -b "$cookie" "$BASE/api/session")"
    state="$(printf '%s' "$body" | json_field state)"
    if [ "$state" = "$wanted" ]; then
      printf '%s\n' "$body"
      return 0
    fi
    if [ "$state" = "error" ]; then
      printf '%s\n' "$body" >&2
      return 1
    fi
    sleep 1
  done
  return 1
}

admin() {
  "${COMPOSE[@]}" exec -T api python -m app.pilot_admin "$@"
}

invite() {
  admin invite --label "$1" --ttl 600 |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["code"])'
}

redeem() {
  local code="$1"
  local cookie="$2"
  local status
  status="$(curl -sS -o /dev/null -w '%{http_code}' -c "$cookie" \
    -H 'Content-Type: application/json' \
    -d "{\"code\":\"$code\"}" "$BASE/api/pilot/redeem")"
  [[ "$status" == "204" ]] || fail "resgate retornou $status"
}

start() {
  local cookie="$1"
  local body
  curl -fsS -b "$cookie" -c "$cookie" -X POST "$BASE/api/session" \
    >/tmp/ros2-launchpad-pilot-create.json
  wait_state "$cookie" ready
}

stop() {
  curl -fsS -b "$1" -c "$1" -X DELETE "$BASE/api/session" >/dev/null
}

cleanup() {
  stop "$COOKIE_A" || true
  stop "$COOKIE_B" || true
  stop "$COOKIE_C" || true
  stop "$COOKIE_D" || true
  admin resume >/dev/null 2>&1 || true
}
trap cleanup EXIT

printf '=== ROS 2 Launchpad - aceite do piloto ===\n'
for attempt in $(seq 1 60); do
  curl -fsS "$BASE/api/health" >/dev/null 2>&1 && break
  sleep 1
done
STATUS="$(curl -fsS "$BASE/api/pilot/status")"
[[ "$(printf '%s' "$STATUS" | json_field state)" == "open" ]] || fail "piloto não está open"
NO_ACCESS="$(curl -fsS "$BASE/api/session")"
[[ "$(printf '%s' "$NO_ACCESS" | json_field state)" == "invite_required" ]] || fail "entrada sem convite não foi bloqueada"

INVITE_A="$(invite guest-a)"
INVITE_B="$(invite guest-b)"
INVITE_C="$(invite guest-c)"
INVITE_D="$(invite guest-d)"
INVALID_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d '{"code":"INVALID-CODE-0000"}' "$BASE/api/pilot/redeem")"
[[ "$INVALID_STATUS" == "403" ]] || fail "convite inválido retornou $INVALID_STATUS"

redeem "$INVITE_A" "$COOKIE_A"
READY_A="$(start "$COOKIE_A")"
TAG_A="$(printf '%s' "$READY_A" | json_field session_tag)"
redeem "$INVITE_B" "$COOKIE_B"
READY_B="$(start "$COOKIE_B")"
TAG_B="$(printf '%s' "$READY_B" | json_field session_tag)"
[[ -n "$TAG_A" && -n "$TAG_B" && "$TAG_A" != "$TAG_B" ]] || fail "tags de sessão inválidas"
[[ "$(curl -fsS "$BASE/api/health" | json_field active)" == "2" ]] || fail "duas sessões não estão ativas"

redeem "$INVITE_C" "$COOKIE_C"
FULL_STATUS="$(curl -sS -o /tmp/pilot-full.json -w '%{http_code}' -b "$COOKIE_C" -X POST "$BASE/api/session")"
[[ "$FULL_STATUS" == "409" ]] || fail "terceira sessão retornou $FULL_STATUS"
[[ "$(curl -fsS -b "$COOKIE_C" "$BASE/api/session" | json_field state)" == "full" ]] || fail "terceiro estado não é full"

PROGRESS='{"stepIndex":1,"selected":null,"quizDone":true,"quizWrong":false,"predictionSelected":null,"predictionDone":false,"predictionWrong":false,"hintsShown":0,"solutionVisible":false,"motionStart":null,"motionDone":false}'
curl -fsS -b "$COOKIE_A" -X PUT -H 'Content-Type: application/json' \
  -d "{\"progress\":$PROGRESS}" "$BASE/api/session/progress" >/dev/null
EVENTS="$(admin events)"
printf '%s\n' "$EVENTS" | grep -q 'step_entered' || fail "evento step_entered ausente"
printf '%s\n' "$EVENTS" | grep -q 'quiz_correct' || fail "evento quiz_correct ausente"
if printf '%s\n' "$EVENTS" | grep -qi 'terminal'; then
  fail "eventos contêm conteúdo de terminal"
fi

redeem "$INVITE_D" "$COOKIE_D"
admin pause >/dev/null
[[ "$(curl -fsS "$BASE/api/pilot/status" | json_field state)" == "paused" ]] || fail "pause não mudou o estado"
[[ "$(curl -fsS -b "$COOKIE_A" "$BASE/api/session" | json_field state)" == "ready" ]] || fail "sessão ativa caiu ao pausar"
PAUSED_STATUS="$(curl -sS -o /tmp/pilot-paused.json -w '%{http_code}' -b "$COOKIE_D" -X POST "$BASE/api/session")"
[[ "$PAUSED_STATUS" == "503" ]] || fail "nova sessão pausada retornou $PAUSED_STATUS"
admin resume >/dev/null
[[ "$(curl -fsS "$BASE/api/pilot/status" | json_field state)" == "open" ]] || fail "resume não reabriu"

admin close >/dev/null
[[ "$(curl -fsS "$BASE/api/pilot/status" | json_field state)" == "closed" ]] || fail "close não fechou"
CLOSED_STATUS="$(curl -sS -o /tmp/pilot-closed.json -w '%{http_code}' -b "$COOKIE_D" -X POST "$BASE/api/session")"
[[ "$CLOSED_STATUS" == "410" ]] || fail "nova sessão fechada retornou $CLOSED_STATUS"
[[ "$(curl -fsS -b "$COOKIE_A" "$BASE/api/session" | json_field state)" == "ready" ]] || fail "sessão ativa caiu no close"
admin resume >/dev/null

stop "$COOKIE_A"
stop "$COOKIE_B"
for attempt in $(seq 1 20); do
  if [[ -z "$(docker ps -aq --filter label=launchpad.role=session)" ]]; then
    break
  fi
  sleep 1
done
[[ -z "$(docker ps -aq --filter label=launchpad.role=session)" ]] || fail "containers permaneceram"
if find run/sessions -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null | grep -q .; then
  fail "diretórios de sessão permaneceram"
fi

printf '=== ACEITE DO PILOTO: OK ===\n'
