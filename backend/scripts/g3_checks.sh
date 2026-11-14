#!/usr/bin/env bash
# G3 red-line evidence: 30-minute timeout release, Redis whole-order compensation,
# test-clock rejection, SSE snapshot/ticket, reconcile drift.
set -u
BASE=${BASE:-http://127.0.0.1:8090/api/v1}
MYSQL="mysql -h127.0.0.1 -utest -ptest123456 req_6343a752e110 -N -B"
TODAY=$(TZ=Asia/Shanghai date +%F)
HOUR=$(TZ=Asia/Shanghai date +%H)
if [ "$HOUR" -ge 15 ]; then EFF=$(TZ=Asia/Shanghai date -d '+1 day' +%F); else EFF=$TODAY; fi
J() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }
hr() { printf '\n===== %s =====\n' "$1"; }
KEY="g3-$(date +%s)"

TOKEN=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"employee@webox.com","password":"Employee123"}' | J 'd["data"]["accessToken"]')
AUTH="Authorization: Bearer $TOKEN"
ATOKEN=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@webox.com","password":"Admin12345"}' | J 'd["data"]["accessToken"]')
AAUTH="Authorization: Bearer $ATOKEN"

hr "G3-1 30-minute timeout release (SQL backdate + scheduled tick)"
SUB=$(curl -s -X POST "$BASE/orders" -H "$AUTH" -H 'Content-Type: application/json' -H "Idempotency-Key: ${KEY}-timeout" \
  -d '{"items":[{"dishId":17,"qty":1}],"address":"Timeout Test Address"}')
echo "submit: $SUB"
OID=$(echo "$SUB" | J 'd["data"]["orderId"]')
echo "orderId=$OID"
$MYSQL -e "UPDATE orders SET created_at = created_at - INTERVAL 31 MINUTE WHERE id=$OID;" 2>/dev/null
echo "backdated created_at: $($MYSQL -e "SELECT created_at FROM orders WHERE id=$OID" 2>/dev/null)"
echo "waiting 130s for two scheduler ticks..."
sleep 130
$MYSQL -e "SELECT id,status,cancel_reason,created_at FROM orders WHERE id=$OID" 2>/dev/null
$MYSQL -e "SELECT entry_type,COUNT(*),SUM(qty) FROM inventory_ledger WHERE order_id=$OID GROUP BY entry_type" 2>/dev/null
echo "expected: status=Cancelled, exactly one RELEASE (no double release)"
$MYSQL -e "SELECT dish_id,serve_date,total_qty,reserved_qty,sold_qty,total_qty-reserved_qty-sold_qty AS available FROM dish_daily_stock WHERE dish_id=17 AND serve_date='$EFF'" 2>/dev/null

hr "G3-2 Redis whole-order compensation (G3A-M1)"
$MYSQL -e "UPDATE dish_daily_stock SET inventory_mode='REDIS_PREALLOC' WHERE dish_id=9 AND serve_date='$EFF';
           UPDATE dish_daily_stock SET total_qty=0 WHERE dish_id=20 AND serve_date='$EFF';" 2>/dev/null
redis-cli DEL "webox:stock:$EFF:9" >/dev/null 2>&1
BEFORE_DB=$($MYSQL -e "SELECT total_qty,reserved_qty,sold_qty,total_qty-reserved_qty-sold_qty FROM dish_daily_stock WHERE dish_id=9 AND serve_date='$EFF'" 2>/dev/null)
echo "dish9 DB before: $BEFORE_DB"
RESP=$(curl -s -w '\nHTTP %{http_code}' -X POST "$BASE/orders" -H "$AUTH" -H 'Content-Type: application/json' -H "Idempotency-Key: ${KEY}-redis" \
  -d '{"items":[{"dishId":9,"qty":1},{"dishId":20,"qty":1}],"deliveryDate":"'"$EFF"'","mealType":"Lunch","address":"Redis Test Address"}')
echo "submit: $RESP"
AFTER_DB=$($MYSQL -e "SELECT total_qty,reserved_qty,sold_qty,total_qty-reserved_qty-sold_qty FROM dish_daily_stock WHERE dish_id=9 AND serve_date='$EFF'" 2>/dev/null)
echo "dish9 DB after:  $AFTER_DB"
echo "redis dish9 value: $(redis-cli GET "webox:stock:$EFF:9")"
echo "expected: DB reserved unchanged; redis value back to DB available ($(echo "$AFTER_DB" | awk '{print $4}'))"
$MYSQL -e "UPDATE dish_daily_stock SET total_qty=40, inventory_mode='DB_ATOMIC' WHERE dish_id=20 AND serve_date='$EFF';
           UPDATE dish_daily_stock SET inventory_mode='DB_ATOMIC' WHERE dish_id=9 AND serve_date='$EFF';" 2>/dev/null
redis-cli DEL "webox:stock:$EFF:9" >/dev/null 2>&1

hr "G3-3 X-Test-Clock rejected outside test profile"
curl -s -w '\nHTTP %{http_code}\n' "$BASE/menu" -H "$AUTH" -H 'X-Test-Clock: 2026-11-14T10:00:00+08:00'

hr "G3-4 SSE snapshot + ticket redemption limit (4th -> 401)"
echo "--- snapshot (2s) ---"
curl -s -N -m 2 "$BASE/menu/stream" -H "$AUTH" || true
TICKET=$(curl -s -X POST "$BASE/menu/stream-ticket" -H "$AUTH" | J 'd["data"]["ticket"]')
echo "ticket=$TICKET"
for i in 1 2 3 4; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 1 "$BASE/menu/stream?ticket=$TICKET")
  echo "redemption $i -> HTTP $code"
done

hr "G3-5 Reconcile drift after order/cancel"
curl -s -w '\nHTTP %{http_code}\n' "$BASE/admin/inventory/reconcile?date=$EFF" -H "$AAUTH"

hr "G3-6 Pending order stock reservation + ledger"
$MYSQL -e "SELECT o.id,o.status,o.total_cents,i.entry_type,i.qty,i.before_available,i.after_available,i.business_key
           FROM orders o LEFT JOIN inventory_ledger i ON i.order_id=o.id ORDER BY o.id DESC LIMIT 8" 2>/dev/null
echo
echo "G3 CHECKS COMPLETE"