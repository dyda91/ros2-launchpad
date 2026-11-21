#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${PILOT_DOMAIN:-}"
if [[ -z "$DOMAIN" ]]; then
  printf 'defina PILOT_DOMAIN\n' >&2
  exit 1
fi

base="https://$DOMAIN"
printf 'health: '
curl -fsS "$base/api/health" >/dev/null
printf 'OK\n'
printf 'redirect HTTP: '
code="$(curl -sS -o /dev/null -w '%{http_code}' "http://$DOMAIN/")"
[[ "$code" == "301" || "$code" == "308" ]] || {
  printf 'inesperado (%s)\n' "$code" >&2
  exit 1
}
printf 'OK\n'
printf 'TLS: '
echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" \
  -verify_return_error >/dev/null 2>&1
printf 'OK\n'
printf 'HSTS: '
curl -fsSI "$base/" | grep -qi '^strict-transport-security:'
printf 'OK\n'
printf 'WebSocket: use tests/e2e/pilot.spec.ts ou o navegador\n'
