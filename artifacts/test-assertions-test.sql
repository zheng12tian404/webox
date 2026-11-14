-- WeBox DB 不变量断言（TC-030/036/058/067/077；表名按 docs/data-model.md）
-- 用法：mysql ... req_6343a752e110 < tests/sql/assertions.sql
-- 约定：所有「违规查询」应返回 0 行；带 report 的查询用于人工核对并作为证据。
USE req_6343a752e110_test;

SELECT '=== 1. 负库存/超占（应 0 行）===' AS section;
SELECT dish_id, serve_date, total_qty, reserved_qty, sold_qty,
       (total_qty - reserved_qty - sold_qty) AS available
FROM dish_daily_stock
WHERE (total_qty - reserved_qty - sold_qty) < 0
   OR reserved_qty < 0 OR sold_qty < 0
   OR (reserved_qty + sold_qty) > total_qty;

SELECT '=== 2. 同日同餐次重复有效单（应 0 行）===' AS section;
SELECT user_id, delivery_date, meal_type, COUNT(*) AS active_cnt
FROM orders
WHERE status IN ('Pending','Confirmed')
GROUP BY user_id, delivery_date, meal_type
HAVING COUNT(*) > 1;

SELECT '=== 3. 同一幂等键多单（应 0 行）===' AS section;
SELECT user_id, idempotency_key, COUNT(*) AS cnt
FROM orders
WHERE idempotency_key IS NOT NULL
GROUP BY user_id, idempotency_key
HAVING COUNT(*) > 1;

SELECT '=== 4. 同一订单重复 RELEASE（应 0 行）===' AS section;
SELECT order_id, COUNT(*) AS release_cnt
FROM inventory_ledger
WHERE entry_type = 'RELEASE'
GROUP BY order_id
HAVING COUNT(*) > 1;

SELECT '=== 5. 订单总额与明细小计不一致（应 0 行）===' AS section;
SELECT o.id, o.order_no, o.total_cents, SUM(oi.subtotal_cents) AS items_sum
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id, o.order_no, o.total_cents
HAVING o.total_cents <> SUM(oi.subtotal_cents);

SELECT '=== 6. 单价为小数/浮点痕迹（应 0 行）===' AS section;
SELECT id, order_no, unit_price_cents
FROM order_items
WHERE unit_price_cents <> FLOOR(unit_price_cents) OR subtotal_cents <> FLOOR(subtotal_cents);

SELECT '=== 7. 明文/非 BCrypt 密码（应 0 行）===' AS section;
SELECT id, email, LEFT(password_hash, 4) AS hash_prefix
FROM users
WHERE password_hash NOT LIKE '$2%';

SELECT '=== 8. 库存 drift 报告（drift 应为空）===' AS section;
-- reserved 应等于该菜该日 RESERVE - RELEASE - CONFIRM(-) 的净额；此处给出账本推导值供核对
SELECT s.dish_id, s.serve_date, s.total_qty, s.reserved_qty, s.sold_qty,
       (s.total_qty - s.reserved_qty - s.sold_qty) AS book_available,
       COALESCE(SUM(CASE
           WHEN l.entry_type = 'RESERVE' THEN -l.qty
           WHEN l.entry_type = 'RELEASE' THEN l.qty
           WHEN l.entry_type = 'ADJUST'  THEN l.qty
           ELSE 0 END), 0) AS ledger_delta
FROM dish_daily_stock s
LEFT JOIN inventory_ledger l
  ON l.dish_id = s.dish_id AND l.serve_date = s.serve_date
GROUP BY s.dish_id, s.serve_date, s.total_qty, s.reserved_qty, s.sold_qty;

SELECT '=== 9. 审计完整性抽查（改价/上下架/库存/取消）===' AS section;
SELECT action, object_type, COUNT(*) AS cnt
FROM audit_log
WHERE action IN ('PRICE_CHANGE','DISH_STATUS_CHANGE','STOCK_CHANGE','ORDER_CANCEL')
GROUP BY action, object_type;

SELECT '=== 10. 今日订单状态分布（TC-065 看板对账）===' AS section;
SELECT status, COUNT(*) AS cnt, COALESCE(SUM(total_cents),0) AS revenue_cents
FROM orders
WHERE delivery_date = CURDATE()
GROUP BY status;