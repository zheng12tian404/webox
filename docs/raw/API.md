# WeBox API — 实现说明（v1.1 契约对齐）

基地址：`/api/v1`；实现：Spring Boot 3.3 + JdbcTemplate；契约唯一锚点：`docs/api-contract.md`。
全部响应 HTTP 200/201/4xx + 包络 `{"code","message","data","requestId"}`；`requestId` 同值写入 `X-Request-Id`。
分页 `page`（≥1，默认 1）/`size`（1–100，默认 20）；越界 400 `VALIDATION_PAGINATION`。
金额 `*Cents` 为 long 分；`priceDisplay` 形如 `¥22.50`。时间 `Asia/Shanghai`，时间戳 ISO-8601 带 `+08:00`。

## 1. 认证与用户（10）

| # | 方法 路径 | 权限 | 请求 | 成功 data |
|---|---|---|---|---|
| 1 | POST `/auth/register` | 公开 | `{email≤200,password 8–64(字母+数字),displayName≤100?}` | 201 `{id,email,role:"EMPLOYEE"}` |
| 2 | POST `/auth/login` | 公开 | `{email,password}` | `{accessToken,refreshToken,expiresIn:7200,user:{id,email,role}}`；10/min/ip+email、20/min/ip 限流 |
| 3 | POST `/auth/refresh` | 公开 | `{refreshToken}` | 新 token 对；**轮换**，旧 refresh 立即失效 |
| 4 | POST `/auth/logout` | 登录 | `{refreshToken}` | `{}`（幂等撤销） |
| 5 | GET `/auth/me` | 登录 | — | `{id,email,role,displayName}` |
| 6 | GET `/me/preferences` | 登录 | — | `{allergens[],preferredCategories[],spicePreference,tastePreference,budgetMinCents,budgetMaxCents,recommendEnabled}` |
| 7 | PUT `/me/preferences` | 登录 | 同上全量 | 保存后对象；枚举/预算 `0<min≤max` 校验 |
| 8 | GET `/me/addresses` | 登录 | — | `[{id,address,lastUsedAt}]`（last_used_at DESC） |
| 9 | POST `/me/addresses` | 登录 | `{address≤200}` | 201 `{id,address}`；重复地址返回已有 |
| 10 | DELETE `/me/addresses/{id}` | 登录 | — | `{deleted:true}`；他人/不存在 404 |

错误：400 `VALIDATION_EMAIL_FORMAT|EMAIL_LENGTH|PASSWORD_POLICY|ADDRESS_LENGTH`，401 `AUTH_INVALID_CREDENTIALS|AUTH_TOKEN_INVALID`，409 `AUTH_EMAIL_EXISTS`，429 `RATE_LIMITED`。

## 2. 菜单与库存流（6）

| # | 方法 路径 | 权限 | 请求 | data |
|---|---|---|---|---|
| 11 | GET `/menu` | 登录 | `date?,page,size,category*(逗号),search≤50,sort=default\|for-you` | `{items:[{dishId,name,description,priceCents,priceDisplay,category,spiceLevel,imageUrl,available:boolean,availableQty:int,lowStock,soldOut,hasOptions,hasRequiredOptions,forYou}],page,size,total}` |
| 12 | GET `/menu/{dishId}` | 登录 | — | 详情 + `protein,allergens[],optionGroups[{groupId,name,required,minSelect,maxSelect,options[{optionId,name,priceDeltaCents}]}]`；非当日/下架 404 `DISH_NOT_FOUND` |
| 13 | GET `/menu/filters` | 登录 | — | `{categories[],spiceLevels[],allergens[],dates:[{date,published}]}`（today/+1/+2） |
| 14 | GET `/menu/stream` | 登录（Bearer 或 ticket） | `date?`，`Accept: text/event-stream` | `event:snapshot` 单行数组 `[{dishId,available:int}]`；`event:stock` `{dishId,available}`；15s `: ping`；`retry:3000` |
| 15 | POST `/menu/stream-ticket` | 登录 | — | `{ticket,expiresIn:60}`；绑定 userId+IP，60s 内最多兑换 3 次，第 4 次 401 |
| 16 | GET `/health` | 公开 | — | `{status,db,redis,cache}`；DB 不可用 503 |

低库存判定：`lowStock = 0 < availableQty <= 3`；`soldOut = availableQty == 0`。搜索为参数化/内存过滤，`%_\` 已转义；注入串返回空列表 200。

## 3. 订单（7）

| # | 方法 路径 | 权限 | 请求 | data |
|---|---|---|---|---|
| 17 | POST `/orders/preview` | 登录 | `{items[{dishId,qty,optionIds[]}],deliveryDate?,mealType?,address?}` | `{items[{dishName,options[{name,priceDeltaCents}],qty,unitPriceCents,subtotalCents}],totalCents,itemCount,effectiveDate,effectiveMeal,cutoffAt,autoSwitched,budgetExceeded,existingOrderId?,addresses[]}`；**不锁库存、库存不足不报 409** |
| 18 | POST `/orders` | 登录 + `Idempotency-Key`(8–64) | 同 17；`address` 必填 1–200；`confirmAutoSwitch?` | 201 `{orderId,orderNo,status:"Pending",deliveryDate,mealType,address,totalCents,itemCount,autoSwitched,estimatedDelivery}` |
| 19 | GET `/orders` | 登录 | `page,size,status?` | 本人订单分页 `{items:[{orderId,orderNo,status,totalCents,itemCount,deliveryDate,mealType,createdAt}],page,size,total}` |
| 20 | GET `/orders/{orderId}` | SELF；ADMIN ALL | — | `{orderId,orderNo,status,deliveryDate,mealType,address,totalCents,itemCount,createdAt,cancelledAt?,cancelReason?,items:[{dishId,dishName,unitPriceCents,options[{name,priceDeltaCents}],qty,subtotalCents}]}`；他人 404 |
| 21 | GET `/orders/active` | 登录 | `date,mealType` | `{orderId,orderNo,status}` 或 `data:null` |
| 22 | POST `/orders/{orderId}/cancel` | SELF（仅 Pending）/ADMIN | `{reason?≤200}` | `{orderId,status:"Cancelled",cancelledAt}`；管理员取消需 reason（400 `VALIDATION_REASON_REQUIRED`） |
| 23 | GET `/admin/orders` | ADMIN | `page,size,status?,date?` | 地址脱敏 `***` |
| 24 | PATCH `/admin/orders/{orderId}/status` | ADMIN | `{toStatus,confirm:true,reason 1–200}` | 合法：Pending→Confirmed / Confirmed→Completed / Pending→Cancelled；其余 409 `ORDER_STATE_INVALID`；同事务 reserved→sold 或释放 + 审计 |

下单规则：
- 服务端按 DB 单价+选项加价重算，忽略客户端价格；订单明细冻结快照。
- 总份数 Σqty ≤ 5 → 400 `ORDER_LIMIT_EXCEEDED`；qty 1–5 → `VALIDATION_QUANTITY`；必选组/归属 → `VALIDATION_OPTION_REQUIRED|OPTION_INVALID`。
- 截单：Lunch 10:00、Dinner 15:00（Asia/Shanghai），`now >= cutoff` 即关闭并自动切最近餐次（当日晚餐未过 15:00 → 当日晚餐，否则次日午餐），响应回显 `autoSwitched` 与生效餐次。
- 唯一有效单：同用户+生效日+生效餐次已有 Pending/Confirmed → 409 `ORDER_DUPLICATE` + `{existingOrderId,existingOrderNo}`。
- 库存不足：409 `STOCK_INSUFFICIENT` + `{details:[{dishId,requested,available}]}`。
- 幂等：同键同体返回首次状态/body（含 201/409）；同键异体 409 `IDEMPOTENCY_CONFLICT`；键永久唯一，24h 仅停止快照重放；仅 5xx 可同键重试。

## 4. Console 菜品/每日菜单/库存/看板/审计/AI 规则（13）

| # | 方法 路径 | 权限 | 请求 | data |
|---|---|---|---|---|
| 25 | GET `/admin/dishes` | ADMIN | `page,size,search≤50,category?,status?` | 含 OFF_SHELF；`dishId,name,description,priceCents,category,protein,allergens,spiceLevel,imageUrl,status` |
| 26 | POST `/admin/dishes` | ADMIN | `{name≤100,description≤1000,priceCents>0,category,protein≤50,allergens[],spiceLevel,imageUrl?}` | 201 `{dishId}` |
| 27 | PUT `/admin/dishes/{dishId}` | ADMIN | 同 26 + `{confirm:true,reason 1–200}` | 菜品；审计 before/after |
| 28 | PATCH `/admin/dishes/{dishId}/status` | ADMIN | `{status:ON_SHELF\|OFF_SHELF,confirm,reason}` | `{dishId,status}` |
| 29 | POST `/admin/dishes/{dishId}/image` | ADMIN | multipart `file` ≤5MB | `{imageUrl}`；魔数校验 jpg/png/webp，非法 400 `VALIDATION_IMAGE` |
| 30 | GET `/admin/daily-menu` | ADMIN | `date?`（默认次日） | `[{dishId,dishName,totalQty,reservedQty,soldQty,available:int,lowStock,inventoryMode,published}]` |
| 31 | PUT `/admin/daily-menu` | ADMIN | `{serveDate,totalQty?,items[{dishId,published,totalQty,inventoryMode?}],confirm,reason}` | 单事务 upsert；total<reserved+sold → 409 |
| 32 | PUT `/admin/daily-menu/{serveDate}/{dishId}/stock` | ADMIN | `{totalQty≥0,confirm,reason}` | `{dishId,serveDate,totalQty,available}`；不得低于 reserved+sold（409） |
| 33 | GET `/admin/inventory/reconcile` | ADMIN | `date` | `{date,checked,drift:[{dishId,bookAvailable,ledgerDerived}]}` |
| 33b | POST `/admin/inventory/adjust` | ADMIN | `{dishId,serveDate,delta,confirm,reason}` | `{dishId,serveDate,available}`；写 ADJUST + 审计 |
| 34 | GET `/admin/dashboard` | ADMIN | `date?` | `{today:{orders,revenueCents,completed,pending,cancelled},topDishes,mealSplit:{lunch,dinner},trend[7],lowStock}`；orders/revenue 仅非 Cancelled，lowStock `0<=available<=3` |
| 35 | GET `/admin/audit-logs` | ADMIN | `page,size,action?,objectType?` | 审计分页（before/after JSON、ip、requestId） |
| 36 | GET `/admin/ai-rules` | ADMIN | — | `{configKey,version,config,updatedAt}` |
| 37 | PUT `/admin/ai-rules` | ADMIN | `{configKey,config,confirm,reason,rollbackToVersion?}` | 新 version 激活；回滚复制历史为新版本，历史行不变；审计 |

审计字段：actor_id/email、action、object_type/id、before_json、after_json、reason、ip、request_id、created_at；与业务写同事务。

## 5. AI 推荐（1）

| # | 方法 路径 | 权限 | 请求 | 响应 |
|---|---|---|---|---|
| 38 | POST `/ai/recommend` | 登录，10/min | `{prompt≤500,sessionId?}`，`Accept: text/event-stream` | `meta{fallback,model,sessionId}` → `dish{dishId,name,priceCents,priceDisplay,category,available}` ×N → `reason{dishId,text}` ×N → `done{dishIds[]}` |

- 候选集先由确定性代码过滤：上架、当日有库存、排除用户过敏原、排除近 7 天已点；模型只做排序/理由，价格/库存/权限不由模型决定。
- 无 `LLM_API_KEY`：1s 内规则推荐，`meta.fallback=true`；LLM 调用异常同样降级，不 500。规则权重取 `ai_rule_config` active 版本；落 `ai_conversation`。

## 6. 错误码

400 `VALIDATION_*`（EMAIL_FORMAT/EMAIL_LENGTH/PASSWORD_POLICY/ADDRESS_LENGTH/SEARCH_LENGTH/REASON_REQUIRED/CATEGORY/PAGINATION/QUANTITY/OPTION_REQUIRED/OPTION_INVALID/DATE_PAST/TEST_CLOCK_FORBIDDEN/IMAGE/INVALID）、`IDEMPOTENCY_KEY_REQUIRED`、`ORDER_LIMIT_EXCEEDED`；401 `AUTH_UNAUTHORIZED|AUTH_TOKEN_INVALID|AUTH_INVALID_CREDENTIALS`；403 `FORBIDDEN`；404 `NOT_FOUND|ORDER_NOT_FOUND|DISH_NOT_FOUND`；409 `AUTH_EMAIL_EXISTS|ORDER_DUPLICATE|ORDER_STATE_INVALID|ORDER_MEAL_UNAVAILABLE|STOCK_INSUFFICIENT|IDEMPOTENCY_CONFLICT`；429 `RATE_LIMITED`；500 `INTERNAL`。

统一异常处理不回显堆栈/SQL/密钥；`requestId` 用于日志关联。

## 7. 测试钩子与隔离

- `X-Test-Clock: 2026-11-14T10:00:00+08:00` 仅在 `test` profile 且 `TEST_CLOCK_ENABLED=true` 生效；其他情况 **400 `VALIDATION_TEST_CLOCK_FORBIDDEN`**。
- 集成测试与并发脚本连接 `req_6343a752e110_test`；`WeBoxApiIT` 会在清理前断言 `SELECT DATABASE()` 以 `_test` 结尾。
- `scripts/reset_test.sql` 仅测试库；演示库重置必须 `ALLOW_DEMO_RESET=1`（`scripts/reset_demo.sh`）。