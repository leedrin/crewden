#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
SERVER_URL="${SERVER_URL:-http://localhost:3000}"
LOG_DIR="$ROOT/.logs"

mkdir -p "$LOG_DIR"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pids=()

cleanup() {
  echo ""
  echo "Stopping all processes..."
  for pid in "${pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null
  echo "Done."
  exit 0
}
trap cleanup INT TERM

log() { echo -e "${CYAN}[start]${NC} $*"; }

log "Starting server..."
pnpm --filter @crewden/server dev > "$LOG_DIR/server.log" 2>&1 &
pids+=($!)

log "Starting web UI..."
pnpm --filter @crewden/web dev > "$LOG_DIR/web.log" 2>&1 &
pids+=($!)

# Wait for server to be ready
log "Waiting for server on $SERVER_URL ..."
for i in $(seq 1 30); do
  if curl -sf "$SERVER_URL/api/channels" > /dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

echo ""
echo -e "${GREEN}All services started.${NC}"
echo -e "  ${YELLOW}Server:${NC}  $SERVER_URL"
echo -e "  ${YELLOW}Web UI:${NC}  http://localhost:5173"
echo -e "  ${YELLOW}Paseo:${NC}   set PASEO_DAEMON_URL for runtime connectivity"
echo -e "  ${YELLOW}Logs:${NC}    $LOG_DIR/"
echo ""
echo "Press Ctrl+C to stop all."

wait
