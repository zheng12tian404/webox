# 04 · 数据库设计（MySQL 8）

> 来源：`docs/raw/data-model.md`；DDL：`backend/src/main/resources/db/schema.sql`；架构 DDL 执行证据：`artifacts/architecture-ddl-check.txt`。

---

# 数据模型 — WeBox（MySQL 8）

- 版本：v1.0（Architecture，2026-11-14 22:10 CST）
- 可执行 DDL + 种子：`docs/raw/schema.sql`（**已在 MySQL 8.0.46 实跑通过**，见 §9 证据）
- 库：`req_6343a752e110`；字符集 `utf8mb4`；金额 `BIGINT` 分；时间 `DATETIME(3)`；时区 `Asia/Shanghai`
- 原则：DB 为唯一事实源/库存账本；正确性靠唯一约束与条件 UPDATE，不依赖缓存或应用内锁

## 1. 表清单（17 张）

| # | 表 | 作用 | 关键约束 |
|---|---|---|---|
| 1 | `users` | 账号/角色 | `UNIQUE(email)`（ci 排序规则天然大小写不敏感）、`role IN EMPLOYEE/ADMIN` |
| 2 | `refresh_tokens` | 可撤销刷新令牌 | `UNIQUE(token_hash)` |
| 3 | `dishes` | 菜品主数据 | `CHECK price_cents>0`，`(status,category)` 索引；软删除仅 `OFF_SHELF` |
| 4 | `dish_option_groups` | 选项组（必选/可选、min/max） | FK→dishes，`CHECK max_select>=min_select` |
| 5 | `dish_options` | 选项与加价（分） | FK→groups，`CHECK price_delta_cents>=0` |
| 6 | `daily_menu` | 每日菜单发布 | `UNIQUE(dish_id,serve_date)`，`(serve_date,publish_status)` 索引 |
| 7 | `dish_daily_stock` | 每日库存计数器 | `PK(dish_id,serve_date)`，`CHECK reserved+sold<=total` |
| 8 | `orders` | 订单头 + 快照 + 唯一有效单 | `UNIQUE(order_no)`、`UNIQUE(active_key)`、`UNIQUE(user_id,idempotency_key)` |
| 9 | `order_items` | 明细快照（名称/单价/选项/小计） | FK→orders，`CHECK qty>=1` |
| 10 | `inventory_ledger` | 库存流水（账本） | `UNIQUE(business_key)` 防重复回补 |
| 11 | `idempotency_records` | 幂等键与响应快照 | `UNIQUE(user_id,idem_key)` |
| 12 | `user_preferences` | 显式偏好（事实源） | PK user_id，预算 `0<min<=max` |
| 13 | `user_profile` | 派生画像（仅软排序） | PK user_id |
| 14 | `addresses` | 地址簿 | `UNIQUE(user_id,address)` |
| 15 | `audit_log` | 审计（只增） | 应用层禁 update/delete |
| 16 | `ai_conversation` | AI 会话 | `(user_id,created_at)` 索引 |
| 17 | `ai_rule_config` | 规则版本/回滚 | `UNIQUE(config_key,version)`，`(config_key,active)` 索引 |

> 购物车无服务端表（A-10：Zustand+localStorage）；支付/退款无表（D22）。

## 2. 核心表字段与语义

### 2.1 orders（唯一有效单 + 幂等 + 快照）
```sql
active_key VARCHAR(80) GENERATED ALWAYS AS (
  CASE WHEN status IN ('Pending','Confirmed')
       THEN CONCAT(user_id,':',delivery_date,':',meal_type) ELSE NULL END) STORED,
UNIQUE KEY uk_orders_active (active_key)
```
- 生成列随 `status` 自动维护：Pending/Confirmed 占用，Cancelled/Completed 变 NULL → 可再下单（AC-027）。
- 冲突（errno 1062）→ 409 `ORDER_DUPLICATE` + 查 `(user_id,delivery_date,meal_type,status IN...)` 得 `existingOrderId`。
- `snapshot_json` 冻结整单；`order_items` 冻结 `dish_name/unit_price_cents/options_json/qty/subtotal_cents`（AC-055）。
- `UNIQUE(user_id,idempotency_key)` 是幂等第二道保险，主控在 `idempotency_records`。

### 2.2 dish_daily_stock（防超卖）
- 语义：`available = total_qty - reserved_qty - sold_qty`；下单 `reserved+=n`，取消 `reserved-=n`，确认 `reserved-=n,sold+=n`。
- 扣减必须是单条条件 UPDATE（影响行数=0 → 409）：
```sql
UPDATE dish_daily_stock
   SET reserved_qty = reserved_qty + ?, version = version + 1
 WHERE dish_id = ? AND serve_date = ?
   AND total_qty - reserved_qty - sold_qty >= ?;
```
- `CHECK (reserved_qty+sold_qty<=total_qty)` 为最后防线（错误码 3819 → 映射 409 `STOCK_INSUFFICIENT`，不返回 500）。
- `version` 供乐观并发/调试；`inventory_mode` 支持 `DB_ATOMIC`/`REDIS_PREALLOC`（每菜至少 1 个 REDIS 模式：种子 dish 1/9）。

### 2.3 inventory_ledger（只回补一次）
- `business_key` 例：`ORD:{orderId}:D:{dishId}:RESERVE`、`...:RELEASE`、`...:CONFIRM`；ADJUST 用 `ADJ:{uuid}`。
- 重复释放插入触发 `UNIQUE` 冲突 → 捕获忽略/告警，不再改库存（AC-018/019/060）。
- `before_available/after_available` 支持对账推导：`total - Σ(qty by type)` 应等于当前 `available`。

### 2.4 idempotency_records
- `UNIQUE(user_id,idem_key)`；`request_hash=SHA-256(canonical body)`；`COMPLETED` 保存 `response_status/response_body`（2xx 与业务 4xx），5xx/超时置 `FAILED` 允许重试；`expires_at=+24h`。
- 注意：`orders.UNIQUE(user_id,idempotency_key)` 为第二道保险，使键在该用户下**永久唯一**；`expires_at=+24h` 仅表示停止快照重放，过期后同键再提交在插入订单时命中 1062，必须映射为 409 `IDEMPOTENCY_CONFLICT`（不得当作新单）。`uk_orders_user_idem` 冲突不得复用 `ORDER_DUPLICATE` 码。

## 3. 索引与查询映射

| 查询 | 索引 |
|---|---|
| 登录/注册（email） | `uk_users_email` |
| 菜单 `(serve_date,publish_status)` + 分类 | `uk_menu_dish_date` / `idx_menu_date_status` + join dishes `idx_dishes_status_category` |
| 搜索 name/description LIKE | `idx_dishes_name`（前缀可用；子串查询 50 行可接受，>5k 换 FULLTEXT，ADR-005） |
| 我的订单 | `idx_orders_user_created(user_id,created_at)` |
| 唯一单冲突查询 | `uk_orders_active` |
| 库存扣减 | `PK(dish_id,serve_date)` 行锁 |
| ledger 对账 | `idx_ledger_dish_date` |
| 看板今日/趋势 | `idx_orders_date_meal_status` |
| 审计查询 | `idx_audit_object`、`idx_audit_created` |

## 4. 事务与锁

| 操作 | 事务内容 | 隔离 |
|---|---|---|
| 下单 | 幂等记录→唯一单检查→逐菜条件扣减→orders→items→ledger→幂等 COMPLETED | READ COMMITTED；行锁仅在 `dish_daily_stock` 行与幂等键 |
| 取消 | 状态 CAS `UPDATE orders SET status='Cancelled' WHERE id=? AND status='Pending'` 影响 1 行 → 回补 + ledger | 同上 |
| 管理员确认 | CAS `Pending→Confirmed`，`reserved-=n,sold+=n`，ledger `CONFIRM` | 同上 |
| 超时任务 | 批量查 Pending>30min，逐单独立事务 CAS+释放 | 单条短事务，无长锁 |
| 每日菜单/库存调整 | `daily_menu` upsert + `dish_daily_stock` upsert + audit 同事务 | 单事务 |
| 死锁 | 扣减按 `dish_id` 升序循环，降低交叉锁；捕获 1213 重试 1 次 | — |

## 5. 种子数据（D1/D20/D21）

| 项 | 内容 |
|---|---|
| 菜品 | 20 道英文菜：9 道 PRD + 11 道补充；`docs/raw/schema.sql` 显式 id 1–20 |
| 选项 | 16 组 / 41 个选项；含 Burger 的 Bun+Sauce 必选组、Cheese/Bacon 加价 |
| 图片 | `docs/raw/product_images/image_NN_*.jpg` → 复制并重命名为 `frontend/public/images/image_NN.jpg`，种子绑定 `/images/image_NN.jpg`；缺图占位 |
| 当日菜单 | 20 道全部 PUBLISHED；前 9 道库存 20–50（40/30/25/35/20/30/45/28/22），其余 40 |
| 未来菜单 | `CURDATE()+1`、`+2` 各 20 道、库存 40（支撑截单切次日与日期选择） |
| 库存模式 | dish 1（Kung Pao）、dish 9（Burger）= `REDIS_PREALLOC`，其余 `DB_ATOMIC`（AC-043） |
| 账号 | `admin@webox.com/Admin12345`（ADMIN）、`employee@webox.com/Employee123`（EMPLOYEE），BCrypt cost 10，`$2b$` 前缀 |
| 偏好/地址 | employee 空偏好 + 1 条地址 |
| AI 规则 | `recommend_weights` v1 active |
| 历史订单 | 默认不种（看板趋势点=7 且可为 0）；测试用 `tests/` 自建（AC-038 近 7 天过滤、AC-042 看板需下单后验证） |

> **种子日期注意**：`CURDATE()` 在迁移执行时求值；跨天演示前执行 `scripts/reseed_today.sql`（等价替换当日/次日菜单与库存）即可保持“当日可下单”。此点写入 README。

## 6. 初始化与迁移

- 方案：Flyway（推荐）`backend/src/main/resources/db/migration/`：
  - `V1__schema.sql`（本文件 §2 DDL 拆表部分）
  - `V2__seed.sql`（本文件 §5 种子）
- 备选：`schema.sql + data.sql`（Spring SQL init）。二选一，不混用；README 给出从零步骤：建库 → 启动后端自动迁移 → 启动前端。
- 幂等初始化：所有 DDL 使用 `CREATE TABLE`（Flyway 版本管理，无需 IF NOT EXISTS）；种子仅执行一次。

## 7. 与 AC 的约束映射

| AC | 支撑 |
|---|---|
| AC-001/002/050 | `users.email` 唯一 + BCrypt |
| AC-015 | `idempotency_records.UNIQUE(user_id,idem_key)` + `orders.UNIQUE(user_id,idempotency_key)` |
| AC-026/027 | `orders.uk_orders_active` 生成列 |
| AC-035 | 条件 UPDATE + `ck_stock_nonneg` |
| AC-018/019/037/060 | `inventory_ledger.UNIQUE(business_key)` + 状态 CAS |
| AC-055 | `order_items` 快照列 + `orders.snapshot_json` |
| AC-038 | `dishes.allergens JSON` + 近 7 天订单查询（`idx_orders_user_created`） |
| AC-042 | `idx_orders_date_meal_status` |
| AC-044 | ledger 全量流水 + `before/after_available` |

## 8. 已知取舍

- `allergens` 用 JSON 而非子表：20–50 菜规模，`JSON_CONTAINS` 足够；含过敏原过滤用应用层解析（候选集 ≤50）。若菜品量级增大，改 `dish_allergens(dish_id,allergen)` 子表（ADR 失效条件）。
- `daily_menu` 与 `dish_daily_stock` 分表：菜单发布（低频写）与库存（高频写）分离，避免热行争用；管理端单事务双写（G1-06）。
- 历史订单不预置：避免手工构造 ledger 造成对账假象；演示前通过 API 下单生成真实数据。

## 9. DDL 执行证据（MySQL 8.0.46）

```text
$ mysql ... -e "CREATE DATABASE req_6343a752e110_ddlcheck"
$ mysql ... req_6343a752e110_ddlcheck < docs/raw/schema.sql   # 无错误
tables=17  dishes=20  option_groups=16  options=41
menu_today=20  stock_today=20  stock_future=40
active_key = '2:2026-11-14:Lunch'
重复有效单 → ERROR 1062 'Duplicate entry ... for key orders.uk_orders_active'   # 唯一有效单生效
取消后 active_key=NULL，可再次下单成功                                              # AC-027
reserved_qty>total_qty → ERROR 3819 ck_stock_nonneg violated                       # 防超卖最后防线
```
完整输出留存：`artifacts/architecture-ddl-check.txt`。校验用 scratch 库 `req_6343a752e110_ddlcheck` 已删除，未污染目标库 `req_6343a752e110`。