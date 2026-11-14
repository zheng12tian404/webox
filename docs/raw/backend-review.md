# 后端代码评审报告（Stage 5 / 后端代码评审员 BR）

- 评审时间：2026-11-14 23:02 CST（代码基线：`backend/src` 22:39 最新修改，含 `/auth/refresh` P1 修复）
- 评审对象：`backend/` 全部 Java 源码 + `pom.xml` + `src/main/resources/db/schema.sql`；对照 `docs/api-contract.md` v1.1、`backend-design.md`、`scenario-profile.md`、`acceptance-matrix.md`
- 作者≠评审者：本报告由 BR 独立产出，未修改任何产品代码
- 结论：**CHANGES**（1 Blocker + 2 Major + 7 Minor；后端 P6+ 五项均 PASS，Blocker 来自高风险操作 `confirm` 校验缺失，AC-032 P0 不满足）
- 代码为动态基线：评审期间开发在 22:39–22:42 合入 PA-D-001（`Util` 注册 `JavaTimeModule`）与 refresh 修复，本报告以 22:43 重新构建的 `target/webox-backend.jar` 为最终验证基线（`mvn test` 13/13 PASS）

## 1. 可运行性（亲自执行）

```bash
JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 /opt/maven/bin/mvn -q test
# target/surefire-reports（22:43 最终基线）:
#   com.webox.UtilTest     Tests run: 6, Failures: 0, Errors: 0, Skipped: 0
#   com.webox.WeBoxApiIT   Tests run: 7, Failures: 0, Errors: 0, Skipped: 0
JAVA_HOME=... /opt/maven/bin/mvn -q -DskipTests package   # exit 0, target/webox-backend.jar 29,968,035 bytes
java -jar target/webox-backend.jar (SERVER_PORT=8085, 生产 profile)
GET /api/v1/health → 200 {"status":"UP","db":"UP","redis":"UP","cache":"UP"}
```

- 构建与测试结果与开发证据一致：**PASS**。
- 注意：测试库为 `req_6343a752e110_test`，`WeBoxApiIT#resetTestDataOnly` 有 `endsWith("_test")` 守卫（`WeBoxApiIT.java:80-91`），不会污染演示库。

## 2. 问题清单

| ID | 级别 | 位置 | 失败场景 | 修复建议 |
|---|---|---|---|---|
| **B-1** | **Blocker** | `admin/AdminService.java:107-136,236-304,335-353,524-548`；`admin/AdminControllers.java:129-133`；`dto/Dtos.java:38-56` | 契约 v1.1 #24/#27/#28/#31/#32/#33b/#37 均要求 `confirm:true`，代码从未读取 `req.confirm()`（全仓 `grep "confirm()"` 无命中）。管理员令牌携带 `confirm:false` 仍可改价、上下架、改库存、调库存、改 AI 规则；AC-032（P0）"缺 confirm → 400" 不满足。实测：`PUT /admin/daily-menu/2026-11-14/17/stock {"totalQty":40,"confirm":false,"reason":"..."}` → **HTTP 200** | 在 7 个服务方法入口统一 `requireConfirm(req.confirm())`，`confirm != TRUE` 抛 `400 VALIDATION_CONFIRM_REQUIRED`；补 IT：`confirm=false` → 400 且 `audit_log` 无新增、库存/价格不变 |
| **M-1** | Major | `order/OrderService.java:121-130`（内层 `catch DuplicateKeyException` 已 `redisStock.compensate`）与 `:134-137`（外层 `catch ApiException` 再次补偿） | 同用户同餐次重复下单走 `uk_orders_active` 的 DuplicateKey 分支时，同一份 Redis 预占被 `INCRBY` 补偿两次；`REDIS_PREALLOC` 菜品 Redis 可售数虚高，直到 `RedisStockService.alignAll()` 30s 对齐。DB 为最终账本，不会真正超卖，但会出现"显示有货→提交 409"的假可用 | 内层分支补偿后置 `prealloc = null`（或返回已映射异常标记），确保每份预占只补偿一次；新增 IT：REDIS_PREALLOC 菜品重复单后 Redis 值 == DB available |
| **M-2** | Major | `admin/AdminService.java:545-546` | `audit.log(..., Map.of("version",version,"rollbackToVersion", req.rollbackToVersion()), ...)`：不走回滚的常规规则更新 `rollbackToVersion=null`，`Map.of` 拒绝 null → **NPE → 500 INTERNAL**，事务回滚，AI 权重主路径完全不可用（仅 `rollbackToVersion` 非空时可用）。实测：`PUT /admin/ai-rules {"confirm":false,"reason":"...","config":{...}}` → 500；日志 `NullPointerException at AdminService.putAiRules(AdminService.java:546)` | 改为 `Map<String,Object>`/`LinkedHashMap` 允许 null，或省略该键；补 IT：无 rollback 的规则更新 200 + 版本+1 + 审计行 |
| m-1 | Minor | `realtime/SseHub.java:63-75` | `publishStock` 向所有订阅者广播，不区分订阅日期；订阅"次日"的客户端会收到"当日"库存事件 | `Entry` 增加 date，按 date 过滤；或发布时传 date 只推给同日期订阅者 |
| m-2 | Minor | `catalog/MenuController.java:75` | `GET /menu/stream?date=abc` → `LocalDate.parse` 抛出未捕获 → 500 `INTERNAL`，契约为 400 | 用 `Util.parseDate(date,"VALIDATION_INVALID")` |
| m-3 | Minor | `auth/AuthService.java:36-57`、`auth/AuthController.java:23-26` | 注册无频率限制（架构 §10 / G1T-M2 约定 10/min/IP）；仅登录有 `limiter`（`:61-62`） | `limiter.check("register:ip:"+ip,10,60_000)` |
| m-4 | Minor | `auth/AuthService.java:88-118` | refresh 不校验 `users.status`，被禁用账号仍可无限续期 access token 2h | refresh 查询带 `status='ACTIVE'`，否则 401 |
| m-5 | Minor | `admin/AdminService.java:236-304` | `saveDailyMenu`/`updateStock` 改 `total_qty` 后未调用 `redisStock.sync`，REDIS_PREALLOC 菜品 Redis 值最多 30s 陈旧 | 写后 `redisStock.sync(date,dishId,inventory.available(...))` |
| m-6 | Minor | `ai/AiController.java:42,67` | 固定 4 线程 + 无界队列，突发 AI 请求排队导致 SseEmitter 25s 超时先于执行 | 有界队列 + 拒绝策略，或 `SseEmitter` 超时设为 60s |
| m-7 | Minor | `auth/AuthService.java:139-140` vs `application.yml:32` | refresh TTL 硬编码 7 天，`webox.jwt.refresh-ttl-seconds` 配置无效 | 注入配置值 |
| n-1 | Nit | `order/OrderService.java:272-274` | `reason` 超 200 返回 `VALIDATION_REASON_REQUIRED`，语义应为 `VALIDATION_INVALID` | 拆分两个错误码 |
| n-2 | Nit | `order/OrderService.java:294-297` | 仅管理员取消写审计；员工自取消无审计行（契约仅强制管理员，IA-6 表述更宽） | 员工取消也写 `ORDER_CANCEL` 审计，或明确 IA-6 口径 |
| n-3 | Nit | `catalog/MenuService.java:69-104` | 菜单搜索/分类为内存过滤（≤20 菜品可接受），数据量上来后退化为全表读 | 记录容量假设，超 500 菜品改 SQL `LIKE ? ESCAPE` |

## 3. 后端 P6+ 五项（各 4 分）

| 项 | 判定 | 得分 | 代码位置 + 证据 |
|---|---|---|---|
| 缓存策略 | **PASS** | 4/4 | Caffeine `expireAfterWrite 60s / maximumSize 500`（`config/AppConfig.java:14-20`）；仅缓存菜品静态元数据 `dishes:{date}` 与 `filters`（`catalog/MenuService.java:31-43,203-223`），库存 `available` 每次实时 SQL（`:116-123`），不缓存库存；失效：`MenuService.invalidate()`（`:28`）在菜创建/改价/上下架/图片/每日菜单/库存/调库存全部写路径调用（`AdminService.java:100,117,131,153,274,297,347`）；Redis 热点预占 TTL 到当日 23:59:59（`RedisStockService.java:45-48`）+ 30s 对齐（`:107-122`）。运行时：`redis-cli GET webox:stock:2026-11-14:1`=40 与 DB available=40 一致 |
| 下单幂等 | **PASS** | 4/4 | `idempotency_records` 唯一键 `uk_idem_user_key(user_id,idem_key)`（`schema.sql:191`）+ 订单侧 `uk_orders_idem(user_id,idempotency_key)`（`:132`）；T0 独立抢占 / T1 业务 / T2 快照三段式（`order/IdempotencyService.java:27-87`、`order/OrderService.java:99-142`）；同键异体 409 `IDEMPOTENCY_CONFLICT`（`:44-46`）；5xx `FAILED` 可重试（`:53-56`）；规范键 = 排序后 hash（`common/Util.java:145-164`）。证据：`WeBoxApiIT#concurrentSameKeyCreatesExactlyOneOrder` 5 并发 → 1 个 orderId、1 条记录，PASS；实测缺头 400、同键异体 409（`tests/api/orders.mjs:114,120`） |
| SQL 注入防护 | **PASS** | 4/4 | 全仓 `JdbcTemplate` 调用均为 `?` 占位（`grep -rn '\${' src/main/java` 无 SQL 拼接；`AdminService.java:49-64` 动态 WHERE 仅拼常量片段）；搜索 `LIKE ? ESCAPE '\\'` + `Util.escapeLike` 转义 `% _ \`（`AdminService.java:52-56`、`common/Util.java:90-92`）；菜单搜索在内存过滤，无 SQL。运行时：`/menu?search=' OR 1=1 --` → 200 空结果；`/admin/dishes?search=100%' OR 1=1 --` → 200 空结果，无 500/无 SQL 报错泄漏 |
| 权限校验 | **PASS** | 4/4 | BCrypt(10)（`config/SecurityConfig.java:30-33`）+ 注册强制 EMPLOYEE、忽略 role（`AuthService.java:46`）；JWT HS256 校验签名/过期（`security/JwtService.java:65-85`）；`/api/v1/admin/**` `hasRole("ADMIN")`、其余 authenticated（`SecurityConfig.java:41-49`）；401/403 handler 分离（`:46-48`）；refresh token 仅存 SHA-256、单次轮换（`AuthService.java:88-118`）；越权订单查询/取消返回 404（`OrderService.java:217,271`）。证据：员工 token `GET /admin/dishes` → **403 FORBIDDEN**；未登录 `/orders` → **401 AUTH_UNAUTHORIZED**；refresh 轮换后旧 token 复用 → **401**（P1 修复正确，见 §4） |
| 并发防超卖 | **PASS** | 4/4 | 原子条件扣减 `UPDATE ... SET reserved_qty=reserved_qty+? WHERE total-reserved-sold>=?`（`inventory/InventoryService.java:34-51`）；DB CHECK `reserved+sold<=total`（`schema.sql:100-102`）；唯一有效单生成列 `active_key` + `uk_orders_active`（`:124-131`）；ledger `uk_ledger_business_key` 保证取消/超时只回补一次（`:170`、`InventoryService.java:60-73`）；按 dishId 升序加锁降低死锁（`OrderTxService.java:142-157`）+ 死锁重试（`OrderService.java:121-124`）。证据：`WeBoxApiIT#concurrentDifferentUsersNeverOversell` 6 用户抢 3 份 → 恰好 3 个 201、`available>=0`、`reserved+sold>total` 行数=0，PASS；AC-035 的 50 并发由 S5 用 `tests/concurrency/order_race.mjs` 执行（本评审 **NOT TESTED**） |

> 说明：B-1 不属于上述五项定义（五项聚焦缓存/幂等/注入/角色拦截/扣减），但属于"高风险操作可控 + 审计"工程要求，单独按 Blocker 处理。

## 4. 已知 P1 `/auth/refresh` 修复核查（专项）

- 修复点：`auth/AuthService.java:101-110` 改为 `Util.localDateTime(row.get("expires_at"))`（`common/Util.java:187-207`），不再盲 cast `java.sql.Timestamp`；`expiresAt == null` 也返回 401。
- 轮换语义：`UPDATE refresh_tokens SET revoked=1 WHERE id=? AND revoked=0` 原子生效，`revoked==0` → 401；随后签发新 refresh（`:103-107`）。
- 证据：`WeBoxApiIT#refreshRotatesTokensRejectsReuseAndExpired`（rotation + 旧 token 复用 401 + 过期 401 + 未知 token 401）PASS；生产 profile 实测 login → refresh 200 → 复用旧 refresh **401 AUTH_TOKEN_INVALID**。
- 结论：**修复正确（CLOSED）**。遗留 m-4（不校验用户状态）不阻塞。

### PA-D-001（产品验收登记的 P0：Console 写操作 500）复核

- 根因与产品验收一致：`Util.MAPPER` 原为裸 `new ObjectMapper()`，`AuditService` 序列化含 `LocalDateTime` 的整行 DB map 时抛 `InvalidDefinitionException`。
- 当前代码已修：`common/Util.java:18-27` 注册 `JavaTimeModule` 并禁用 `WRITE_DATES_AS_TIMESTAMPS`；新增 IT `WeBoxApiIT#adminDishCrudWritesAuditSnapshotsWithDatetimes`（共 7 个 IT，全 PASS）。
- BR 独立复测（22:43 重建包）：`PATCH /admin/dishes/20/status {"status":"ON_SHELF","confirm":true,"reason":"BR verify audit datetime"}` → **200**，`audit_log` 落行 `DISH_STATUS / 20 / BR verify audit datetime`。
- 结论：**PA-D-001 修复已验证（CLOSED，BR 复核）**。

## 5. 测试质量

- JUnit（13/13 PASS）：`UtilTest` 覆盖整数分金额、截单六边界/跨日、canonical hash、状态机、LIKE 转义、JDBC 时间形态；`WeBoxApiIT` 覆盖测试库隔离、密码策略/分页/403/401、幂等（串行+5 并发）、同键异体、重复有效单、refresh 全链路、6 并发防超卖、Console 菜品 CRUD 审计快照（PA-D-001 回归）。断言均为真实响应/DB 断言，非空跑。
- 脚本（S5 执行）：`tests/api/orders.mjs` 覆盖订单详情快照、RESERVE 唯一、二次取消 409、ledger 仅 1 条 RELEASE、缺幂等键/异体；`tests/api/authz.mjs` 覆盖员工 403、admin 200、横向越权 404；`tests/concurrency/*.mjs`。
- 缺口（major 级测试洞）：**无任何用例断言 `confirm=false` → 400**（因此 B-1 未被测试发现）；AC-060 30 分钟超时无自动化用例（G3T-B2 仍 OPEN，S5 需 SQL 回拨 `created_at` 或标 NOT TESTED）；AC-035 50 并发依赖脚本首跑。
- 判定：**PARTIAL**——核心不变量覆盖良好，高风险操作确认策略与超时任务缺测试。

## 6. 实际执行命令与输出摘录

```
mvn -q test            → UtilTest 6/6 PASS；WeBoxApiIT 6/6 PASS（0 failure/error）
mvn -q -DskipTests package → exit 0
java -jar target/webox-backend.jar (8085) → health 200 db/redis/cache UP
employee → GET /api/v1/admin/dishes            → 403 {"code":"FORBIDDEN"}
employee + X-Test-Clock → GET /api/v1/menu     → 400 VALIDATION_TEST_CLOCK_FORBIDDEN
POST /auth/refresh（旧 token 第二次）           → 401 AUTH_TOKEN_INVALID
GET /menu?page=1&size=101                      → 400 VALIDATION_PAGINATION
GET /menu?search=' OR 1=1 --                   → 200 {"items":[],"total":0}
GET /admin/dishes?search=100%' OR 1=1 --       → 200 {"items":[],"total":0}
PUT /admin/daily-menu/2026-11-14/17/stock {confirm:false,reason} → 200（应为 400，B-1）
PUT 同端点 缺 reason                            → 400 VALIDATION_REASON_REQUIRED
GET /orders（未登录）                            → 401 AUTH_UNAUTHORIZED
redis-cli GET webox:stock:2026-11-14:1         → 40（DB available=40，对齐一致）
PATCH /admin/dishes/20/status {confirm:true,reason} → 200；audit_log 新增 DISH_STATUS 行（PA-D-001 修复验证）
PUT /admin/ai-rules {config:{...},confirm:false,reason} → 500 INTERNAL（NPE @ AdminService.java:546，M-2）
```

## 7. Scenario checks

| Profile | 检查项 | 判定 | 证据 |
|---|---|---|---|
| transaction-order | TO-1 金额整数分/服务端重算 | PASS | `OrderTxService.java:58-110` 按 DB 价+选项加价重算；`UtilTest#moneyIsIntegerCents...` |
| transaction-order | TO-2 available 不为负 | PASS | 条件 UPDATE + CHECK；6/3 并发 IT 断言 `available>=0`、越界行=0 |
| transaction-order | TO-3 提交占用/只回补一次 | PASS | `InventoryService.java:60-88` ledger 唯一键；`orders.mjs` 二次取消 409 + 1 条 RELEASE |
| transaction-order | TO-4 下单幂等 | PASS | 5 并发同键 IT；异体 409 |
| transaction-order | TO-5 唯一有效单 | PASS | 生成列 + 唯一索引；IT `ORDER_DUPLICATE` + `existingOrderId` |
| transaction-order | TO-6 状态机 | PASS | `OrderStateMachine.java:7-16` + `UtilTest`；非法迁移 409 |
| transaction-order | TO-7 截单服务端判定/六边界 | PASS | `Util.resolveMeal:115-141`；`UtilTest#cutoffSixBoundariesAndCrossDay`；生产 profile 拒绝 `X-Test-Clock` |
| transaction-order | TO-8 订单快照 | PASS | `order_items` + `snapshot_json`（`OrderTxService.java:159-206`）；`orders.mjs` TC-030 |
| transaction-order | TO-9 总份数≤5 | PASS | `OrderTxService.java:54-57` 跨行累计后 400 `ORDER_LIMIT_EXCEEDED` |
| transaction-order | TO-10 仅 Pending 员工可取消 | PASS | `OrderService.java:279-286` CAS `status='Pending'` |
| identity-access | IA-1 密码哈希 | PASS | BCrypt(10)；注册响应不回显密码 |
| identity-access | IA-2 员工 Console 403 | PASS | 实测 403 FORBIDDEN（URL 级 + 角色） |
| identity-access | IA-3 角色矩阵 | PASS | `authz.mjs` 员工 403/admin 200；越权订单 404 |
| identity-access | IA-4 后端输入校验 | PASS | 密码策略/分页/地址/搜索/选项归属 400；SQLi 探测无 500 |
| identity-access | IA-5 登录限流/401-403 区分 | PASS | `AuthService.java:61-62`（20/min/IP、10/min/IP+邮箱）；429 `RATE_LIMITED`；401/403 分离 |
| identity-access | IA-6 高风险操作 audit + confirm | **FAIL** | 审计前后值已实现（`AuditService`），但 `confirm=false` 仍 200（B-1）；员工自取消无审计（n-2） |
| identity-access | IA-7 横向越权 | PASS | `OrderService.java:217,271` 404；`authz.mjs` 读/取消他人 403/404 |
| ai-llm | AI-1 确定性候选过滤 | PASS | `AiController.java:123-172`：上架+当日有货+过敏原+近 7 天 |
| ai-llm | AI-2 模型不得决定价格/库存/权限 | PASS | `tryLlm` 仅接受候选集内 dishId（`:218-230`），价格取自 DB |
| ai-llm | AI-3 无 Key/失败降级 | PASS | `:80-91` fallback=true + model=rule-based，SSE `meta` 回传；不 500 |
| ai-llm | AI-4 SSE 流式与超时 | PASS（设计）/ 运行时 NOT TESTED | 事件 `meta→dish→reason→done`、`reconnectTime(3000)`；25s emitter 超时；首 token ≤3s 由 S5 计时 |
| ai-llm | AI-5 规则可配/可回滚/会话落库 | PASS | `AdminService.putAiRules:523-548` 版本+active+rollback；`ai_conversation` 落库（`AiController.java:237-248`） |
| ai-llm | AI-6 Key 仅环境变量 | PASS | `application.yml:41-44` `${LLM_API_KEY}`；代码/日志无 key；DB 无 key 字段 |
| general-engineering | GE-1 可构建启动 | PASS | mvn test/package exit 0；health 200 |
| general-engineering | GE-2 种子数据 | PASS | 20 菜品当日 PUBLISHED、库存 20-50、admin/employee 可登录（DB 查询+实测） |
| general-engineering | GE-3 统一错误码/分页/鉴权 | PASS | `Api.envelope` 全响应含 requestId；分页 1/20 上限 100；`/api/v1` |
| general-engineering | GE-4 参数化查询 | PASS | 代码审查 + SQLi 运行时探测 |
| general-engineering | GE-5 英文文案/¥xx.xx | PASS | `Util.money`；`UtilTest` |
| general-engineering | GE-6 文档齐全 | N/A | 属文档/AI 导出节点，不在后端代码评审范围 |
| general-engineering | GE-7 证据可追溯 | PASS | 本报告 §6 + surefire 报告 + 运行时输出 |

## 8. 未测项（NOT TESTED）

1. **AC-035** 50 用户真并发（本评审仅 6/3 集成测试 PASS；50 并发由 S5 `tests/concurrency/order_race.mjs` 首跑）。
2. **AC-060** 30 分钟超时释放（`@Scheduled` 无法被 `X-Test-Clock` 推进，G3T-B2 OPEN；需 SQL 回拨 `created_at` 后观察 ≤60s tick）。
3. **AI 首 token ≤3s / SSE 计时**（设计就绪，运行时由 S5 采集）。
4. Redis 宕机整单降级 DB_ATOMIC 的实机演练（代码 `RedisStockService.java:54-87` 有降级路径，未做停 Redis 演练）。
5. REDIS_PREALLOC 重复单后的 Redis/DB 一致性（M-1 的复现用例，建议 Stage 5b 补）。

## 9. 修复优先级（给开发的最小修复项，8 分钟内）

1. **必修（B-1，约 15 行）**：`AdminService` 7 个高风险方法统一 `if (!Boolean.TRUE.equals(req.confirm())) throw Api.error(400,"VALIDATION_CONFIRM_REQUIRED",...)`；补 1 个 IT：`confirm=false` → 400 且无审计/无数据变化。
2. **必修（M-1，约 3 行）**：`OrderService.submit` 内层 DuplicateKey 分支补偿后 `prealloc = null;`，避免二次 `INCRBY`。
3. **必修（M-2，约 3 行）**：`AdminService.putAiRules` 审计 after 改为允许 null 的 Map（如 `LinkedHashMap`），或 `Map.of("version", version)`；补 IT 常规规则更新 200。
4. 建议随修（各 ≤3 行）：m-2 stream 日期校验、m-3 注册限流、m-5 改库存后 Redis sync。
5. m-4/m-6/m-7/n-* 记 P2，Stage 5b 或后续迭代处理。

## 10. 门禁自检

- 作者≠评审者：PASS（BR 独立评审，未改产品代码）
- 代码全量评审（非只看文档）：PASS（36 个 Java 文件 + schema + pom + 测试）
- 每条结论有证据：PASS（命令输出/代码行/surefire）
- P0/P1 缺陷闭环指令：B-1、M-1 已给 Stage 5b 可执行修复指令
- **G4-后端自检：CHANGES**（Blocker B-1 未闭环）
- 下一步：`Stage 5b 后端修复（B-1、M-1）` → 复评 → `Quality Checker`（若前端评审 PASS 且测试完成）