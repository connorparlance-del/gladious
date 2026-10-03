#!/usr/bin/env bash
# Ejecuta todas las pruebas automáticas (sólo desarrollo).
# Requisitos: Python 3 + Playwright (pip install playwright && playwright install chromium) y Node >= 16.
set -e
cd "$(dirname "$0")/.."
OUT="${1:-/tmp/gladiadores-shots}"; mkdir -p "$OUT"
python3 -m http.server 8123 >/dev/null 2>&1 & WEB=$!
node network/signaling-server.js 9000 >/dev/null 2>&1 & SIG=$!
trap 'kill $WEB $SIG 2>/dev/null' EXIT
sleep 1
for t in gameplay weapons survival_long multiplayer_duel multiplayer_coop multiplayer_3p; do
  echo "=== $t ==="
  python3 -u tests/$t.py "$OUT" | grep -E "PASS|FAIL|pruebas OK"
done
