# API 契约 — WeBox 员工餐食订购平台 `/api/v1`

- 版本：v1.1（Architecture，2026-11-14 22:12 CST，G3 契约回写；v1.0 初稿 22:09）｜配套：`docs/architecture.md`、`docs/data-model.md`
- 消费者：前端 SPA（Stage 3 前端方案以此为准）、后端 BTL（Stage 3 实现以此为准）

## 1. 统一约定

| 项 | 约定 |
|---|---|
| 基础路径 | `/api/v1`；JSON UTF-8；用户可见 `message` 一律英文 |
| 鉴权 | `Authorization: Bearer <JWT>`；access 2h，refresh 7d；无 token/过期 401 `AUTH_UNAUTHORIZED`/`AUTH_TOKEN_INVALID`；角色 `EMPLOYEE`/`ADMIN` |
| 响应包络 | `{"code":"OK","message":"...","data":{},"requestId":"uuid"}`；**全部响应（含删除/登出）使用 HTTP 200 + 包络，不使用 204**；`requestId` 同步写入响应头 `X-Request-Id`（同值，MDC 生成），并以 `Access-Control-Expose-Headers: X-Request-Id` 暴露 |
| 分页 | 请求 `page`（≥1，默认 1）、`size`（1–100，默认 20）；响应 `data:{items:[],page,size,total}`；越界 400 `VALIDATION_PAGINATION` |
| 金额 | 全部 `*Cents` 为整数（BIGINT 分）；另给展示串 `priceDisplay:"¥22.50"`；服务端按 DB 重算，忽略客户端价格 |
| 时间 | 日期 `YYYY-MM-DD`；时间戳 ISO-8601 `2026-11-14T22:00:00+08:00`；时区 `Asia/Shanghai` |
| 枚举 | category: `Chinese,Western,Japanese,Light Meal,Korean,Southeast Asian`；spice: `None,Mild,Medium,Hot`；allergen: `Peanuts,Dairy,Egg,Gluten,Soy,Fish,Shellfish`；meal: `Lunch,Dinner`；order status: `Pending,Confirmed,Completed,Cancelled` |
| 幂等 | `POST /orders` 必带 `Idempotency-Key`（8–64）；缺失 400；同键同体重放首次结果；异体 409 `IDEMPOTENCY_CONFLICT`；快照保留 24h。`orders.UNIQUE(user_id,idempotency_key)` 使键在该用户下**永久唯一**：24h 后仅停止快照重放，同键再次提交返回 409 `IDEMPOTENCY_CONFLICT`（不复用旧响应、不下新单） |
| 版本兼容 | 仅 `/api/v1`；新增可选字段不破坏兼容；删除/改义需 `/v2` |
| CORS | 允许 `Origin=http://localhost:5173`，头 `Authorization,Idempotency-Key,Content-Type` |
| 测试钩子 | `X-Test-Clock: 2026-11-14T10:00:00+08:00`（仅 `test` profile + `webox.test.clock-enabled=true`；非 test profile 或开关关闭时返回 400 `VALIDATION_TEST_CLOCK_FORBIDDEN`（不静默忽略））；用于 AC-024/025/060 |

### 1.1 错误码全集

| HTTP | code | 场景 |
|---|---|---|
| 400 | `VALIDATION_*` | `EMAIL_FORMAT`/`EMAIL_LENGTH`/`PASSWORD_POLICY`/`ADDRESS_LENGTH`/`SEARCH_LENGTH`/`REASON_REQUIRED`（实际码 `VALIDATION_REASON_REQUIRED`）/`CATEGORY`/`PAGINATION`/`QUANTITY`/`OPTION_REQUIRED`/`OPTION_INVALID`/`CONFIRM_REQUIRED`（实际码 `VALIDATION_CONFIRM_REQUIRED`，高风险写操作 `confirm!=true`）/`DATE_PAST`/`TEST_CLOCK_FORBIDDEN`/`IMAGE` |
| 401 | `AUTH_UNAUTHORIZED` / `AUTH_TOKEN_INVALID` / `AUTH_INVALID_CREDENTIALS` | 未登录 / token 无效 / 密码错 |
| 403 | `FORBIDDEN` | 员工访问 `/admin/**`、越权访问他人资源 |
| 404 | `NOT_FOUND` / `ORDER_NOT_FOUND` / `DISH_NOT_FOUND` | 资源不存在（他人订单统一 404 防枚举） |
| 409 | `AUTH_EMAIL_EXISTS` / `ORDER_DUPLICATE` / `ORDER_STATE_INVALID` / `ORDER_MEAL_UNAVAILABLE` / `STOCK_INSUFFICIENT` / `IDEMPOTENCY_CONFLICT` | 业务冲突 |
| 400 | `ORDER_LIMIT_EXCEEDED` / `IDEMPOTENCY_KEY_REQUIRED` | 规则拒绝 |
| 429 | `RATE_LIMITED` | 登录/下单/AI 超限 |
| 503 | `SERVICE_DEGRADED` | L3 维护/写阻断（`webox.degrade.write-block=true`）；只读接口仍可用 |
| 500 | `INTERNAL` | 未预期异常（无堆栈/SQL/密钥泄漏） |

## 2. 端点清单（39 个 = #1–#38 + #33b）

### 2.1 认证 / 用户（AC-001~005、048、051）

| # | 方法 路径 | 权限 | 请求 | 响应 data | 错误 |
|---|---|---|---|---|---|
| 1 | POST `/auth/register` | 公开 | `{email≤200, password 8–64(字母+数字), displayName≤100?}` | `{id,email,role:"EMPLOYEE"}` 201 | 400 VALIDATION_*，409 AUTH_EMAIL_EXISTS |
| 2 | POST `/auth/login` | 公开 | `{email,password}` | `{accessToken,refreshToken,expiresIn(秒),user:{id,email,role}}` | 401 AUTH_INVALID_CREDENTIALS，429 RATE_LIMITED |
| 3 | POST `/auth/refresh` | 公开（refresh token） | `{refreshToken}` | 新 token 对（**每次轮换 refreshToken，旧值立即失效**） | 401 AUTH_TOKEN_INVALID |
| 4 | POST `/auth/logout` | 登录 | `{refreshToken}` | `{}` | 401 |
| 5 | GET `/auth/me` | 登录 | — | `{id,email,role,displayName}` | 401 |
| 6 | GET `/me/preferences` | 登录 | — | `{allergens[],preferredCategories[],spicePreference,tastePreference,budgetMinCents,budgetMaxCents,recommendEnabled}` | 401 |
| 7 | PUT `/me/preferences` | 登录 | 同上（全量） | 保存后对象 | 400 VALIDATION_CATEGORY / 预算 `0<min≤max` |
| 8 | GET `/me/addresses` | 登录 | — | `[{id,address,lastUsedAt}]` | 401 |
| 9 | POST `/me/addresses` | 登录 | `{address≤200}` | `{id,address}` 201 | 400 VALIDATION_ADDRESS_LENGTH |
| 10 | DELETE `/me/addresses/{id}` | 登录 | — | `{deleted:true}` 200 | 404 |

### 2.2 菜单 / 库存（AC-006~010、022、030、034、036）

| # | 方法 路径 | 权限 | 请求 | 响应 data | 错误 |
|---|---|---|---|---|---|
| 11 | GET `/menu` | 登录 | `date?`(默认当日) `page,size,category*(多值逗号),search≤50,sort=default|for-you` | `{items:[{dishId,name,description,priceCents,priceDisplay,category,spiceLevel,imageUrl,available:boolean,availableQty:int,lowStock,soldOut,hasOptions:boolean,hasRequiredOptions:boolean,forYou}],page,size,total}` | 400 VALIDATION_CATEGORY/SEARCH_LENGTH/PAGINATION；401 |
| 12 | GET `/menu/{dishId}` | 登录 | — | `{dishId,name,description,priceCents,priceDisplay,category,protein,allergens[],spiceLevel,imageUrl,available:boolean,availableQty:int,optionGroups:[{groupId,name,required,minSelect,maxSelect,options:[{optionId,name,priceDeltaCents}]}]}` | 404 DISH_NOT_FOUND（下架/非当日菜单） |
| 13 | GET `/menu/filters` | 登录 | — | `{categories[],spiceLevels[],allergens[],dates:[{date,published:boolean}]}`（`dates` 覆盖 today/+1/+2，结算页日期选择唯一数据源，不新增端点） | 401 |
| 14 | GET `/menu/stream` | 登录（Bearer 或 ticket） | SSE；可选 `date` | `event: snapshot` → 单行 JSON 数组 `[{dishId,available:int}]`；`event: stock` → `{dishId,available:int}`；15s 心跳 | 401 |
| 15 | POST `/menu/stream-ticket` | 登录 | — | `{ticket,expiresIn:60}`；绑定 userId+IP，60s 内最多兑换 3 次，超限 401 | 401 |
| 16 | GET `/health` | 公开 | — | `{status:"UP",db:"UP",redis:"UP|DOWN",cache:"UP"}` | 503（db down） |

### 2.3 订单（AC-013~020、024~027、034、035、037、053~055、060）

| # | 方法 路径 | 权限 | 请求 | 响应 data | 错误 |
|---|---|---|---|---|---|
| 17 | POST `/orders/preview` | 登录 | `{items:[{dishId,qty,optionIds[]}],deliveryDate?,mealType?,address?}` | `{items:[{dishName,options:[{name,priceDeltaCents}],qty,unitPriceCents,subtotalCents}],totalCents,itemCount,effectiveDate,effectiveMeal,cutoffAt,autoSwitched,budgetExceeded,existingOrderId?,addresses[]}` | 400 ORDER_LIMIT_EXCEEDED/VALIDATION_QUANTITY/OPTION_*/DATE_PAST；409 ORDER_MEAL_UNAVAILABLE |
| 18 | POST `/orders` | 登录 + `Idempotency-Key` | 同 17 且 `address` 必填 1–200 + `{confirmAutoSwitch?:true}`（仅兼容；服务端始终按提交时刻自动切换） | `{orderId,orderNo,status:"Pending",deliveryDate,mealType,address,totalCents,itemCount,autoSwitched,estimatedDelivery}` 201 | 400 IDEMPOTENCY_KEY_REQUIRED/ORDER_LIMIT_EXCEEDED，409 IDEMPOTENCY_CONFLICT/ORDER_DUPLICATE(+existingOrderId)/STOCK_INSUFFICIENT(+details[{dishId,requested,available}])/ORDER_MEAL_UNAVAILABLE |
| 19 | GET `/orders` | 登录 | `page,size,status?` | 本人订单分页（`orderNo,status,totalCents,itemCount,deliveryDate,mealType,createdAt`） | 401 |
| 20 | GET `/orders/{orderId}` | 登录（SELF；ADMIN ALL） | — | `{orderId,orderNo,status,deliveryDate,mealType,address,totalCents,itemCount,createdAt,cancelledAt?,cancelReason?,items:[{dishId,dishName,unitPriceCents,options:[{name,priceDeltaCents}],qty,subtotalCents}]}`（项均来自 `order_items` 冻结快照） | 404 ORDER_NOT_FOUND |
| 21 | GET `/orders/active` | 登录 | `date,mealType` | `{orderId,orderNo,status}` 或 `data:null` | 401 |
| 22 | POST `/orders/{orderId}/cancel` | 登录（本人：仅 `Pending`）/ADMIN | `{reason?≤200}` | `{orderId,status:"Cancelled",cancelledAt}` | 409 ORDER_STATE_INVALID；404 |
| 23 | GET `/admin/orders` | ADMIN | `page,size,status?,date?` | 列表（地址脱敏 `***`） | 403 |
| 24 | PATCH `/admin/orders/{orderId}/status` | ADMIN | `{toStatus:"Confirmed"|"Completed"|"Cancelled",confirm:true,reason 1–200}`；合法迁移：`Pending→Confirmed`、`Confirmed→Completed`、`Pending→Cancelled`；其余（`Confirmed→Cancelled`、`Completed→*`、同态）→409 | 更新后订单 | 400 VALIDATION_REASON_REQUIRED；409 ORDER_STATE_INVALID |

### 2.4 Console 菜品 / 每日菜单 / 看板 / 审计（AC-028~033、042、044）

| # | 方法 路径 | 权限 | 请求 | 响应 data | 错误 |
|---|---|---|---|---|---|
| 25 | GET `/admin/dishes` | ADMIN | `page,size,search≤50,category?,status?` | 菜品分页（含 OFF_SHELF）；每行含全部可编辑字段 `dishId,name,description,priceCents,category,protein,allergens,spiceLevel,imageUrl,status`（不新增详情端点） | 403 |
| 26 | POST `/admin/dishes` | ADMIN | `{name≤100,description≤1000,priceCents>0,category,protein≤50,allergens[],spiceLevel,imageUrl?}` | `{dishId}` 201 | 400 VALIDATION_* |
| 27 | PUT `/admin/dishes/{dishId}` | ADMIN | 同 26 + `{confirm:true,reason 1–200}` | 菜品 | 400 VALIDATION_REASON_REQUIRED |
| 28 | PATCH `/admin/dishes/{dishId}/status` | ADMIN | `{status:"ON_SHELF"|"OFF_SHELF",confirm:true,reason}` | `{dishId,status}` | 400/403 |
| 29 | POST `/admin/dishes/{dishId}/image` | ADMIN | multipart `file` ≤5MB jpg/png/webp | `{imageUrl}` | 400 VALIDATION_IMAGE |
| 30 | GET `/admin/daily-menu` | ADMIN | `date`（默认次日，**允许当日/过去日期，不做 DATE_PAST 校验**） | `[{dishId,dishName,totalQty,reservedQty,soldQty,available:int,lowStock:boolean,inventoryMode,published}]` | 403 |
| 31 | PUT `/admin/daily-menu` | ADMIN | `{serveDate,totalQty,items:[{dishId,published,totalQty,inventoryMode?}],confirm:true,reason}` | 保存结果 | 400/403 |
| 32 | PUT `/admin/daily-menu/{serveDate}/{dishId}/stock` | ADMIN | `{totalQty≥0,confirm:true,reason}` | `{dishId,serveDate,totalQty,available}` | 400；409 若 <reserved+sold |
| 33 | GET `/admin/inventory/reconcile` | ADMIN | `date` | `{date,checked,drift:[{dishId,bookAvailable,ledgerDerived}]}` | 403 |
| 33b | POST `/admin/inventory/adjust` | ADMIN | `{dishId,serveDate,delta,confirm:true,reason 1–200}` | `{dishId,serveDate,available}`；写 ADJUST 流水+审计 | 400；409 若调整后 <reserved+sold |
| 34 | GET `/admin/dashboard` | ADMIN | `date?`(默认今日)；口径：`today.orders`/`trend[].orders`/`mealSplit` 均为**非 Cancelled 订单数**，`revenueCents` 仅非 Cancelled，`lowStock` 为 `0<=available<=3` | `{today:{orders,revenueCents,completed,pending,cancelled},topDishes:[{dishId,name,soldQty}],mealSplit:{lunch,dinner},trend:[{date,orders,revenueCents}×7],lowStock:[{dishId,name,available}]}` | 403 |
| 35 | GET `/admin/audit-logs` | ADMIN | `page,size,action?,objectType?` | 审计分页（before/after JSON） | 403 |
| 36 | GET `/admin/ai-rules` | ADMIN | — | `{configKey,version,config,updatedAt}` | 403 |
| 37 | PUT `/admin/ai-rules` | ADMIN | `{configKey,config,confirm:true,reason,rollbackToVersion?:int}` | 新版本；带 `rollbackToVersion` 时复制该历史版本为新 version 并置 active，历史行不可变，审计留痕 | 400/403 |

### 2.5 AI（Tier 3，AC-038~041）

| # | 方法 路径 | 权限 | 请求 | 响应 | 错误 |
|---|---|---|---|---|---|
| 38 | POST `/ai/recommend` | 登录 | `{prompt≤500, sessionId?}`，`Accept: text/event-stream` | SSE：`meta` `{fallback:boolean,model,sessionId}` → `dish` `{dishId,name,priceCents,priceDisplay,category,available}`×N → `reason` `{dishId,text}`×N → `done` `{dishIds[]}`；无 Key：`fallback:true` + 规则顺序 | 429 RATE_LIMITED；401 |

> 说明：购物车无服务端端点（A-10：Zustand+localStorage），但 `preview`/`orders` 均服务端全量校验。端点合计 **39**（#1–#38 + #33b，含 health）。

## 3. 关键契约细节

### 3.1 下单与截单（AC-014/015/016/020/024/025/026/034/035）
```json
// POST /api/v1/orders   Header: Authorization, Idempotency-Key: 6f1c...c9
{
  "items": [{"dishId": 9, "qty": 2, "optionIds": [11, 14, 17]}],
  "deliveryDate": "2026-11-14",
  "mealType": "Lunch",
  "address": "Building A, 12F",
  "confirmAutoSwitch": true
}
// 201
{"code":"OK","message":"Order placed","data":{
  "orderId":101,"orderNo":"WB20261114-0001","status":"Pending",
  "deliveryDate":"2026-11-14","mealType":"Lunch","autoSwitched":false,
  "totalCents":8200,"itemCount":2,"estimatedDelivery":"Lunch on 2026-11-14"},
 "requestId":"..."}
```
- 服务端只读取 `dishId/qty/optionIds`；单价/加价/总价按 DB 重算，忽略任何客户端价格字段（AC-016）。
- 总份数 = Σqty ≤5，否则 400 `ORDER_LIMIT_EXCEEDED`（AC-020）。
- 截单按服务端时钟判定，等于截单点即关闭；自动切换后响应 `effectiveDate/effectiveMeal/autoSwitched=true`（AC-024/025）。
- 同 `(user, effectiveDate, effectiveMeal)` 已有 Pending/Confirmed → 409：
```json
{"code":"ORDER_DUPLICATE","message":"An active order already exists for this meal",
 "data":{"existingOrderId":88,"existingOrderNo":"WB20261114-0008"},"requestId":"..."}
```
- **preview（#17）语义**：只做算价/截单/限购/选项校验，**不锁库存、不因库存不足返回 409**；生效餐次已有有效单时返回 `existingOrderId`。submit（#18）始终按提交时刻重算并自动切换，`confirmAutoSwitch` 仅兼容、服务端不据此拒绝。
- **状态机（#22/#24）**：`Pending→Confirmed`（reserved-=n, sold+=n, ledger CONFIRM）｜`Confirmed→Completed`（无库存副作用）｜`Pending→Cancelled`（reserved-=n, ledger RELEASE）｜其余迁移与同态 → 409 `ORDER_STATE_INVALID`。
- 员工 #22 `reason` 可选（≤200，写 `cancel_reason`）；管理员 #24 `reason` 必填 1–200 并写审计。
- 库存不足 409：
```json
{"code":"STOCK_INSUFFICIENT","message":"Some dishes are sold out or insufficient",
 "data":{"details":[{"dishId":1,"requested":2,"available":1}]},"requestId":"..."}
```

### 3.2 幂等语义（AC-015）
- 同键同 `request_hash`：返回首次 `response_status` + body（含 201 / 409），并发 5 次仍只有 1 个订单。
- 同键异体：409 `IDEMPOTENCY_CONFLICT`，不执行业务。
- 5xx/超时：记录 FAILED，同键可重试（G1-01）。
- 缺失/长度非法：400 `IDEMPOTENCY_KEY_REQUIRED`。

### 3.2.1 事务形态（G2-BE-B1）
- T0 独立事务抢占幂等键（`IN_PROGRESS` 立即提交）→ T1 单业务事务 → T2 独立事务落 `COMPLETED` 快照（**含首个业务 4xx 快照**）；仅 5xx/超时落 `FAILED` 并允许同键重试。
- 并发同键：后到请求见新鲜 `IN_PROGRESS` 时最多等待/轮询 2s；仍未完成 → 409 `IDEMPOTENCY_CONFLICT`（不得重复扣库存/建单）。

### 3.3 SSE（AC-036/039）
```
event: snapshot
data: [{"dishId":9,"available":7},{"dishId":1,"available":3}]

event: stock
data: {"dishId":9,"available":6}

event: meta
data: {"fallback":false,"model":"gpt-4o-mini","sessionId":"s-123"}

event: dish
data: {"dishId":3,"name":"Salmon Sashimi Set","priceCents":4500,"priceDisplay":"¥45.00"}

event: reason
data: {"dishId":3,"text":"Light and high in protein, fits your preference."}

event: done
data: {"dishIds":[3,6,17]}
```
- SSE 固定：单行 JSON、`retry:3000`、15s 心跳 `: ping`、事件名 `snapshot|stock|meta|dish|reason|done`。
- 菜单库存流只允许 `dishId+available` 字段，不泄露其他信息（D17）；前端断线按 `retry` 重连，3 次失败切 5s 轮询。
- AI 流首事件 ≤3s、总 ≤20s；无 Key 时 `meta.fallback=true` 且 1s 内出结果。
- ticket 仅兜底：主路径 `fetch + ReadableStream + Bearer`；ticket 绑定 userId+IP，60s 内最多兑换 3 次（G2-BE-M7）。

## 4. AC 覆盖清单（契约级）

| AC | 覆盖端点 | AC | 覆盖端点 |
|---|---|---|---|
| AC-001~005 | #1–5 | AC-028~033 | #23–32、#35 |
| AC-006~010 | #11–13 | AC-034~037 | #11、#14、#18、#22、#33 |
| AC-013~020 | #17–22 | AC-038~041 | #38、#36–37 |
| AC-021~023 | #6–7、#17 | AC-042 | #34 |
| AC-024~027 | #17–18、#21 | AC-043~044 | #18、#31–33 |
| AC-045~050 | 全端点统一包络/校验/401/403/429 | AC-051~060 | #19–22、全端点 + `X-Test-Clock` |

**必覆盖专项**：AC-015（#18）、AC-018/019（#22）、AC-020（#17/#18）、AC-024/025（#17/#18 + 测试时钟）、AC-026（#21/#18）、AC-027（#22+#18）、AC-028（#25 admin + 员工 403）、AC-035（#18 条件扣减）、AC-043（#31 inventoryMode + 降级）。

## 5. 契约自检

| 项 | 结论 |
|---|---|
| 鉴权/角色/401/403 区分 | PASS（§1、#25–37） |
| 分页统一 page/size 1/20 ≤100 | PASS（§1、#11/#19/#23/#35） |
| 错误码全集与 HTTP 映射 | PASS（§1.1，8 段） |
| 幂等键与重放/异体语义 | PASS（§3.2） |
| 版本 `/api/v1` 与兼容策略 | PASS（§1） |
| SSE 事件格式与降级 | PASS（§3.3） |
| 金额整数分/时间 ISO8601 | PASS（§1、#11/#12/#17/#18） |

## 6. 版本变更记录（G3 契约回写，2026-11-14 22:12 CST）

| 变更点 | 端点/章节 | 内容 |
|---|---|---|
| 包络 | §1、#10 | 全部 200 包络，删除 204；`X-Request-Id` 暴露 |
| 幂等 | §1、§3.2.1 | 键永久唯一（24h 仅停快照重放）；T0/T1/T2；并发轮询 2s |
| 类型 | #11/#12/#30 | `available:boolean` + `availableQty:int`；Console `available:int` |
| 选项标记 | #11 | `hasOptions/hasRequiredOptions` |
| 结算 | #17/#18 | preview 不锁库存/不报库存 409；submit 自动切换；`address` 必填 |
| 详情 | #20 | 字段级订单 JSON（items/options/subtotal） |
| 状态机 | #22/#24 | 三迁移合法，其余 409；员工仅 Pending 取消；reason 规则 |
| SSE | #13/#14/#15/#38、§3.3 | `dates` 扩展 filters；ticket 60s×3；`sessionId` 回传；snapshot 数组 |
| 看板 | #34 | 非 Cancelled 口径；lowStock=`0<=available<=3` |
| AI | #37 | `rollbackToVersion?`，历史行不变，仍 39 端点 |
| 错误码 | §1.1 | 补 `VALIDATION_TEST_CLOCK_FORBIDDEN`，标注 `VALIDATION_REASON_REQUIRED` |
| 稳定性 | §1.1 | 增 503 `SERVICE_DEGRADED`（L3 维护写阻断）；状态机不新增端点/错误码 |
| 计数 | §2 | 39 个（#1–#38 + #33b） |
