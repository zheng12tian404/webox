#!/usr/bin/env bash
# Demo DB reset requires the explicit ALLOW_DEMO_RESET=1 switch.
set -eu
if [ "${ALLOW_DEMO_RESET:-0}" != "1" ]; then
  echo "Refusing to reset the demo database. Set ALLOW_DEMO_RESET=1 to proceed." >&2
  exit 1
fi
mysql --default-character-set=utf8mb4 -h"${MYSQL_HOST:-127.0.0.1}" -P"${MYSQL_PORT:-3306}" \
  -u"${MYSQL_USER:-test}" -p"${MYSQL_PASSWORD:-test123456}" "${MYSQL_DATABASE:-req_6343a752e110}" \
  -e "SET @ALLOW_DEMO_RESET=1; SOURCE scripts/reset_demo.sql;"
