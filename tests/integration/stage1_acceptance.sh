#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
RESULTS_DIR="${RESULTS_DIR:-/tmp/ros2-launchpad-stage1}"
mkdir -p "$RESULTS_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="$RESULTS_DIR/stage1-$STAMP.log"
exec > >(tee -a "$LOG") 2>&1

lab() {
  docker compose exec -T lab bash -lc "$1"
}

start_launch() {
  docker compose exec -d lab bash -lc \
    'source /opt/ros/jazzy/setup.bash; source /ros_ws/install/setup.bash; ros2 launch launchpad_bringup lab.launch.py > /tmp/lab_launch.log 2>&1'
}

wait_for_odom() {
  local attempts="${1:-120}"
  local index
  for index in $(seq 1 "$attempts"); do
    if lab 'timeout 2 ros2 topic echo /odom --once >/dev/null 2>&1' >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

restart_lab() {
  docker compose restart lab >/dev/null
}

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

check_pose_zero() {
  python3 - "$1" <<'PY'
import json
import math
import sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
pose = payload["initial"]
assert abs(pose["x"]) < 0.02, pose
assert abs(pose["y"]) < 0.02, pose
assert abs(pose["yaw"]) < 0.02, pose
assert abs(pose["vx"]) < 0.02, pose
assert abs(pose["wz"]) < 0.05, pose
print("pose zero ok")
PY
}

check_cli_movement() {
  python3 - "$1" "$2" <<'PY'
import json
import math
import sys
before = json.load(open(sys.argv[1], encoding="utf-8"))["initial"]
after = json.load(open(sys.argv[2], encoding="utf-8"))["initial"]
distance = math.hypot(after["x"] - before["x"], after["y"] - before["y"])
assert distance > 0.15, distance
assert abs(after["vx"]) < 0.02, after
assert abs(after["wz"]) < 0.05, after
print(f"cli movement ok: {distance:.3f} m, final vx={after['vx']:.6f}")
PY
}

printf '=== ROS 2 Launchpad - aceite Etapa 1 ===\n'
printf 'log: %s\n' "$LOG"

docker compose up -d --force-recreate lab >/dev/null

printf '\n[1/8] reiniciando o laboratório\n'
restart_lab

printf '\n[2/8] iniciando simulador headless e medindo startup\n'
START="$(date +%s.%N)"
start_launch
wait_for_odom 120 || fail "odom não apareceu em 60 s"
END="$(date +%s.%N)"
STARTUP="$(awk "BEGIN {printf \"%.2f\", $END - $START}")"
printf 'startup_seconds=%s\n' "$STARTUP"
lab 'grep -E "\[ERROR|Traceback|Exception" /tmp/lab_launch.log || true'

printf '\n[3/8] tópicos, tipos e interfaces\n'
lab 'ros2 topic list'
CMD_TYPE="$(lab 'ros2 topic type /cmd_vel')"
ODOM_TYPE="$(lab 'ros2 topic type /odom')"
[[ "$CMD_TYPE" == "geometry_msgs/msg/Twist" ]] || fail "tipo de /cmd_vel: $CMD_TYPE"
[[ "$ODOM_TYPE" == "nav_msgs/msg/Odometry" ]] || fail "tipo de /odom: $ODOM_TYPE"
printf 'cmd_vel=%s\nodom=%s\n' "$CMD_TYPE" "$ODOM_TYPE"
lab 'ros2 interface show geometry_msgs/msg/Twist'
lab 'ros2 interface show nav_msgs/msg/Odometry'

printf '\n[4/8] pose inicial e robô único\n'
lab 'python3 /tests/integration/odom_probe.py --mode sample' > "$RESULTS_DIR/initial-1.json"
cat "$RESULTS_DIR/initial-1.json"
check_pose_zero "$RESULTS_DIR/initial-1.json"
ROBOTS="$(lab 'gz topic -l 2>/dev/null | grep "^/model/" | cut -d/ -f3 | sort -u')"
printf 'robots=%s\n' "$ROBOTS"
[[ "$ROBOTS" == "launchpad_robot" ]] || fail "esperava um único launchpad_robot"

printf '\n[5/8] movimento e parada pelo watchdog\n'
lab 'python3 /tests/integration/odom_probe.py --mode move --speed 0.2 --duration 2.0' \
  | tee "$RESULTS_DIR/move.json"
python3 - "$RESULTS_DIR/move.json" <<'PY'
import json
import sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["ok"], payload
assert payload["stop_latency_s"] is not None
print(f"parada observada em {payload['stop_latency_s']:.3f} s")
PY

printf '\n[6/8] comando CLI de duração limitada\n'
lab 'python3 /tests/integration/odom_probe.py --mode sample' > "$RESULTS_DIR/before-cli.json"
lab 'timeout 3 ros2 topic pub --rate 10 /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.2}}" >/tmp/cli_pub.log 2>&1 || true'
sleep 1.0
lab 'python3 /tests/integration/odom_probe.py --mode sample' > "$RESULTS_DIR/after-cli.json"
check_cli_movement "$RESULTS_DIR/before-cli.json" "$RESULTS_DIR/after-cli.json"

printf '\n[7/8] rota real até a zona e validação da missão\n'
restart_lab
start_launch
wait_for_odom 120 || fail "odom não apareceu após reinício"
lab 'python3 /tests/integration/route_probe.py' | tee "$RESULTS_DIR/route.json"
python3 - "$RESULTS_DIR/route.json" <<'PY'
import json
import sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["ok"], payload
assert payload["mission"]["delivered"], payload
assert payload["mission"]["in_zone"], payload
print("entrega validada por pose e velocidade reais")
PY

printf '\n[8/8] recursos e reinício limpo\n'
docker stats --no-stream --format '{{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}} ({{.MemPerc}})' ros2-launchpad-lab
docker inspect ros2-launchpad-lab --format 'Memory={{.HostConfig.Memory}} NanoCpus={{.HostConfig.NanoCpus}} PidsLimit={{.HostConfig.PidsLimit}} NetworkMode={{.HostConfig.NetworkMode}}'
restart_lab
start_launch
wait_for_odom 120 || fail "odom não apareceu após o segundo reinício"
lab 'python3 /tests/integration/odom_probe.py --mode sample' > "$RESULTS_DIR/initial-2.json"
cat "$RESULTS_DIR/initial-2.json"
check_pose_zero "$RESULTS_DIR/initial-2.json"
SECOND_ROBOTS="$(lab 'gz topic -l 2>/dev/null | grep "^/model/" | cut -d/ -f3 | sort -u')"
printf 'robots_after_restart=%s\n' "$SECOND_ROBOTS"
[[ "$SECOND_ROBOTS" == "launchpad_robot" ]] || fail "robô duplicado após reinício"

printf '\n=== ACEITE ETAPA 1: OK ===\n'
printf 'startup_seconds=%s\n' "$STARTUP"
printf 'resultados: %s\n' "$RESULTS_DIR"
