#!/usr/bin/env bash
# Restore a WeBox backup into a TARGET database. Usage: restore.sh <backup.sql[.gz]> <target_db>
# Safety: refuses to restore into the demo DB unless ALLOW_DEMO_RESTORE=1. Never drops anything by default.
set -euo pipefail
HOST="${MYSQL_HOST:-127.0.0.1}"; PORT="${MYSQL_PORT:-3306}"
USER="${MYSQL_USER:-test}"; PASS="${MYSQL_PASSWORD:-test123456}"
SRC="${1:?usage: restore.sh <backup.sql[.gz]> <target_db>}"
TARGET="${2:?usage: restore.sh <backup.sql[.gz]> <target_db>}"
DEMO_DB="${DEMO_DB:-req_6343a752e110}"
if [[ "$TARGET" == "$DEMO_DB" && "${ALLOW_DEMO_RESTORE:-0}" != "1" ]]; then
  echo "[restore] refusing to overwrite demo db '$TARGET' (set ALLOW_DEMO_RESTORE=1 to force)" >&2
  exit 2
fi
mysql -h"$HOST" -P"$PORT" -u"$USER" -p"$PASS" -e "CREATE DATABASE IF NOT EXISTS \`$TARGET\` CHARACTER SET utf8mb4"
echo "[restore] $SRC -> $TARGET"
if [[ "$SRC" == *.gz ]]; then gzip -dc "$SRC"; else cat "$SRC"; fi | mysql -h"$HOST" -P"$PORT" -u"$USER" -p"$PASS" "$TARGET"
echo "[restore] done; tables=$(mysql -h"$HOST" -P"$PORT" -u"$USER" -p"$PASS" -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$TARGET'")"
