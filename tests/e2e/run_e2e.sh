#!/usr/bin/env bash
# WeBox E2E 冒烟：三档 viewport 打开关键页面 + 横向滚动断言 + 截图
# 用法：bash tests/e2e/run_e2e.sh
set -uo pipefail

APP="${APP_URL:-http://127.0.0.1:5173}"
OUT="${EVIDENCE_DIR:-artifacts/test/manual}"
BROWSER="${AGENT_BROWSER:-/opt/gem/bin/agent-browser}"
mkdir -p "$OUT"

if ! command -v "$BROWSER" >/dev/null 2>&1 && [ ! -x "$BROWSER" ]; then
  echo "[SKIP] agent-browser 不存在: $BROWSER"
  exit 0
fi

fail=0
for vp in "375 812" "768 1024" "1440 900"; do
  set -- $vp
  W="$1"; H="$2"
  "$BROWSER" set viewport "$W" "$H" >/dev/null 2>&1 || true
  for page in "login" "menu" "cart" "checkout" "orders"; do
    "$BROWSER" open "$APP/$page" >/dev/null 2>&1 || true
    "$BROWSER" wait 800 >/dev/null 2>&1 || true
    "$BROWSER" screenshot "$OUT/TC-075-${W}x${H}-${page}.png" >/dev/null 2>&1 || true
    "$BROWSER" eval "JSON.stringify({w:innerWidth,sw:document.scrollingElement?document.scrollingElement.scrollWidth:0,path:location.pathname})" \
      > "$OUT/TC-075-${W}x${H}-${page}.json" 2>/dev/null || true
    if grep -q '"sw"' "$OUT/TC-075-${W}x${H}-${page}.json" 2>/dev/null; then
      SW=$(grep -oE '"sw":[0-9]+' "$OUT/TC-075-${W}x${H}-${page}.json" | head -1 | cut -d: -f2)
      if [ -n "${SW:-}" ] && [ "$SW" -gt $((W + 1)) ]; then
        echo "[FAIL] TC-075 ${W}x${H} ${page}: scrollWidth=$SW > $((W + 1))"
        fail=1
      fi
    fi
  done
done

"$BROWSER" close >/dev/null 2>&1 || true
echo "== e2e screenshot sweep done: $OUT (fail=$fail) =="
exit "$fail"