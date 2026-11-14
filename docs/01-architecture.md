# 01 · 架构设计（WeBox）

> 来源：`docs/raw/architecture.md`（Architecture，G2/G3 已评审）。

---

# 架构设计 — WeBox 企业员工餐食订购平台

- 版本：v1.0（Architecture，2026-11-14 22:06 CST）
- 输入：`docs/raw/PRD.md`、`RUNBOOK.md` D1–D22、`docs/raw/prd-analysis.md`、`docs/raw/acceptance-matrix.md`、`docs/raw/scenario-profile.md` v2、`docs/raw/assumptions.md`
- 契约：`docs/raw/api-contract.md`；数据模型：`docs/raw/data-model.md`；可执行 DDL：`docs/raw/schema.sql`
- 结论：**PASS**（模块化单体：React SPA → `/api/v1` → Spring Boot 3 / JDK17 → MySQL 8；Redis 可选增强，DB 为唯一账本）

## 1. 架构总览

```text
Browser SPA (React 18 + TS + Vite, :5173)
   │  HTTPS/JSON, Bearer JWT, Idempotency-Key
   ▼
REST API  /api/v1  (Spring Boot 3.x, JDK17, :8080)
   ├─ SecurityFilterChain (JWT) → Controller → Service → Repository(MyBatis/JdbcTemplate)
   ├─ MenuCache (Caffeine 本地缓存, TTL 60s) ── 只缓存目录类数据，绝不缓存库存账本
   ├─ SseHub (SseEmitter, post-commit 事件) ── /api/v1/menu/stream
   ├─ AiAdapter (OpenAI 兼容 HTTP, 超时/降级) ── 事务外调用
   └─ Scheduler (Pending 超时释放、ledger 对账、缓存清理)
   ▼
MySQL 8 独立进程 (127.0.0.1:3306, db=req_6343a752e110) —— 事实源/账本
   ▲
Redis 7 (127.0.0.1:6379, 可选) —— 仅：REDIS_PREALLOC 热点预占、登录/下单限流。不可用→自动降级，正确性不依赖
```

**强制基线**：前后端分离、JDK 17 + Spring Boot、独立 MySQL 8；无 H2/SQLite。**2 小时不做**：微服务、MQ、多机房、独立搜索集群、支付。可扩展边界只保留：模块化单体包边界、`InventoryService` 策略接口、唯一约束、ledger、配置开关。

## 2. 模块划分（模块化单体，单向依赖）

| 模块 | 包 | 职责 | 允许依赖 |
|---|---|---|---|
| auth | `com.webox.auth` | 注册/登录/刷新/登出、JWT 签发校验、BCrypt、登录限流 | user, audit |
| user | `com.webox.user` | 用户/角色、地址簿、偏好与画像 | — |
| catalog | `com.webox.catalog` | 菜品、选项组/选项、分类/辣度/过敏原枚举、搜索筛选、每日菜单发布 | user(只读角色), audit |
| cart | 前端 Zustand（无服务端表） | 购物车本地态；服务端只做 preview/下单校验（A-10） | — |
| order | `com.webox.order` | 结算预览、截单判定、下单事务、幂等、状态机、快照、取消 | catalog, inventory, user, audit |
| inventory | `com.webox.inventory` | `InventoryService`：DB_ATOMIC / REDIS_PREALLOC、ledger、对账、超时释放 | catalog, order(仅回调) |
| admin | `com.webox.admin` | Console：菜品 CRUD/上下架/每日菜单/库存调整/订单状态/看板 | 全部只读 + audit |
| analytics | `com.webox.analytics` | 看板聚合 SQL（今日概览/Top10/午晚/7 天/低库存） | order, catalog |
| ai | `com.webox.ai` | 候选确定性过滤、LLM 排序/理由（SSE）、规则配置、会话落库、降级 | catalog, user, order(只读) |
| audit | `com.webox.audit` | audit_log 写入（只增不改删） | — |
| common | `com.webox.common` | 统一响应/错误码、异常处理、分页、Clock、限流 | — |

依赖方向：`controller → service → repository`，禁止反向；`order` 不直接访问 ai/catalog 内部表，跨模块只通过 service 接口。模块边界在包结构 + ArchUnit（可选）约束。

## 3. 请求数据流

```mermaid
sequenceDiagram
  participant B as Browser SPA
  participant C as Controller (/api/v1)
  participant S as Service
  participant D as MySQL 8
  participant X as Caffeine Cache
  participant E as SSE Hub
  B->>C: POST /orders (Bearer, Idempotency-Key)
  C->>S: 校验 DTO / 角色 / 限流
  S->>D: 查幂等记录(唯一键) → HIT: 返回快照
  S->>D: BEGIN; 锁库存条件UPDATE; 写订单/明细/ledger/幂等
  D-->>S: COMMIT
  S->>E: publish(StockChangedEvent) —— 事务提交后
  S-->>C: 201 {orderNo,totalCents,...}
  C-->>B: JSON
  E-->>B: SSE event: stock {dishId,available}
```

- 菜单读：`GET /menu` → 缓存命中直接返回（TTL 60s）；未命中查 DB 后回填。库存字段**不进缓存**，每次从 `dish_daily_stock` 读或在缓存值上标记 stale（≤1s 刷新）。
- 写路径（管理端改菜/上下架/改库存）：事务提交后同步 `@CacheEvict(allEntries)` + 发 SSE；端到端可见 ≤1s（AC-030/045）。
- AI 流：Controller 返回 `SseEmitter`，Service 在**事务外**调用 LLM，逐事件 flush；不占用 DB 连接。

## 4. 事务边界（INV-10）

**下单事务（单 DB 事务、READ COMMITTED）内只做 DB 写**：
1. 插入/校验幂等记录（`UNIQUE(user_id, key)` 抢占；冲突走重放/409）；
2. 锁定并校验有效单（唯一索引兜底）；
3. 逐菜条件扣减库存 `UPDATE dish_daily_stock SET reserved_qty=reserved_qty+n, version=version+1 WHERE dish_id=? AND serve_date=? AND total_qty-reserved_qty-sold_qty>=n`（影响行数=0 → 抛 `STOCK_INSUFFICIENT`，整体回滚）；
4. 插入 `orders` / `order_items` / `inventory_ledger(RESERVE, business_key 唯一)`；
5. 更新幂等记录为 COMPLETED（响应快照）。

**禁止**：事务内调 LLM、HTTP 外部服务、Redis 写作为正确性前提、发 SSE。SSE 通过 `TransactionSynchronization.afterCommit` 发布进程内事件，异步推送；推送失败不影响订单结果。取消/确认/超时释放同样：单事务更新订单状态 + `reserved` + 1 条 ledger，提交后推 SSE。

## 5. 幂等设计（D6 / AC-015）

- 请求头 `Idempotency-Key`（8–64，前端 UUID），作用域 `(user_id, key)`，缺失 400 `IDEMPOTENCY_KEY_REQUIRED`。
- 表 `idempotency_records`：`UNIQUE(user_id, idem_key)`，`request_hash=SHA-256(canonical JSON)`，`status IN_PROGRESS/COMPLETED/FAILED`，`response_status/response_body JSON`，`expires_at=+24h`。
- 语义：
  - 新键 → 插入 IN_PROGRESS 后执行业务；成功/业务 4xx → COMPLETED + 响应快照；
  - 同键同 hash → 重放首次 `response_status/body`（含 201 与 409，AC-015）；
  - 同键异 hash → 409 `IDEMPOTENCY_CONFLICT`；
  - 5xx/超时 → 标记 FAILED 并**允许同键重试**（覆盖 G1-01）；IN_PROGRESS 超过 30s 视为僵死可接管（仅同用户同键，`SELECT ... FOR UPDATE`）。
- 兜底：`orders` 上 `UNIQUE(user_id, idempotency_key)` 双保险。
- 清理：定时任务删除 `expires_at < now()`；过期后的同键请求按新请求处理（文档化，AC 不覆盖）。

## 6. 唯一有效单（D5 / AC-026/027）

- `orders.active_key` 为 STORED 生成列：`status IN ('Pending','Confirmed')` 时 = `CONCAT(user_id,':',delivery_date,':',meal_type)`，否则 NULL；`UNIQUE KEY uk_orders_active(active_key)`（MySQL 唯一索引允许多个 NULL）。
- 插入冲突（SQLState 23000 / errno 1062）→ 捕获后按 `(user_id, delivery_date, meal_type, status IN...)` 查已有单，返回 **409 `ORDER_DUPLICATE`** + `data.existingOrderId`；订单/库存不变。
- 生效餐次（截单切换后）参与唯一键，客户端请求的原始餐次不参与。
- 取消/完成 → `active_key` 自动变 NULL（生成列随 status 更新），可再次下单（AC-027）。

## 7. 截单与自动切换（D2/D3 / AC-024/025）

- 服务端 `Clock`（`ZonedDateTime.now(ZoneId.of("Asia/Shanghai"))`）为唯一判据；JVM/MySQL 会话时区统一 `Asia/Shanghai`。
- `now < cutoff` 可订；`>=` 关闭（A-04）。Lunch 10:00，Dinner 15:00。
- 判定算法 `resolveEffectiveMeal(requestedDate, requestedMeal, now)`：
  1. 过去日期 → 400 `VALIDATION_DATE_PAST`；
  2. 未来日期（> today）→ 原样返回（需该日菜单已发布，否则 409 `ORDER_MEAL_UNAVAILABLE`）；
  3. 当日且请求餐次未截单 → 原样；
  4. 当日 Lunch 已截单且 now<15:00 → Dinner；
  5. 当日 Lunch/Dinner 已截单且 now>=15:00 → 次日 Lunch；
  6. 切换后必须存在已发布菜单，否则 409 `ORDER_MEAL_UNAVAILABLE`；切换结果 `autoSwitched=true`。
- `preview` 与 `submit` 都调用同一函数；submit 以提交时刻重算并回写响应（G1-02）。库存与唯一单均按生效餐次/日期判定。

## 8. 库存设计（D7/D8 / AC-035/043/044）

- 可见性：`daily_menu(dish_id, serve_date, publish_status=PUBLISHED)` 决定“是否在当日菜单”；库存计数器在 `dish_daily_stock`；`available = total_qty - reserved_qty - sold_qty`。管理端一次事务同时写两表（G1-06）。
- **DB_ATOMIC（默认）**：条件 UPDATE 原子扣减（见 §4），无需先查；影响行数 0 → 409 `STOCK_INSUFFICIENT`（响应含不足明细）。
- **REDIS_PREALLOC（热点菜）**：Redis `DECRBY` 预占（Lua 脚本保证 `>=0`），成功后再走 DB 条件 UPDATE 落账；Redis 失败/超时/未启动 → **直接降级 DB_ATOMIC**，不得 500、不得超卖（AC-043）。Redis 值只作加速，**不作为账本**。
- 状态流转：下单 `reserved += n`；取消/超时 `reserved -= n`；管理员确认 `reserved -= n, sold += n`；完成不变；管理员调整 `total_qty ± n` 并写 `ADJUST`。
- Ledger：每次变更写 1 行，`business_key` 唯一，例如 `ORD:{orderId}:D:{dishId}:RESERVE` / `:RELEASE`；重复取消在插入 ledger 前被状态机拦截，唯一键再兜底，**只回补一次**（AC-018/019/060）。
- 对账：`GET /api/v1/admin/inventory/reconcile`（S5 起可选）按 `total - Σ(RESERVE) + Σ(RELEASE)…` 推导与当前值比较，漂移返回 `drift>0` 并写审计；补偿写 `ADJUST`（含原因）。
- 超时释放：每 60s 扫描 `Pending AND created_at < now-30min`，逐单在同一事务内“状态 CAS 更新成功才释放”，保证幂等。

## 9. 缓存设计（BE-1 / AC-030/045）

- 选型：**Caffeine 进程内缓存**（单实例演示，零外部依赖；Redis 仅用于预占/限流）。若未来多实例，替换为 Redis 缓存仅需替换 `CacheManager`（决策见 ADR-004）。
- 缓存对象：菜单卡片列表（按查询条件 key：date/page/size/category/search/sort）、菜品详情、筛选枚举；`TTL=60s`，`maximumSize=500`。
- **不缓存**：库存计数器、订单、用户、幂等记录、看板聚合（可 5s 短缓存但需标注）。
- 失效：管理端任何菜品/每日菜单/库存写操作 `afterCommit` 执行 `cache.invalidateAll()`（≤1s 可见）；下单只广播 SSE，不失效目录缓存。
- 失效条件：多实例且未接 Redis 时，本地缓存失效只覆盖本实例 → 必须切 Redis Cache 或缩短 TTL（ADR-004 失效条件）。

## 10. 安全设计（IA / D15）

1. **认证**：JWT HS256（`JWT_SECRET` 环境变量，≥32 字节），access 2h；刷新 token 存 `refresh_token`（SHA-256 哈希，7d，可撤销）。刷新页面用 localStorage 中的 refresh token 换新 access token（AC-004）。篡改/过期 → 401 `AUTH_TOKEN_INVALID`。
2. **授权**：Spring Security `SecurityFilterChain`：`/api/v1/auth/**`、`/health` permitAll；`/api/v1/admin/**` `hasRole('ADMIN')`；其余 authenticated；Service 层再校验数据归属（SELF）并返回 404/403。员工访问 Console API → 403 `FORBIDDEN`（AC-028）。
3. **密码**：BCrypt(cost 10)，永不出现在响应/日志/审计；注册仅 `EMPLOYEE`，请求带 ADMIN 被忽略（A-01）。
4. **输入校验**：Bean Validation（@Email/@Size），邮箱≤200、密码 8–64 且含字母数字、地址≤200、搜索≤50、原因≤200、菜名≤100、描述≤1000；图片≤5MB 且 jpg/png/webp（魔数校验）。用户可见错误为英文。
5. **SQL 注入**：MyBatis `#{}` / JdbcTemplate 参数绑定，禁止 `${}` 拼接；LIKE 参数在 Java 侧转义 `%`/`_` 并 `ESCAPE '\\'`（AC-008）。
6. **限流**：登录 10 次/分/IP+邮箱、下单 5 次/分/用户、AI 10 次/分/用户 → 429 `RATE_LIMITED`；实现用 Caffeine/Redis 计数器（单实例允许本地）。
7. **CORS**：仅允许 `http://localhost:5173`（可通过 `CORS_ALLOWED_ORIGINS` 配置），允许 `Authorization`、`Idempotency-Key` 请求头。
8. **敏感配置**：`JWT_SECRET`、`LLM_API_KEY`、DB/Redis 密码仅环境变量；日志脱敏 Authorization/Cookie/password。审计 `audit_log` 只增不改删（应用层禁止 update/delete，DB 账号不授予）。
9. **字段权限**：`password_hash`/token 永不序列化；管理员订单列表地址脱敏（`***` 中间段），详情可见；员工仅本人（A-21）。

### 10.3 SSE 鉴权（G1-04）
- 推荐：前端 `fetch('/api/v1/menu/stream', {headers:{Authorization}})` + `ReadableStream` 解析 `text/event-stream`，支持 Bearer。
- 兜底：`POST /api/v1/menu/stream-ticket`（JWT）返回 60s 一次性 ticket，`GET /stream?ticket=` 供原生 EventSource；ticket 单次使用、绑定用户。
- 事件：`event: stock`，`data: {"dishId":1,"available":8}`；连接建立发 `event: snapshot`（当前可见菜品库存）；心跳 `: ping` 每 15s；断线前端 3s 退避重连，连续失败 3 次 → 5s 轮询 `GET /menu`（D17/AC-036）。

## 11. AI 推荐（D18 / AC-038–041）

```text
request(prompt) → 限流 → 候选集确定性过滤 → (有Key) LLM 流式排序/理由 → 服务端白名单校验 → SSE
                                        └─(无Key/超时/错误) 规则打分降级 → SSE fallback:true
```

- 候选过滤（硬，代码执行）：当日菜单 PUBLISHED、`available>0`、`allergens ∩ user.allergens = ∅`、排除近 7 天已点（`created_at >= now-7d` 且 status != Cancelled，G1-03）。
- LLM 仅输出 `dishId + reason` 排序；服务端丢弃不在候选集的 dishId（AI 幻觉防护）；价格/库存/权限永不由模型决定。
- 配置：`LLM_BASE_URL/LLM_API_KEY/LLM_MODEL`（OpenAI 兼容），连接/首 token 3s、总 20s 超时；无 Key → 规则推荐（偏好菜系+辣度+蛋白+预算打分）并标注 `rule-based fallback`（AC-040）。
- 规则配置：`ai_rule_config`（`config_key+version` 唯一，`active` 单版本），管理接口改权重/回滚，热更新 ≤60s（本地缓存 60s 过期）；每次推荐写 `ai_conversation`（user/prompt/response/dishIds/model/fallback/latency）。
- 注入防护：prompt 只做数据传递，系统提示固定；不把 DB 结构/密钥放入上下文；输出仅接受结构化 JSON，解析失败降级规则。

## 12. NFR（数字锚点落地）

| 维度 | 目标 | 实现手段 | AC |
|---|---|---|---|
| 规模 | 200 员工 / 50 菜 / 30 天 6000 单 | 单库单表 + 索引足够；无分库分表 | — |
| 峰值 | 1 单/秒设计，压测 5/10 QPS | 连接池 20、Tomcat 200 线程、无长事务 | AC-045/046 |
| 菜单列表 | P95≤200ms（未命中）/≤100ms（命中），50 QPS | Caffeine + 覆盖索引 `(publish_status, category)` | AC-006/045 |
| 搜索/筛选 | P95≤250ms @20 QPS | LIKE + 50 行规模；参数化；后续可换 FULLTEXT（ADR-005 失效条件） | AC-008/045 |
| 详情 | P95≤150ms @20 QPS | 主键查 + 缓存 | AC-045 |
| 下单 | P95≤500ms @10 QPS | 单事务 6 次 SQL 以内；无外部调用 | AC-046 |
| 登录 | P95≤300ms @10 QPS | BCrypt cost 10（约 60–80ms）+ 单查询 | AC-005 |
| 实时库存 | 推送 ≤2s；断线 5s 重连/轮询 | afterCommit 事件 + SSE；轮询降级 | AC-036 |
| AI | 首 token ≤3s、总 ≤20s；降级 ≤1s | 超时/熔断 + 规则降级 | AC-039/040 |
| 可用性 | 核心路径 5xx=0（演示窗口），SLO 99.5%/月 | 全局异常处理、降级不 500、健康检查 | AC-058 |
| 并发正确性 | 50 抢 10 → 成功 10，409×40，available=0 | 条件 UPDATE + 唯一索引 + ledger | AC-035 |
| 缓存 | TTL 60s，写后 ≤1s 失效，库存不缓存 | Caffeine + afterCommit 失效 | AC-030/045 |
| 分页 | 默认 1/20，size≤100 | 统一 PageQuery 校验 | AC-006/048 |
| 限流 | 登录 10/min、下单 5/min、AI 10/min | 计数器 + 429 | AC-049 |
| 多实例 | 无状态 JWT、唯一约束在 DB | 设计兼容；双实例实跑 N/A | AC-059 |
| 备份 | mysqldump 每日，RPO≤24h/RTO≤30min | `scripts/backup.sh` + 恢复演练 | AC-058 |
| 可观测 | health、请求 requestId、慢日志 ≥1s、5xx 计数 | 日志 MDC + `/health` + `docs/raw/observability.md` | AC-058 |

## 13. 失败语义与降级

| 场景 | 行为 | 错误码 |
|---|---|---|
| DB 超时/连接失败 | 事务回滚；5xx `INTERNAL`；不写幂等 COMPLETED（可重试） | INTERNAL |
| 重复提交 | 同键重放；异体 409 | IDEMPOTENCY_CONFLICT |
| 唯一单冲突 | 409 + existingOrderId | ORDER_DUPLICATE |
| 库存不足 | 409 + 不足明细（dishId/requested/available） | STOCK_INSUFFICIENT |
| 截单切换 | 200 + autoSwitched + 生效餐次；次日无菜单 409 | ORDER_MEAL_UNAVAILABLE |
| 取消非 Pending | 409，状态与库存不变 | ORDER_STATE_INVALID |
| Redis 不可用 | REDIS_PREALLOC 自动降级 DB；限流退化本地；不 500 | — |
| AI 无 Key/超时 | 200 SSE fallback:true + 规则推荐 | —（不报错） |
| SSE 断开 | 自动重连；3 次失败切 5s 轮询 | — |
| 缓存故障 | 直接查 DB（缓存装饰器捕获异常） | — |
| 图片缺失 | 返回占位图 URL，前端不裂图 | — |

## 14. 关键决策（ADR 摘要）与失效条件

| ID | 决策 | 理由 | 失效条件 |
|---|---|---|---|
| ADR-001 | 模块化单体 + 进程内事件 | 2 小时/200 人规模，微服务/MQ 过度设计 | 团队/部署规模上升、需要多团队独立发布时拆服务 |
| ADR-002 | 条件 UPDATE 扣减 + ledger 唯一键 | 单 SQL 原子性、可对账、可回滚 | 出现跨库/跨分片库存时需分布式事务/Saga |
| ADR-003 | 生成列 + 唯一索引实现唯一有效单 | DB 强一致，无先查后插竞态 | 需要“同餐次多单”业务时改复合键 |
| ADR-004 | Caffeine 本地缓存 | 零外部依赖、演示单实例 | 多实例且要求写后 1s 全网一致 → 切 Redis Cache |
| ADR-005 | LIKE 参数化搜索 | 50 菜规模足够，避免 ES/分词复杂度 | 菜品 >5k 或需相关性排序 → FULLTEXT/搜索引擎 |
| ADR-006 | SSE（非 WebSocket） | 单向库存推送，简单可降级 | 需要双向（如协作编辑）时改 WebSocket |
| ADR-008 | 表驱动统一状态机模块（非工作流引擎） | 订单 4 态 4 事件、单实体单事务；自研 ~100 行，零重依赖 | 状态>8、出现并行分支/会签/跨实体长流程 → 引入 Flowable/Camunda |
| ADR-009 | 策略模式 + 路由器（库存/截单/推荐/限流） | 变化点收敛为接口，新增实现不改主流程 | 策略维度>3 或需业务人员运行时编排 → 上规则引擎 |
| ADR-010 | 通用不变量沉淀到 `common` 包并单向依赖 | 金额/时间/包络/鉴权/幂等/审计/库存账本只实现一次 | `common` >30 类或跨域耦合 → 按领域拆分共享内核 |
| ADR-011 | 稳定性=舱壁+LLM 熔断+降级阶梯+优雅停机 | 单点故障不扩散，交易路径优先保命 | 需要自动扩缩容/多活 → 平台级能力，非本服务自建 |
| ADR-012 | 演示级容灾：备份+恢复演练+启动对账 | RTO≤10min、RPO≤5min（mysqldump 每小时），成本可控 | 生产化需 binlog/只读副本/跨机房，列入后续演进 |

## 15. 部署与启动

| 项 | 值 |
|---|---|
| 后端 | `:8080`，`SPRING_PROFILES_ACTIVE=dev`（演示）/`test`（测试钩子） |
| 前端 | `:5173`，Vite proxy `/api` → `localhost:8080` |
| DB | `jdbc:mysql://127.0.0.1:3306/req_6343a752e110?useSSL=false&serverTimezone=Asia/Shanghai&characterEncoding=utf8&allowPublicKeyRetrieval=true`，user `test` |
| Redis | `127.0.0.1:6379`，可选；`spring.data.redis.*`，`REDIS_ENABLED` 开关 |
| 环境变量 | `DB_URL/DB_USER/DB_PASSWORD`、`JWT_SECRET`、`LLM_BASE_URL/LLM_API_KEY/LLM_MODEL`、`CORS_ALLOWED_ORIGINS`、`REDIS_ENABLED/REDIS_HOST/REDIS_PORT` |
| 初始化 | Flyway（`backend/src/main/resources/db/migration/V1__schema.sql`、`V2__seed.sql`）或 `schema.sql+data.sql`；README 给出从零步骤；种子保证当天可下单（D21） |
| 测试钩子 | `X-Test-Clock`（RFC3339，仅 `test` profile 且 `webox.test.clock-enabled=true`）注入请求级 Clock；生产禁用；响应回显 `X-Test-Clock-Applied: true` |

## 16. 可扩展与稳定性边界

- 无状态多实例：JWT 无服务端会话；幂等/唯一/库存全部依赖 DB 约束；Caffeine 仅性能层。限流在单实例为本地计数，多实例需 Redis（ADR-004）。
- 限流/隔离：按接口分组计数器；AI 与下单独立线程池/信号量（AI 最多 4 并发），避免 LLM 慢调用拖垮交易路径。
- 降级：Redis→DB、LLM→规则、SSE→轮询、缓存→DB，均不返回 5xx。
- 恢复：`scripts/backup.sh`（mysqldump --single-transaction）、`scripts/restore.sh`；演练步骤写入 README。
- 告警阈值（文档化）：5xx >1%/5min、P95 >1s、库存漂移 >0、AI 错误率 >20%、SSE 连接数异常；`/api/v1/health` 暴露 db/redis/cache 状态。
- 灰度/回滚：AI 规则按版本表回滚；配置项（截单时间、超时、限流阈值、库存模式）走 DB/环境变量，无需改码。2 小时不做：蓝绿发布、自动扩缩容、多机房容灾。

## 17. 与 RUNBOOK 默认决策对应

| RUNBOOK | 架构落点 |
|---|---|
| D5 唯一有效单 | §6 生成列 `active_key` + 唯一索引；409+existingOrderId |
| D6 幂等 | §5 idempotency_records + request_hash + 响应快照 |
| D7 库存模型 | §8 DB_ATOMIC / REDIS_PREALLOC，统一 InventoryService |
| D8 占用时点 | §4 提交事务内占用；取消释放；ledger |
| D15 权限 | §10 JWT + URL/方法级 + SELF/ALL + 审计 |
| D16 高风险操作 | api-contract admin 写接口 `confirm+reason`；audit_log 前后值 |
| D17 实时库存 | §10.3 SSE + 断线重连 + 5s 轮询 |
| D18 AI | §11 候选过滤 + SSE + 降级 + 规则版本 |

## 18. G2 架构自检

| 检查项 | 结论 | 证据 |
|---|---|---|
| 前后端分离 + JDK17/Spring Boot + 独立 MySQL | PASS | §1、§15；无 H2/SQLite |
| API 契约完整（鉴权/分页/错误码/幂等/版本/SSE） | PASS | `docs/raw/api-contract.md` §1–§4 |
| 数据模型唯一约束/事务/原子扣减/ledger/审计 | PASS | `docs/raw/data-model.md` + `docs/raw/schema.sql`（MySQL 8 实跑） |
| 幂等/唯一单/截单/库存双模式/取消回补/AI 过滤 | PASS | §5–§8、§11 |
| NFR 数字锚点 | PASS | §12 |
| 测试钩子支持截单与并发 | PASS | §15 `X-Test-Clock`；`tests/` 固定 Clock |
| 场景 required_checks 有架构回应 | PASS | 交付评论 `## Scenario checks` |

## 19. 统一状态机与策略化扩展（ADR-008/009/010）

> 设计原则：**不变量集中、变化点隔离**。通用能力只实现一次；业务差异用策略+配置承接，而不是到处 if/else；但 2 小时交付不引入工作流引擎、规则引擎或微服务。

### 19.1 统一状态机模块（`common.statemachine`）

**动机**：订单状态被 3 个入口驱动（员工取消 #22、管理端流转 #24、Pending 超时任务），若各写一套 CAS/库存副作用，必然漂移。统一为一个表驱动状态机，三处只发事件。

```java
public interface StateMachine<S extends Enum<S>, E extends Enum<E>> {
    TransitionResult<S> fire(S current, E event, TransitionContext ctx); // INVALID 不抛异常，由调用方映射 409
    boolean canFire(S current, E event);
    Set<E> eventsFrom(S state);                                          // 供 Console 渲染可用操作
}
```

- **单一事实源**：`OrderTransitionTable` 以声明式表定义迁移，与 `api-contract.md` §3.1 逐行对应（代码评审可直接对照）。
- **守卫（Guard）**：`reasonRequired`、`actorAllowed`、`mealEditable` 等纯函数；**动作（Action）**：`releaseStock/confirmStock/audit`。
- **持久化语义不变**：`OrderStateService.transition(orderId, event, actor, reason)` 内部仍是 `UPDATE orders SET status=:to WHERE id=:id AND status=:from` 的 CAS；0 行→重读→404/409 `ORDER_STATE_INVALID`。禁止 `SELECT ... FOR UPDATE` 后改（先查后改反模式）。
- **一致性**：库存副作用与 ledger 在同一业务事务；`afterCommit` 才发 SSE/指标。
- **超时是事件源不是独立逻辑**：扫描器只发 `TIMEOUT` 事件，复用同一迁移表与释放动作。

```text
Pending --CONFIRM(ADMIN)--> Confirmed --COMPLETE(ADMIN)--> Completed
   |                             |
   +--CANCEL(EMPLOYEE/ADMIN)--> Cancelled
   +--TIMEOUT(SYSTEM)---------> Cancelled
   其余迁移/同态 → 409 ORDER_STATE_INVALID（单一错误码）
```

**扩展方式**：新增状态/事件 = 改枚举+加迁移行+DB 值域（DDL 变更需升级脚本，登记风险）；不改调用方。**明确不做**：状态内嵌脚本、运行时可编辑迁移表、跨聚合 Saga。

### 19.2 策略化变化点（`domain.strategy`）

| 变化点 | 接口 | 实现（本阶段） | 选择方式 | 新增业务不改主流程 |
|---|---|---|---|---|
| 库存扣减 | `StockStrategy{reserve/release/confirm; mode()}` | `DbAtomicStockStrategy`、`RedisPreallocStockStrategy`（装饰 DB 实现） | `StockStrategyRouter` 按 `dish_daily_stock.inventory_mode` | 新增 `SeatReservationStrategy` 仅注册 Bean |
| 截单规则 | `CutoffPolicy{resolve(now,date,meal)}` | `DefaultCutoffPolicy`（10:00/15:00，配置化） | 单 Bean，按配置注入 | 节假日/分园区策略新增实现，@Primary 切换 |
| AI 推荐 | `RecommendationEngine{recommend(candidates,sink)}` | `LlmRecommendationEngine`、`RuleRecommendationEngine` | `FallbackRecommendationEngine(primary,fallback)` 按可用性/超时 | 新增模型供应商只加实现 |
| 限流 | `RateLimiter{tryAcquire(key,permits)}` | `LocalTokenBucketLimiter`（默认）、`RedisTokenBucketLimiter`（多实例） | `@RateLimited(group)` AOP + 配置 | 新接口组=加配置项 |
| 审计出口 | `AuditWriter` | `DbAuditWriter` | 单 Bean | 接外部审计只加装饰器 |

**配置化边界**：`@ConfigurationProperties` 前缀 `webox.*`（截单时间、订单上限、Pending 超时、限流阈值、熔断参数、SSE 上限、降级开关），**环境变量 > application.yml**，重启生效；仅 AI 权重/版本走 `ai_rule_config` 热生效（60s 缓存）。**不新增配置表**（避免 schema 变更与迁移风险）。

**明确不做策略化**：金额计算、库存账本、唯一有效单、幂等键——这些是不变量，只有一份实现，禁止插件化（否则无法保证正确性）。

### 19.3 通用逻辑沉淀（`common` 包，单向依赖）

```text
interfaces(web) → application → domain → infrastructure
                      ↘        ↙
                        common（被所有层依赖，自己不依赖业务）
```

| 能力 | 单一实现 | 约束 |
|---|---|---|
| 金额 | `Money`（long 分、`display`、`multiply`） | 禁止 double/BigDecimal 入库；前端 `formatMoney` 对应 |
| 时间 | `AppClock`（Asia/Shanghai + `X-Test-Clock`） | 禁止 `LocalDateTime.now()` 直接调用 |
| 包络/错误 | `ApiResponse`、`ErrorCode`、`GlobalExceptionHandler` | 码表与契约 §1.1 逐字一致 |
| 鉴权 | `JwtService`、`SecurityFilterChain`、`@SelfOrAdmin` | 403 与 404 语义固定 |
| 幂等 | `IdempotencyFacade`（T0/T1/T2） | 业务代码不得自行判重 |
| 审计 | `AuditWriter`（同事务、只增） | 高风险操作强制 reason |
| 库存账本 | `InventoryLedger`（唯一 business_key） | 只允许经 `StockStrategy` 调用 |

**可验证性**：Stage 4 加 1 个轻量 `DependencyRuleTest`（ArchUnit，可选 P1）：禁止 `common` 依赖业务包、禁止 `interfaces` 直连 Mapper；成本约 20 行，越界即红。

## 20. 稳定性 / 容灾 / 限流降级 / 故障恢复

### 20.1 舱壁与隔离

| 资源 | 隔离手段 | 数字 |
|---|---|---|
| 下单/取消 | 独立事务，Hikari 连接 3s、Socket 5s | P95≤500ms；单事务 SQL ≤8 条 |
| AI/LLM | 独立信号量（并发 4）+ 超时（连接 3s/总 20s） | 慢调用不占交易线程池 |
| SSE | 连接注册表上限 + 15s 心跳 + 空闲回收 | 单实例 ≤500 连接，超限 429 `RATE_LIMITED` |
| 定时任务 | 独立调度线程，批量 LIMIT 100 | 不与请求线程竞争 |

### 20.2 限流（AC-049）

| 组 | 默认阈值 | 维度 | 超限 |
|---|---|---|---|
| login | 10/min | IP | 429 `RATE_LIMITED` + `Retry-After` |
| order | 10/min | userId | 429 |
| ai | 10/min，并发 4 | userId | 429 |
| 全站兜底 | 60/min | IP（仅测试/Harness 可关） | 429 |

单实例本地令牌桶；多实例切 `RedisTokenBucketLimiter`（`webox.ratelimit.backend=local|redis`，ADR-009 失效条件）。

### 20.3 降级阶梯与熔断

| 级别 | 触发 | 行为 | 恢复 |
|---|---|---|---|
| L0 正常 | — | 全功能 | — |
| L1 依赖降级 | Redis 异常 / LLM 异常 / SSE 断线 | Redis→`DB_ATOMIC`；LLM→规则推荐（`fallback:true`）；SSE→3 次失败切 5s 轮询 | 健康探测恢复自动回到 L0 |
| L2 保护性限流 | 错误率>5%/1min 或 P95>2s | 收紧 order/ai 限流，暂停 AI，保留菜单/订单读 | 指标回落后自动解除 |
| L3 维护 | 人工开关 `webox.degrade.write-block=true` | 写接口 503 `SERVICE_DEGRADED`（只读可用） | 人工关闭 |

- **熔断仅用于 LLM**：连续 5 次失败/超时 → OPEN 30s → HALF_OPEN 放 1 个探针；Redis 不做熔断（直接 try/catch 降级更快更简单）。
- 降级**不改变业务结论**：Redis 降级后订单结果由 DB 决定；LLM 降级后推荐结果确定性可复现。
- 所有降级必须打点：`webox_degrade_total{component,level}`；日志含 `requestId`。

### 20.4 故障恢复（自愈 + 补偿）

| 故障 | 检测 | 自愈/补偿 | 证据 |
|---|---|---|---|
| 订单卡 Pending | 60s 扫描 `created_at<now-30m` | CAS 发 `TIMEOUT` 事件→取消+释放+ledger | 扫描日志、`inventory_ledger` |
| 幂等记录僵死 | `IN_PROGRESS` 超 30s | 同键 CAS 接管重试 | 幂等表 `updated_at` |
| Redis 与 DB 漂移 | 30s 对齐任务 + `/admin/inventory/reconcile` | `SET=DB available`；对账只报不自动改账 | 对账 `drift[]` |
| 死锁 1213 | 异常捕获 | 外层重试 1 次（新事务） | 重试计数指标 |
| 重复提交 | 客户端重试/超时 | `Idempotency-Key` 重放首次结果 | 幂等记录 |
| 进程重启 | Spring Lifecycle | 优雅停机：停收新请求→排空在途≤20s→关闭 SSE；启动校验 Flyway 版本/种子/JWT_SECRET 长度，跑一次只读对账 | 启动日志、停机日志 |

**优雅停机配置**：`server.shutdown=graceful`、`spring.lifecycle.timeout-per-shutdown-phase=20s`；SSE `SseEmitter.complete()`，避免客户端悬挂。

### 20.5 容灾（演示级，ADR-012）

- **备份**：`scripts/backup.sh` 每小时 `mysqldump --single-transaction`（不锁表），保留 24 份；**恢复**：`scripts/restore.sh` 演练并有 `restore-drill.md` 记录时间。
- **目标**：RTO ≤10min（恢复库+重启）、RPO ≤5min（小时备份+停机前补备）；演示数据可重放种子，故接受该级别。
- **启动一致性**：Flyway migrate 失败即启动失败（不带着半套 schema 提供服务）；种子缺失只告警不自动写。
- **明确不做**：主从自动切换、多机房双活、跨云容灾——成本远超本需求，写入 `docs/raw/assumptions.md` 的 Non-goals。

### 20.6 可观测（运维闭环）

- 指标：状态迁移计数/非法迁移数、库存扣减失败率、限流拒绝数、降级事件、LLM 熔断状态、SSE 连接数、Pending 积压数。
- 日志：`requestId + orderId + dishId` 关联；错误日志脱敏；审计与业务同事务。
- 告警阈值（文档化）：5xx>1%/5min、P95>1s、库存 drift>0、AI 错误率>20%、SSE 连接数异常。

### 20.7 与契约/测试的对应

- 状态机不新增端点与错误码：非法迁移统一 409 `ORDER_STATE_INVALID`（契约 #22/#24）。
- 新增测试：`OrderStateMachineTest`（4 态×4 事件全矩阵）、`StockStrategyRouterTest`（Redis 停机→DB）、`CutoffPolicyTest`（六边界）、`RateLimitIT`（429+`Retry-After`）、`GracefulShutdownIT`（在途订单完成，可标 `NOT TESTED`）、`DependencyRuleTest`（可选）。
