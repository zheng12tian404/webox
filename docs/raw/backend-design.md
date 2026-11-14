# 后端实现方案 — WeBox 企业员工餐食订购平台

- 版本：v1.1（Stage 3 后端技术方案设计师，2026-11-14 22:14 CST；v1.1 变更：独立订单状态机模块 + 终态定义与终态可达保证，响应 2026-11-14 22:12 评审意见）
- 输入：`docs/architecture.md`、`docs/api-contract.md`、`docs/data-model.md`、`docs/schema.sql`、`docs/prd-analysis.md`、`docs/acceptance-matrix.md`、`docs/scenario-profile.md` v2、`docs/assumptions.md`、`docs/test-plan.md`、`docs/test-cases.md`、`RUNBOOK.md`
- 评审：`docs/cross-review-g2.md`（CHANGES：1 blocker + 8 major，本文件逐项给默认决策）
- 约束：JDK17 / Spring Boot 3.3.x / MySQL 8 / Redis 可选 / 端口 8080 / `/api/v1`；金额整数分；事务内禁止 LLM、HTTP、SSE。
- 结论：**PASS（可进入 Stage 4）**；39/39 端点有实现映射；17 表 DDL 直接采用 `docs/schema.sql`（无 schema 变更）。

## 0. 一页结论

| 决策点 | 落地方式 |
|---|---|
| 工程 | Maven 单模块 `com.webox:webox-server`，Spring Boot 3.3.5，JDK17，MyBatis + JdbcTemplate |
| 下单事务 | **T0 幂等抢占（独立事务）→ T1 业务事务 → T2 快照落库（独立事务）**，解决 G2-BE-B1 |
| 订单状态机 | 独立 `com.webox.order.statemachine`：Action 负责 A→B；`Completed`（成功）与 `Cancelled`（失败/关闭）为**吸收终态**；Pending 30 分钟超时、Confirmed 配送日 23:59 自动推进，保证所有订单有限时间内到达终态 |
| 防超卖 | `UPDATE ... WHERE total-reserved-sold >= ?` 单条条件更新；影响行数=0 → 409；DB 唯一账本 |
| 唯一有效单 | `orders.active_key` STORED 生成列 + `uk_orders_active`；1062 → 409 + `existingOrderId` |
| 幂等 | `UNIQUE(user_id, idem_key)`；canonical hash；COMPLETED 重放；FAILED 可重试；24h |
| 库存双模式 | `DB_ATOMIC`（默认）/`REDIS_PREALLOC`（Lua 预占 + DB 落账 + 失败 INCR 补偿 + 30s 对齐） |
| 截单 | 可注入 `Clock`；Asia/Shanghai；六边界 + 跨日；`X-Test-Clock` 仅 test profile |
| 缓存 | Caffeine：菜单静态字段/详情/筛选 TTL60s；**库存永不入缓存**，每次按 dishIds 查 DB |
| 安全 | JWT HS256 + 可撤销 refresh（SHA-256）；`/admin/**` URL 级 ADMIN；SELF 在 Service 判 404；BCrypt cost10 |
| 实时 | SSE Hub + `afterCommit` 事件；`snapshot/stock` + 15s 心跳；断线 3 次切 5s 轮询 |
| AI | 候选确定性过滤 → LLM 仅排序/理由 → 白名单校验；无 Key/超时 1s 内规则降级 |
| 测试 | JUnit + `@SpringBootTest` 独立库 `req_6343a752e110_test`；Redis 关闭跑主链路；并发脚本 50 用户 |

## 1. 工程与包结构

### 1.1 Maven 坐标与依赖

```xml
<groupId>com.webox</groupId>
<artifactId>webox-server</artifactId>
<version>0.1.0</version>
<parent>org.springframework.boot:spring-boot-starter-parent:3.3.5</parent>
<properties><java.version>17</java.version></properties>
```

| 依赖 | 用途 |
|---|---|
| `spring-boot-starter-web` / `validation` / `security` | REST、Bean Validation、过滤链 |
| `spring-boot-starter-jdbc` + `mybatis-spring-boot-starter:3.0.3` | SQL；复杂聚合用 JdbcTemplate |
| `mysql-connector-j` | MySQL 8 驱动 |
| `flyway-core` + `flyway-mysql` | `V1__schema.sql` / `V2__seed.sql` |
| `spring-boot-starter-cache` + `com.github.ben-manes.caffeine:caffeine` | 菜单缓存、限流计数 |
| `spring-boot-starter-data-redis` | 可选；`REDIS_ENABLED=false` 时 Bean 不创建 |
| `io.jsonwebtoken:jjwt-api/impl/jackson:0.12.6` | JWT |
| `spring-boot-starter-test` / `spring-security-test` | 单测/集成测试 |

### 1.2 包结构（模块化单体，依赖单向）

```text
com.webox
├── WeboxApplication.java                 # @SpringBootApplication @EnableScheduling
├── common
│   ├── api/{ApiResponse,PageResult,ErrorCode,ApiException,BusinessResult}
│   ├── web/{RequestIdFilter,GlobalExceptionHandler,TestClockFilter}
│   ├── time/{AppClock,CutoffResolver,EffectiveMeal}
│   ├── util/{Money,CanonicalJson,Sha256,AddressMasker}
│   └── ratelimit/{RateLimiter,RateLimitProperties}
├── config/{SecurityConfig,WebConfig,CacheConfig,RedisConfig,AsyncConfig,MybatisConfig}
├── security/{JwtService,JwtAuthFilter,CurrentUser,AuthPrincipal,RestAuthEntryPoint,RestAccessDeniedHandler}
├── auth/{AuthController,AuthService,RefreshTokenRepository,dto/*}
├── user/{MeController,PreferenceService,AddressService,UserRepository,PreferenceRepository,AddressRepository}
├── catalog/{MenuController,MenuService,DishQueryRepository,DailyMenuRepository,MenuCache,MenuAssembler}
├── order
│   ├── OrderController
│   ├── PreviewService
│   ├── OrderFacade            # 死锁重试、幂等编排（T0/T1/T2）
│   ├── OrderTxService         # @Transactional 业务事务
│   ├── IdempotencyService / IdempotencyRepository
│   ├── statemachine/{OrderStatus,OrderActionType,OrderAction,OrderStateMachine,
│   │                  OrderTransitionExecutor,OrderTransitionContext,OrderStateException,
│   │                  action/{ConfirmOrderAction,CompleteOrderAction,CancelOrderAction,
│   │                          TimeoutCancelAction,AutoCompleteAction}}
│   ├── OrderRepository / OrderItemRepository / OrderSnapshotBuilder
│   └── dto/*
├── inventory
│   ├── InventoryService (interface)
│   ├── DbAtomicInventoryService
│   ├── RedisPreallocInventoryService
│   ├── InventoryLedgerRepository
│   ├── ReconcileService
│   └── PendingOrderReleaser   # @Scheduled
├── realtime/{MenuStreamController,SseHub,StockEventPublisher,StreamTicketService,StreamAuthFilter}
├── admin/{AdminDishController,AdminMenuController,AdminOrderController,AdminInventoryController,
│          AdminDashboardController,AdminAuditController,AdminAiRuleController,...Service}
├── analytics/{DashboardRepository,DashboardService}
├── ai/{AiController,AiRecommendService,CandidateFilter,RuleRecommender,LlmClient,
│       AiRuleService,AiConversationRepository,dto/*}
└── audit/{AuditService,AuditRepository,AuditEvent}
```

规则：`controller → service → repository`，禁止反向；`order` 访问库存只经 `InventoryService`；`admin` 写操作统一经 Service + `AuditService`。

### 1.3 启动与配置

```java
@SpringBootApplication
@EnableScheduling
@EnableCaching
public class WeboxApplication {
  public static void main(String[] args) { SpringApplication.run(WeboxApplication.class, args); }
}
```

`application.yml`（关键项，**无密钥默认值**）：

```yaml
server: { port: 8080, shutdown: graceful }
spring:
  profiles: { active: ${SPRING_PROFILES_ACTIVE:dev} }
  datasource:
    url: ${DB_URL:jdbc:mysql://127.0.0.1:3306/req_6343a752e110?useSSL=false&serverTimezone=Asia/Shanghai&characterEncoding=utf8&allowPublicKeyRetrieval=true&sessionVariables=time_zone='+08:00'}
    username: ${DB_USER:test}
    password: ${DB_PASSWORD:test123456}
    hikari: { maximum-pool-size: 20, connection-timeout: 3000 }
  flyway: { enabled: true, baseline-on-migrate: true, locations: classpath:db/migration }
  data.redis:
    host: ${REDIS_HOST:127.0.0.1}
    port: ${REDIS_PORT:6379}
    timeout: 300ms
    connect-timeout: 300ms
  cache: { type: caffeine }
  jackson: { default-property-inclusion: non_null }
webox:
  timezone: Asia/Shanghai
  cutoff: { lunch: "10:00", dinner: "15:00" }
  order: { pending-timeout-minutes: 30, max-items: 5 }
  test: { clock-enabled: false }          # 仅 application-test.yml 为 true
  jwt: { secret: ${JWT_SECRET}, access-ttl: 2h, refresh-ttl: 7d }
  inventory: { redis-enabled: ${REDIS_ENABLED:false}, resync-seconds: 30 }
  llm: { base-url: ${LLM_BASE_URL:}, api-key: ${LLM_API_KEY:}, model: ${LLM_MODEL:gpt-4o-mini},
         connect-timeout: 3s, total-timeout: 20s }
  cors: { allowed-origins: ${CORS_ALLOWED_ORIGINS:http://localhost:5173} }
```

启动命令（README/脚本）：

```bash
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export JWT_SECRET="$(openssl rand -base64 48)"
/opt/maven/bin/mvn -q -DskipTests package
$JAVA_HOME/bin/java -Duser.timezone=Asia/Shanghai -jar target/webox-server-0.1.0.jar --spring.profiles.active=dev
```

### 1.4 统一响应 / 异常 / 错误码

```java
public record ApiResponse<T>(String code, String message, T data, String requestId) {
  public static <T> ApiResponse<T> ok(T data, String rid) { return new ApiResponse<>("OK", "Success", data, rid); }
}
public record PageResult<T>(List<T> items, int page, int size, long total) {}
```

- `RequestIdFilter`：入站有 `X-Request-Id` 则复用（≤64，清洗），否则 UUID；写 MDC `requestId` 与响应头；异常处理读 MDC。
- `GlobalExceptionHandler` 映射：

| 异常 | HTTP | code |
|---|---|---|
| `MethodArgumentNotValidException` / `ConstraintViolationException` | 400 | `VALIDATION_*`（字段→码表） |
| `ApiException(ErrorCode)` | 按 code | 见 `api-contract.md` §1.1 |
| `DuplicateKeyException`（上下文判定） | 409 | `ORDER_DUPLICATE` / `AUTH_EMAIL_EXISTS` / `IDEMPOTENCY_CONFLICT` |
| `DataIntegrityViolationException`（SQLState 3819） | 409 | `STOCK_INSUFFICIENT` |
| `DeadlockLoserDataAccessException` | 重试 1 次；仍失败 500 | `INTERNAL` |
| `Exception` | 500 | `INTERNAL`（日志留栈，响应不含 SQL/栈/密钥） |

- 错误码枚举 `ErrorCode` 与契约 §1.1 一一对应；`VALIDATION_PAGINATION`、`IDEMPOTENCY_KEY_REQUIRED`、`VALIDATION_TEST_CLOCK_FORBIDDEN`（契约表漏列，见 G2-O2）均实现。

## 2. 接口实现映射（39/39）

### 2.1 通用策略

- Controller 只做：`@Valid` DTO → 取 `AuthPrincipal` → 调 Service → 包装 `ApiResponse`。
- 分页统一 `PageQuery(page,size)`：`page>=1`，`1<=size<=100`，默认 1/20；越界 `VALIDATION_PAGINATION`。
- 权限：URL 级 + 方法级；SELF 类资源在 Service 按 `user_id` 过滤，他人资源统一 **404 `ORDER_NOT_FOUND`** 防枚举。
- 幂等：仅 `POST /orders` 强制 `Idempotency-Key`（8–64，`[A-Za-z0-9._:-]`），缺失/长度错 400 `IDEMPOTENCY_KEY_REQUIRED`。
- `X-Test-Clock`：`TestClockFilter` 仅在 `webox.test.clock-enabled=true` 时解析并放入 request attribute；否则头存在即 400 `VALIDATION_TEST_CLOCK_FORBIDDEN`（显式失败，可测试；生产不静默接受）。

### 2.2 端点 → 类方法

| # | 方法 路径 | Controller.method | 请求 DTO / 校验 | 权限 | 关键实现 |
|---|---|---|---|---|---|
| 1 | POST `/auth/register` | `AuthController.register` | `RegisterReq(email@Email≤200,password 8–64 字母+数字,displayName≤100)`；**无 role 字段** | 公开 | `AuthService.register`：`role=EMPLOYEE` 硬编码；唯一键 1062→409 |
| 2 | POST `/auth/login` | `AuthController.login` | `LoginReq` | 公开 | 限流(ip+email 10/min, ip 20/min)→BCrypt→签发 access+refresh |
| 3 | POST `/auth/refresh` | `AuthController.refresh` | `RefreshReq(refreshToken)` | 公开 | SHA-256 查表；有效则**旋转**（旧撤销）并返回新对 |
| 4 | POST `/auth/logout` | `AuthController.logout` | `RefreshReq` | 登录 | 撤销该 hash；幂等返回 `{}` |
| 5 | GET `/auth/me` | `AuthController.me` | — | 登录 | 查 user，返回 id/email/role/displayName |
| 6 | GET `/me/preferences` | `MeController.getPrefs` | — | 登录 | 无记录返回默认值（空枚举/预算 null/关闭） |
| 7 | PUT `/me/preferences` | `MeController.putPrefs` | `PreferenceReq`：枚举校验、`0<min≤max` | 登录 | upsert；`VALIDATION_CATEGORY` |
| 8 | GET `/me/addresses` | `MeController.listAddr` | — | 登录 | 按 `last_used_at DESC` |
| 9 | POST `/me/addresses` | `MeController.addAddr` | `AddressReq(address 1–200)` | 登录 | `UNIQUE(user_id,address)` 冲突返回已有 |
| 10 | DELETE `/me/addresses/{id}` | `MeController.delAddr` | path Long | 登录 SELF | `DELETE WHERE id=? AND user_id=?`；0 行→404 |
| 11 | GET `/menu` | `MenuController.list` | `MenuQuery(date,page,size,List<Category>,search≤50,sort)` | 登录 | 校验日期/分类；缓存静态字段；库存每次 live 查询；`forYou` 软排序 |
| 12 | GET `/menu/{dishId}` | `MenuController.detail` | path Long | 登录 | 仅当日 PUBLISHED；否则 404 `DISH_NOT_FOUND`；选项组/选项排序 |
| 13 | GET `/menu/filters` | `MenuController.filters` | — | 登录 | 静态枚举；缓存 60s |
| 14 | GET `/menu/stream` | `MenuStreamController.stream` | `date?`；`Accept: text/event-stream` | Bearer 或 ticket | `StreamAuthFilter` 认证→`SseHub.subscribe`；首帧 `snapshot`；15s 心跳 |
| 15 | POST `/menu/stream-ticket` | `MenuStreamController.ticket` | — | 登录 | 32B 随机；Caffeine TTL60s；60s 内最多 3 次兑换（G2-BE-M7） |
| 16 | GET `/health` | `HealthController.health` | — | 公开 | DB `SELECT 1`；Redis ping（关闭时 `DOWN` 但不算故障）；cache 状态；DB down→503 |
| 17 | POST `/orders/preview` | `OrderController.preview` | `PreviewReq(items[dishId,qty 1–5,optionIds],deliveryDate?,mealType?,address?)` | 登录 | 不锁库存、不报库存 409；服务端重算价；截单解析；有效单/地址回显 |
| 18 | POST `/orders` | `OrderController.submit` | `SubmitReq` 同 17 + `confirmAutoSwitch?`；Header `Idempotency-Key` | 登录 | `OrderFacade.submit`（§4） |
| 19 | GET `/orders` | `OrderController.list` | `page,size,status?` | 登录 SELF | `WHERE user_id=?`；`created_at DESC` |
| 20 | GET `/orders/{orderId}` | `OrderController.detail` | path Long | SELF 或 ADMIN | SELF 不匹配→404；返回 items 快照+`snapshot_json` |
| 21 | GET `/orders/active` | `OrderController.active` | `date,mealType` | 登录 | `active_key` 等值查；无→`data:null` |
| 22 | POST `/orders/{orderId}/cancel` | `OrderController.cancel` | `CancelReq(reason?≤200)` | SELF 或 ADMIN | 员工 reason 可选、管理员必填（G2-BE-M8）；CAS+释放+ledger |
| 23 | GET `/admin/orders` | `AdminOrderController.list` | `page,size,status?,date?` | ADMIN | 地址 `***` 脱敏；不返回 snapshot_json 大字段 |
| 24 | PATCH `/admin/orders/{orderId}/status` | `AdminOrderController.patchStatus` | `StatusReq(toStatus,confirm=true,reason 1–200)` | ADMIN | 矩阵见 §4.5；审计前后值；确认时 reserved→sold |
| 25 | GET `/admin/dishes` | `AdminDishController.list` | `page,size,search≤50,category?,status?` | ADMIN | 含 OFF_SHELF；LIKE 转义 |
| 26 | POST `/admin/dishes` | `AdminDishController.create` | `DishReq(name≤100,desc≤1000,priceCents>0,category,protein≤50,allergens[],spice,imageUrl?)` | ADMIN | 审计 CREATE；返回 dishId 201 |
| 27 | PUT `/admin/dishes/{dishId}` | `AdminDishController.update` | `DishReq + confirm,reason 1–200` | ADMIN | 查 before→更新→审计 diff；缓存失效 afterCommit |
| 28 | PATCH `/admin/dishes/{dishId}/status` | `AdminDishController.status` | `StatusReq` | ADMIN | 上下架；审计；员工端详情 404（下架） |
| 29 | POST `/admin/dishes/{dishId}/image` | `AdminDishController.image` | multipart `file≤5MB` | ADMIN | 魔数 jpg/png/webp；落 `./uploads/images/{uuid}.{ext}`；返回 `/images/{file}`；非法 400 `VALIDATION_IMAGE` |
| 30 | GET `/admin/daily-menu` | `AdminMenuController.get` | `date?` 默认次日 | ADMIN | join stock；返回 total/reserved/sold/available/mode/published |
| 31 | PUT `/admin/daily-menu` | `AdminMenuController.save` | `DailyMenuReq(serveDate,totalQty?,items[{dishId,published,totalQty,inventoryMode?}],confirm,reason)` | ADMIN | 单事务 upsert `daily_menu`+`dish_daily_stock`；校验 `total≥reserved+sold`；审计 |
| 32 | PUT `/admin/daily-menu/{serveDate}/{dishId}/stock` | `AdminMenuController.stock` | `StockReq(totalQty≥0,confirm=true,reason 1–200)` | ADMIN | 条件 `total_qty=? WHERE total_qty>=reserved+sold`；0 行→409；审计 |
| 33 | GET `/admin/inventory/reconcile` | `AdminInventoryController.reconcile` | `date` | ADMIN | 账本推导 vs 账面；`drift[]`；只读 |
| 33b | POST `/admin/inventory/adjust` | `AdminInventoryController.adjust` | `AdjustReq(dishId,serveDate,delta,confirm,reason)` | ADMIN | `total_qty+=delta`（不得低于 reserved+sold）→`ADJUST` ledger→审计 |
| 34 | GET `/admin/dashboard` | `AdminDashboardController.get` | `date?` 默认今日 | ADMIN | 5 段聚合（§5.4）；趋势补零 7 点 |
| 35 | GET `/admin/audit-logs` | `AdminAuditController.list` | `page,size,action?,objectType?` | ADMIN | `created_at DESC`；before/after JSON 原样 |
| 36 | GET `/admin/ai-rules` | `AdminAiRuleController.get` | — | ADMIN | active 版本；无则返回默认 v0 只读 |
| 37 | PUT `/admin/ai-rules` | `AdminAiRuleController.put` | `AiRuleReq(configKey,config,confirm,reason,rollbackToVersion?)` | ADMIN | 新版本 `version+1` 并激活；`rollbackToVersion` 复制旧配置为新版本（G2-BE-M6）；审计；≤60s 生效 |
| 38 | POST `/ai/recommend` | `AiController.recommend` | `AiReq(prompt≤500,sessionId?)`；`Accept: text/event-stream` | 登录 + 10/min | 候选过滤→LLM/规则→SSE `meta/dish/reason/done`；落 `ai_conversation` |

> 覆盖：**39/39**（#1–#38 + #33b）。购物车无服务端端点（A-10）。

### 2.3 类型口径（解决 G2-BE-M2）

| 字段 | 端点 | 类型 | 说明 |
|---|---|---|---|
| `available` | #11 列表 / #12 详情 | boolean | 可下单 = `availableQty>0` 且当日 PUBLISHED |
| `lowStock` | #11 | boolean | `0<availableQty<=3` |
| `soldOut` | #11 | boolean | `availableQty==0` |
| `available` | #14 SSE `stock` | int | 实时余量，仅 `dishId+available` |
| `available` | #30/#32/#33b | int | Console 余量 |
| `priceCents`/`*Cents` | 全部 | long/BIGINT | 分；`priceDisplay` 由 `Money.display(long)` 生成 `¥22.50` |

## 3. 数据库

### 3.1 采用既有 DDL（无变更）

- 事实源：`docs/schema.sql`（17 表，MySQL 8.0.46 已实跑；`utf8mb4`；金额 BIGINT 分）。
- Flyway：`backend/src/main/resources/db/migration/V1__schema.sql`（复制 §DDL 部分）、`V2__seed.sql`（复制种子部分）。**不修改表结构**；若 Stage 4 发现必须加索引/列，按规则回写 `docs/architecture.md` + `docs/data-model.md` 后另起 `V3__*.sql`，不得静默漂移。
- 会话时区：JDBC `sessionVariables=time_zone='+08:00'` + `-Duser.timezone=Asia/Shanghai`；Flyway 连接同样生效。

### 3.2 关键 SQL（可直接执行）

**(a) 原子扣减（DB 账本，防超卖核心）**

```sql
UPDATE dish_daily_stock
   SET reserved_qty = reserved_qty + #{qty},
       version = version + 1
 WHERE dish_id = #{dishId}
   AND serve_date = #{serveDate}
   AND total_qty - reserved_qty - sold_qty >= #{qty};
-- 影响行数 = 0 → 抛 STOCK_INSUFFICIENT（触发回滚）
```

**(b) 取消/超时释放（只释放一次）**

```sql
UPDATE dish_daily_stock
   SET reserved_qty = reserved_qty - #{qty}, version = version + 1
 WHERE dish_id = #{dishId} AND serve_date = #{serveDate} AND reserved_qty >= #{qty};
```

**(c) Ledger（业务键唯一，重复插入即已处理）**

```sql
INSERT INTO inventory_ledger
  (order_id,dish_id,serve_date,entry_type,qty,before_available,after_available,business_key,operator,reason)
VALUES (#{orderId},#{dishId},#{serveDate},#{type},#{qty},#{before},#{after},#{businessKey},#{operator},#{reason});
-- business_key: ORD:{orderId}:D:{dishId}:RESERVE | :RELEASE | :CONFIRM ; ADJ:{uuid}
```

**(d) 唯一有效单冲突判定**

```sql
SELECT id, order_no FROM orders
 WHERE user_id=#{userId} AND delivery_date=#{date} AND meal_type=#{meal}
   AND status IN ('Pending','Confirmed') LIMIT 1;
```

**(e) 管理端确认（reserved→sold）**

```sql
UPDATE dish_daily_stock
   SET reserved_qty = reserved_qty - #{qty}, sold_qty = sold_qty + #{qty}, version = version + 1
 WHERE dish_id = #{dishId} AND serve_date = #{serveDate} AND reserved_qty >= #{qty};
```

**(f) 对账推导**

```sql
SELECT s.dish_id, s.total_qty,
       s.total_qty - s.reserved_qty - s.sold_qty AS book_available,
       s.total_qty - COALESCE(SUM(CASE l.entry_type
           WHEN 'RESERVE' THEN l.qty WHEN 'RELEASE' THEN -l.qty ELSE 0 END),0) AS ledger_derived
  FROM dish_daily_stock s
  LEFT JOIN inventory_ledger l ON l.dish_id=s.dish_id AND l.serve_date=s.serve_date
 WHERE s.serve_date=#{date}
 GROUP BY s.dish_id, s.total_qty, s.reserved_qty, s.sold_qty
HAVING book_available <> ledger_derived;
```

> 说明：`ADJUST` 已反映在当前 `total_qty`，不重复计入；`CONFIRM` 只搬 reserved→sold，对 available 净影响为 0。

### 3.3 索引使用核对

| 查询 | 命中索引 | 结论 |
|---|---|---|
| 登录/注册 | `uk_users_email` | PASS |
| 当日菜单 | `idx_menu_date_status(serve_date,publish_status)` + PK join stock | PASS |
| 分类/搜索 | `idx_dishes_status_category` + LIKE（20 行） | PASS（>5k 换 FULLTEXT，ADR-005） |
| 我的订单 | `idx_orders_user_created` | PASS |
| 唯一单 | `uk_orders_active` | PASS |
| 库存扣减 | PK `(dish_id,serve_date)` 行锁 | PASS |
| 看板 | `idx_orders_date_meal_status`、`idx_items_order` | PASS |
| 审计 | `idx_audit_object` / `idx_audit_created` | PASS |
| 幂等清理 | `idx_idem_expires` | PASS |

### 3.4 种子数据（演示当天可下单）

- 20 道菜（id 1–20）+ 16 选项组/41 选项；当日/次日/后天各 20 道 PUBLISHED；当日库存 20–50。
- 账号：`admin@webox.com/Admin12345`（ADMIN）、`employee@webox.com/Employee123`（EMPLOYEE）；**BCrypt 实测均匹配**（cost 10，`$2b$`）。
- 两种库存模式：dish 1（Kung Pao）、dish 9（Burger）= `REDIS_PREALLOC`，其余 `DB_ATOMIC`（AC-043）。
- 图片：`docs/product_images/` 20 张 → Stage 4 复制为 `frontend/public/images/image_01..20.jpg`（后端上传目录 `./uploads/images/` 用于新增图）。
- **跨天**：种子 `CURDATE()` 在迁移时求值；`scripts/reseed_today.sql` 负责把当日/次日/后天菜单与库存整体平移并重置 reserved/sold（Stage 4 P1 交付；演示前执行）。
- 历史订单默认不种，看板趋势为 0 点；AI 近 7 天过滤由测试下单构造。

## 4. 事务与并发

### 4.1 下单主链路（T0/T1/T2）

```text
POST /orders
OrderFacade.submit(cmd, key):
  validateKey(key) / canonicalHash(cmd)
  for attempt in 0..1:                        # 死锁重试 1 次
    claim = idemService.claim(userId, key, hash)     # T0: REQUIRES_NEW
      ├─ 新键 → IN_PROGRESS（expires=now+24h），继续
      ├─ COMPLETED 且 hash 相同 → 直接返回 response_status/body
      ├─ hash 不同 → 409 IDEMPOTENCY_CONFLICT（不执行业务）
      ├─ FAILED 或 IN_PROGRESS 超 30s → CAS 接管为 IN_PROGRESS，继续
      └─ 新鲜 IN_PROGRESS → 200ms×10 轮询 COMPLETED；仍无 → 409 IDEMPOTENCY_CONFLICT
    try:
      result = orderTxService.execute(cmd)            # T1: @Transactional
      idemService.complete(claim.id, result)          # T2: REQUIRES_NEW 快照
      return result
    catch OrderDuplicate / StockInsufficient / MealUnavailable ... (业务 4xx):
      idemService.complete(claim.id, errorSnapshot)   # T2 落 4xx 快照（B1 修复）
      throw
    catch Exception (5xx/超时):
      idemService.fail(claim.id, 500)                 # T2 落 FAILED，允许同键重试
      throw
```

`OrderTxService.execute`（**单 DB 事务，READ COMMITTED，只做 DB 写**）：

1. `resolveEffectiveMeal(now)`（§4.6），得到 `effectiveDate/effectiveMeal/autoSwitched`；
2. 校验 items：DTO 仅 `@Min(1)`；`qty>5` 或 `Σqty>5` 均由 Service 统一抛 400 `ORDER_LIMIT_EXCEEDED`（避免 `@Max` 先返回 `VALIDATION_*`，G3P-M2）；dish 当日 PUBLISHED（否则 409 `ORDER_MEAL_UNAVAILABLE`）、选项归属/必选组/min-max（`VALIDATION_OPTION_*`）；按 `(dishId, options)` 合并同配置行、按 `dishId` 汇总扣减量；
3. 服务端重算：`unit = dish.price_cents + Σoption.price_delta_cents`；`subtotal = unit*qty`；`total = Σsubtotal`（全 long）；
4. 早查有效单（非锁定）：存在→抛 `ORDER_DUPLICATE`（带 existingOrderId）；并发窗口由第 6 步唯一索引兜底；
5. 按 `dishId ASC` 逐菜 `inventory.reserve(...)`（§4.4）；任一失败抛 `STOCK_INSUFFICIENT`（含 details），**整个 T1 回滚**；
6. `INSERT orders`（`active_key` 生成列自动写入；1062→查已有单→`ORDER_DUPLICATE`）；`INSERT order_items`（快照列）；`snapshot_json`；
7. 每菜 `INSERT inventory_ledger(RESERVE, business_key)`（before=after+qty，after 由扣减后同一事务读回）；
8. 地址若为新地址则 upsert 地址簿（≤200）；
9. 返回 `OrderPlaced`（含 orderId/orderNo/...）；T2 落 COMPLETED 快照。

**禁止**：事务内调 LLM/HTTP、写 Redis 作为正确性前提、发 SSE。SSE 由 `StockEventPublisher` 在 `afterCommit` 发布。

### 4.2 幂等（AC-015 / G1-01 / G2-BE-B1）

- 存储：`idempotency_records`，`UNIQUE(user_id,idem_key)`，`request_hash CHAR(64)`，`status IN_PROGRESS/COMPLETED/FAILED`，`response_status/response_body`，`expires_at=+24h`；`orders.UNIQUE(user_id,idempotency_key)` 双保险。
- Canonical hash：仅白名单字段 `items[{dishId,qty,optionIds sorted asc}]`（items 按 `dishId`+options 排序）、`deliveryDate`、`mealType`、`address`（trim 两端、保留内部空格）、`confirmAutoSwitch`；SHA-256 hex。**忽略**客户端价格字段与字段顺序。
- 重放：`COMPLETED` 直接返回首次 `response_status` + body（含 201 与业务 409）。
- 异体：同键不同 hash → 409 `IDEMPOTENCY_CONFLICT`，不写订单/库存。
- 失败：仅 5xx/超时置 `FAILED`（T2 独立事务），同键可重试；业务 4xx **不置 FAILED**，而是 COMPLETED 快照。
- 并发：T0 独立提交后，同键第二个请求看到 IN_PROGRESS，轮询 2s 后重放；不会重复扣库存。
- 清理：每小时删除过期记录；但 `orders.UNIQUE(user_id,idempotency_key)` 永久保留，24h 后同用户同键的新请求在插入订单时命中该唯一键 → 409 `IDEMPOTENCY_CONFLICT`（契约 v1.1；不当作新请求，不产生第二单，G3A-M2）。
- 僵死：IN_PROGRESS 且 `updated_at<now()-30s` 允许同用户同键 CAS 接管。

### 4.3 唯一有效单（AC-026/027）

- DB 生成列 `active_key` + `uk_orders_active` 为唯一权威；Service 早查只为给出 `existingOrderId`。
- 插入冲突（errno 1062，键名 `uk_orders_active`）→ rollback T1 → T2 落 409 快照 → 返回 `ORDER_DUPLICATE` + `existingOrderId/existingOrderNo`；库存与订单不变。
- 取消/完成 → `status` 变化使 `active_key=NULL`，可再次下单。
- 生效餐次（截单切换后）参与唯一键；原始请求餐次不参与。

### 4.4 库存双策略（AC-035/043）

**接口**：`InventoryService.reserve(dishId, date, qty)` / `release(...)` / `confirm(...)` / `adjust(...)`；返回 `StockDelta(before, after)`。

**DB_ATOMIC（默认）**：§3.2(a) 条件 UPDATE；0 行→`STOCK_INSUFFICIENT`。同一订单内按 `dish_id ASC` 顺序执行，降低交叉死锁；捕获 1213 由 Facade 重试 1 次（新事务）。

**REDIS_PREALLOC（热点菜，dish 1/9）**：

```lua
-- KEYS[1]=webox:stock:{serveDate}:{dishId}  ARGV[1]=qty
local v = tonumber(redis.call('GET', KEYS[1]) or '-1')
if v < 0 then return -1 end          -- 未初始化 → 调用方回源 DB 初始化后重试一次
if v < tonumber(ARGV[1]) then return 0 end
redis.call('DECRBY', KEYS[1], ARGV[1])
return 1
```

1. Lua 返回 1 → 执行 DB 条件 UPDATE 落账；
2. DB 失败（库存不足/异常）→ `INCRBY` 补偿本次预占；若 T1 在后续菜/订单写入失败而整体回滚，Facade 维护“已预占清单”，回滚后逐菜 `INCRBY` 补偿**所有已预占菜**（不只失败菜），再返回错误/降级（G3A-M1）；
3. Lua 返回 0 → 409 `STOCK_INSUFFICIENT`（DB 仍会在其他路径兜底）；
4. Redis 连接/超时/未启用 → **本请求直接走 DB_ATOMIC**，不得 500；
5. 初始化：cache miss 时 `SET key = DB available EX 至当日 23:59:59`；
6. 对齐：每 30s（`@Scheduled`）把启用的热点 key `SET = DB available`（DB 为账本）；取消/确认后同步 `INCRBY/DECRBY` 或直接 `SET`；
7. 健康：`/health.redis` 反映连接；Redis 降级不改变订单结果。

**状态流转**：下单 `reserved+=n`；取消/超时 `reserved-=n`；管理员确认 `reserved-=n, sold+=n`；完成不变；调整 `total±delta`。每次写 1 条 ledger，唯一键保证只回补一次。

### 4.5 独立订单状态机模块（v1.1 / G2-BE-M1）

**目标**：状态迁移不散落在 Controller/Service，而是由独立模块统一定义“Action 把状态 A 推进到 B”，并在模块内声明**终态**；任何订单都必须有限时间内到达终态，终态吸收（不可再迁移）。

#### 4.5.1 状态与终态

| 状态 | 类别 | 语义 | 出边 |
|---|---|---|---|
| `Pending` | 非终态（初始态） | 已创建、待确认 | CONFIRM / CANCEL / TIMEOUT_CANCEL |
| `Confirmed` | 非终态 | 已确认、待完成 | COMPLETE / AUTO_COMPLETE |
| `Completed` | **终态（成功）** | 餐已交付/订单成功结束 | 无（吸收） |
| `Cancelled` | **终态（失败/关闭）** | 用户取消、超时、管理员关闭 | 无（吸收） |

- “成功 / 失败 / 关闭”全部映射为终态：成功=`Completed`；失败与关闭统一=`Cancelled`（含用户取消、30 分钟超时、管理员取消）。
- 当前 `orders.status` ENUM 已覆盖四态，**不需要 schema 变更**。若未来要求独立的 `Failed` 状态（如支付失败），属于 schema + 契约变更：必须回写 Architecture/Data Model，新增 `V3__*.sql` 并把 API 升到 v1.1，不在本次范围（D22 无支付）。
- **终态吸收**：`OrderStateMachine` 对终态不接受任何 Action；终态上的 Cancel/Confirm/Complete/Timeout 一律 409 `ORDER_STATE_INVALID`，不产生库存/ledger/审计副作用。

#### 4.5.2 Action 定义（Action 负责 A→B）

| Action | From → To | 触发方 | Guard（推进前置条件） | 同事务副作用 |
|---|---|---|---|---|
| `CONFIRM` | `Pending → Confirmed` | ADMIN `PATCH .../status` | 角色 ADMIN、`confirm=true`、reason 1–200、当前态=Pending | `reserved-=n, sold+=n` + ledger `CONFIRM` + 审计 |
| `COMPLETE` | `Confirmed → Completed` | ADMIN `PATCH .../status` | 角色 ADMIN、reason 1–200、当前态=Confirmed | 仅审计（库存不变） |
| `CANCEL` | `Pending → Cancelled` | 员工/管理员取消 | SELF 或 ADMIN；员工 reason 可选、管理员必填；当前态=Pending | `reserved-=n` + ledger `RELEASE` + 审计 |
| `TIMEOUT_CANCEL` | `Pending → Cancelled` | 系统定时任务 | 当前态=Pending 且 `created_at < now-30m` | 释放 `reserved` + ledger `RELEASE`（reason=TIMEOUT）+ 系统审计 |
| `AUTO_COMPLETE` | `Confirmed → Completed` | 系统定时任务 | 当前态=Confirmed 且已到配送日 23:59 或配送日已过 | 仅状态 + 系统审计（成功终态） |

- 不存在的组合（如 `Confirmed→Cancelled`、`Completed→*`、`Cancelled→*`、同态迁移）→ `OrderStateException` → 409 `ORDER_STATE_INVALID`；订单不存在→404 `ORDER_NOT_FOUND`。
- 下单创建不是“状态迁移”：新订单由 `OrderTxService` 直接以初始态 `Pending` 插入（`OrderStatus.INITIAL=Pending`），之后所有变化必须经过 Action。

#### 4.5.3 模块结构与执行器

```text
com.webox.order.statemachine
├── OrderStatus.java              # 四态 + isTerminal() + INITIAL
├── OrderActionType.java          # CONFIRM/COMPLETE/CANCEL/TIMEOUT_CANCEL/AUTO_COMPLETE
├── OrderAction.java              # interface: type(), from(), to(), guard(ctx), apply(ctx)
├── OrderStateMachine.java        # registry Map<(from,type), OrderAction>; resolve/transit/isTerminal
├── OrderTransitionExecutor.java  # @Transactional 编排：guard → CAS → apply → 审计 → afterCommit
├── OrderTransitionContext.java   # orderId/actor/role/reason/now/items
├── OrderStateException.java      # 映射 409 ORDER_STATE_INVALID
└── action/{ConfirmOrderAction,CompleteOrderAction,CancelOrderAction,
            TimeoutCancelAction,AutoCompleteAction}.java
```

```java
public interface OrderAction {
  OrderActionType type();
  OrderStatus from();
  OrderStatus to();
  void guard(OrderTransitionContext ctx);   // 失败抛 OrderStateException（409）
  void apply(OrderTransitionContext ctx);   // 库存/ledger/审计，须幂等可重入
}

@Component
public class OrderStateMachine {
  private final Map<Key, OrderAction> actions;         // 构造注入 5 个 Action
  public OrderAction resolve(OrderStatus from, OrderActionType type) {
    if (from.isTerminal()) throw new OrderStateException(from, type); // 终态吸收
    OrderAction a = actions.get(new Key(from, type));
    if (a == null) throw new OrderStateException(from, type);         // 未定义迁移
    return a;
  }
  public boolean isTerminal(OrderStatus s) { return s.isTerminal(); }
}
```

`OrderTransitionExecutor`（唯一写状态入口）：

```text
@Transactional
execute(orderId, type, actor, reason):
  order = orderMapper.findByIdForUpdate(orderId)
  action = machine.resolve(order.status, type)          # 终态/未定义 → 409
  action.guard(ctx)                                     # 角色/原因/时间/当前态
  rows = orderMapper.casStatus(orderId, action.from(), action.to(), reason, now)
  if rows == 0: throw new OrderStateException(current)  # 并发竞争失败 → 409（重新读取）
  action.apply(ctx)                                     # 仅 CAS 成功者执行库存/ledger/审计
  afterCommit publish StockChangedEvent（如库存变化）
```

- **CAS 是第二道防线**：即使两个管理员同时确认，只有一个 `UPDATE ... WHERE status='Pending'` 成功；另一个 409，不会重复 `reserved→sold`。
- 审计：每次 Action 写 1 条 `audit_log(action=ORDER_<TYPE>, before/after status, actor_type=EMPLOYEE|ADMIN|SYSTEM, reason, ip, requestId)`。
- 所有入口统一经 Executor：`POST /orders/{id}/cancel` → `CANCEL`；`PATCH /admin/orders/{id}/status` 的 `toStatus` 映射 `Confirmed→CONFIRM`、`Completed→COMPLETE`、`Cancelled→CANCEL`；定时任务 → `TIMEOUT_CANCEL` / `AUTO_COMPLETE`。

#### 4.5.4 终态可达保证（Termination Guarantee）

| 非终态 | 保证路径 | 上界 |
|---|---|---|
| `Pending` | 用户/管理员 `CANCEL`，或 30 分钟 `TIMEOUT_CANCEL`，或 `CONFIRM→Confirmed` | 创建后 ≤30 分钟（除非先转 Confirmed） |
| `Confirmed` | 管理员 `COMPLETE`，或配送日 23:59 `AUTO_COMPLETE` | `delivery_date 23:59:59`（Asia/Shanghai；已过则下一轮任务立即完成） |
| `Completed` / `Cancelled` | 终态，无出边 | 已终止 |

- 因此任意订单最迟在 **max(创建+30 分钟, 配送日 23:59:59)** 到达终态；`Confirmed` 在未来配送日期间保持非终态是业务预期（有明确上界），不是悬挂。
- 定时任务：
  - `PendingOrderReleaser`：60s 扫描 `Pending AND created_at<now()-30m LIMIT 100`，逐单 `TIMEOUT_CANCEL`（独立事务，CAS 防重）。
  - `ConfirmedOrderAutoCompleter`：60s 扫描 `Confirmed AND (delivery_date<CURDATE() OR (delivery_date=CURDATE() AND now>=23:59)) LIMIT 100`，逐单 `AUTO_COMPLETE`；启动时补跑一次。
  - 两者均幂等：第二次执行 CAS 影响 0 行，不重复释放库存/写 ledger/审计。
- 可观测：`webox_orders_transition_total{action,from,to}`、`webox_orders_non_terminal_overdue`（超过上界仍非终态=告警）；`/health` 附最近一次任务执行时间。
- 单实例 `@Scheduled` 满足演示；多实例需 ShedLock/DB 锁（只文档说明，A-23）。

#### 4.5.5 状态机测试（对应 AC-019/027/042/060、D4）

- `OrderStateMachineTest`：全迁移矩阵（合法 5 条全部通过；`Confirmed→Cancelled`、`Completed→*`、`Cancelled→*`、同态、未知组合全部 409）；终态出度为 0；每个非终态 BFS 可达终态。
- `OrderTransitionExecutorIT`：两个管理员并发 CONFIRM，仅 1 次成功、1 次 409，`reserved/sold` 只搬一次。
- `OrderTerminalizationIT`：Pending 超 30 分钟→Cancelled；Confirmed 配送日过期→Completed；重复触发无第二次 ledger/审计。
- 所有 Action 的副作用必须在 CAS 成功后执行；回滚时状态、库存、ledger、审计一起回滚（同一 T1/T2 事务边界，见 §4.1）。

### 4.6 截单与自动切换（AC-024/025）

- `AppClock`：`Clock` Bean，默认 `Clock.system(Asia/Shanghai)`；`TestClockFilter` 在 test 开关下把请求头时间放入 request attribute，`AppClock.now()` 优先读取，异步线程回退系统时钟。
- `CutoffResolver.resolve(requestedDate, requestedMeal, now)` 严格按 `architecture.md` §7：
  1. 过去日期→400 `VALIDATION_DATE_PAST`；
  2. 未来日期→原样（校验该日菜单 PUBLISHED，否则 409）；
  3. 当日且 `now < cutoff(meal)`→原样（**等于即关闭**，A-04）；
  4. 当日 Lunch 已截且 `now<15:00`→当日 Dinner；
  5. 当日均截且 `now>=15:00`→次日 Lunch；
  6. 切换后无已发布菜单→409 `ORDER_MEAL_UNAVAILABLE`；`autoSwitched=true`。
- preview 与 submit 调同一函数；submit 以提交时刻重算并回写，前端成功页以服务端值为准（G1-02）。
- 单测覆盖 09:59:59/10:00:00/10:01、14:59:59/15:00:00/15:01、16:00 跨日、过去日期（TC-039a–g）。

### 4.7 锁顺序、隔离与死锁

- 隔离级别 READ COMMITTED；事务只锁 `dish_daily_stock` 命中的行、`orders` 插入的唯一键、`idempotency_records` 的 T0 短行。
- 扣减按 `dishId ASC`；取消/确认同样按 `order_items.dish_id ASC` 释放，避免与下单交叉死锁。
- 死锁：捕获 `DeadlockLoserDataAccessException`/1213 → Facade 外层重试 1 次（T1 全新事务）；仍失败→500 `INTERNAL`（T2 记 FAILED，可重试）。
- 超时：Hikari 3s、Socket 5s；下单 P95≤500ms，单事务 SQL ≤8 条。

## 5. 数据访问

### 5.1 Mapper 清单

| Mapper | 关键方法 |
|---|---|
| `UserMapper` | `findByEmail`, `insert`, `findById` |
| `RefreshTokenMapper` | `insert`, `findValid`, `revoke`, `revokeAllForUser` |
| `PreferenceMapper` / `AddressMapper` | `find/upsert`, `list/insert/delete` |
| `DishMapper` | `findOnShelfById`, `search`, `insert`, `update`, `updateStatus`, `findByIds` |
| `DailyMenuMapper` | `listByDate`, `findPublished`, `upsert`, `updatePublish` |
| `StockMapper` | `findForUpdate`, `findByDate`, `reserve`, `release`, `confirm`, `adjustTotal`, `listByDate`, `reconcile` |
| `OrderMapper` | `insert`, `findByIdAndUser`, `findById`, `listByUser`, `findActive`, `casStatus`, `listPendingBefore`, `dashboard*` |
| `OrderItemMapper` | `batchInsert`, `listByOrderId` |
| `LedgerMapper` | `insert`, `sumByDishDate`, `listByOrder` |
| `IdempotencyMapper` | `insertInProgress`, `findAndLock`, `casTakeover`, `complete`, `fail`, `deleteExpired` |
| `AuditMapper` | `insert`, `search` |
| `AiMapper` | `activeRule`, `insertRule`, `insertConversation`, `listConversations` |

全部 MyBatis `#{}` 参数绑定；LIKE 在 Java 侧对 `%`/`_`/`\` 转义并使用 `ESCAPE '\\'`；禁止 `${}`（代码审查 + grep 门禁）。

### 5.2 菜单查询（核心）

```sql
SELECT d.id AS dish_id, d.name, d.description, d.price_cents, d.category, d.protein,
       d.allergens, d.spice_level, d.image_url,
       s.total_qty - s.reserved_qty - s.sold_qty AS available_qty
  FROM daily_menu m
  JOIN dishes d ON d.id = m.dish_id AND d.status = 'ON_SHELF'
  JOIN dish_daily_stock s ON s.dish_id = m.dish_id AND s.serve_date = m.serve_date
 WHERE m.serve_date = #{date} AND m.publish_status = 'PUBLISHED'
   AND (#{categoryCount} = 0 OR d.category IN (...))
   AND (#{search} IS NULL OR (d.name LIKE CONCAT('%',#{search},'%') ESCAPE '\\'
        OR d.description LIKE CONCAT('%',#{search},'%') ESCAPE '\\'))
 ORDER BY d.name ASC
 LIMIT #{offset}, #{size};
```

- 静态字段缓存（§6）；`available_qty` 每次 live 查询，不缓存。
- 分页总数单独 `COUNT(*)` 同条件；`for-you` 在内存中对当前页按偏好打分排序（20 行规模），不缓存个性化结果。

### 5.3 订单查询

- 我的订单：`WHERE user_id=#{uid} [AND status=?] ORDER BY created_at DESC LIMIT`。
- 详情：`orders` + `order_items` 两次查询；SELF 校验 `user_id`；ADMIN 全量。
- 管理端列表：地址 `AddressMasker.mask()`（保留首尾，中间 `***`）；不返回 `snapshot_json`。

### 5.4 看板聚合

- 今日：`SELECT status, COUNT(*), SUM(total_cents) FROM orders WHERE delivery_date=? GROUP BY status`；收入=非 Cancelled 的 `total_cents` 之和。
- Top 菜：`order_items JOIN orders` 非 Cancelled、当日，`SUM(qty) GROUP BY dish_id ORDER BY sold DESC LIMIT 10`。
- 午晚：按 `meal_type` 计数（非 Cancelled）。
- 近 7 天：Java 生成 `today-6..today` 日期序列，SQL `GROUP BY delivery_date` 后补 0，保证 7 点。
- 低库存：`0<available<=3`（含 0 则归 `lowStock` 列表，前端可区分 Sold out），按 available ASC。

## 6. 缓存与限流

### 6.1 Caffeine（ADR-004）

| Cache | Key | TTL | 内容 | 失效 |
|---|---|---|---|---|
| `menuQuery` | `date|page|size|categories|search` | 60s | 菜品静态字段 + 菜单成员关系（不含库存） | 管理端写 afterCommit `invalidateAll` |
| `dishDetail` | `dishId` | 60s | 菜品 + 选项组/选项（不含库存） | 同上 |
| `filters` | `filters` | 300s | 分类/辣度/过敏原枚举 | 同上 |
| `aiRules` | `configKey` | 60s | active 规则 JSON | 规则更新 afterCommit evict |
| `dashboard` | `date` | 5s | 看板聚合（可选） | TTL 自然过期 |

- 配置：`maximumSize=500`、`recordStats()`；缓存访问异常一律 catch 后回源 DB（缓存故障不 5xx）。
- **不缓存**：任何库存值、订单、用户、幂等记录、审计。
- 写后 ≤1s：管理端 Service 在事务提交后（`TransactionSynchronization.afterCommit`）清缓存并广播 SSE；多实例时本地缓存仅本实例失效（ADR-004 失效条件，演示单实例）。

### 6.2 限流（AC-049）

| 场景 | Key | 阈值 | 行为 |
|---|---|---|---|
| 登录 | `ip+email` / `ip` | 10/min / 20/min（计数所有尝试，成功不重置窗口） | 429 `RATE_LIMITED` + `Retry-After` |
| 下单 | `user` | 5/min（幂等重放不计） | 429 |
| AI | `user` | 10/min；并发信号量 4 | 429 / 排队≤1s |

实现：Caffeine `expireAfterWrite=1min` 计数器（单实例）；Redis 可用时可用 `INCR+EXPIRE`，不可用自动本地（不影响正确性）。

## 7. 安全与审计

1. **认证**：JWT HS256（`JWT_SECRET` 仅环境变量，≥32 字节，缺失启动失败）；claims `sub=userId, role, jti, iat, exp`；access 2h；refresh 32B 随机、SHA-256 入库、7d、**刷新即旋转**、登出撤销；篡改/过期 401 `AUTH_TOKEN_INVALID`。
2. **授权**：`SecurityFilterChain`：`/api/v1/auth/register|login|refresh`、`/api/v1/health` permitAll；`/api/v1/menu/stream` 由 `StreamAuthFilter` 处理（Bearer 或 ticket，失败 401）；`/admin/**` `hasRole('ADMIN')`；其余 authenticated。`AuthenticationEntryPoint`→401 `AUTH_UNAUTHORIZED`；`AccessDeniedHandler`→403 `FORBIDDEN`。员工调 `/admin/**` 必 403（AC-028）。
3. **SELF**：订单/地址/偏好查询一律带 `user_id` 条件；他人订单返回 404 `ORDER_NOT_FOUND`（防枚举，AC-051）。
4. **密码**：BCrypt cost 10；注册强制 `EMPLOYEE`（请求含 `role` 被忽略，A-01/AC-061）；响应/日志/审计永不含 `password_hash`/token。
5. **输入**：Bean Validation + 手写枚举/长度校验；金额只读 DB；图片校验扩展名 + 魔数（FFD8FF / 89504E47 / RIFF....WEBP）+ ≤5MB；上传文件名 UUID 化，禁止路径穿越。
6. **SQL 注入**：全部 `#{}`；LIKE 转义；`ORDER BY` 字段白名单（`name|price|created_at`）。
7. **CORS**：仅 `http://localhost:5173`（可配），头 `Authorization, Idempotency-Key, Content-Type`；`OPTIONS` 放行。
8. **审计**：`audit_log` 仅 INSERT；写操作在**同一业务事务**内写 `actor_id/action/object_type/object_id/before_json/after_json/reason/ip/request_id`；应用层无 update/delete mapper；审计 JSON 脱敏。
9. **错误**：500 统一 `{"code":"INTERNAL","message":"Internal server error"}`，不含栈/SQL/主机名；日志保留栈但脱敏 Authorization/Cookie/password。
10. **高风险确认**：管理端 #24/#27/#28/#31/#32/#33b/#37 服务层校验 `confirm==true`，否则 400 `VALIDATION_CONFIRM_REQUIRED`；`confirm=false` 不产生任何写入/审计（G3P-M3）。
11. **测试时钟与调度**：`X-Test-Clock` 只作用于请求线程；AC-060 的 30 分钟超时用 test-only `webox.test.time-offset-minutes`（`Clock.offset`）或 SQL 回拨 `created_at=now()-31m` 后等 ≤60s tick，禁止修改系统时钟（G3P-M1/G3T-B2）。

## 8. SSE 与 AI

### 8.1 菜单库存流（AC-036/037）

- `SseHub`：`ConcurrentHashMap<Long, Client{emitter,userId,serveDate}>`；`subscribe` 先 `snapshot`（当日 PUBLISHED 的 `{dishId,available}` 数组），再注册；`SseEmitter(timeout=0)`。
- 心跳：`@Scheduled(fixedRate=15000)` 向所有连接发 `: ping`；异常/完成移除。
- 事件：`afterCommit` 发布 `StockChangedEvent(dishId,serveDate)`；`StockEventPublisher` 在新只读事务查 `available` 后向匹配日期的连接发 `event: stock\ndata: {"dishId":9,"available":7}\n\n`；推送失败不影响订单。
- 断线：连接建立时 `retry:3000`；前端 3 次失败切 5s 轮询 `GET /menu`（前端职责）。
- 鉴权：主路径 `fetch + ReadableStream` 带 Bearer；兜底 ticket（60s，最多 3 次兑换，G2-BE-M7）；事件仅 `dishId+available`，不泄露名称/价格。

### 8.2 AI 推荐（AC-038–041）

```text
POST /ai/recommend → 限流(10/min,并发4) → 候选硬过滤（SQL/代码）
  → 有 Key：LLM 流式(连接3s/总20s) → 白名单校验 dishId → dish/reason 事件
  → 无 Key/超时/解析失败：规则打分 → fallback:true → 1s 内 dish/reason 事件
  → done{dishIds} → 异步写 ai_conversation（独立事务）
```

- 候选硬过滤：当日/生效餐次 PUBLISHED、`available>0`、`allergens ∩ user.allergens = ∅`、排除近 7 天 `created_at>=now-7d AND status!='Cancelled'`；候选 ≤50。
- 生效餐次：`now<10:00`→今日 Lunch；`<15:00`→今日 Dinner；否则次日 Lunch。
- LLM 只输出 `dishId+reason`；服务端丢弃候选外 dishId；价格/库存/权限永不由模型决定；prompt 只做数据传递，系统提示固定，不注入 DB 结构/密钥。
- 规则打分：`preferredCategory*3 + spiceMatch*2 + budgetFit*2 + protein*1 + taste*1`（权重取 `ai_rule_config` active，60s 缓存）；理由为英文模板，≤200 字符。
- 规则版本：PUT 新建 `version+1` 并激活；`rollbackToVersion` 复制旧配置为新版本；历史行不可变；审计；≤60s 生效。
- 落库：`ai_conversation(user_id,session_id,prompt,response_json,dish_ids,model,fallback,latency_ms)`。

## 9. 定时任务与对账

| 任务 | 频率 | 逻辑 |
|---|---|---|
| Pending 超时释放 | 60s | 查 `status='Pending' AND created_at<now()-30m LIMIT 100`；逐单经状态机 `TIMEOUT_CANCEL`（CAS→Cancelled + 释放 reserved + ledger RELEASE + 系统审计）；已处理跳过 |
| Confirmed 自动完成 | 60s + 启动补跑 | 查 `status='Confirmed' AND (delivery_date<CURDATE() OR (delivery_date=CURDATE() AND now>=23:59)) LIMIT 100`；逐单经状态机 `AUTO_COMPLETE`（仅状态+系统审计，不动库存）；保证终态可达 |
| 幂等清理 | 1h | `DELETE FROM idempotency_records WHERE expires_at < now() LIMIT 1000` |
| Redis 对齐 | 30s | 对 `REDIS_PREALLOC` 菜品 `SET key = DB available`（DB 账本） |
| refresh 清理 | 1h | 删除 `expires_at<now()` 或 `revoked=1` 且过期 |

- 单实例 `@Scheduled` 足够（演示）；多实例需 ShedLock/DB 锁，本阶段只文档说明（A-23）。
- 对账：`GET /admin/inventory/reconcile` 按 §3.2(f) 返回 `drift[]`，不自动改账；修正走 `POST /admin/inventory/adjust`（ADJUST + 审计 + 原因）。

## 10. 可观测与测试

### 10.1 日志/指标

- 日志格式：`ts level requestId userId method path status durationMs msg`；MDC 由 `RequestIdFilter` 注入；慢请求（>1s）WARN；5xx ERROR 含栈（不进响应）。
- 关键指标（Micrometer 可选，或日志计数）：下单成功/失败、`STOCK_INSUFFICIENT`、幂等重放/冲突、ledger 写入失败、SSE 连接数、AI fallback 率、Redis 降级次数。
- `/health`：`{status,db,redis,cache}`；DB down→503；Redis disabled→`DOWN` 但 `status:UP`（可选增强，不影响核心）。

### 10.2 测试清单

| 层 | 用例 | 断言 |
|---|---|---|
| U1 `CutoffResolverTest` | 六边界+跨日+过去日期 | 与 `acceptance-matrix` AC-024/025 一致 |
| U2 `MoneyTest` | 加料组合 `3580+300×2+...` | `totalCents=7760`，无浮点 |
| U3 `OrderStateMachineTest` | 全迁移矩阵/终态吸收/同态/未知动作/非终态可达终态 | 合法 5 条通过；其余 409；终态出度 0 |
| U3b `OrderTerminalizationIT` | Pending>30min、Confirmed 配送日过期、重复触发 | 到达 Cancelled/Completed；二次触发无副作用 |
| U4 `CanonicalJsonTest` | items/option 顺序不同同 hash；价格字段不参与 | 同键重放 |
| U5 `RuleRecommenderTest` | 过敏/售罄/近 7 天过滤 | 候选集正确 |
| I1 `AuthIT` | 注册/重复/登录/刷新/登出/限流 | MockMvc + DB 断言 |
| I2 `MenuIT` | 分页/筛选/搜索注入/详情选项 | 200/400/404 |
| I3 `OrderIT` | 预览/下单/唯一单/取消/快照/金额 | 201/409/DB ledger |
| I4 `IdempotencyIT` | 同键并发 5+串行 2；异体 | 1 单；重放同 body |
| I5 `StockIT` | 条件扣减/取消只回补一次/确认 | available、ledger 计数 |
| I6 `AuthzIT` | 员工→admin 403；他人订单 404；未登录 401 | 状态码 |
| I7 `AdminIT` | 改价/上下架/库存/状态流转/审计 | audit before/after |
| I8 `SseIT` | 订阅快照/下单后 stock/心跳 | 事件解析 |
| I9 `AiIT` | 无 Key fallback/候选过滤/规则回滚 | SSE 事件 |
| C1 `tests/concurrency/*.mjs` | 50 抢 10；同键并发 | 10 成功/40 409；1 单 |

### 10.3 测试数据构造

- 测试库：`req_6343a752e110_test`（`application-test.yml` 覆盖 `DB_URL`），Flyway 自动建表+种子；**不用演示库**（G2-BE-M9）。
- 50 并发用户：`tests/sql/seed_users.sql` 直插 `race_<runId>_01..60@test.com`，统一 BCrypt hash（`Passw0rd1`），不经注册接口（规避限流）；`runId` 由脚本注入。
- 重置：`tests/sql/reset.sql` 仅清订单/明细/ledger/幂等/地址/库存占用并重播种子，附 `ALLOW_DEMO_RESET` 保护。
- 低库存/售罄：管理端 #32 设 3/0（审计），测后恢复；`REDIS_PREALLOC` 用 dish 1/9。
- 时钟：`application-test.yml` `webox.test.clock-enabled=true`；请求带 `X-Test-Clock`；生产 profile 反向用例断言 400。
- Redis 用例：`REDIS_ENABLED=false` 跑全主链路；单开 `RedisStockIT` 在 Redis 可用时验证预占/停 Redis 降级（不可用记 NOT TESTED）。

## 11. Stage 4 实施拆解（60 分钟，后端 1 人）

### 11.1 文件清单与顺序

**P0（0–37 分钟，必须）**

| 顺序 | 文件 | 内容 | 预估 |
|---|---|---|---|
| 1 | `backend/pom.xml`、`application.yml`、`WeboxApplication.java` | 骨架、依赖、配置 | 4min |
| 2 | `db/migration/V1__schema.sql`、`V2__seed.sql` | 复制 `docs/schema.sql` 拆分 | 3min |
| 3 | `common/**`、`config/**`、`security/**` | 响应/异常/requestId/Clock/JWT/Security | 7min |
| 4 | `auth/**`、`user/**` | 注册/登录/刷新/登出/me/偏好/地址 | 6min |
| 5 | `catalog/MenuController+MenuService+DishQueryRepository` | 菜单/详情/筛选 | 5min |
| 6 | `inventory/DbAtomicInventoryService+LedgerRepository` | 条件扣减/ledger | 4min |
| 7 | `order/**`（Facade/Tx/Idempotency/Snapshot）+ `order/statemachine/**` | 预览/下单/列表/详情/取消/active；状态机 + 5 个 Action + Executor | 14min |

**P1（37–54 分钟）**

| 顺序 | 文件 | 内容 | 预估 |
|---|---|---|---|
| 8 | `admin/AdminDish*`、`AdminMenu*` | 菜品 CRUD/上下架/图片/每日菜单/库存 | 7min |
| 9 | `admin/AdminOrder*`、`audit/**` | 状态流转/审计 | 4min |
| 10 | `realtime/**` | SSE Hub/ticket/afterCommit/心跳 | 4min |
| 11 | `inventory/PendingOrderReleaser`、`order/statemachine/ConfirmedOrderAutoCompleter`、`ReconcileService`、`AdminInventory*` | 超时/自动完成/对账/调整 | 4min |

**P2（54–60 分钟，可顺延 Stage 5）**

| 顺序 | 文件 | 内容 | 预估 |
|---|---|---|---|
| 12 | `analytics/**`、`AdminDashboard*` | 看板 | 3min |
| 13 | `ai/**`、`AdminAiRule*` | AI SSE/规则/降级 | 5min |
| 14 | `inventory/RedisPrealloc*` | Lua 预占/补偿/对齐 | 3min |
| 15 | `src/test/**`、`scripts/reseed_today.sql`、`scripts/backup.sh` | 单测/集成/种子跨天/备份 | 5min |

### 11.2 实现顺序原则

1. 先 `auth` + `catalog`（可登录、可看菜单）→ 再 `cart preview` → `order`（交易核心）→ `inventory admin` → `SSE/AI/看板`。
2. 每完成一层立即 `curl` 冒烟，不攒到最后。
3. 交易核心（金额/幂等/唯一单/条件扣减/ledger/取消）优先于任何 UI 支撑接口。
4. 时间不足：砍 AI/看板/Redis 预占（P2），**不砍**幂等、防超卖、权限、快照、审计。

### 11.3 验收命令（每步可独立执行）

```bash
BASE=http://127.0.0.1:8080/api/v1
# 1 健康与种子
curl -s $BASE/health
mysql -h127.0.0.1 -utest -ptest123456 req_6343a752e110 -e \
 "SELECT COUNT(*) FROM dishes; SELECT COUNT(*) FROM daily_menu WHERE serve_date=CURDATE();"
# 2 登录
TOKEN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
 -d '{"email":"employee@webox.com","password":"Employee123"}' | jq -r .data.accessToken)
# 3 菜单
curl -s "$BASE/menu?page=1&size=20" -H "Authorization: Bearer $TOKEN" | jq '.data.total'
# 4 预览+下单（替 dishId=9 为当日菜）
curl -s -X POST $BASE/orders/preview -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
 -d '{"items":[{"dishId":9,"qty":1,"optionIds":[15,17]}]}' | jq '.data.totalCents'
curl -s -X POST $BASE/orders -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
 -H "Idempotency-Key: $(uuidgen)" -d '{"items":[{"dishId":9,"qty":1,"optionIds":[15,17]}]}' | jq '.data.orderNo'
# 5 库存与 ledger
mysql -h127.0.0.1 -utest -ptest123456 req_6343a752e110 -e \
 "SELECT * FROM dish_daily_stock WHERE dish_id=9; SELECT entry_type,qty FROM inventory_ledger ORDER BY id DESC LIMIT 3;"
# 6 构建与单测
cd backend && /opt/maven/bin/mvn -q test
```

## 12. 风险与降级

| 风险 | 触发 | 行为 | 证据/处置 |
|---|---|---|---|
| Redis 不可用 | 未启动/超时 | `REDIS_PREALLOC` 请求整体降级 `DB_ATOMIC`；限流回本地；不 500、不超卖 | 停 Redis 跑 TC-066；`/health.redis=DOWN` |
| 无 LLM Key/超时 | 环境无 Key | 1s 内 SSE `meta.fallback=true` + 规则推荐；不 500 | TC-063；真实模型质量 NOT TESTED |
| 时区漂移 | JVM/DB 非 +08 | 截单错误 | JDBC sessionVariables + `-Duser.timezone`；单测固定 Clock |
| 图片缺失 | 未复制 20 图 | 前端占位图，不裂图 | Stage 4 复制 `frontend/public/images/`；404 回退 |
| 种子跨天 | 次日演示 | 当日菜单为空 | 演示前 `scripts/reseed_today.sql`；README 注明 |
| schema 变更 | 实现发现缺列/索引 | 不得静默改 | 回写 `architecture.md`/`data-model.md` → `V3__*.sql` |
| 幂等 T0/T2 失败 | DB 抖动 | 业务结果已返回但快照缺失 | 日志 WARN + 唯一键防重；下一同键请求按 30s 接管 |
| SSE 连接泄漏 | 客户端不关 | 心跳失败移除；上限 200 连接 | 监控连接数 |
| 多实例 | 扩容 | 本地缓存/限流不一致 | 文档化 ADR-004；演示单实例 |

## 13. G3 自检（后端部分）

| 检查项 | 结论 | 证据 |
|---|---|---|
| 39 端点全部有实现映射 | **PASS（39/39）** | §2.2 表 #1–#38 + #33b |
| 下单事务/幂等/唯一单/条件扣减/ledger/回补/截单/快照/5 份上限落到类与 SQL | **PASS** | §4.1–§4.6、§3.2；`OrderFacade/OrderTxService/InventoryService` |
| 独立状态机模块 + Action A→B + 终态定义 + 所有订单可达终态 | **PASS** | §4.5；`OrderStateMachine/OrderAction/OrderTransitionExecutor`；Completed/Cancelled 吸收；Pending 30min、Confirmed 配送日 23:59 自动终态 |
| 双库存策略与降级明确，DB 为账本 | **PASS** | §4.4；Lua + INCR 补偿 + 30s 对齐 |
| 权限/审计/限流/校验/参数化查询 | **PASS** | §7、§6.2；`#{}`、LIKE 转义、白名单 |
| SSE/AI 降级/缓存失效 | **PASS** | §8、§6.1；afterCommit、fallback、TTL60s |
| 测试与测试数据构造可执行 | **PASS** | §10；独立测试库、50 用户 SQL、reset |
| 与 `schema.sql` / `api-contract.md` 无冲突 | **PASS（0 结构变更）** | 17 表直接复用；契约歧义在 `cross-review-g2.md` 登记并给默认决策 |

### 13.1 后端评分卡映射（G3P-M5）

| 评分项 | 实现落点 | AC 锚点 |
|---|---|---|
| BE-1 缓存 | `catalog/MenuCache`（Caffeine，TTL60s，afterCommit invalidateAll，库存不入缓存）§6.1 | AC-030/045 |
| BE-2 幂等 | `order/IdempotencyService` + `idempotency_records` 唯一键 + T0/T1/T2 §4.2 | AC-015/053 |
| BE-3 注入防护 | MyBatis `#{}`、LIKE 转义、ORDER BY 白名单、全局异常不泄 SQL §5.1/§7 | AC-008/047/050 |
| BE-4 权限 | `config/SecurityConfig` + `JwtAuthFilter` + Service SELF 404 + `/admin/**` 403 §7 | AC-028/033/051 |
| BE-5 并发/防超卖 | `inventory/DbAtomicInventoryService` 条件 UPDATE + `OrderStateMachine` CAS + ledger 唯一 §3.2/§4.4/§4.5 | AC-018/019/035/043/060 |

## 14. Scenario checks（设计覆盖）

| Profile / check | 结论 | 证据 |
|---|---|---|
| general-engineering GE-1~GE-7 | PASS | §1/§3.4 启动与种子；§1.4 统一包络；§7 参数化；§10 测试/证据 |
| transaction-order TO-1~TO-10 | PASS | TO-1 §4.1/§5.1；TO-2 §3.2(a)/§4.4；TO-3 §4.4/§4.5；TO-4 §4.2；TO-5 §4.3；TO-6 §4.5；TO-7 §4.6；TO-8 §4.1 快照；TO-9 §4.1；TO-10 §4.5 |
| 订单终态可达（评审 2026-11-14 22:12） | PASS | §4.5：Completed/Cancelled 为吸收终态；Pending→30min 超时；Confirmed→配送日 23:59 自动完成；终态出度 0；非终态均有到终态路径 |
| identity-access IA-1~IA-7 | PASS | §7 BCrypt/JWT/URL+SELF/审计/限流/校验/字段脱敏 |
| ai-llm AI-1~AI-6 | PASS（Tier3 可 N/A） | §8.2 硬过滤/白名单/fallback/SSE/规则版本/Key 仅环境变量 |
| 场景失败模式 12 项 | PASS | 超卖 §4.4；重复单 §4.3；重复回补 §3.2(b)/ledger 唯一；截单 §4.6；金额 §4.1；越权 §7；注入 §5.1；缓存 §6.1；Redis 降级 §4.4；AI 幻觉 §8.2 |
| 未实现项 | N/A | 真实 LLM 质量、双实例实跑（A-23）、支付/退款（D22） |

## 15. 下一步

- Stage 4 后端开发工程师：按 §11 顺序实施；P0 交易核心先交付，P2 可顺延。
- Stage 3b G3 评审：Architecture/产品/测试按 `cross-review-g2.md` 的 B1/M1–M9 核对本文件默认决策，需回写 `api-contract.md`/`test-plan.md` 的条目见 G2 M5/M6。
## 16. 变更记录

| 版本 | 时间 | 变更 | 触发 | 影响 |
|---|---|---|---|---|
| v1.0 | 2026-11-14 22:08 | 初版：39 端点映射、T0/T1/T2 事务、双库存、截单、SSE/AI、Stage 4 拆解 | Stage 3 任务 | 基线 |
| v1.1 | 2026-11-14 22:14 | 新增独立状态机模块（§4.5）：Action 负责 A→B、Completed/Cancelled 终态吸收、终态可达保证；定时任务增加 Confirmed 自动完成；测试与 Stage 4 拆解同步 | 郑田评审意见“要有单独的状态机模块……订单最终都要到达终态” | `orders.status` 不变、API 不变；Stage 4 增加 `order/statemachine/**` 与 `ConfirmedOrderAutoCompleter` |
