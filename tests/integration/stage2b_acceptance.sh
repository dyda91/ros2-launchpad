#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
BASE="${BASE:-http://127.0.0.1:8080}"
COOKIE_A="${COOKIE_A:-/tmp/ros2-launchpad-stage2b-a.txt}"
COOKIE_B="${COOKIE_B:-/tmp/ros2-launchpad-stage2b-b.txt}"
COOKIE_C="${COOKIE_C:-/tmp/ros2-launchpad-stage2b-c.txt}"
IDLE="${SESSION_IDLE_SECONDS:-15}"
WARNING="${SESSION_WARNING_SECONDS:-5}"
rm -f "$COOKIE_A" "$COOKIE_B" "$COOKIE_C"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

json_field() {
  local field="$1"
  python3 -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1],""))' "$field"
}

wait_health() {
  local attempt
  for attempt in $(seq 1 60); do
    if curl -fsS "$BASE/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
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

start_session() {
  local cookie="$1"
  local code
  code="$(curl -sS -o /tmp/ros2-launchpad-stage2b-create.json -w '%{http_code}' \
    -b "$cookie" -c "$cookie" -X POST "$BASE/api/session")"
  if [ "$code" = "409" ]; then
    cat /tmp/ros2-launchpad-stage2b-create.json >&2
    return 1
  fi
  if [ "$code" != "202" ] && [ "$code" != "200" ]; then
    cat /tmp/ros2-launchpad-stage2b-create.json >&2
    return 1
  fi
  wait_state "$cookie" ready
}

touch_session() {
  curl -fsS -b "$1" -X POST "$BASE/api/session/touch" >/dev/null
}

stop_session() {
  curl -fsS -b "$1" -c "$1" -X DELETE "$BASE/api/session" >/dev/null
}

container_names() {
  docker ps -a --filter label=launchpad.role=session --format '{{.Names}}'
}

cleanup() {
  stop_session "$COOKIE_A" || true
  stop_session "$COOKIE_B" || true
  stop_session "$COOKIE_C" || true
}
trap cleanup EXIT

printf '=== ROS 2 Launchpad - aceite Etapa 2B ===\n'
wait_health || fail "API não respondeu em $BASE"
INITIAL="$(curl -fsS "$BASE/api/session")"
[[ "$(printf '%s' "$INITIAL" | json_field state)" == "idle" ]] || fail "estado inicial não está idle"
HEALTH="$(curl -fsS "$BASE/api/health")"
[[ "$(printf '%s' "$HEALTH" | json_field max)" == "2" ]] || fail "MAX_SESSIONS não é 2"

printf '\n[1/7] duas sessões simultâneas e isoladas\n'
START_A="$(start_session "$COOKIE_A")"
touch_session "$COOKIE_A"
START_B="$(start_session "$COOKIE_B")"
touch_session "$COOKIE_A"
TAG_A="$(printf '%s' "$START_A" | json_field session_tag)"
TAG_B="$(printf '%s' "$START_B" | json_field session_tag)"
[[ -n "$TAG_A" && -n "$TAG_B" && "$TAG_A" != "$TAG_B" ]] || fail "tags de sessão iguais"
HEALTH="$(curl -fsS "$BASE/api/health")"
[[ "$(printf '%s' "$HEALTH" | json_field active)" == "2" ]] || fail "contagem ativa não é 2"
NAMES="$(container_names)"
[[ "$(printf '%s\n' "$NAMES" | wc -l)" -eq 2 ]] || fail "containers de sessão não são únicos"
[[ "$(printf '%s\n' "$NAMES" | sort -u | wc -l)" -eq 2 ]] || fail "nomes de container duplicados"
SOCKETS="$(find run/sessions -mindepth 2 -maxdepth 2 -name agent.sock -type s | wc -l)"
[[ "$SOCKETS" -eq 2 ]] || fail "UDS por sessão não encontrado"

printf '\n[2/7] terceiro navegador recebe full\n'
CODE="$(curl -sS -o /tmp/ros2-launchpad-stage2b-full.json -w '%{http_code}' \
  -c "$COOKIE_C" -X POST "$BASE/api/session")"
[[ "$CODE" == "409" ]] || fail "terceira sessão não recebeu 409 (recebeu $CODE)"
STATE_C="$(curl -fsS -b "$COOKIE_C" "$BASE/api/session")"
[[ "$(printf '%s' "$STATE_C" | json_field state)" == "full" ]] || fail "terceiro estado não é full"

printf '\n[3/7] progresso isolado e validado\n'
PROGRESS_A='{"stepIndex":2,"selected":null,"quizDone":true,"quizWrong":false,"predictionSelected":1,"predictionDone":true,"predictionWrong":false,"hintsShown":1,"solutionVisible":false,"motionStart":{"x":0.0,"y":0.0,"yaw":0.0},"motionDone":false}'
CODE="$(curl -sS -o /dev/null -w '%{http_code}' -b "$COOKIE_A" \
  -X PUT -H 'Content-Type: application/json' \
  -d "{\"progress\":$PROGRESS_A}" "$BASE/api/session/progress")"
[[ "$CODE" == "204" ]] || fail "progresso A não foi aceito ($CODE)"
STATE_A="$(curl -fsS -b "$COOKIE_A" "$BASE/api/session")"
[[ "$(printf '%s' "$STATE_A" | python3 -c 'import json,sys; print(json.load(sys.stdin)["progress"]["stepIndex"])')" == "2" ]] || fail "progresso A não persistiu"
STATE_B="$(curl -fsS -b "$COOKIE_B" "$BASE/api/session")"
[[ "$(printf '%s' "$STATE_B" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("progress",{}).get("stepIndex",0))')" == "0" ]] || fail "progresso vazou para B"
CODE="$(curl -sS -o /dev/null -w '%{http_code}' -b "$COOKIE_A" \
  -X PUT -H 'Content-Type: application/json' \
  -d '{"progress":{"stepIndex":99}}' "$BASE/api/session/progress")"
[[ "$CODE" == "409" ]] || fail "progresso inválido não foi rejeitado ($CODE)"

printf '\n[4/7] aviso e expiração por inatividade\n'
WARNING_SEEN=0
for attempt in $(seq 1 $((IDLE + 15))); do
  touch_session "$COOKIE_A"
  BODY="$(curl -fsS -b "$COOKIE_B" "$BASE/api/session")"
  STATE_B="$(printf '%s' "$BODY" | json_field state)"
  if [ "$STATE_B" = "expired" ]; then
    break
  fi
  WARN="$(printf '%s' "$BODY" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("lifecycle",{}).get("warning",False))')"
  if [ "$WARN" = "True" ]; then
    WARNING_SEEN=1
  fi
  sleep 1
done
[[ "$(printf '%s' "$BODY" | json_field state)" == "expired" ]] || fail "sessão B não expirou por inatividade"
[[ "$WARNING_SEEN" -eq 1 ]] || fail "aviso de expiração não apareceu"
STATE_A="$(curl -fsS -b "$COOKIE_A" "$BASE/api/session")"
[[ "$(printf '%s' "$STATE_A" | json_field state)" == "ready" ]] || fail "sessão A não sobreviveu"
[[ "$(curl -fsS "$BASE/api/health" | json_field active)" == "1" ]] || fail "vaga de B não foi liberada"
REMOVED=0
for attempt in $(seq 1 20); do
  if [[ "$(container_names | wc -l)" -eq 1 ]]; then
    REMOVED=1
    break
  fi
  sleep 1
done
[[ "$REMOVED" -eq 1 ]] || fail "container de B não foi removido"

printf '\n[5/7] nova sessão após expiração\n'
START_C="$(start_session "$COOKIE_B")"
TAG_C="$(printf '%s' "$START_C" | json_field session_tag)"
[[ -n "$TAG_C" && "$TAG_C" != "$TAG_B" ]] || fail "sessão C reutilizou a tag expirada"
[[ "$(curl -fsS "$BASE/api/health" | json_field active)" == "2" ]] || fail "vaga não foi ocupada"
[[ "$(container_names | wc -l)" -eq 2 ]] || fail "container C não foi criado"

printf '\n[6/7] reinício mantém a vaga e zera o progresso\n'
touch_session "$COOKIE_A"
touch_session "$COOKIE_B"
CODE="$(curl -sS -o /tmp/ros2-launchpad-stage2b-restart.json -w '%{http_code}' \
  -b "$COOKIE_A" -X POST "$BASE/api/session/restart")"
[[ "$CODE" == "202" ]] || fail "restart não aceitou ($CODE)"
wait_state "$COOKIE_A" ready >/dev/null
touch_session "$COOKIE_B"
STATE_A="$(curl -fsS -b "$COOKIE_A" "$BASE/api/session")"
[[ "$(printf '%s' "$STATE_A" | json_field session_tag)" == "$TAG_A" ]] || fail "restart trocou a sessão"
[[ "$(printf '%s' "$STATE_A" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("progress",{}).get("stepIndex",0))')" == "0" ]] || fail "restart manteve o progresso"
[[ "$(container_names | wc -l)" -eq 2 ]] || fail "restart não preservou as duas vagas"

printf '\n[7/7] encerramento e limpeza\n'
stop_session "$COOKIE_A"
stop_session "$COOKIE_B"
REMOVED=0
for attempt in $(seq 1 20); do
  if [[ -z "$(container_names)" ]]; then
    REMOVED=1
    break
  fi
  sleep 1
done
if [[ "$REMOVED" -ne 1 ]]; then
  printf 'containers restantes:\n' >&2
  docker ps -a --filter label=launchpad.role=session --format '{{.Names}} {{.Status}} {{.Label "launchpad.session"}}' >&2
  fail "containers permaneceram após encerrar"
fi
if find run/sessions -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null | grep -q .; then
  fail "diretórios de sessão permaneceram"
fi
[[ "$(curl -fsS "$BASE/api/session" | json_field state)" == "idle" ]] || fail "estado final não é idle"

printf '\n=== ACEITE ETAPA 2B (integração): OK ===\n'
