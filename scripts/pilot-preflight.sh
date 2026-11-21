#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
fail=0

ok() { printf 'OK   %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1" >&2; fail=1; }

[[ "$(uname -s)" == "Linux" ]] && ok "Linux" || bad "sistema não Linux"
if [[ -r /etc/os-release ]]; then
  . /etc/os-release
  [[ "${ID:-}" == "ubuntu" && "${VERSION_ID:-}" == "24.04" ]] \
    && ok "Ubuntu 24.04" || bad "recomendado Ubuntu 24.04"
fi
cpus="$(nproc)"
mem_kb="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
mem_gib="$((mem_kb / 1024 / 1024))"
[[ "$cpus" -ge 4 ]] && ok "CPUs: $cpus" || bad "menos de 4 CPUs"
[[ "$mem_gib" -ge 8 ]] && ok "RAM: ${mem_gib} GiB" || bad "menos de 8 GiB"
[[ "$(stat -f -c '%T' /)" == "ext4" || "$(stat -f -c '%T' /)" == "xfs" ]] \
  && ok "filesystem" || true

if docker info >/dev/null 2>&1; then
  ok "Docker responde"
else
  bad "Docker não responde"
fi
if docker info --format '{{json .SecurityOptions}}' 2>/dev/null | grep -q rootless; then
  ok "Docker rootless"
else
  bad "Docker não está em rootless (ou userns-remap não confirmado)"
fi
if command -v aa-status >/dev/null 2>&1; then
  aa-status >/dev/null 2>&1 && ok "AppArmor carregado" || bad "AppArmor indisponível"
else
  bad "aa-status não encontrado"
fi
if command -v caddy >/dev/null 2>&1; then
  ok "Caddy $(caddy version 2>/dev/null | head -n 1)"
  if systemctl is-active --quiet caddy 2>/dev/null; then
    ok "serviço caddy ativo"
  else
    printf 'AVISO caddy ainda não está ativo; valide o Caddyfile antes de iniciar\n'
  fi
else
  bad "Caddy não encontrado"
fi
if grep -q '^CONFIG_SECCOMP=y' "/boot/config-$(uname -r)" 2>/dev/null; then
  ok "seccomp no kernel"
else
  printf 'AVISO não foi possível confirmar CONFIG_SECCOMP\n'
fi
if [[ -n "${PILOT_DOMAIN:-}" ]]; then
  ok "PILOT_DOMAIN=$PILOT_DOMAIN"
  if getent ahostsv4 "$PILOT_DOMAIN" >/dev/null 2>&1; then
    ok "DNS A resolve $PILOT_DOMAIN"
  else
    bad "DNS A não resolve $PILOT_DOMAIN"
  fi
  if getent ahostsv6 "$PILOT_DOMAIN" >/dev/null 2>&1; then
    ok "DNS AAAA resolve $PILOT_DOMAIN (opcional)"
  else
    printf 'AVISO sem AAAA para %s; IPv6 não será validado\n' "$PILOT_DOMAIN"
  fi
else
  bad "PILOT_DOMAIN não definido"
fi
if ss -ltn | grep -qE ':(80|443) '; then
  ok "portas 80/443 em escuta"
else
  bad "portas 80/443 não estão em escuta"
fi
if ss -ltn | grep -qE ':8080 .*0\.0\.0\.0'; then
  bad "API publicada fora do loopback"
else
  ok "API não exposta em 0.0.0.0:8080"
fi
exit "$fail"
