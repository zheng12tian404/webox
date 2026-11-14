#!/usr/bin/env bash
# Deterministic launcher: pinned JDK17 absolute path + health probe (PA-D-003 / DEF-013).
set -euo pipefail
cd "$(dirname "$0")/.."
JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-amd64}"
JAVA_BIN="$JAVA_HOME/bin/java"
PORT="${SERVER_PORT:-8083}"
JAR="target/webox-backend.jar"
[[ -x "$JAVA_BIN" ]] || { echo "JDK17 not found at $JAVA_BIN" >&2; exit 1; }
[[ -f "$JAR" ]] || { echo "$JAR missing; run mvn -q -DskipTests package" >&2; exit 1; }
OLD=$(ss -ltnp 2>/dev/null | grep ":$PORT " | grep -o 'pid=[0-9]*' | cut -d= -f2 || true)
[[ -n "$OLD" ]] && { echo "[start] stopping pid=$OLD on :$PORT"; kill "$OLD"; sleep 2; }
echo "[start] java=$JAVA_BIN jar=$JAR port=$PORT"
SERVER_PORT="$PORT" nohup "$JAVA_BIN" -Duser.timezone=Asia/Shanghai -jar "$JAR" > "../artifacts/backend-$PORT.log" 2>&1 &
NEW=$!
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/api/v1/health" || true)
  [[ "$code" = "200" ]] && { echo "[start] pid=$NEW health=200 after ${i}s"; exit 0; }
  sleep 1
done
echo "[start] FAILED health probe after 60s (last=$code)" >&2; exit 1
