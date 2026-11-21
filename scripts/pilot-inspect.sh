#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
PROJECT="${SESSION_PROJECT:-launchpad}"
fail=0
ok() { printf 'OK   %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1" >&2; fail=1; }

if docker info --format '{{json .SecurityOptions}}' 2>/dev/null | grep -q rootless; then
  ok "daemon rootless"
else
  bad "daemon não declara rootless"
fi

CONTAINERS="$(docker ps -q --filter label=launchpad.role=session \
  --filter label=launchpad.project=$PROJECT)"
COUNT="$(printf '%s\n' "$CONTAINERS" | sed '/^$/d' | wc -l)"
printf 'sessões ativas em %s: %s\n' "$PROJECT" "$COUNT"
[[ "$COUNT" -ge 1 ]] || bad "nenhuma sessão ativa para inspecionar"

for cid in $CONTAINERS; do
  NAME="$(docker inspect "$cid" --format '{{.Name}}')"
  printf '\n[%s]\n' "${NAME#/}"
  docker inspect "$cid" | python3 -c '
import json, sys
item = json.load(sys.stdin)[0]
host = item["HostConfig"]
config = item["Config"]
print("ReadonlyRootfs:", host.get("ReadonlyRootfs"))
print("NetworkMode:", host.get("NetworkMode"))
print("Privileged:", host.get("Privileged"))
print("CapDrop:", host.get("CapDrop"))
print("SecurityOpt:", host.get("SecurityOpt"))
print("AppArmorProfile:", item.get("AppArmorProfile"))
print("UsernsMode:", host.get("UsernsMode"))
print("Memory:", host.get("Memory"))
print("NanoCpus:", host.get("NanoCpus"))
print("PidsLimit:", host.get("PidsLimit"))
print("Tmpfs:", host.get("Tmpfs"))
print("Ulimits:", host.get("Ulimits"))
print("User:", config.get("User"))
print("Binds:", host.get("Binds"))
'
  RO="$(docker inspect "$cid" --format '{{.HostConfig.ReadonlyRootfs}}')"
  NET="$(docker inspect "$cid" --format '{{.HostConfig.NetworkMode}}')"
  AA="$(docker inspect "$cid" --format '{{.AppArmorProfile}}')"
  PRIV="$(docker inspect "$cid" --format '{{.HostConfig.Privileged}}')"
  CAPS="$(docker inspect "$cid" --format '{{json .HostConfig.CapDrop}}')"
  MEM="$(docker inspect "$cid" --format '{{.HostConfig.Memory}}')"
  CPUS="$(docker inspect "$cid" --format '{{.HostConfig.NanoCpus}}')"
  PIDS="$(docker inspect "$cid" --format '{{.HostConfig.PidsLimit}}')"
  USER="$(docker inspect "$cid" --format '{{.Config.User}}')"
  BINDS="$(docker inspect "$cid" --format '{{json .HostConfig.Binds}}')"
  [[ "$RO" == "true" ]] && ok "rootfs read-only" || bad "rootfs gravável"
  [[ "$NET" == "none" ]] && ok "network none" || bad "network=$NET"
  [[ "$PRIV" == "false" ]] && ok "não privilegiado" || bad "privileged=true"
  [[ "$CAPS" == *"ALL"* ]] && ok "cap_drop ALL" || bad "cap_drop inesperado: $CAPS"
  [[ -n "$AA" && "$AA" != "unconfined" ]] && ok "AppArmor=$AA" || bad "AppArmor ausente/unconfined"
  [[ "$MEM" == "2147483648" ]] && ok "memória 2 GiB" || bad "memória=$MEM"
  [[ "$CPUS" == "2000000000" ]] && ok "2 CPUs" || bad "NanoCpus=$CPUS"
  [[ "$PIDS" == "256" ]] && ok "256 PIDs" || bad "PidsLimit=$PIDS"
  [[ "$USER" == "1000:1000" ]] && ok "usuário 1000:1000" || bad "user=$USER"
  if printf '%s' "$BINDS" | grep -q 'docker.sock'; then
    bad "socket Docker montado"
  elif printf '%s' "$BINDS" | grep -qE '/tests|/content|ros2-launchpad-launchpad'; then
    bad "bind de host proibido: $BINDS"
  elif printf '%s' "$BINDS" | grep -q '/run/agent'; then
    ok "somente bind esperado da UDS"
  else
    bad "bind inesperado: $BINDS"
  fi

  docker exec -u 1000 "$cid" sh -lc '
    set -e
    id
    grep -E "^(CapEff|Seccomp):" /proc/self/status
    ip -brief addr
    test ! -e /var/run/docker.sock && echo no-docker-socket
    if ip -brief addr | grep -v "^lo "; then
      exit 22
    fi
    getent hosts example.com >/dev/null 2>&1 && exit 21 || true
  ' 2>/dev/null | sed "s/^/  /" || bad "probe dentro do container falhou"
  CAPEFF="$(docker exec -u 1000 "$cid" sh -lc "grep '^CapEff:' /proc/self/status" 2>/dev/null || true)"
  [[ "$CAPEFF" == *"0000000000000000"* ]] && ok "capabilities efetivas zero" || bad "capabilities efetivas não zeradas"
  SECCOMP="$(docker exec -u 1000 "$cid" sh -lc "grep '^Seccomp:' /proc/self/status" 2>/dev/null || true)"
  [[ "$SECCOMP" == *"2"* ]] && ok "seccomp ativo" || bad "seccomp=$SECCOMP"
done

exit "$fail"
