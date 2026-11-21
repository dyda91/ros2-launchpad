#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
BASE="${BASE:-http://127.0.0.1:8080}"
COOKIE="${COOKIE:-/tmp/ros2-launchpad-stage2a-cookies.txt}"
SESSION_NAME="${SESSION_NAME:-ros2-launchpad-session}"
rm -f "$COOKIE"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

json_state() {
  python3 -c 'import json,sys; print(json.load(sys.stdin).get("state",""))'
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
  local wanted="$1"
  local attempt body state
  for attempt in $(seq 1 60); do
    body="$(curl -fsS -b "$COOKIE" "$BASE/api/session")"
    state="$(printf '%s' "$body" | json_state)"
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
  curl -fsS -b "$COOKIE" -c "$COOKIE" -X POST "$BASE/api/session" |
    tee /tmp/ros2-launchpad-stage2a-create.json
  echo
  wait_state ready
}

stop_session() {
  curl -fsS -b "$COOKIE" -c "$COOKIE" -X DELETE "$BASE/api/session" >/dev/null
  wait_state idle >/dev/null
}

printf '=== ROS 2 Launchpad - aceite Etapa 2A ===\n'
wait_health || fail "API não respondeu em $BASE"
INITIAL="$(curl -fsS -b "$COOKIE" "$BASE/api/session")"
printf 'estado inicial: %s\n' "$INITIAL"
[[ "$(printf '%s' "$INITIAL" | json_state)" == "idle" ]] || fail "sessão inicial não está idle"

printf '\n[1/5] iniciando sessão\n'
start_session

printf '\n[2/5] mapa e tópicos ROS reais\n'
curl -fsS -b "$COOKIE" "$BASE/api/map" > /tmp/ros2-launchpad-stage2a-map.json
python3 - <<'PY'
import json
payload = json.load(open("/tmp/ros2-launchpad-stage2a-map.json", encoding="utf-8"))
assert payload["world"] == "armazem", payload
assert payload["zone"]["id"] == "coleta", payload
print("mapa ok:", payload["world"], payload["zone"]["id"])
PY
docker exec -u 1000 "$SESSION_NAME" bash -lc \
  'source /opt/ros/jazzy/setup.bash; source /ros_ws/install/setup.bash;
   ros2 topic list; ros2 topic type /cmd_vel; ros2 topic type /odom' \
  > /tmp/ros2-launchpad-stage2a-topics.txt
grep -qx '/cmd_vel' /tmp/ros2-launchpad-stage2a-topics.txt
grep -qx '/odom' /tmp/ros2-launchpad-stage2a-topics.txt
grep -q 'geometry_msgs/msg/Twist' /tmp/ros2-launchpad-stage2a-topics.txt
grep -q 'nav_msgs/msg/Odometry' /tmp/ros2-launchpad-stage2a-topics.txt

printf '\n[3/5] isolamento do container\n'
INSPECT="$(docker inspect "$SESSION_NAME" --format '{{.HostConfig.NetworkMode}} {{.HostConfig.Memory}} {{.HostConfig.NanoCpus}} {{.HostConfig.PidsLimit}}')"
printf 'inspect: %s\n' "$INSPECT"
[[ "$INSPECT" == "none 2147483648 2000000000 256" ]] || fail "limites ou rede inesperados"
docker exec -u 1000 "$SESSION_NAME" bash -lc 'test ! -e /var/run/docker.sock'
docker exec -u 1000 "$SESSION_NAME" bash -lc 'ip -brief addr' | tee /tmp/ros2-launchpad-stage2a-net.txt
if grep -qE '^[^l]' /tmp/ros2-launchpad-stage2a-net.txt; then
  fail "interface de rede inesperada"
fi

printf '\n[4/5] encerrando e liberando\n'
stop_session
if docker ps -a --filter "name=$SESSION_NAME" --format '{{.Names}}' | grep -q .; then
  fail "container da sessão não foi removido"
fi
if find run/sessions -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null | grep -q .; then
  fail "diretório da sessão não foi removido"
fi

printf '\n[5/5] nova sessão começa limpa\n'
start_session
curl -fsS -b "$COOKIE" "$BASE/api/map" >/dev/null
stop_session
FULL="$(curl -fsS "$BASE/api/session")"
printf 'estado sem cookie: %s\n' "$FULL"
[[ "$(printf '%s' "$FULL" | json_state)" == "idle" ]] || fail "estado final não está idle"

printf '\n=== ACEITE ETAPA 2A (integração): OK ===\n'
