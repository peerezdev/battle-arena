#!/usr/bin/env bash
# Launch the full stack for ONE Solana network. Both networks run side by side on different ports,
# sharing the (network-agnostic) oracle on :8787. The mainnet stack spends REAL USDC.
#
#   ./scripts/run-net.sh devnet     → backend :9090  frontend http://localhost:5173
#   ./scripts/run-net.sh mainnet    → backend :9190  frontend http://localhost:5273
#
# Stop one network:  ./scripts/run-net.sh stop devnet   (or  stop mainnet )
# no `set -u`: macOS bash 3.2 errors on "${MODE[@]}" when the array is empty (devnet).
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGDIR="$ROOT/.run"; mkdir -p "$LOGDIR"

net_ports() {  # sets BPORT / FPORT for a network name
  case "$1" in
    devnet)  BPORT=9090; FPORT=5173 ;;
    mainnet) BPORT=9190; FPORT=5273 ;;
    *) echo "unknown network: $1 (use devnet|mainnet)"; exit 1 ;;
  esac
}

if [ "${1:-}" = "stop" ]; then
  net_ports "${2:-devnet}"
  lsof -ti :"$BPORT" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true
  lsof -ti :"$FPORT" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true
  echo "stopped ${2:-devnet} (backend :$BPORT, frontend :$FPORT). Oracle :8787 left running."
  exit 0
fi

NET="${1:-devnet}"; net_ports "$NET"
[ "$NET" = "mainnet" ] && MODE=(--mode mainnet) || MODE=()

# Shared oracle — start once (network-agnostic pricing/attestation).
if ! lsof -i :8787 -sTCP:LISTEN >/dev/null 2>&1; then
  ( cd "$ROOT/oracle" && PRICING_SOURCE=collectorcrypt nohup .venv/bin/uvicorn app.main:app --port 8787 >"$LOGDIR/oracle.log" 2>&1 & )
  echo "oracle       → :8787 (shared)"
fi

# Backend (per network): APP_NETWORK selects .env / .env.mainnet inside get_settings().
( cd "$ROOT/backend" && APP_NETWORK="$NET" PRICING_SOURCE=collectorcrypt \
    nohup .venv/bin/uvicorn app.main:app --port "$BPORT" >"$LOGDIR/backend-$NET.log" 2>&1 & )
echo "backend  $NET → :$BPORT   (DB: battlearena$([ "$NET" = mainnet ] && echo .mainnet).db)"

# Frontend (per network): BACKEND_PORT points Vite's proxy at the right backend; --mode loads .env.<mode>.
( cd "$ROOT" && BACKEND_PORT="$BPORT" \
    nohup npx vite "${MODE[@]}" --port "$FPORT" --host >"$LOGDIR/frontend-$NET.log" 2>&1 & )
echo "frontend $NET → http://localhost:$FPORT"
echo "logs: $LOGDIR/{backend,frontend}-$NET.log · oracle.log"
[ "$NET" = "mainnet" ] && echo "⚠️  MAINNET spends REAL USDC — fund the operator/fee address on mainnet before battles."
