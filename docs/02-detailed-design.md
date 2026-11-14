# 02 · 详细设计（后端 + 前端）

> 来源：`docs/raw/backend-design.md`（后端技术方案设计师）、`docs/raw/frontend-design.md`（前端技术方案设计师），均经 G2/G3 评审。

---

# 第一部分：后端详细设计

# 后端实现方案 — WeBox 企业员工餐食订购平台

- 版本：v1.1（Stage 3 后端技术方案设计师，2026-11-14 22:14 CST；v1.1 变更：独立订单状态机模块 + 终态定义与终态可达保证，响应 2026-11-14 22:12 评审意见）
- 输入：`docs/raw/architecture.md`、`docs/raw/api-contract.md`、`docs/raw/data-model.md`、`docs/raw/schema.sql`、`docs/raw/prd-analysis.md`、`docs/raw/acceptance-matrix.md`、`docs/raw/scenario-profile.md` v2、`docs/raw/assumptions.md`、`docs/raw/test-plan.md`、`docs/raw/test-cases.md`、`RUNBOOK.md`
- 评审：`docs/raw/cross-review-g2.md`（CHANGES：1 blocker + 8 major，本文件逐项给默认决策）
- 约束：JDK17 / Spring Boot 3.3.x / MySQL 8 / Redis 可选 / 端口 8080 / `/api/v1`；金额整数分；事务内禁止 LLM、HTTP、SSE。
- 结论：**PASS（可进入 Stage 4）**；39/39 端点有实现映射；17 表 DDL 直接采用 `docs/raw/schema.sql`（无 schema 变更）。

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

- 事实源：`docs/raw/schema.sql`（17 表，MySQL 8.0.46 已实跑；`utf8mb4`；金额 BIGINT 分）。
- Flyway：`backend/src/main/resources/db/migration/V1__schema.sql`（复制 §DDL 部分）、`V2__seed.sql`（复制种子部分）。**不修改表结构**；若 Stage 4 发现必须加索引/列，按规则回写 `docs/raw/architecture.md` + `docs/raw/data-model.md` 后另起 `V3__*.sql`，不得静默漂移。
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
- 图片：`docs/raw/product_images/` 20 张 → Stage 4 复制为 `frontend/public/images/image_01..20.jpg`（后端上传目录 `./uploads/images/` 用于新增图）。
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
| 2 | `db/migration/V1__schema.sql`、`V2__seed.sql` | 复制 `docs/raw/schema.sql` 拆分 | 3min |
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


---

# 第二部分：前端详细设计

# 前端技术方案 — WeBox 员工餐食订购平台

- 版本：v1.0（Stage 3 前端技术方案设计师，2026-11-14 22:18 CST）
- 输入：`docs/raw/architecture.md`、`docs/raw/api-contract.md`、`docs/raw/data-model.md`、`docs/raw/test-plan.md`、`docs/raw/test-cases.md`、`docs/raw/prd-analysis.md`、`docs/raw/acceptance-matrix.md`、`docs/raw/scenario-profile.md` v2、`docs/raw/assumptions.md`、`RUNBOOK.md`
- 评审：`docs/raw/cross-review-g2-frontend.md`（CHANGES，2B+9M）；发现台账：`docs/raw/review-findings.md`（G2FE-*）
- 结论：**PASS（设计完成，可进入 Stage 4）**；契约缺口以前端防御性实现兜底，不虚报。
- 目标工程：`/home/gem/code/req-squad/workspace/6343a752-e110-407c-8dfb-a5873425d917/frontend/`

## 1. 技术选型与工程结构

### 1.1 选型与理由

| 项 | 选型 | 理由 / 失效条件 |
|---|---|---|
| 框架 | React 18 + TypeScript（strict） | 生态稳、团队熟悉；列表/表单/流式 UI 组件化成本低 |
| 构建 | Vite 5 | 启动 <1s，`/api` proxy 免 CORS；生产 `dist/` 可由后端静态托管 |
| 路由 | React Router 6（`createBrowserRouter`） | 嵌套路由 + 守卫 + 深链；刷新不 404 需后端 SPA fallback（README 写明） |
| 状态 | Zustand 4（auth / cart / stock / ui）+ React Context（Toast） | 比 Redux 轻；persist 中间件直接满足 localStorage；50 道菜规模无需 RTK Query |
| 服务端数据 | 自研 `useApiQuery`（AbortController + 内存 cache + 失效） | **不引入 TanStack Query**：50 分钟窗口减少依赖与配置风险；缓存语义只需“菜单写后刷新” |
| 样式 | CSS Variables + CSS Modules | 无 Tailwind 构建配置成本；三档断点用 media query 明写 |
| 图表 | Recharts（仅 Console 看板，`React.lazy` 分包） | PRD 指定柱状/折线；懒加载避免拖慢员工端首屏 |
| 图标 | 内联 SVG（12 个） | 无额外依赖、可 `currentColor` 换色 |
| 测试钩子 | `data-testid` + `VITE_API_BASE_URL` | 配合 `tests/e2e/checklist.md` |

### 1.2 目录结构（Stage 4 按此创建）

```text
frontend/
├── index.html
├── package.json                 # scripts: dev/build/lint/typecheck
├── tsconfig.json                # strict:true, noUncheckedIndexedAccess:true
├── vite.config.ts               # server.port=5173, proxy /api,/images -> 127.0.0.1:8080
├── .env.example                 # VITE_API_BASE_URL=/api/v1
├── public/
│   ├── images/image_01.jpg … image_20.jpg   # 由 docs/raw/product_images 复制重命名
│   └── images/placeholder.svg
└── src/
    ├── main.tsx                 # createRoot + RouterProvider
    ├── App.tsx                  # 全局布局 + ToastProvider + ErrorBoundary
    ├── api/
    │   ├── client.ts            # fetch 封装、Bearer、超时、401 单飞刷新、错误映射
    │   ├── errors.ts            # ERROR_MESSAGES + mapApiError
    │   ├── sse.ts               # fetch+ReadableStream 解析 event/data
    │   ├── endpoints.ts         # 38 端点常量（见 §2.3）
    │   └── types.ts             # 契约 DTO（含 G2FE-B1/B2 预留字段）
    ├── components/
    │   ├── layout/ AppLayout.tsx ConsoleLayout.tsx Header.tsx BottomBar.tsx
    │   ├── ui/ Button.tsx Input.tsx Select.tsx Checkbox.tsx Modal.tsx Drawer.tsx
    │   │      Toast.tsx Skeleton.tsx EmptyState.tsx ErrorState.tsx Pagination.tsx Badge.tsx
    │   ├── dish/ DishCard.tsx DishGrid.tsx FilterBar.tsx SearchBox.tsx StockBadge.tsx
    │   ├── dish/ OptionGroup.tsx PriceSummary.tsx AllergenModal.tsx
    │   ├── cart/ CartLine.tsx CartSummary.tsx CartDrawer.tsx
    │   ├── order/ OrderCard.tsx OrderTable.tsx OrderItems.tsx CancelOrderModal.tsx
    │   ├── console/ DishForm.tsx ConfirmReasonModal.tsx DailyMenuTable.tsx
    │   │           InventoryReconcile.tsx AuditTable.tsx DashboardCharts.tsx
    │   └── ai/ AiAssistant.tsx AiDishCard.tsx FallbackBadge.tsx
    ├── pages/
    │   ├── auth/ LoginPage.tsx RegisterPage.tsx
    │   ├── employee/ MenuPage.tsx DishDetailPage.tsx CartPage.tsx CheckoutPage.tsx
    │   │            OrderSuccessPage.tsx OrdersPage.tsx OrderDetailPage.tsx PreferencesPage.tsx
    │   ├── console/ DashboardPage.tsx DishesPage.tsx DailyMenuPage.tsx ConsoleOrdersPage.tsx
    │   │            InventoryPage.tsx AuditPage.tsx AiRulesPage.tsx
    │   └── system/ ForbiddenPage.tsx NotFoundPage.tsx
    ├── routes/ router.tsx RequireAuth.tsx RequireAdmin.tsx
    ├── store/ authStore.ts cartStore.ts stockStore.ts uiStore.ts
    ├── hooks/ useApiQuery.ts useDebounce.ts useMenuStream.ts useIdempotencyKey.ts
    │         usePreferences.ts useMediaQuery.ts useDocumentTitle.ts
    ├── i18n/ en.ts              # 全部用户可见文案（英文），key 清单见 §8
    ├── styles/ tokens.css global.css
    ├── types/ api.ts domain.ts
    └── utils/ money.ts validation.ts datetime.ts cart.ts
```

### 1.3 环境变量 / 代理 / 命令

```bash
# environment
VITE_API_BASE_URL=/api/v1          # 可注入（E2E 指向 mock/其他端口）
VITE_APP_NAME=WeBox
VITE_SSE_POLL_MS=5000              # SSE 降级轮询间隔
VITE_REQUEST_TIMEOUT_MS=15000
VITE_AI_TIMEOUT_MS=25000

# vite.config.ts
server: { port: 5173, proxy: {
  '/api':    { target: 'http://127.0.0.1:8080', changeOrigin: true },
  '/images': { target: 'http://127.0.0.1:8080', changeOrigin: true } } }

# commands
npm ci
npm run dev -- --port 5173        # 开发（proxy /api → 8080）
npm run typecheck                 # tsc --noEmit（strict）
npm run build                     # tsc -b && vite build，产物 dist/
npm run preview -- --port 5173
```

- ESLint：`eslint:recommended` + `@typescript-eslint` + `react-hooks`；CI 门禁 `npm run typecheck && npm run build` 必须 0 error。
- 图片：复制并重命名 20 张 `docs/raw/product_images/image_NN_*.jpg → frontend/public/images/image_NN.jpg`，校验 `ls public/images/*.jpg | wc -l == 20`；`imageUrl` 缺失或 404 时用 `placeholder.svg`（`onError` 兜底，不裂图）。

## 2. 路由与页面

### 2.1 路由清单（19 条：员工 10 + Console 7 + 系统 2）

| # | 路径 | 页面 | Tier | 守卫 | 主要 API | 关键 testid |
|---|---|---|---|---|---|---|
| R01 | `/login` | LoginPage | T1 | 公开（已登录→按角色跳转） | `POST /auth/login` | `login-email` `login-password` `login-submit` `login-error` |
| R02 | `/register` | RegisterPage | T1 | 公开 | `POST /auth/register` → 自动登录 | `register-email` `register-password` `register-submit` |
| R03 | `/menu` | MenuPage（默认首页） | T1 | 登录 | `GET /menu`、`/menu/filters`、SSE `/menu/stream` | `menu-grid` `menu-card-{dishId}` `add-to-cart-{dishId}` `stock-badge-{dishId}` |
| R04 | `/menu/:dishId` | DishDetailPage | T1 | 登录 | `GET /menu/{dishId}` | `dish-detail` `dish-price` `option-{optionId}` `detail-add-to-cart` |
| R05 | `/cart` | CartPage | T1 | 登录 | 无（本地）→ 结算前 preview | `cart-page` `cart-line-{lineId}` `cart-qty-plus` `cart-total` `cart-empty` |
| R06 | `/checkout` | CheckoutPage | T1 | 登录 | `POST /orders/preview`、`POST /orders`、`/me/addresses` | `checkout-total` `checkout-submit` `checkout-existing-order` `budget-warning` `auto-switch-banner` |
| R07 | `/orders/:orderId/success` | OrderSuccessPage | T1 | 登录 | `GET /orders/{orderId}`（刷新兜底） | `order-success` `order-no` `order-delivery` |
| R08 | `/orders` | OrdersPage | T1 | 登录 | `GET /orders?page&size&status` | `orders-list` `order-row-{orderNo}` `orders-empty` |
| R09 | `/orders/:orderId` | OrderDetailPage | T1 | 登录（本人；ADMIN 可读） | `GET /orders/{orderId}`、`POST /orders/{id}/cancel` | `order-detail` `order-status` `order-cancel` |
| R10 | `/preferences` | PreferencesPage | T2 | 登录 | `GET/PUT /me/preferences`、`GET /menu/filters` | `pref-allergen-{name}` `pref-budget-max` `pref-save` `pref-recommend-toggle` |
| R11 | `/console` | DashboardPage | T3 | ADMIN | `GET /admin/dashboard` | `dashboard-tiles` `dashboard-top10` `dashboard-trend` `dashboard-lowstock` |
| R12 | `/console/dishes` | DishesPage | T2 | ADMIN | `GET/POST/PUT /admin/dishes`、`PATCH .../status`、`POST .../image` | `console-dishes` `dish-create` `dish-edit-{id}` `dish-status-{id}` `confirm-reason` |
| R13 | `/console/daily-menu` | DailyMenuPage | T2 | ADMIN | `GET/PUT /admin/daily-menu`、`PUT .../stock` | `daily-menu-date` `daily-menu-row-{dishId}` `daily-menu-publish` `daily-menu-qty` |
| R14 | `/console/orders` | ConsoleOrdersPage | T2（P2 子项） | ADMIN | `GET /admin/orders`、`PATCH /admin/orders/{id}/status` | `console-orders` `admin-order-status-{id}` |
| R15 | `/console/inventory` | InventoryPage | T3 | ADMIN | `GET /admin/inventory/reconcile`、`POST .../adjust` | `inventory-drift` `inventory-adjust` |
| R16 | `/console/audit` | AuditPage | T2 | ADMIN | `GET /admin/audit-logs` | `audit-table` `audit-filter-action` |
| R17 | `/console/ai-rules` | AiRulesPage | T3（P2） | ADMIN | `GET/PUT /admin/ai-rules` | `ai-rules-config` `ai-rules-save` |
| R18 | `/403` | ForbiddenPage | — | 登录 | — | `forbidden-page` |
| R19 | `*` | NotFoundPage | — | 公开 | — | `not-found-page` |

> AI 助手不是独立路由，而是 MenuPage 内的 Drawer（`AiAssistant`），保留 `?ai=1` 深链打开（E2E 稳定）。

### 2.2 守卫与跳转

```text
未登录访问受保护路由 → /login?next=<encoded>  （登录成功后按 next 回跳，缺省按角色）
EMPLOYEE 访问 /console/** → /403（不渲染任何 Console 组件；API 403 由 client 兜底）
ADMIN 登录成功 → /console（可从 Header 回 /menu）
token 过期：client 单飞 refresh 成功→重放原请求；失败→清 store→/login
404：未知路径 → NotFoundPage（含 Back to Menu）
```

- `RequireAuth`：`authStore.status === 'loading'` 时渲染全屏 Skeleton（避免刷新闪登录页）；`anonymous` → 跳转；`authenticated` 渲染 `<Outlet/>`。
- `RequireAdmin`：角色不是 `ADMIN` → `<Navigate to="/403" replace/>`；不做“隐藏菜单按钮”式假权限（AC-028 要求后端 403 + 前端不渲染）。

### 2.3 API 端点常量（与 api-contract 38 个一一对应）

`src/api/endpoints.ts` 按契约编号导出，禁止页面内拼字符串：

```ts
export const EP = {
  register:'/auth/register', login:'/auth/login', refresh:'/auth/refresh',
  logout:'/auth/logout', me:'/auth/me',
  prefs:'/me/preferences', addresses:'/me/addresses',
  menu:'/menu', dish:(id:number)=>`/menu/${id}`, filters:'/menu/filters',
  stream:'/menu/stream', streamTicket:'/menu/stream-ticket',
  preview:'/orders/preview', orders:'/orders', order:(id:number)=>`/orders/${id}`,
  activeOrder:'/orders/active', cancel:(id:number)=>`/orders/${id}/cancel`,
  adminOrders:'/admin/orders', adminOrderStatus:(id:number)=>`/admin/orders/${id}/status`,
  adminDishes:'/admin/dishes', adminDish:(id:number)=>`/admin/dishes/${id}`,
  adminDishStatus:(id:number)=>`/admin/dishes/${id}/status`,
  adminDishImage:(id:number)=>`/admin/dishes/${id}/image`,
  dailyMenu:'/admin/daily-menu',
  dailyMenuStock:(d:string,id:number)=>`/admin/daily-menu/${d}/${id}/stock`,
  reconcile:'/admin/inventory/reconcile', adjust:'/admin/inventory/adjust',
  dashboard:'/admin/dashboard', audit:'/admin/audit-logs',
  aiRules:'/admin/ai-rules', aiRecommend:'/ai/recommend', health:'/health',
} as const;
```

## 3. 组件与交互

### 3.1 菜单页（R03）

- **DishCard**：`<article>` 图片（`loading="lazy"`、4:3、`onError` 占位）、名称（2 行截断）、`formatMoney(priceCents)`、菜系 chip、辣度 chip、`StockBadge`；`For You` 开启且 `item.forYou` → 高亮描边 + `For you` 徽标（AC-022）。
- **StockBadge**：`soldOut` → 灰度蒙层 + `Sold out`（Add 禁用）；`lowStock` → 橙色 `Low stock`；否则 `Available`。**数量展示仅来自 SSE `available`（整数）**：未收到 SSE 计数前不虚构 `Only N left`；收到后显示 `Only N left`（1–3）/`N available`。契约若补菜单 `availableQty:int`（见 §10 缺口-14 / G2-BE-M2），直接改用该字段。
- **Add 行为**（契约缺口 B1 的防御实现）：
  - `item.hasRequiredOptions === true`（字段未上线前用 `item.hasOptions !== false && item.hasOptions !== undefined` 无法判定 → 统一打开详情 Drawer/跳详情）；
  - 无必选项 → 直接 `cartStore.add(dish, [])`，并做 300ms 节流 + 在途禁用（FE-3）；
  - 购物车总份数 ≥5 → 禁用并显示 `Order limit reached: max 5 items per order.`；售罄禁用。
- **FilterBar**：6 个菜系多选（`aria-pressed`），选择后以 `category=Chinese,Japanese` 请求（OR 并集，AC-007）；清空按钮。
- **SearchBox**：受控输入，`maxLength=50`，300ms 防抖后写 URL `?search=`；粘贴 >50 截断并提示；命中数显示 `N dishes found`；空结果 EmptyState（含 Clear filters）。
- **排序开关**：`For You` toggle → `sort=for-you`；关闭 → `sort=default`；刷新保留（URL `?sort=` + 偏好同步）。
- **分页**：`page/size` 写 URL；默认 `size=20`；上一页/下一页 + 页码；`page*size >= total` 时禁用；切换筛选/搜索重置 `page=1`。20→50+ 菜品：服务端分页 + 单页 ≤20 卡片 + `React.memo(DishCard)`，不做虚拟列表（单页 20 行无需；避免复杂度）。
- **URL 即状态**：`/menu?page=1&size=20&category=Chinese,Japanese&search=chicken&sort=default`，刷新/深链/E2E 可复现。

### 3.2 菜品详情与选项（R04）

- 布局：桌面左图右信息；移动单列，底部固定 `PriceSummary`（价格 + Add to Cart，≥44px）。
- 选项组：`minSelect===maxSelect===1` 用 radio；多选且 `maxSelect>1` 用 checkbox（达到上限禁用其余并提示 `Up to N selections`）；`required` 组标 `Required`。
- 实时加价：`unitPriceCents = priceCents + Σ selected.priceDeltaCents`；`formatMoney` 展示；不做任何 float 运算（选项加价均为整数分）。
- 必选校验：未满足时 Add 禁用并提示 `Please select: Bun, Sauce`；maxSelect 超出不可点（UI 层）+ 服务端 400 兜底。
- 过敏原（T2）：`prefs.allergens ∩ dish.allergens` 非空 → `AllergenModal`：`This dish contains an allergen you flagged: Egg. Add anyway?`；`Add anyway` → 加购；`Cancel` → 关闭（不过滤该菜，AC-021）。
- Add 成功：Toast `Added to cart` + 购物车角标 + 不自动跳转；同配置再次 Add 合并数量（AC-011）。

### 3.3 购物车（R05）

- 数据模型（§5.2）按 `dishId + sorted(optionIds)` 分行；同菜不同配置不同行；行内展示选项名（如 `Whole Wheat · Mustard · Cheese (+¥3.00)`）。
- `+`：总份数 5 时禁用；`−`：降到 0 删除该行；删除按钮；清空按钮（二次确认）。
- 总价：`cartStore.totalCents()` 用整数分累加；空态 `Your cart is empty` + `Browse menu`，总价 `¥0.00`。
- 刷新持久化：Zustand `persist` 写 `localStorage['webox.cart.v1']`（`version` 字段 + 迁移函数，脏数据丢弃）。
- `Proceed to Checkout` → `/checkout`；空车禁用。
- 价格快照仅用于展示：结算 preview 返回服务端价；若 `preview.totalCents !== cart.totalCents` → 顶部横幅 `Prices were updated. New total: ¥xx.xx.` 并用 preview 明细覆盖显示（提交仍以服务端为准）。

### 3.4 结算与提交（R06，交易主路径）

1. 进入即 `POST /orders/preview`（`items:[{dishId,qty,optionIds}]`，`deliveryDate`/`mealType`/`address` 可选）：渲染明细/`totalCents`/`effectiveDate`/`effectiveMeal`/`cutoffAt`/`budgetExceeded`/`addresses`/`existingOrderId`。
2. **截单自动切换**：`autoSwitched=true` → 横幅 `Lunch has closed. Your order will be placed for Dinner on 2026-11-14 (cutoff 15:00).`；`effectiveMeal` 按契约枚举 `Lunch|Dinner` 映射文案（不直接大写拼接，规避 G2FE-M6）。
3. **唯一有效单**：`preview.existingOrderId` 存在 → 主按钮变 `View Existing Order` → 跳 `/orders/{id}`；用户改餐次/日期后重新 preview。
4. **预算**：`budgetExceeded=true` → 黄色提示 `This order exceeds your meal budget (¥15.00). You can still place it.`，不阻断（AC-023）。
5. **地址**：下拉历史地址（`GET /me/addresses`）+ `New address` 输入（≤200，超长前端提示；后端 400 同文案）；新地址提交订单前 `POST /me/addresses`（409 已存在则忽略），再下单。
6. **日期/餐次**：默认 today + Lunch（A-09/PRD）；日期选项 today/+1/+2（D21 种子），空菜单日期由 preview 409 处理并提示切换（缺口 M2）；餐次 Lunch/Dinner。
7. **提交防抖 + 幂等**：
   - 按钮 `disabled + loading`（`Placing order…`），提交期间不可再点；
   - `Idempotency-Key = crypto.randomUUID()`，按“规范化请求体 hash”存入 `sessionStorage['webox.idem.v1']`；同 body 重试复用同一 key，body 变化或成功后清除；
   - 超时/5xx 允许同一 key 重试 1 次（同键重放安全）；4xx 不自动重试；
   - 成功后 `cartStore.clear()` → `/orders/{id}/success`。
8. **错误分支**：`STOCK_INSUFFICIENT` → 行内标红 + `Only N left for {dish}` + `Adjust cart`；`ORDER_DUPLICATE` → 按钮切 `View Existing Order`；`ORDER_MEAL_UNAVAILABLE` → 提示改日期/餐次；`ORDER_LIMIT_EXCEEDED` → 回购物车；`RATE_LIMITED` → 禁用 30s 倒计时；`IDEMPOTENCY_CONFLICT` → 提示刷新购物车（body 已变化）。
9. **成功页**：`orderNo`、`deliveryDate`、`mealType`、`address`、`estimatedDelivery`、`totalCents`；`View order` / `Back to menu`。

### 3.5 我的订单 / 详情 / 取消（R08/R09）

- 列表：状态 Tabs（All/Pending/Confirmed/Completed/Cancelled）+ 分页；桌面表格、移动卡片；字段 `orderNo/status/totalCents/itemCount/deliveryDate/mealType/createdAt`；空态 `No orders yet`。
- 详情：`orderNo` + 状态 Badge + 配送信息 + 明细（名称/选项/单价/数量/小计，服务端快照）+ 总价；`Pending` 且本人 → `Cancel order`；`Confirmed/Completed` 不显示取消按钮（AC-019）。
- 取消：Modal 填写原因（可选，≤200）→ `POST /orders/{id}/cancel`；成功 Toast `Order cancelled` + 状态刷新；409 `ORDER_STATE_INVALID` → Toast + 刷新详情。
- 订单号等文案使用 `font-variant-numeric: tabular-nums`，便于 E2E 读取。

### 3.6 偏好设置（R10）

- 过敏原多选（7 枚举）、偏好菜系多选（6）、辣度单选（None/Mild/Medium/Hot）、口味单选（Light/Balanced/Rich，契约未定义枚举 → 前端默认，见 §10）、预算 min/max（元输入，转分提交）、`For You` 开关。
- 预算校验：`0 < min <= max`，元→分用字符串解析（`"15.5" → 1550`），禁止 `parseFloat*100`；超限英文提示。
- 保存：`PUT /me/preferences` 全量；成功后更新 `prefsStore`（过敏原立即用于加购弹窗）并 Toast；失败保留输入 + 错误提示。
- 服务端不可用时：显示上次成功值（localStorage 镜像），保存按钮可用但提示重试；不阻断浏览。

### 3.7 Console（R11–R17）

- **布局**：左侧 Sidebar（Dashboard/Dishes/Daily Menu/Orders/Inventory/Audit/AI Rules），顶部用户邮箱 + `Back to store`；移动端 Sidebar 折叠为 Drawer。
- **Dishes（R12）**：表格列（图/名/分类/价/辣度/状态/操作）；搜索 300ms 防抖、分类/状态筛选、分页（与服务端 `page/size` 对齐）。新增/编辑用 Drawer 表单：名称 ≤100、描述 ≤1000、价格元→分、分类下拉、蛋白 ≤50、过敏原多选、辣度、图片（jpg/png/webp ≤5MB，本地预览 + 尺寸/类型校验）。新增：`POST /admin/dishes` → 有图再 `POST /admin/dishes/{id}/image`。编辑：`PUT` 必带 `confirm+reason`（高风险弹窗）。上下架：`ConfirmReasonModal`（`I understand` 勾选 + 原因 1–200 + 影响说明 `This dish will be hidden from employees.`）→ `PATCH .../status`。
- **Daily Menu（R13）**：日期选择（默认次日，可切当日）；表格列出菜品 + `published` 开关 + `totalQty`（≥0）+ 展示 `reserved/sold/available` + `inventoryMode`（DB_ATOMIC/REDIS_PREALLOC）；单行保存 `PUT .../stock`（confirm+reason），批量发布 `PUT /admin/daily-menu`（confirm+reason）；`totalQty=0` 行标 `Sold out`；保存后提示 `Menu published`，员工端 ≤1s 可见（前端不做强缓存）。
- **Orders（R14）**：状态/日期筛选 + 分页；地址列脱敏原样展示（后端已 `***`）；详情 Drawer（`GET /orders/{id}`，ADMIN 可见完整）；状态操作 Confirm/Complete/Cancel 均弹 `ConfirmReasonModal` → `PATCH /admin/orders/{id}/status`；状态机非法操作禁用（Pending 才能 Confirm/Cancel；Confirmed 才能 Complete）。
- **Inventory（R15）**：日期 + `Reconcile` 按钮 → 展示 `checked`、`drift[]`；`Adjust` 填写 `delta`（整数，可为负）+ reason → `POST /admin/inventory/adjust`；drift>0 红色告警条。
- **Audit（R16）**：action/objectType 筛选 + 分页；表格列 时间/操作者/动作/对象/前后值/原因/IP；before/after 用可折叠 `<pre>` 渲染 JSON（不注入 HTML）。
- **AI Rules（R17，P2）**：读取配置 JSON → 表单编辑权重 → `PUT /admin/ai-rules`（confirm+reason）；版本与更新时间展示；无回滚端点时显示 `Previous values are kept locally`（见 §10 缺口-09）。
- **Dashboard（R11）**：6 块——今日概览 5 个 tile（订单/收入/Completed/Pending/Cancelled）、Top10 柱状图（Recharts `BarChart`）、午晚对比（`BarChart` 双柱）、7 日趋势（`LineChart` 双 Y 轴：订单数、收入元）、低库存列表（`available ≤3`）；`Refresh` 按钮 + 60s 自动刷新（页面可见时）；空数据各图表显示 `No data for today`；加载 Skeleton；错误 ErrorState + Retry。
- **高风险统一**：所有写操作弹窗含“影响说明 + 必填原因（1–200）+ 勾选确认”，按钮 loading/disabled，成功 Toast 带对象名，失败展示 `code + message + requestId`。

### 3.8 AI 助手（T3，R03 Drawer）

- 入口：菜单页悬浮按钮 `Ask AI` + 空结果时的推荐入口；`?ai=1` 可深链。
- 输入 ≤500 字符 + 4 个快捷 prompt（`Something light` / `High protein` / `Not what I had yesterday` / `Spicy`）。
- 流式：`POST /ai/recommend`（`Accept: text/event-stream`，fetch+ReadableStream）；按事件渲染：
  - `meta` → `fallback:true` 显示 `Rule-based fallback` 徽标（AC-040）；
  - `dish` → 追加 `AiDishCard`（图/名/价/分类/库存；`available=0` 禁用 Add）；
  - `reason` → 对应卡片下追加理由（`aria-live="polite"`）；
  - `done` → 停止 loading，显示 `Add to cart` 可用；无结果 → 空态。
- 超时 25s（客户端 AbortController）→ 错误 `AI is taking too long. Please try again.`；429 → `Too many requests. Try again in a minute.`；断网 → `Connection lost. Check your network.` + Retry。
- 加购：AI 卡片与菜单卡片同规则（有必选项 → 打开详情；过敏原 → 弹窗）；AI 不决定价格/库存，价格用事件 `priceCents`，加购后以服务端 preview 为准。
- 多轮：前端生成/保存 `sessionId`（`sessionStorage`），请求携带；若 `meta` 未回传则本轮结束重置（缺口 M5）。

## 4. API 客户端

### 4.1 统一封装（`src/api/client.ts`）

```ts
type RequestOptions = { method?: HttpMethod; body?: unknown; headers?: Record<string,string>;
  signal?: AbortSignal; auth?: boolean; timeoutMs?: number; retry?: 0|1 };

async function request<T>(path: string, o: RequestOptions = {}): Promise<ApiEnvelope<T>>
```

- URL：`${import.meta.env.VITE_API_BASE_URL ?? '/api/v1'}${path}`；`Content-Type: application/json`（图片上传用 FormData，不设该头）。
- 鉴权：`Authorization: Bearer <accessToken>`（来自 `authStore`，内存）；`auth:false` 仅 login/register/refresh。
- 超时：AbortController + `setTimeout(timeoutMs ?? 15000)`；AI 25s；超时映射 `NETWORK_TIMEOUT`。
- 错误映射：非 2xx 解析 envelope；`401` 触发单飞 refresh（见 4.2）；`403` → `uiStore.toast(t('error.forbidden'))`；`429` → 限流文案；`5xx` → 通用文案 + requestId；网络错误 → 离线横幅。
- **204 短路**（G2FE-M1）：`if (res.status === 204) return {code:'OK',message:'',data:{} as T,requestId:res.headers.get('X-Request-Id') ?? ''}``。
- requestId：优先 body `requestId`，否则 `X-Request-Id`；错误 Toast 附 `Request ID: xxx`（便于排障，不含敏感信息）。
- 分页：`pageQuery({page,size=20,status?,category?,search?,sort?,date?})` 过滤空值；`size` 前端限制 1..100（`size>100` 不发请求，直接提示）。
- 重试边界：仅 `GET` 在网络错误/502/503 重试 1 次（指数退避 300ms）；`POST /orders` 仅在超时/5xx 时以**同一幂等键**重试 1 次；`POST /ai/recommend`、`/auth/login` 不自动重试。
- 幂等键：`useIdempotencyKey(body)` → `crypto.randomUUID()`（8–64），存 `sessionStorage`；键与 canonical body（`JSON.stringify` 排序后的 items/date/meal/address）绑定。

### 4.2 401 刷新（单飞）

```text
401 AUTH_TOKEN_INVALID
  ├─ 无 refreshToken → 清 auth → /login?next=...
  ├─ 已有 refresh 在途 → 挂起当前请求，等待同一 Promise
  └─ 发起 POST /auth/refresh {refreshToken}
       ├─ 200 → 写新 token 对 → 重放原请求（每个请求最多重放 1 次）
       └─ 401 → 清 auth → /login
refresh 失败/过期（7d）→ 同一路径登出；登出调用 POST /auth/logout（失败忽略）并清本地
```

- 启动恢复：内存无 accessToken 时，若 localStorage 有 refreshToken → 静默 refresh → `GET /auth/me` 校准角色；失败视为未登录（不白屏，显示登录页）。
- 存储：`accessToken` 仅内存；`refreshToken`+`user` 存 localStorage（键 `webox.auth.v1`）。风险：localStorage 可被 XSS 读取 → 前端不使用 `dangerouslySetInnerHTML`、CSP 预留、审计日志不打印 token（写入 §10 风险）。

### 4.3 SSE 消费（`src/api/sse.ts`）

```ts
export async function openSse(path: string, h: {onEvent:(e:string,d:string)=>void;
  signal: AbortSignal}): Promise<void>   // fetch + res.body.getReader()
// 解析：TextDecoder 累积 buffer；按 \n\n 分帧；逐行识别 event:/data:/retry:/: ping
// 只处理单行 JSON（契约固定）；JSON.parse 失败 → 忽略该帧并计数
```

- 库存流 `useMenuStream`：菜单页挂载连接 `/menu/stream`；`snapshot`（数组）与 `stock`（`{dishId,available}`）写入 `stockStore`；卡片用 `useStock(dishId)` 选择器订阅 → **只重渲染受影响卡片**（避免全量重渲染）。
- 断线：按 `retry:3000` 重连，连续失败 3 次 → 切 5s 轮询（`GET /menu` 当前查询，只取 `dishId/available` 合并）；恢复后停轮询并重连；UI 显示 `Live` / `Live updates paused — refreshing every 5s`（不阻断操作）。
- AI 流：同一解析器；事件名 `meta|dish|reason|done`；不自动重连，用户可 Retry；支持 `AbortController` 取消。
- 降级触发条件：`EventSource`/stream 不支持、401、连续 3 次网络错误、30s 无任何事件（含心跳）。

## 5. 状态与数据

### 5.1 authStore

```ts
{ status: 'loading'|'anonymous'|'authenticated'; user?: {id,email,role,displayName?};
  accessToken?: string; login(email,pw); register(...); logout(); bootstrap(); }
```

- `bootstrap()` 在 `main.tsx` 首帧调用（refresh + me）；`loading` 期间路由守卫渲染 Skeleton。
- 角色派生 `isAdmin = user.role === 'ADMIN'`；登录后跳转：`next` 优先，否则 ADMIN→`/console`、EMPLOYEE→`/menu`。

### 5.2 cartStore（localStorage）

```ts
type CartLine = { lineId:string; dishId:number; name:string; imageUrl?:string;
  basePriceCents:number; options:{optionId:number;name:string;priceDeltaCents:number}[];
  unitPriceCents:number; qty:number; addedAt:number };
type CartState = { lines:CartLine[]; totalQty():number; totalCents():number;
  add(dish, options): 'added'|'limit'|'soldout'; inc(lineId); dec(lineId);
  remove(lineId); clear(); replaceFromPreview(items,totalCents): void }
```

- 行键：`dishId + '|' + optionIds.sort((a,b)=>a-b).join(',')`；同键合并 `qty`（AC-011）。
- `unitPriceCents` 为整数分：`basePriceCents + Σ priceDeltaCents`；`qty` 上限受总份数 ≤5 约束；`dec` 到 0 删行。
- `persist`：`name:'webox.cart.v1'`，`partialize` 只存 `lines`；`version:1` + `migrate`；读取时校验字段（非法行丢弃）。
- 价格快照仅展示；**提交永远只用 `dishId/qty/optionIds`**（AC-016）。

### 5.3 服务端数据与失效

| 数据 | 位置 | 失效/刷新 |
|---|---|---|
| 菜单列表 | `useApiQuery(['menu', params])` 内存缓存 30s | 筛选/搜索/分页变化重取；Console 任何写操作后 `invalidate('menu*')`；SSE 只改库存 map 不改列表 |
| 菜品详情 | `useApiQuery(['dish', id])` | 进入详情必取；管理端改菜后不缓存 |
| 偏好 | `usePreferences` + `prefsStore`（localStorage 镜像） | 保存后更新 store；加购弹窗即时生效 |
| 地址簿 | `useApiQuery(['addresses'])` | 结算页进入取；新增地址后 invalidate |
| 订单列表/详情 | `useApiQuery(['orders', params])` | 取消/状态变更后 invalidate 对应 key |
| 看板 | 手动/60s 刷新 | 每次 `GET /admin/dashboard`；不做本地缓存 |
| 库存 | `stockStore`（SSE map） | snapshot/stock 覆盖；轮询每 5s 合并 |

- 所有请求 `AbortController` 在组件卸载/参数变化时取消，避免竞态覆盖（搜索快速输入）。
- 加载态：Skeleton 卡片（列表 6 个）/ 详情骨架 / 表格 5 行；空态：EmptyState（图标 + 文案 + 主操作）；错误态：ErrorState（英文 + Retry）；403/404 专用页。

### 5.4 列表性能

- 服务端分页默认 20，前端单页最多 100；`React.memo(DishCard)` + 稳定 key（dishId）→ 翻页/筛选只替换数据。
- 搜索 300ms 防抖 + 请求取消；筛选变更合并为一次请求（不逐项请求）。
- SSE 库存更新用选择器，仅重渲染库存变化的卡片（20–50 菜品流畅；无需虚拟列表）。
- 看板图表懒加载；Recharts 只在 `/console` 路由 chunk 中。

## 6. 5 项前端质量锚点（评分卡落点）

| 锚点 | 实现点（文件/组件） | 具体方案 | 验收 |
|---|---|---|---|
| FE-1 响应式 | `styles/tokens.css` + `DishGrid.tsx` + `AppLayout.tsx` | 断点 `≤767`（375/768 单列/双列）、`768–1199` 双列、`≥1200` 三列；`grid-template-columns: repeat(auto-fill, minmax(260px,1fr))`；移动端底部操作栏（购物车总价 + Checkout）；Header 折叠为汉堡；表格在移动端转卡片（Console Dishes/Orders）；触控目标 ≥44px；`body{overflow-x:hidden}` 不作为唯一手段，必须实测 `scrollWidth ≤ innerWidth+1` | AC-052 / TC-075 三档截图 |
| FE-2 分页/长列表 | `useApiQuery` + `Pagination.tsx` + `MenuPage` URL 参数 | 服务端 `page/size`（默认 1/20，≤100）；筛选/搜索服务端执行；单页 ≤20 卡片；`memo` + 稳定 key；请求去重/取消；20→50+ 翻页无卡顿 | AC-006/007/045、TC-010/011 |
| FE-3 防抖/节流 | `useDebounce.ts`、`DishCard`、`CheckoutPage` | 搜索 300ms 防抖；加购 300ms 节流 + 在途 `disabled`（500ms 内 10 连点 ≤2 请求）；Place Order `disabled+loading` + 幂等键；`+` 连点串行更新本地状态（无网络） | AC-053、TC-076 |
| FE-4 价格精度 | `utils/money.ts` `formatMoney/parseYuanToCents` | 全链路整数分；`formatMoney(7760)==='¥77.60'`（整数除法 + 补零，禁止 `toFixed` 于浮点中间值）；选项加价整数求和；元输入用字符串分割转分；无 `parseFloat*100`；全页面只通过 `formatMoney` 输出金额 | AC-010/011/016/054、TC-077 正则 `^¥\d+\.\d{2}$` |
| FE-5 输入校验 | `utils/validation.ts` + 各表单 | 邮箱 ≤200 + 正则、密码 8–64 且含字母数字、地址 ≤200、搜索 ≤50（`maxLength` + 提交前拦截）、菜名 ≤100、描述 ≤1000、原因 1–200、预算 `0<min≤max`；错误文案与后端错误码一一映射；边界值 200/50/64 通过 | AC-003/008/029/048、TC-003/071 |

### 6.1 金额工具（必须逐字实现）

```ts
export const formatMoney = (cents: number): string => {
  const n = Math.trunc(cents); const sign = n < 0 ? '-' : ''; const abs = Math.abs(n);
  return `${sign}¥${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};
export const parseYuanToCents = (input: string): number | null => {
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  const yuan = Number(m[1]); const frac = (m[2] ?? '').padEnd(2, '0');
  return yuan * 100 + Number(frac);
};
```

## 7. 异常态、可访问性与文案

### 7.1 状态矩阵

| 场景 | UI | 文案 key |
|---|---|---|
| 页面加载 | Skeleton（列表 6 卡/详情 1/表格 5 行） | `common.loading` |
| 空列表/空购物车/无订单/无搜索结果 | EmptyState + 主操作 | `menu.empty` `cart.empty` `orders.empty` `menu.noResults` |
| 网络/5xx | ErrorState + Retry + Request ID | `error.network` `error.server` `common.retry` |
| 401 | 跳登录（保留 next） | `error.sessionExpired` |
| 403 | `/403` 页 + `Back to menu` | `error.forbidden` |
| 404 | NotFoundPage；订单他人 404 → `Order not found` | `error.notFound` |
| 429 | Toast + 30s 倒计时/禁用 | `error.rateLimited` |
| 库存不足 409 | 行内标红 + `Only N left` + Adjust cart | `error.stockInsufficient` |
| 售罄 | 卡片灰度 + Add 禁用 | `menu.soldOut` |
| 低库存 1–3 | 橙色徽标 | `menu.onlyLeft` |
| 过敏原 | 弹窗确认，可继续 | `allergen.title` `allergen.addAnyway` |
| 预算超限 | 结算页黄色提示，不阻断 | `checkout.budgetExceeded` |
| 截单切换 | 横幅说明生效餐次/日期 | `checkout.autoSwitched` |
| 重复有效单 | 按钮 `View Existing Order` | `checkout.viewExistingOrder` |
| SSE 断开/降级 | 顶部细条 `Live updates paused…` | `stock.polling` |
| AI 降级 | 徽标 `Rule-based fallback` | `ai.fallback` |
| AI 超时/断网 | 卡片内错误 + Retry | `ai.timeout` `ai.offline` |
| 图片缺失 | 占位图 | `common.imageUnavailable` |

### 7.2 可访问性

- 所有表单 `<label htmlFor>` + `aria-invalid` + `aria-describedby` 指向错误文本；错误用 `role="alert"`。
- Modal/Drawer：`role="dialog" aria-modal="true"`、焦点陷阱、Esc 关闭、打开时锁 body 滚动、关闭后焦点回到触发按钮。
- Toast：`aria-live="polite"`，3s 自动消失，可手动关闭；错误 Toast 5s。
- 键盘：筛选 chips 用 `<button aria-pressed>`；数量 `+/-` 为按钮；卡片标题是链接；可见 `:focus-visible` 2px 描边。
- 对比度：正文 `#1f2937` on `#ffffff` ≥ 7:1；橙色低库存徽标配深色文字 ≥ 4.5:1；不仅靠颜色传达状态（同时有文本）。
- 触控目标 ≥44×44px；移动端底部栏不遮挡内容（`padding-bottom: 88px`）。

## 8. 文案 key 清单（英文，`src/i18n/en.ts`）

> 全部用户可见文案走 `t(key)`；禁止在 JSX 写死中文；E2E 通过 `data-testid` + 英文确定性文案断言。以下为**完整 key 集合**（值即英文文案）。

```ts
export const en = {
  'app.name': 'WeBox', 'common.loading': 'Loading…', 'common.retry': 'Retry',
  'common.cancel': 'Cancel', 'common.confirm': 'Confirm', 'common.save': 'Save',
  'common.close': 'Close', 'common.back': 'Back', 'common.next': 'Next',
  'common.previous': 'Previous', 'common.page': 'Page {page} of {total}',
  'common.imageUnavailable': 'Image unavailable',
  'nav.menu': 'Menu', 'nav.cart': 'Cart', 'nav.orders': 'My Orders',
  'nav.preferences': 'Preferences', 'nav.console': 'Console', 'nav.logout': 'Sign out',
  'nav.backToStore': 'Back to store',
  'auth.login.title': 'Sign in to WeBox', 'auth.login.submit': 'Sign in',
  'auth.register.title': 'Create your account', 'auth.register.submit': 'Create account',
  'auth.email': 'Email', 'auth.password': 'Password', 'auth.displayName': 'Display name (optional)',
  'auth.toRegister': 'New here? Create an account', 'auth.toLogin': 'Already have an account? Sign in',
  'auth.login.failed': 'Incorrect email or password.',
  'auth.emailExists': 'This email is already registered.',
  'auth.emailFormat': 'Enter a valid email address.',
  'auth.passwordPolicy': 'Password must be 8–64 characters and include letters and numbers.',
  'auth.sessionExpired': 'Your session expired. Please sign in again.',
  'menu.title': 'Today’s Menu', 'menu.searchPlaceholder': 'Search dishes…',
  'menu.searchTooLong': 'Search is limited to 50 characters.',
  'menu.filters': 'Filters', 'menu.clearFilters': 'Clear filters',
  'menu.forYou': 'For You', 'menu.forYouBadge': 'For you',
  'menu.noResults': 'No dishes match your search.', 'menu.empty': 'No dishes are available today.',
  'menu.available': '{count} available', 'menu.onlyLeft': 'Only {count} left', 'menu.soldOut': 'Sold out',
  'menu.addToCart': 'Add to cart', 'menu.added': 'Added to cart',
  'menu.viewDetails': 'View details', 'menu.found': '{count} dishes found',
  'menu.orderLimit': 'Order limit reached: max 5 items per order.',
  'detail.required': 'Required', 'detail.optional': 'Optional', 'detail.selectUpTo': 'Select up to {count}',
  'detail.pleaseSelect': 'Please select: {groups}', 'detail.allergens': 'Allergens', 'detail.protein': 'Protein',
  'detail.spice': 'Spice level', 'detail.description': 'Description', 'detail.addToCart': 'Add to cart',
  'allergen.title': 'Allergen warning',
  'allergen.message': 'This dish contains an allergen you flagged: {allergens}. Add anyway?',
  'allergen.addAnyway': 'Add anyway',
  'cart.title': 'Your Cart', 'cart.empty': 'Your cart is empty.', 'cart.browseMenu': 'Browse menu',
  'cart.subtotal': 'Subtotal', 'cart.total': 'Total', 'cart.checkout': 'Proceed to checkout',
  'cart.remove': 'Remove', 'cart.clear': 'Clear cart', 'cart.qty': 'Quantity',
  'cart.priceUpdated': 'Prices were updated. New total: {total}.',
  'checkout.title': 'Checkout', 'checkout.items': 'Order items', 'checkout.deliveryDate': 'Delivery date',
  'checkout.mealType': 'Meal', 'checkout.lunch': 'Lunch', 'checkout.dinner': 'Dinner',
  'checkout.address': 'Delivery address', 'checkout.newAddress': 'New address', 'checkout.saveAddress': 'Save this address',
  'checkout.placeOrder': 'Place Order', 'checkout.placing': 'Placing order…',
  'checkout.viewExistingOrder': 'View Existing Order',
  'checkout.budgetExceeded': 'This order exceeds your meal budget ({budget}). You can still place it.',
  'checkout.autoSwitched': '{meal} has closed. Your order will be placed for {effectiveMeal} on {date} (cutoff {cutoff}).',
  'checkout.cutoff': 'Order by {time}', 'checkout.empty': 'Your cart is empty. Add dishes before checking out.',
  'checkout.stockInsufficient': 'Only {available} left for {dish}. Please adjust your cart.',
  'checkout.adjustCart': 'Adjust cart', 'checkout.dateUnavailable': 'No menu is published for this date. Choose another date.',
  'checkout.confirmSwitch': 'Continue with {effectiveMeal} on {date}',
  'orders.title': 'My Orders', 'orders.empty': 'No orders yet.', 'orders.orderNo': 'Order number',
  'orders.status': 'Status', 'orders.total': 'Total', 'orders.items': 'Items', 'orders.delivery': 'Delivery',
  'orders.createdAt': 'Placed at', 'orders.detail': 'Order details', 'orders.cancel': 'Cancel order',
  'orders.cancelReason': 'Reason (optional)', 'orders.cancelled': 'Order cancelled.',
  'orders.notFound': 'Order not found.', 'orders.view': 'View order',
  'order.status.Pending': 'Pending', 'order.status.Confirmed': 'Confirmed',
  'order.status.Completed': 'Completed', 'order.status.Cancelled': 'Cancelled',
  'success.title': 'Order placed!', 'success.message': 'Your order has been received.',
  'success.orderNo': 'Order number', 'success.viewOrder': 'View order', 'success.backToMenu': 'Back to menu',
  'prefs.title': 'Dietary Preferences', 'prefs.allergens': 'Allergens to avoid',
  'prefs.categories': 'Preferred cuisines', 'prefs.spice': 'Spice preference', 'prefs.taste': 'Taste preference',
  'prefs.taste.Light': 'Light', 'prefs.taste.Balanced': 'Balanced', 'prefs.taste.Rich': 'Rich',
  'prefs.budget': 'Meal budget', 'prefs.budgetMin': 'Minimum', 'prefs.budgetMax': 'Maximum',
  'prefs.budgetInvalid': 'Minimum must be greater than 0 and no more than maximum.',
  'prefs.recommendEnabled': 'Enable “For You” recommendations', 'prefs.saved': 'Preferences saved.',
  'console.title': 'Console', 'console.dashboard': 'Dashboard', 'console.dishes': 'Dishes',
  'console.dailyMenu': 'Daily Menu', 'console.orders': 'Orders', 'console.inventory': 'Inventory',
  'console.audit': 'Audit Log', 'console.aiRules': 'AI Rules',
  'console.todayOrders': 'Orders today', 'console.todayRevenue': 'Revenue today',
  'console.completed': 'Completed', 'console.pending': 'Pending', 'console.cancelled': 'Cancelled',
  'console.topDishes': 'Top 10 dishes', 'console.mealSplit': 'Lunch vs Dinner',
  'console.trend': 'Last 7 days', 'console.lowStock': 'Low stock (≤ 3)',
  'console.noData': 'No data for this period.', 'console.refresh': 'Refresh',
  'console.newDish': 'New dish', 'console.editDish': 'Edit dish', 'console.name': 'Name',
  'console.description': 'Description', 'console.price': 'Price (¥)', 'console.category': 'Category',
  'console.protein': 'Protein source', 'console.allergens': 'Allergens', 'console.spice': 'Spice level',
  'console.image': 'Image', 'console.imageHint': 'JPG, PNG or WebP, up to 5 MB.',
  'console.imageTooLarge': 'Image must be 5 MB or smaller.', 'console.imageType': 'Only JPG, PNG or WebP images are allowed.',
  'console.status': 'Status', 'console.onShelf': 'On shelf', 'console.offShelf': 'Off shelf',
  'console.publish': 'Publish', 'console.unpublish': 'Unpublish', 'console.totalQty': 'Total quantity',
  'console.inventoryMode': 'Inventory mode', 'console.serveDate': 'Serve date',
  'console.menuPublished': 'Menu published.', 'console.stockUpdated': 'Stock updated.',
  'console.reasonRequired': 'A reason is required.', 'console.reason': 'Reason',
  'console.confirmRisk': 'I understand this action affects employees and is audited.',
  'console.confirmOffShelf': 'This dish will be hidden from employees.',
  'console.adminOrderStatus': 'Update status', 'console.maskedAddress': 'Address is masked in the list.',
  'console.reconcile': 'Reconcile', 'console.drift': 'Drift', 'console.adjust': 'Adjust stock',
  'console.delta': 'Adjustment', 'console.driftZero': 'Inventory is reconciled.',
  'console.auditAction': 'Action', 'console.auditObject': 'Object', 'console.before': 'Before', 'console.after': 'After',
  'ai.title': 'AI Meal Assistant', 'ai.placeholder': 'Tell me what you feel like eating…',
  'ai.send': 'Ask AI', 'ai.thinking': 'Finding dishes for you…', 'ai.fallback': 'Rule-based fallback',
  'ai.quick.light': 'Something light', 'ai.quick.protein': 'High protein',
  'ai.quick.notYesterday': 'Not what I had yesterday', 'ai.quick.spicy': 'Something spicy',
  'ai.empty': 'No recommendations matched. Try another description.', 'ai.retry': 'Try again',
  'ai.timeout': 'AI is taking too long. Please try again.', 'ai.offline': 'Connection lost. Check your network.',
  'ai.rateLimited': 'Too many AI requests. Try again in a minute.', 'ai.addToCart': 'Add to cart',
  'error.network': 'Network error. Check your connection and try again.',
  'error.server': 'Something went wrong on our side. Please try again.',
  'error.forbidden': 'You do not have permission to view this page.',
  'error.notFound': 'Page not found.', 'error.rateLimited': 'Too many requests. Please wait a moment.',
  'error.validation': 'Please check the highlighted fields.', 'error.requestId': 'Request ID: {id}',
  'error.offline': 'You are offline. Some actions are unavailable.',
  'stock.live': 'Live stock', 'stock.polling': 'Live updates paused — refreshing every 5s',
} as const;
```

## 9. 测试钩子（E2E 契约）

### 9.1 `data-testid` 约定（稳定、语义化、不复用）

| 区域 | testid |
|---|---|
| 认证 | `login-email` `login-password` `login-submit` `login-error` `register-email` `register-password` `register-submit` |
| 菜单 | `menu-grid` `menu-card-{dishId}` `dish-name-{dishId}` `dish-price-{dishId}` `add-to-cart-{dishId}` `stock-badge-{dishId}` `filter-category-{Category}` `search-input` `sort-for-you` `pagination-next` |
| 详情 | `dish-detail` `dish-price` `option-{optionId}` `option-group-{groupId}` `detail-add-to-cart` `allergen-modal` `allergen-add-anyway` |
| 购物车 | `cart-page` `cart-line-{lineId}` `cart-qty-plus` `cart-qty-minus` `cart-remove` `cart-total` `cart-empty` `cart-checkout` |
| 结算 | `checkout-total` `checkout-date` `checkout-meal` `checkout-address` `checkout-submit` `checkout-existing-order` `budget-warning` `auto-switch-banner` `checkout-error` |
| 订单 | `order-success` `order-no` `order-delivery` `orders-list` `order-row-{orderNo}` `order-detail` `order-status` `order-cancel` `cancel-confirm` |
| 偏好 | `pref-allergen-{Allergen}` `pref-category-{Category}` `pref-budget-max` `pref-save` `pref-recommend-toggle` `pref-saved-toast` |
| Console | `console-dishes` `dish-create` `dish-edit-{id}` `dish-status-{id}` `confirm-reason` `confirm-risk-check` `confirm-submit` `daily-menu-date` `daily-menu-row-{dishId}` `daily-menu-qty` `daily-menu-publish` `console-orders` `admin-order-status-{id}` `inventory-drift` `inventory-adjust` `audit-table` `dashboard-tiles` `dashboard-refresh` |
| AI | `ai-open` `ai-input` `ai-send` `ai-fallback-badge` `ai-card-{dishId}` `ai-reason-{dishId}` `ai-error` |
| 全局 | `toast` `toast-error` `app-loading` `not-found-page` `forbidden-page` |

- 错误 Toast 必带 `data-error-code="{code}"`（如 `STOCK_INSUFFICIENT`）与 `data-request-id`，E2E 不解析自然语言。
- 所有可交互控件附 `aria-label`（英文）；金额文本只由 `formatMoney` 生成（正则可断言）。
- 确定性：不使用 `Date.now()`/随机数渲染文本；日期文案来自服务端 `effectiveDate/deliveryDate`；分页/筛选状态在 URL，E2E 可直接深链。
- 可注入 API base：`VITE_API_BASE_URL`；E2E 可用 `?e2e=1` 关闭非必要动画（`prefers-reduced-motion` 同等处理）。

### 9.2 与 tests/e2e/checklist.md 的对齐

- 登录：`input[type=email]` / `input[type=password]` 仍可用，同时推荐 `data-testid` 选择器；
- 加购连点：`[data-testid=add-to-cart]` 已存在（checklist 已使用该选择器）；
- 三档 viewport：375×812 / 768×1024 / 1440×900 的 `scrollWidth` 断言由 `run_e2e.sh` 执行，页面根节点 `#root` 不得设置固定宽度。

## 10. 契约缺口与前端处理（与 api-contract 对照）

| # | 缺口 | 影响页面 | 前端处理 | 状态 |
|---|---|---|---|---|
| 01 | 菜单项无 `hasOptions/hasRequiredOptions`（G2FE-B1） | Menu/AI | 过渡：Add 一律进详情；契约补字段后直接加购 | OPEN→Blocker |
| 02 | 订单详情无字段级 JSON（G2FE-B2） | OrderDetail/Success | 按 `data-model.md` `order_items` 列推断类型；`types.ts` 预留；E2E 断言改用可确定字段 | OPEN→Blocker |
| 03 | `DELETE /me/addresses` 204 无包络（M1） | Preferences/Cart | client 204 短路，返回空 envelope | 已兜底 |
| 04 | 无“已发布菜单日期”端点（M2） | Checkout | 日期仅 today/+1/+2；preview 409 提示切换；空态文案 | 已兜底 |
| 05 | 缺 `GET /admin/dishes/{id}`（M3） | Console Dishes | 编辑用列表行数据（契约若不含全字段，保存时只提交已知字段；缺字段提示） | 已兜底 |
| 06 | `expiresIn` 单位/refresh 轮换未定义（M4） | Auth | 按“秒”处理；每次 refresh 用返回的新 refreshToken（若未返回则保留旧值）；401 统一登出 | 已兜底 |
| 07 | AI `sessionId` 不回传（M5） | AI | 前端本地保存 sessionId；无回传则单轮 | 已兜底 |
| 08 | 看板 `mealSplit/trend` 口径未定义（M8） | Dashboard | 按“订单数、不含 Cancelled”展示，并在图表副标题标注口径；契约回写后对齐 | 已兜底 |
| 09 | AI 规则无回滚端点 | Console AI Rules | 不做“一键回滚”；仅展示当前版本 + 编辑保存；回滚记 `NOT TESTED` | 降级 |
| 10 | 口味枚举未定义（`tastePreference`） | Preferences | 前端固定 `Light/Balanced/Rich`（PRD 语义），提交字符串；后端若校验不同值则提示 | 假设 |
| 11 | 结算新地址无“下单时保存”标志 | Checkout | 下单前调用 `POST /me/addresses`（409 忽略），再提交订单 | 已兜底 |
| 12 | `ORDER_LIMIT_EXCEEDED` 为 400 而非 409 | Cart/Checkout | 错误映射按 code，不按 HTTP 猜 | 已对齐 |
| 13 | SSE 事件名在 §1/#14 与 §3.3 表述不完全一致 | Menu | 按端点消费：menu 流只处理 `snapshot/stock`；AI 流只处理 `meta/dish/reason/done`；未知事件忽略 | 已兜底 |
| 14 | 菜单 `available` 为 boolean，SSE/Console 为 int（BTL 已登记 `G2-BE-M2`）；`Only 3 left` 缺数量来源 | Menu/DishCard | 初始用 `lowStock` 显示 `Low stock`（不虚构数字）；SSE snapshot/stock 到达后用精确 `available` 显示 `Only N left`/`N available`；preview/下单以服务端为准 | 已兜底（建议契约增 `availableQty:int`） |

> 缺口 01/02 为 blocker，已登记 `G2FE-B1/B2`；其余为 major/降级，前端均有确定性兜底，不影响 Stage 4 开工。

## 11. Stage 4 实施拆解（50 分钟，22:35–23:25）

### 11.1 优先级与文件清单

| 优先级 | 里程碑 | 文件（新建） | 分钟 | 验收 |
|---|---|---|---|---|
| P0-M0 | 脚手架 + token + client | `package.json` `vite.config.ts` `tsconfig.json` `index.html` `src/main.tsx` `src/App.tsx` `styles/*` `api/client.ts` `api/errors.ts` `api/types.ts` `api/endpoints.ts` `utils/money.ts` `utils/validation.ts` | 6 | `npm run typecheck` 0 error；5173 打开 |
| P0-M1 | 认证与守卫 | `store/authStore.ts` `routes/*` `pages/auth/*` `components/layout/AppLayout.tsx` | 5 | 登录→刷新仍登录（AC-004）；员工进 `/console`→403（AC-028） |
| P0-M2 | 菜单列表 | `pages/employee/MenuPage.tsx` `components/dish/*` `components/ui/Pagination.tsx` `hooks/useDebounce.ts` | 8 | 20 卡 + 多选筛选 + 300ms 搜索 + 分页（AC-006/007/008） |
| P0-M3 | 详情与选项 | `pages/employee/DishDetailPage.tsx` `components/dish/OptionGroup.tsx` `PriceSummary.tsx` | 5 | Burger ¥38→¥41 实时（AC-010） |
| P0-M4 | 购物车 | `store/cartStore.ts` `pages/employee/CartPage.tsx` `components/cart/*` `components/dish/AllergenModal.tsx` | 5 | 同行合并/分行/总价/空态/刷新持久化（AC-011/012） |
| P0-M5 | 结算 + 幂等提交 | `pages/employee/CheckoutPage.tsx` `pages/employee/OrderSuccessPage.tsx` `hooks/useIdempotencyKey.ts` | 8 | 连点 10 次仅 1 单；自动切换横幅；预算提示（AC-015/023/024/025/053） |
| P0-M6 | 订单列表/详情/取消 | `pages/employee/OrdersPage.tsx` `OrderDetailPage.tsx` `components/order/*` | 4 | 取消 Pending→Cancelled；Confirmed 无取消（AC-017/018/019） |
| P0-M7 | 偏好 + For You | `pages/employee/PreferencesPage.tsx` `hooks/usePreferences.ts` `store/prefsStore.ts` | 3 | 过敏原弹窗 + 预算提示 + 软排序开关（AC-021/022/023） |
| P1-M8 | Console 菜品 + 每日菜单 | `routes/RequireAdmin.tsx` `components/layout/ConsoleLayout.tsx` `pages/console/DishesPage.tsx` `DailyMenuPage.tsx` `components/console/*` | 6 | 建菜→员工可见；下架 404；设当日库存（AC-029/030/031/032） |
| P1-M9 | Console 订单/审计 | `pages/console/ConsoleOrdersPage.tsx` `AuditPage.tsx` | 3 | 状态流转 + 审计查询（AC-019/032/042 前置） |
| P2-M10 | SSE 实时库存 | `api/sse.ts` `store/stockStore.ts` `hooks/useMenuStream.ts` | 4 | 两客户端 ≤2s 库存变化；断线轮询（AC-036/037） |
| P2-M11 | 看板 | `pages/console/DashboardPage.tsx` `components/console/DashboardCharts.tsx` | 5 | 6 块数据 + 刷新（AC-042） |
| P2-M12 | AI 助手 | `components/ai/*` | 5 | 流式卡片 + 理由 + 降级徽标（AC-038/039/040） |
| P2-M13 | 对账/规则/收尾 | `pages/console/InventoryPage.tsx` `AiRulesPage.tsx` | 3 | 对账 drift + 调整（AC-044） |

> P0 合计 44 分钟，P1 9 分钟，P2 17 分钟。硬门槛：**P0 全部完成后再动 P1/P2**。

### 11.2 时间盒内的裁剪线（明确“砍哪个”）

| 时点 | 若未完成 | 裁剪动作 |
|---|---|---|
| T+20（22:55） | 未完成 M4 | 跳过筛选多选，仅保留搜索；购物车保留核心加/减/删 |
| T+30（23:05） | 未完成 M5 | 结算页去掉历史地址下拉（仅输入）；保留幂等提交与错误分支 |
| T+40（23:15） | 未完成 M8 | Console 只做 Dishes 列表 + 上下架 + 当日库存表；Orders/Audit 标 `NOT TESTED` |
| T+45（23:20） | 未完成 P2 | 全部 P2 停止；SSE 保留 5s 轮询替代；AI/看板标 `N/A（Tier 3 未实现）` |

### 11.3 自测命令（开发每完成一个里程碑执行）

```bash
cd frontend
npm run typecheck                 # 必须 0 error（strict）
npm run build                     # 必须成功，无 TS/ESLint 阻断
npm run dev -- --port 5173        # 手测入口
curl -s http://127.0.0.1:8080/api/v1/health   # 依赖后端
bash ../tests/e2e/run_e2e.sh      # 三档 viewport 截图（Stage 5）
```

### 11.4 Definition of Done（前端）

- 19 条路由可达；员工端 10 页 + Console 7 页全部有加载/空/错误态。
- `npm run typecheck && npm run build` 通过；无 `any` 滥用（API DTO 除外）。
- 5 项锚点均有可运行证据：三档截图、分页、防抖网络日志、`¥77.60`、边界校验提示。
- E2E checklist 的 `data-testid` 全部存在；错误 Toast 带 `data-error-code`。
- 所有可见文案来自 `en.ts`；`grep -rP '[\x{4e00}-\x{9fa5}]' src/pages src/components` 仅注释命中。

## 12. 风险与降级

| # | 风险 | 影响 | 缓解 / 降级 |
|---|---|---|---|
| FR-1 | 契约 B1/B2 未在 Stage 4 前补齐 | 菜单加购入口、订单详情字段 | 过渡实现（Add→详情；类型按 data-model 推断）；E2E 用可确定字段；不虚报 |
| FR-2 | 50 分钟做不完 Console | Tier2 扣分 | 严格 P0 优先；Console 保 Dishes/Daily Menu 最小闭环，Orders/Audit 明示 NOT TESTED |
| FR-3 | SSE 不可用/被代理缓冲 | 实时库存失效 | 3 次失败切 5s 轮询；UI 明示；轮询只合并库存字段 |
| FR-4 | 图片路径/命名不一致 | 裂图 | 启动脚本复制 20 张为 `image_NN.jpg`；`onError` 占位；E2E 断言 `<img>` 自然宽度>0 |
| FR-5 | 时区/截单展示错误 | 用户误解餐次 | 结算页只展示服务端 `effectiveDate/effectiveMeal/cutoffAt`；前端不用本地时钟判定；日期按 `YYYY-MM-DD` 原样显示 |
| FR-6 | token 过期恰逢提交 | 下单失败/重复 | 单飞 refresh + 同幂等键重试；刷新失败跳登录并保留购物车（localStorage） |
| FR-7 | 5 份上限仅前端拦截 | 用户绕过 | 前端禁用 + API 400 双保险；错误映射 `ORDER_LIMIT_EXCEEDED` |
| FR-8 | 无 LLM Key | AI 空白/500 观感 | 契约保证 `fallback:true`；前端显示 `Rule-based fallback` 徽标；无 Key 不阻断 |
| FR-9 | CORS/代理（127.0.0.1 vs localhost） | 请求被拦 | 一律走 Vite 同源 `/api` proxy；不直连 8080；生产由后端同源托管 `dist` |
| FR-10 | localStorage 购物车脏数据/版本升级 | 页面崩溃 | `persist` version + `migrate` + 读取校验；异常清空并提示 |
| FR-11 | Console 表格在 375 宽度横向滚动 | AC-052 失败 | 移动端切换卡片列表；表格容器 `overflow:auto` 不作用于 `body`；实测 `scrollWidth` |
| FR-12 | 看板数字口径与 DB 不一致 | AC-042 争议 | 文案标注口径；以服务端聚合为唯一来源，前端不二次计算 |

## 13. G3 自检（前端部分）

| # | 检查项 | 结论 | 证据 |
|---|---|---|---|
| 1 | 全部员工端/Console 页面与路由有设计 | PASS | §2.1 R01–R19（员工 10 + Console 7 + 系统 2），含 Tier 标注与 API/testid |
| 2 | API 客户端/SSE/错误码/分页/金额/幂等键一致 | PASS | §4.1–4.3、§10 缺口表；错误码按 api-contract §1.1 映射，幂等键 8–64 UUID |
| 3 | 响应式、分页性能、防抖、价格精度、输入校验 5 项有实现点 | PASS | §6 表 + §6.1 代码；每条含文件/组件与验收 AC |
| 4 | 权限路由与 403/401 处理明确 | PASS | §2.2、§4.2；`RequireAuth/RequireAdmin`、单飞 refresh、/403 页 |
| 5 | 加载/空/错误态与英文文案明确 | PASS | §7.1 状态矩阵 + §8 `en.ts` 全量 key |
| 6 | 测试钩子可支撑 E2E | PASS | §9 `data-testid` 全表 + 错误码属性 + URL 状态 + `VITE_API_BASE_URL` |
| 7 | 与 api-contract 无冲突（有冲突登记） | PASS | §10 14 项缺口逐条登记；B1/B2 入 `review-findings.md` |
| 8 | 金额/校验规则与后端一致 | PASS | §6.1 `formatMoney/parseYuanToCents`；长度/密码/预算与 AC-003/048 一致 |

## 14. Scenario checks（设计阶段）

> 口径：本阶段只证明“方案覆盖 required_check”；运行时证据由 Stage 5 采集。`PASS` 指设计已给出可执行落点。

| Profile / check | 结论 | 设计证据 |
|---|---|---|
| transaction-order TO-1 金额整数分/服务端重算 | PASS | §6.1；提交只发送 `dishId/qty/optionIds`（§3.4-7）；`priceDisplay` 仅校验 |
| TO-2 不超卖（前端配合） | PASS | 库存徽标 + 售罄禁用 + 409 `STOCK_INSUFFICIENT` 明细映射（§3.4-8、§7.1） |
| TO-3 提交才占用/取消只回补一次（前端配合） | PASS | 加购仅本地（§5.2）；取消仅 Pending 显示（§3.5）；重复取消 409 提示 |
| TO-4 幂等 | PASS | §3.4-7 幂等键与同键重试；`useIdempotencyKey` |
| TO-5 唯一有效单 | PASS | `existingOrderId` → `View Existing Order`（§3.4-3） |
| TO-6 状态机 | PASS | §3.5/§3.7 按钮可用性映射状态；非法迁移依赖服务端 409 |
| TO-7 截单/自动切换 | PASS | §3.4-2 横幅 + 生效餐次回显；不使用客户端时钟 |
| TO-8 订单快照 | PASS | 订单详情只读渲染服务端快照（§3.5）；前端不改价 |
| TO-9 5 份上限 | PASS | 加购/`+` 禁用 + 文案（§3.1/§3.3）+ 400 映射 |
| TO-10 仅 Pending 可取消 | PASS | §3.5 取消按钮条件 |
| identity-access IA-1 密码/无明文 | PASS | 前端不存储密码；token 不打印/不入日志（§4.2） |
| IA-2 Console 403 | PASS | `RequireAdmin` → /403；API 403 兜底（§2.2） |
| IA-3 角色矩阵 | PASS | 员工 10 路由 / Console 7 路由分离（§2.1） |
| IA-4 输入校验 | PASS | §6 FE-5；前端提示与后端错误码一致 |
| IA-5 限流/401/403 | PASS | 429 倒计时（§3.4-8）；401 单飞刷新；403 页面 |
| IA-6 审计 | PASS | Console 高风险操作 confirm+reason（§3.7）；Audit 查询页（R16） |
| IA-7 横向越权 | PASS | 订单详情仅本人/管理员；404 统一文案（§7.1） |
| ai-llm AI-1 候选硬过滤 | PASS（前端消费侧） | AI 卡片只渲染服务端 `dish` 事件；前端不自行扩候选（§3.8） |
| AI-2 模型不决定价格/库存 | PASS | 价格用服务端事件/DB；加购走 preview 重算（§3.8） |
| AI-3 无 Key 降级 | PASS | `fallback:true` → `Rule-based fallback` 徽标（§3.8） |
| AI-4 SSE 流式/超时 | PASS | §4.3 事件顺序消费；25s 客户端超时 + Retry |
| AI-5 规则可配置/回滚 | N/A（Tier 3，回滚端点缺失） | 理由：契约无回滚端点，Console 仅做读取/保存；回滚记 `NOT TESTED`（§10 缺口-09） |
| AI-6 Key 不入前端 | PASS | Key 仅后端环境变量；`VITE_*` 不含 LLM Key；构建产物无 Key |
| general-engineering GE-1 可构建启动 | PASS | 命令与代理见 §1.3；`npm run build` 门禁 |
| GE-2 种子可下单 | PASS | 前端依赖当日 20 卡 + 图片 20 张；空态兜底（§7.1） |
| GE-3 统一错误码/分页 | PASS | §4.1 `mapApiError`/`pageQuery` |
| GE-5 英文/金额格式 | PASS | §8 全量英文 key；`formatMoney` 单点（§6.1） |
| GE-7 证据可追溯 | PASS | §9 testid + Stage 5 截图/网络日志路径（§11.3） |

> N/A 仅 AI-5（契约无回滚端点）；其余未测项在 Stage 5 按实际证据判定，本文件不预判运行时 PASS。

## 15. 下一步

`前端开发工程师`（Stage 4，22:35–23:25）按 §11 顺序实施：**M0→M1→M2→M3→M4→M5→M6→M7（P0）→ M8/M9（P1）→ M10/M11/M12/M13（P2）**；每个里程碑执行 §11.3 自测命令；契约缺口按 §10 兜底，B1/B2 待 Architecture 回写。