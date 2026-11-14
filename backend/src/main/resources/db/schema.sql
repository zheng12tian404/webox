-- WeBox schema + seed (MySQL 8.0.46 validated)
-- Money: BIGINT cents. Time: DATETIME(3), Asia/Shanghai. User-visible text: English.
SET NAMES utf8mb4;
SET time_zone = '+08:00';

CREATE TABLE users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(200) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  display_name VARCHAR(100) NULL,
  role ENUM('EMPLOYEE','ADMIN') NOT NULL DEFAULT 'EMPLOYEE',
  status ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE',
  site_id VARCHAR(16) NOT NULL DEFAULT 'HQ',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_email (email),
  KEY idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE refresh_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_rt_hash (token_hash),
  KEY idx_rt_user (user_id, expires_at),
  CONSTRAINT fk_rt_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE dishes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(1000) NOT NULL,
  price_cents BIGINT NOT NULL,
  category ENUM('Chinese','Western','Japanese','Light Meal','Korean','Southeast Asian') NOT NULL,
  protein VARCHAR(50) NOT NULL,
  allergens JSON NULL,
  spice_level ENUM('None','Mild','Medium','Hot') NOT NULL DEFAULT 'None',
  image_url VARCHAR(300) NULL,
  status ENUM('ON_SHELF','OFF_SHELF') NOT NULL DEFAULT 'ON_SHELF',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_dishes_status_category (status, category),
  KEY idx_dishes_name (name),
  CONSTRAINT ck_dishes_price CHECK (price_cents > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE dish_option_groups (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dish_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(50) NOT NULL,
  required TINYINT(1) NOT NULL DEFAULT 0,
  min_select INT NOT NULL DEFAULT 0,
  max_select INT NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_groups_dish (dish_id, sort_order),
  CONSTRAINT fk_groups_dish FOREIGN KEY (dish_id) REFERENCES dishes(id),
  CONSTRAINT ck_groups_select CHECK (min_select >= 0 AND max_select >= min_select)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE dish_options (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  group_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(50) NOT NULL,
  price_delta_cents BIGINT NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_options_group (group_id, sort_order),
  CONSTRAINT fk_options_group FOREIGN KEY (group_id) REFERENCES dish_option_groups(id),
  CONSTRAINT ck_options_delta CHECK (price_delta_cents >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE daily_menu (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dish_id BIGINT UNSIGNED NOT NULL,
  serve_date DATE NOT NULL,
  publish_status ENUM('DRAFT','PUBLISHED') NOT NULL DEFAULT 'PUBLISHED',
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_menu_dish_date (dish_id, serve_date),
  KEY idx_menu_date_status (serve_date, publish_status),
  CONSTRAINT fk_menu_dish FOREIGN KEY (dish_id) REFERENCES dishes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE dish_daily_stock (
  dish_id BIGINT UNSIGNED NOT NULL,
  serve_date DATE NOT NULL,
  total_qty INT NOT NULL DEFAULT 0,
  reserved_qty INT NOT NULL DEFAULT 0,
  sold_qty INT NOT NULL DEFAULT 0,
  inventory_mode ENUM('DB_ATOMIC','REDIS_PREALLOC') NOT NULL DEFAULT 'DB_ATOMIC',
  version BIGINT NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (dish_id, serve_date),
  KEY idx_stock_date (serve_date),
  CONSTRAINT fk_stock_dish FOREIGN KEY (dish_id) REFERENCES dishes(id),
  CONSTRAINT ck_stock_nonneg CHECK (total_qty >= 0 AND reserved_qty >= 0 AND sold_qty >= 0
    AND reserved_qty + sold_qty <= total_qty)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_no VARCHAR(24) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  status ENUM('Pending','Confirmed','Completed','Cancelled') NOT NULL DEFAULT 'Pending',
  delivery_date DATE NOT NULL,
  meal_type ENUM('Lunch','Dinner') NOT NULL,
  address VARCHAR(200) NOT NULL,
  total_cents BIGINT NOT NULL,
  item_count INT NOT NULL,
  budget_exceeded TINYINT(1) NOT NULL DEFAULT 0,
  idempotency_key VARCHAR(64) NULL,
  snapshot_json JSON NOT NULL,
  cancel_reason VARCHAR(200) NULL,
  cancelled_at DATETIME(3) NULL,
  active_key VARCHAR(80) GENERATED ALWAYS AS (
    CASE WHEN status IN ('Pending','Confirmed')
         THEN CONCAT(user_id, ':', delivery_date, ':', meal_type) ELSE NULL END) STORED,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_orders_no (order_no),
  UNIQUE KEY uk_orders_active (active_key),
  UNIQUE KEY uk_orders_idem (user_id, idempotency_key),
  KEY idx_orders_user_created (user_id, created_at),
  KEY idx_orders_date_meal_status (delivery_date, meal_type, status),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT ck_orders_total CHECK (total_cents >= 0),
  CONSTRAINT ck_orders_count CHECK (item_count BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE order_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  dish_id BIGINT UNSIGNED NOT NULL,
  dish_name VARCHAR(100) NOT NULL,
  unit_price_cents BIGINT NOT NULL,
  options_json JSON NULL,
  qty INT NOT NULL,
  subtotal_cents BIGINT NOT NULL,
  PRIMARY KEY (id),
  KEY idx_items_order (order_id),
  CONSTRAINT fk_items_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT ck_items_qty CHECK (qty >= 1),
  CONSTRAINT ck_items_subtotal CHECK (subtotal_cents >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE inventory_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NULL,
  dish_id BIGINT UNSIGNED NOT NULL,
  serve_date DATE NOT NULL,
  entry_type ENUM('RESERVE','RELEASE','CONFIRM','ADJUST') NOT NULL,
  qty INT NOT NULL,
  before_available INT NOT NULL,
  after_available INT NOT NULL,
  business_key VARCHAR(120) NOT NULL,
  operator VARCHAR(100) NULL,
  reason VARCHAR(200) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_ledger_business_key (business_key),
  KEY idx_ledger_order (order_id),
  KEY idx_ledger_dish_date (dish_id, serve_date),
  KEY idx_ledger_created (created_at),
  CONSTRAINT fk_ledger_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT ck_ledger_qty CHECK (qty > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE idempotency_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  idem_key VARCHAR(64) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  status ENUM('IN_PROGRESS','COMPLETED','FAILED') NOT NULL DEFAULT 'IN_PROGRESS',
  response_status INT NULL,
  response_body JSON NULL,
  order_id BIGINT UNSIGNED NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_idem_user_key (user_id, idem_key),
  KEY idx_idem_expires (expires_at),
  CONSTRAINT fk_idem_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_idem_order FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE user_preferences (
  user_id BIGINT UNSIGNED NOT NULL,
  allergens JSON NULL,
  preferred_categories JSON NULL,
  spice_preference ENUM('None','Mild','Medium','Hot') NULL,
  taste_preference ENUM('Light','Medium','Rich') NULL,
  budget_min_cents BIGINT NULL,
  budget_max_cents BIGINT NULL,
  recommend_enabled TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  CONSTRAINT fk_pref_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT ck_pref_budget CHECK (budget_min_cents IS NULL OR budget_max_cents IS NULL
    OR (budget_min_cents > 0 AND budget_min_cents <= budget_max_cents))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE user_profile (
  user_id BIGINT UNSIGNED NOT NULL,
  order_count_30d INT NOT NULL DEFAULT 0,
  favorite_categories JSON NULL,
  avg_spend_cents BIGINT NOT NULL DEFAULT 0,
  last_computed_at DATETIME(3) NULL,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_profile_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE addresses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  address VARCHAR(200) NOT NULL,
  usage_count INT NOT NULL DEFAULT 0,
  last_used_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_addr_user_address (user_id, address),
  KEY idx_addr_user_last (user_id, last_used_at),
  CONSTRAINT fk_addr_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_id BIGINT UNSIGNED NULL,
  actor_email VARCHAR(200) NULL,
  action VARCHAR(64) NOT NULL,
  object_type VARCHAR(32) NOT NULL,
  object_id VARCHAR(64) NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  reason VARCHAR(200) NULL,
  ip VARCHAR(45) NULL,
  request_id VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_audit_object (object_type, object_id),
  KEY idx_audit_actor (actor_id, created_at),
  KEY idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE ai_conversation (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  session_id VARCHAR(64) NULL,
  prompt VARCHAR(500) NOT NULL,
  response_json JSON NULL,
  dish_ids JSON NULL,
  model VARCHAR(64) NULL,
  fallback TINYINT(1) NOT NULL DEFAULT 0,
  latency_ms INT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_ai_conv_user (user_id, created_at),
  CONSTRAINT fk_ai_conv_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE ai_rule_config (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  config_key VARCHAR(64) NOT NULL,
  version INT NOT NULL,
  config_json JSON NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 0,
  change_reason VARCHAR(200) NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_ai_rule_version (config_key, version),
  KEY idx_ai_rule_active (config_key, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------
-- Seed: 20 dishes (9 PRD + 11 supplementary), English content
-- images: docs/product_images/image_NN_*.jpg -> /images/image_NN.jpg
-- ---------------------------------------------------------------
INSERT INTO dishes (id,name,description,price_cents,category,protein,allergens,spice_level,image_url,status) VALUES
(1,'Kung Pao Chicken','Classic Sichuan dish, chicken stir-fried with peanuts and dried chili',2200,'Chinese','Chicken','["Peanuts"]','Medium','/images/image_01.jpg','ON_SHELF'),
(2,'Caesar Salad','Fresh romaine lettuce with Parmesan and Caesar dressing',2850,'Light Meal','None','["Dairy","Egg"]','None','/images/image_02.jpg','ON_SHELF'),
(3,'Salmon Sashimi Set','Fresh salmon sashimi with rice and miso soup',4500,'Japanese','Fish','["Fish"]','None','/images/image_03.jpg','ON_SHELF'),
(4,'Tomato Pasta','Classic Italian tomato pasta with fresh basil',2650,'Western','None','["Gluten"]','None','/images/image_04.jpg','ON_SHELF'),
(5,'Tom Yum Soup','Thai hot & sour shrimp soup with lemongrass, galangal, lime leaves',3200,'Southeast Asian','Shrimp','["Shellfish"]','Hot','/images/image_05.jpg','ON_SHELF'),
(6,'Chicken Quinoa Bowl','Low-fat high-protein grilled chicken with quinoa, avocado, veggies',3580,'Light Meal','Chicken','[]','None','/images/image_06.jpg','ON_SHELF'),
(7,'Mapo Tofu','Sichuan classic, soft tofu with spicy minced meat',1800,'Chinese','Tofu, Pork','["Soy"]','Medium','/images/image_07.jpg','ON_SHELF'),
(8,'Korean Bibimbap','Stone-pot mixed rice with veggies, fried egg, and chili sauce',3000,'Korean','Egg','["Egg","Soy"]','Mild','/images/image_08.jpg','ON_SHELF'),
(9,'Classic Beef Burger','Angus beef patty with lettuce, tomato, onion',3800,'Western','Beef','["Gluten","Dairy"]','None','/images/image_09.jpg','ON_SHELF'),
(10,'Sweet and Sour Pork','Crispy pork with bell peppers in sweet and sour sauce',2400,'Chinese','Pork','["Gluten","Soy"]','None','/images/image_10.jpg','ON_SHELF'),
(11,'Beef Noodle Soup','Slow-cooked beef brisket with wheat noodles in rich broth',2800,'Chinese','Beef','["Gluten","Soy"]','Mild','/images/image_11.jpg','ON_SHELF'),
(12,'Margherita Pizza','Wood-fired pizza with tomato, mozzarella and basil',3200,'Western','Dairy','["Gluten","Dairy"]','None','/images/image_12.jpg','ON_SHELF'),
(13,'Grilled Chicken Sandwich','Grilled chicken breast with lettuce and tomato in a toasted bun',2900,'Western','Chicken','["Gluten","Dairy"]','None','/images/image_13.jpg','ON_SHELF'),
(14,'Chicken Teriyaki Bento','Teriyaki chicken with rice, pickles and seasonal vegetables',3600,'Japanese','Chicken','["Soy","Gluten"]','Mild','/images/image_14.jpg','ON_SHELF'),
(15,'California Roll','Crab, avocado and cucumber roll with sesame',2450,'Japanese','Crab','["Shellfish","Egg"]','None','/images/image_15.jpg','ON_SHELF'),
(16,'Green Goddess Salad','Mixed greens with avocado and herb yogurt dressing',2500,'Light Meal','None','["Dairy"]','None','/images/image_16.jpg','ON_SHELF'),
(17,'Mushroom Risotto','Creamy Arborio rice with wild mushrooms and Parmesan',3000,'Western','Dairy','["Dairy"]','None','/images/image_17.jpg','ON_SHELF'),
(18,'Korean Fried Chicken','Double-fried chicken with spicy gochujang glaze',3300,'Korean','Chicken','["Gluten","Soy"]','Hot','/images/image_18.jpg','ON_SHELF'),
(19,'Pad Thai','Stir-fried rice noodles with shrimp, egg and peanuts',2700,'Southeast Asian','Shrimp','["Peanuts","Shellfish","Egg"]','Mild','/images/image_19.jpg','ON_SHELF'),
(20,'Vegan Buddha Bowl','Roasted vegetables, tofu and grains with tahini dressing',2600,'Light Meal','Tofu','["Soy"]','None','/images/image_20.jpg','ON_SHELF');

INSERT INTO dish_option_groups (id,dish_id,name,required,min_select,max_select,sort_order) VALUES
(1,2,'Add-ons',0,0,3,1),(2,4,'Pasta Type',1,1,1,1),(3,4,'Add-ons',0,0,2,2),
(4,6,'Base',1,1,1,1),(5,8,'Add-ons',0,0,3,1),(6,9,'Bun',1,1,1,1),
(7,9,'Sauce',1,1,1,2),(8,9,'Add-ons',0,0,3,3),(9,12,'Add-ons',0,0,2,1),
(10,13,'Sauce',1,1,1,1),(11,13,'Add-ons',0,0,2,2),(12,14,'Base',1,1,1,1),
(13,16,'Add-ons',0,0,3,1),(14,17,'Add-ons',0,0,2,1),(15,19,'Add-ons',0,0,3,1),
(16,20,'Base',1,1,1,1);

INSERT INTO dish_options (id,group_id,name,price_delta_cents,sort_order) VALUES
(1,1,'Grilled Chicken',600,1),(2,1,'Bacon',500,2),(3,1,'Avocado',400,3),
(4,2,'Spaghetti',0,1),(5,2,'Fusilli',0,2),(6,2,'Penne',0,3),
(7,3,'Bacon',500,1),(8,3,'Cheese',300,2),
(9,4,'Quinoa',0,1),(10,4,'Brown Rice',0,2),(11,4,'Mixed Grains',0,3),
(12,5,'Cheese',300,1),(13,5,'Fried Egg',200,2),(14,5,'Beef Slices',800,3),
(15,6,'Plain',0,1),(16,6,'Whole Wheat',0,2),
(17,7,'Ketchup',0,1),(18,7,'Mustard',0,2),(19,7,'Mayo',0,3),(20,7,'BBQ',0,4),
(21,8,'Cheese',300,1),(22,8,'Bacon',500,2),(23,8,'Fried Egg',200,3),
(24,9,'Extra Cheese',300,1),(25,9,'Bacon',500,2),
(26,10,'Ketchup',0,1),(27,10,'Mustard',0,2),(28,10,'Mayo',0,3),(29,10,'BBQ',0,4),
(30,11,'Cheese',300,1),(31,11,'Bacon',500,2),
(32,12,'White Rice',0,1),(33,12,'Brown Rice',0,2),
(34,13,'Grilled Chicken',600,1),(35,13,'Avocado',400,2),
(36,14,'Parmesan',300,1),
(37,15,'Extra Shrimp',800,1),(38,15,'Peanuts',200,2),
(39,16,'Quinoa',0,1),(40,16,'Brown Rice',0,2),(41,16,'Mixed Grains',0,3);

-- accounts: BCrypt(cost 10); see README demo section
INSERT INTO users (id,email,password_hash,display_name,role) VALUES
(1,'admin@webox.com','$2b$10$tPTDIiDEm7wLmaCclGtbFuLqyP13aBM6Xu1rdo5SwiTT6QY7FBzbS','WeBox Admin','ADMIN'),
(2,'employee@webox.com','$2b$10$SfE7IXQu7pCsHignSZhfAuKfYB/YaQLlgvqS1jdNtDI4FDrKZzFBq','Demo Employee','EMPLOYEE');

INSERT INTO user_preferences (user_id, allergens, preferred_categories, spice_preference, taste_preference, recommend_enabled)
VALUES (2,'[]','[]',NULL,NULL,0);
INSERT INTO user_profile (user_id, order_count_30d, favorite_categories, avg_spend_cents, last_computed_at)
VALUES (2,0,'[]',0,NOW(3));
INSERT INTO addresses (user_id,address,usage_count,last_used_at)
VALUES (2,'Building A, 12F, WeBox HQ',1,NOW(3));

-- today: all 20 published; PRD 9 dishes stock 20-50; two hot dishes REDIS_PREALLOC
INSERT INTO daily_menu (dish_id,serve_date,publish_status,created_by)
SELECT id, CURDATE(), 'PUBLISHED', 1 FROM dishes;
INSERT INTO dish_daily_stock (dish_id,serve_date,total_qty,inventory_mode)
SELECT id, CURDATE(), CASE id WHEN 1 THEN 40 WHEN 2 THEN 30 WHEN 3 THEN 25 WHEN 4 THEN 35
  WHEN 5 THEN 20 WHEN 6 THEN 30 WHEN 7 THEN 45 WHEN 8 THEN 28 WHEN 9 THEN 22 ELSE 40 END,
  CASE WHEN id IN (1,9) THEN 'REDIS_PREALLOC' ELSE 'DB_ATOMIC' END
FROM dishes;
-- tomorrow and day+2: all 20 published, stock 40
INSERT INTO daily_menu (dish_id,serve_date,publish_status,created_by)
SELECT id, CURDATE() + INTERVAL 1 DAY, 'PUBLISHED', 1 FROM dishes;
INSERT INTO dish_daily_stock (dish_id,serve_date,total_qty,inventory_mode)
SELECT id, CURDATE() + INTERVAL 1 DAY, 40, 'DB_ATOMIC' FROM dishes;
INSERT INTO daily_menu (dish_id,serve_date,publish_status,created_by)
SELECT id, CURDATE() + INTERVAL 2 DAY, 'PUBLISHED', 1 FROM dishes;
INSERT INTO dish_daily_stock (dish_id,serve_date,total_qty,inventory_mode)
SELECT id, CURDATE() + INTERVAL 2 DAY, 40, 'DB_ATOMIC' FROM dishes;

INSERT INTO ai_rule_config (config_key,version,config_json,active,change_reason,created_by) VALUES
('recommend_weights',1,'{"preferredCategory":3,"spiceMatch":2,"budgetFit":2,"protein":1,"taste":1}',1,'initial rule weights',1);