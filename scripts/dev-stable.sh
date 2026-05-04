#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

STATE_DIR="$ROOT_DIR/.state"
BACKUP_DIR="$STATE_DIR/backups"
DB_PATH_DEFAULT="$STATE_DIR/crewden.db"

mkdir -p "$STATE_DIR" "$BACKUP_DIR"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

DB_PATH="${CREWDEN_DB_PATH:-$DB_PATH_DEFAULT}"
export CREWDEN_DB_PATH="$DB_PATH"

mkdir -p "$(dirname "$DB_PATH")"
if [ -f "$DB_PATH" ]; then
  ts="$(date +%Y%m%d-%H%M%S)"
  cp "$DB_PATH" "$BACKUP_DIR/crewden-${ts}.db"
  echo "[dev-stable] backup created: $BACKUP_DIR/crewden-${ts}.db"
else
  echo "[dev-stable] no existing db, skip backup"
fi

echo "[dev-stable] using CREWDEN_DB_PATH=$CREWDEN_DB_PATH"
exec pnpm dev
