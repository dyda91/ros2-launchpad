#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${PILOT_DOMAIN:-}"
if [[ -z "$DOMAIN" ]]; then
  printf 'defina PILOT_DOMAIN\n' >&2
  exit 1
fi

base="https://$DOMAIN"
client="$(mktemp)"
cert="$(mktemp)"
trap 'rm -f "$client" "$cert"' EXIT

printf 'health: '
curl -fsS "$base/api/health" >/dev/null
printf 'OK\n'

printf 'DNS A: '
getent ahostsv4 "$DOMAIN" >/dev/null || {
  printf 'FAIL\n' >&2
  exit 1
}
printf 'OK\n'

printf 'DNS AAAA (opcional): '
if getent ahostsv6 "$DOMAIN" >/dev/null 2>&1; then
  printf 'OK\n'
else
  printf 'ausente\n'
fi

printf 'redirect HTTP: '
code="$(curl -sS -o /dev/null -w '%{http_code}' "http://$DOMAIN/")"
[[ "$code" == "301" || "$code" == "308" ]] || {
  printf 'inesperado (%s)\n' "$code" >&2
  exit 1
}
printf 'OK\n'

printf 'TLS/hostname: '
if ! openssl s_client -showcerts -connect "$DOMAIN:443" \
    -servername "$DOMAIN" -verify_hostname "$DOMAIN" \
    -verify_return_error </dev/null >"$client" 2>/dev/null; then
  printf 'FAIL\n' >&2
  exit 1
fi
if ! openssl x509 -in "$client" -outform PEM >"$cert" 2>/dev/null; then
  printf 'FAIL (certificado ausente)\n' >&2
  exit 1
fi
openssl x509 -in "$cert" -noout -checkhost "$DOMAIN"
openssl x509 -in "$cert" -noout -checkend 0 >/dev/null || {
  printf 'FAIL (certificado expirado)\n' >&2
  exit 1
}
printf 'OK\n'

printf 'subject: '
openssl x509 -in "$cert" -noout -subject | sed 's/^subject=//'
printf 'issuer: '
openssl x509 -in "$cert" -noout -issuer | sed 's/^issuer=//'
printf 'validity: '
openssl x509 -in "$cert" -noout -dates | tr '\n' ' '
printf '\nSAN: '
openssl x509 -in "$cert" -noout -ext subjectAltName 2>/dev/null |
  tail -n +2 | tr '\n' ' '
printf '\n'

printf 'HSTS: '
curl -fsSI "$base/" | grep -qi '^strict-transport-security:'
printf 'OK\n'

printf 'WebSocket: use o teste host-pilot no navegador externo\n'
