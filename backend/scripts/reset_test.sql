-- Reset transactional data in the isolated TEST database (req_6343a752e110_test).
-- Never run against the demo database.
SET @db := DATABASE();
SELECT @db AS database_name;
DELETE FROM idempotency_records;
DELETE FROM inventory_ledger;
DELETE FROM order_items;
DELETE FROM orders;
DELETE FROM audit_log;
DELETE FROM ai_conversation;
UPDATE dish_daily_stock SET reserved_qty=0, sold_qty=0, version=version+1;
UPDATE addresses SET usage_count=1, last_used_at=NOW(3);
SELECT 'reset_test complete' AS result;