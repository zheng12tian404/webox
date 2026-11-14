#!/usr/bin/env bash
# Backup a WeBox database. Usage: backup.sh [db_name] [output_file]
# Defaults to $MYSQL_DATABASE or the demo DB; never writes into a database.
set -euo pipefail
HOST="${MYSQL_HOST:-127.0.0.1}"; PORT="${MYSQL_PORT:-3306}"
USER="${MYSQL_USER:-test}"; PASS="${MYSQL_PASSWORD:-test123456}"
DB="${1:-${MYSQL_DATABASE:-req_6343a752e110}}"
TS=$(date +%Y%m%d%H%M%S)
OUT="${2:-$(dirname "$0")/../backups/${DB}-${TS}.sql.gz}"
mkdir -p "$(dirname "$OUT")"
echo "[backup] db=$DB host=$HOST port=$PORT -> $OUT"
mysqldump -h"$HOST" -P"$PORT" -u"$USER" -p"$PASS" \
  --single-transaction --routines --triggers --set-gtid-purged=OFF "$DB" | gzip > "$OUT"
echo "[backup] bytes=$(stat -c%s "$OUT") sha256=$(sha256sum "$OUT" | cut -d' ' -f1)"
