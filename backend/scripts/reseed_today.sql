-- Re-seed today / tomorrow / day+2 menus and stock so the demo always works on any day.
-- Safe to run before a demo. Existing orders are untouched.
SET NAMES utf8mb4;
INSERT INTO daily_menu (dish_id, serve_date, publish_status, created_by)
SELECT id, CURDATE(), 'PUBLISHED', 1 FROM dishes
ON DUPLICATE KEY UPDATE publish_status='PUBLISHED';
INSERT INTO dish_daily_stock (dish_id, serve_date, total_qty, inventory_mode)
SELECT id, CURDATE(),
  CASE id WHEN 1 THEN 40 WHEN 2 THEN 30 WHEN 3 THEN 25 WHEN 4 THEN 35 WHEN 5 THEN 20
          WHEN 6 THEN 30 WHEN 7 THEN 45 WHEN 8 THEN 28 WHEN 9 THEN 22 ELSE 40 END,
  CASE WHEN id IN (1,9) THEN 'REDIS_PREALLOC' ELSE 'DB_ATOMIC' END
FROM dishes
ON DUPLICATE KEY UPDATE total_qty=VALUES(total_qty), reserved_qty=0, sold_qty=0, version=version+1;

INSERT INTO daily_menu (dish_id, serve_date, publish_status, created_by)
SELECT id, CURDATE() + INTERVAL 1 DAY, 'PUBLISHED', 1 FROM dishes
ON DUPLICATE KEY UPDATE publish_status='PUBLISHED';
INSERT INTO dish_daily_stock (dish_id, serve_date, total_qty, inventory_mode)
SELECT id, CURDATE() + INTERVAL 1 DAY, 40, 'DB_ATOMIC' FROM dishes
ON DUPLICATE KEY UPDATE total_qty=VALUES(total_qty), reserved_qty=0, sold_qty=0, version=version+1;

INSERT INTO daily_menu (dish_id, serve_date, publish_status, created_by)
SELECT id, CURDATE() + INTERVAL 2 DAY, 'PUBLISHED', 1 FROM dishes
ON DUPLICATE KEY UPDATE publish_status='PUBLISHED';
INSERT INTO dish_daily_stock (dish_id, serve_date, total_qty, inventory_mode)
SELECT id, CURDATE() + INTERVAL 2 DAY, 40, 'DB_ATOMIC' FROM dishes
ON DUPLICATE KEY UPDATE total_qty=VALUES(total_qty), reserved_qty=0, sold_qty=0, version=version+1;

SELECT serve_date, COUNT(*) AS dishes, SUM(total_qty) AS total_stock, SUM(reserved_qty) AS reserved, SUM(sold_qty) AS sold
FROM dish_daily_stock WHERE serve_date >= CURDATE() GROUP BY serve_date;