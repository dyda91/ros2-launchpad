#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
COMPOSE=(docker compose -f compose.yaml -f compose.pilot.yaml)
GRACE="${PILOT_CLOSE_GRACE:-60}"
PROJECT="${SESSION_PROJECT:-launchpad}"

if [[ "${1:-}" == "close" ]]; then
  "${COMPOSE[@]}" exec -T api python -m app.pilot_admin close
  if [[ "${2:-}" == "--now" ]]; then
    GRACE=0
  fi
  if [[ "$GRACE" -gt 0 ]]; then
    printf 'aguardando %s s antes de remover as sessões\n' "$GRACE"
    sleep "$GRACE"
  fi
  ids="$(docker ps -aq --filter label=launchpad.role=session \
    --filter label=launchpad.project=$PROJECT)"
  if [[ -n "$ids" ]]; then
    docker rm -f $ids >/dev/null
  fi
  rm -rf run/sessions/*
  "${COMPOSE[@]}" down --remove-orphans
  printf 'piloto encerrado\n'
  exit 0
fi

"${COMPOSE[@]}" exec -T api python -m app.pilot_admin "$@"
