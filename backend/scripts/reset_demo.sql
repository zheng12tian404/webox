-- Reset the DEMO database (req_6343a752e110). Guarded by scripts/reset_demo.sh.
-- Direct execution fails unless @ALLOW_DEMO_RESET=1 (CHECK constraint guard).
SET @allow := IFNULL(@ALLOW_DEMO_RESET, 0);
CREATE TEMPORARY TABLE demo_reset_guard (ok TINYINT NOT NULL, CONSTRAINT ck_demo_reset CHECK (ok = 1));
INSERT INTO demo_reset_guard (ok) VALUES (@allow);
DROP TEMPORARY TABLE demo_reset_guard;
DELETE FROM idempotency_records;
DELETE FROM inventory_ledger;
DELETE FROM order_items;
DELETE FROM orders;
DELETE FROM audit_log;
DELETE FROM ai_conversation;
UPDATE dish_daily_stock SET reserved_qty=0, sold_qty=0, version=version+1;
UPDATE addresses SET usage_count=1, last_used_at=NOW(3);
SELECT 'reset_demo complete' AS result;
