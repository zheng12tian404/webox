#!/usr/bin/env bash
# WeBox backend smoke test. Usage: BASE=http://127.0.0.1:8090/api/v1 bash scripts/smoke.sh
set -u
BASE=${BASE:-http://127.0.0.1:8090/api/v1}
J() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }
hr() { printf '\n===== %s =====\n' "$1"; }
TODAY=$(TZ=Asia/Shanghai date +%F)
HOUR=$(TZ=Asia/Shanghai date +%H)
if [ "$HOUR" -ge 15 ]; then EFF=$(TZ=Asia/Shanghai date -d '+1 day' +%F); else EFF=$TODAY; fi
echo "today=$TODAY effectiveDateForCutoff=$EFF hour=$HOUR"
KEY1="smoke-key-$(date +%s)-01"

hr "0. health"
curl -s -w '\nHTTP %{http_code}\n' "$BASE/health"

hr "1. employee login (seeded)"
LOGIN=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"employee@webox.com","password":"Employee123"}')
echo "$LOGIN"
TOKEN=$(echo "$LOGIN" | J 'd["data"]["accessToken"]')
AUTH="Authorization: Bearer $TOKEN"

hr "2. menu page=1 size=5"
curl -s -w '\nHTTP %{http_code}\n' "$BASE/menu?page=1&size=5" -H "$AUTH"

hr "3. menu detail dish 9"
curl -s -w '\nHTTP %{http_code}\n' "$BASE/menu/9" -H "$AUTH"

hr "4. filters"
curl -s -w '\nHTTP %{http_code}\n' "$BASE/menu/filters" -H "$AUTH"

hr "5. preview dish 9 + Bun/Sauce options (expect 3800)"
curl -s -w '\nHTTP %{http_code}\n' -X POST "$BASE/orders/preview" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"items":[{"dishId":9,"qty":1,"optionIds":[15,17]}],"deliveryDate":"'"$TODAY"'","mealType":"Dinner"}'

hr "6. submit order (new Idempotency-Key)"
SUB=$(curl -s -X POST "$BASE/orders" -H "$AUTH" -H 'Content-Type: application/json' -H "Idempotency-Key: $KEY1" \
  -d '{"items":[{"dishId":9,"qty":1,"optionIds":[15,17]}],"deliveryDate":"'"$TODAY"'","mealType":"Dinner","address":"Building A, 12F"}')
echo "$SUB"
ORDER_ID=$(echo "$SUB" | J 'd["data"]["orderId"]')
echo "orderId=$ORDER_ID"

hr "7. submit again with SAME key and SAME body (expect replay, same orderId)"
curl -s -w '\nHTTP %{http_code}\n' -X POST "$BASE/orders" -H "$AUTH" -H 'Content-Type: application/json' -H "Idempotency-Key: $KEY1" \
  -d '{"items":[{"dishId":9,"qty":1,"optionIds":[15,17]}],"deliveryDate":"'"$TODAY"'","mealType":"Dinner","address":"Building A, 12F"}'

hr "8. submit same key DIFFERENT body (expect 409 IDEMPOTENCY_CONFLICT)"
curl -s -w '\nHTTP %{http_code}\n' -X POST "$BASE/orders" -H "$AUTH" -H 'Content-Type: application/json' -H "Idempotency-Key: $KEY1" \
  -d '{"items":[{"dishId":9,"qty":2,"optionIds":[15,17]}],"deliveryDate":"'"$TODAY"'","mealType":"Dinner","address":"Building A, 12F"}'

hr "9. submit different key same meal (expect 409 ORDER_DUPLICATE + existingOrderId)"
curl -s -w '\nHTTP %{http_code}\n' -X POST "$BASE/orders" -H "$AUTH" -H 'Content-Type: application/json' -H "Idempotency-Key: ${KEY1}-dup" \
  -d '{"items":[{"dishId":9,"qty":1,"optionIds":[15,17]}],"deliveryDate":"'"$TODAY"'","mealType":"Dinner","address":"Building A, 12F"}'

hr "10. order detail"
curl -s -w '\nHTTP %{http_code}\n' "$BASE/orders/$ORDER_ID" -H "$AUTH"

hr "11. active order"
curl -s -w '\nHTTP %{http_code}\n' "$BASE/orders/active?date=$TODAY&mealType=Dinner" -H "$AUTH"

hr "12. cancel order (employee, reason optional)"
curl -s -w '\nHTTP %{http_code}\n' -X POST "$BASE/orders/$ORDER_ID/cancel" -H "$AUTH" -H 'Content-Type: application/json' -d '{}'

hr "13. cancel again (expect 409 ORDER_STATE_INVALID)"
curl -s -w '\nHTTP %{http_code}\n' -X POST "$BASE/orders/$ORDER_ID/cancel" -H "$AUTH" -H 'Content-Type: application/json' -d '{}'

hr "14. employee calls /admin/dishes (expect 403 FORBIDDEN)"
curl -s -w '\nHTTP %{http_code}\n' "$BASE/admin/dishes" -H "$AUTH"

hr "15. admin login + set dish 9 stock 0"
ALOGIN=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@webox.com","password":"Admin12345"}')
ATOKEN=$(echo "$ALOGIN" | J 'd["data"]["accessToken"]')
AAUTH="Authorization: Bearer $ATOKEN"
curl -s -w '\nHTTP %{http_code}\n' -X PUT "$BASE/admin/daily-menu/$EFF/9/stock" -H "$AAUTH" -H 'Content-Type: application/json' \
  -d '{"totalQty":0,"confirm":true,"reason":"smoke test sold out"}'

hr "16. submit while sold out (expect 409 STOCK_INSUFFICIENT)"
curl -s -w '\nHTTP %{http_code}\n' -X POST "$BASE/orders" -H "$AUTH" -H 'Content-Type: application/json' -H "Idempotency-Key: ${KEY1}-oos" \
  -d '{"items":[{"dishId":9,"qty":1,"optionIds":[15,17]}],"deliveryDate":"'"$TODAY"'","mealType":"Dinner","address":"Building A, 12F"}'

hr "17. restore dish 9 stock 30"
curl -s -w '\nHTTP %{http_code}\n' -X PUT "$BASE/admin/daily-menu/$EFF/9/stock" -H "$AAUTH" -H 'Content-Type: application/json' \
  -d '{"totalQty":30,"confirm":true,"reason":"restore after smoke test"}'

hr "18. register new employee (expect 201)"
NEWMAIL="smoke$(date +%s)@webox.com"
curl -s -w '\nHTTP %{http_code}\n' -X POST "$BASE/auth/register" -H 'Content-Type: application/json' \
  -d '{"email":"'"$NEWMAIL"'","password":"Smoke12345","displayName":"Smoke Tester"}'

hr "19. invalid login (expect 401 AUTH_INVALID_CREDENTIALS)"
curl -s -w '\nHTTP %{http_code}\n' -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"employee@webox.com","password":"WrongPass123"}'

hr "20. search injection attempt (expect 200, empty/normal result)"
curl -s -w '\nHTTP %{http_code}\n' "$BASE/menu?search=%27%20OR%201%3D1--" -H "$AUTH"

hr "21. admin dashboard"
curl -s -w '\nHTTP %{http_code}\n' "$BASE/admin/dashboard?date=$TODAY" -H "$AAUTH"

hr "22. admin reconcile"
curl -s -w '\nHTTP %{http_code}\n' "$BASE/admin/inventory/reconcile?date=$TODAY" -H "$AAUTH"

hr "23. admin audit logs (last 3)"
curl -s -w '\nHTTP %{http_code}\n' "$BASE/admin/audit-logs?page=1&size=3" -H "$AAUTH"

hr "24. AI recommend (fallback SSE)"
curl -s -N -m 10 -X POST "$BASE/ai/recommend" -H "$AUTH" -H 'Content-Type: application/json' -H 'Accept: text/event-stream' \
  -d '{"prompt":"light and high protein lunch"}'

hr "25. invalid idempotency key length (expect 400 IDEMPOTENCY_KEY_REQUIRED)"
curl -s -w '\nHTTP %{http_code}\n' -X POST "$BASE/orders" -H "$AUTH" -H 'Content-Type: application/json' -H 'Idempotency-Key: short' \
  -d '{"items":[{"dishId":9,"qty":1,"optionIds":[15,17]}],"deliveryDate":"'"$TODAY"'","mealType":"Dinner","address":"Building A, 12F"}'

hr "26. unauth menu (expect 401)"
curl -s -w '\nHTTP %{http_code}\n' "$BASE/menu"

echo
echo "SMOKE COMPLETE"