-- 测试数据重置（仅限独立库 req_6343a752e110，禁止对共享库执行）
-- 用法：mysql -h127.0.0.1 -utest -ptest123456 req_6343a752e110 < tests/sql/reset.sql
USE req_6343a752e110_test;

SET FOREIGN_KEY_CHECKS = 0;
DELETE FROM inventory_ledger;
DELETE FROM order_items;
DELETE FROM idempotency_records;
DELETE FROM orders;
DELETE FROM ai_conversation;
-- 审计与菜品/用户保留（审计不可删；菜品与图片为种子）
SET FOREIGN_KEY_CHECKS = 1;

-- 释放所有未完成占用，保留 total_qty 与已售；测试环境从干净可售开始
UPDATE dish_daily_stock
SET reserved_qty = 0
WHERE serve_date >= CURDATE();

-- 校验：应返回 0
SELECT COUNT(*) AS active_orders_after_reset FROM orders WHERE status IN ('Pending','Confirmed');