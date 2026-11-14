# 缺陷台账 — WeBox（Stage 5 产品验收更新）

- 更新：2026-11-14 23:06 CST（产品工程师，G4 业务验收抽查）
- 分级：P0 阻断主链路/资损/安全；P1 规则或 Tier1/2 核心功能错误；P2 增强/体验
- 状态：OPEN / FIXED / VERIFIED / CLOSED

## Stage 5 产品验收新登记

| ID | 级别 | 关联 AC | 标题 | 复现步骤 | 期望 | 实际 | 根因（已定位） | 状态 | Owner |
|---|---|---|---|---|---|---|---|---|---|
| PA-D-001 | **P0** | AC-030、AC-032、AC-031（每日菜单同路径） | Console 菜品写操作（改价/编辑/上下架/每日菜单）全部 500 `INTERNAL` | 管理员 token 调用 `PUT /api/v1/admin/dishes/9`（含 confirm+reason）或 `PATCH /api/v1/admin/dishes/20/status` | 200，写库成功并产生 `audit_log` | 500 `{"code":"INTERNAL"}`；DB 未变更，无审计行；后端日志 `AuditService - Audit write failed ... Java 8 date/time type LocalDateTime not supported ... LinkedCaseInsensitiveMap["created_at"]` | `common/Util.java:21` 使用裸 `new ObjectMapper()`（未注册 `JavaTimeModule`），`AuditService` 序列化 DB 行 map 中的 `LocalDateTime` 时抛异常 | **CLOSED**（Stage 5c 架构复核：8083 PID 1385859 加载 22:51:39 修复后 jar；菜品/状态/每日菜单写 200 + 审计） | 后端开发 |
| PA-D-002 | P2 | AC-035 | 50 并发夹具受登录限流（20/min/IP）限制，50 用户无法就绪 | `RACE_N=50 RACE_K=10 node tests/concurrency/order_race.mjs` | 50 用户并发抢 10 份 | 登录接口 429，`ready=18/50`；改用 15 用户/5 库存的既有用例通过（`artifacts/evidence/backend/concurrency/order_race.log`） | 测试环境登录限流 20/min/IP 与夹具策略冲突（非业务缺陷） | OPEN（测试基建） | 测试执行 |
| PA-D-003 | P2 | 环境/AC-056 | 8083 后端一度无监听（22:39 以 Java 8 启动导致 `UnsupportedClassVersionError`） | `ss -ltn \| grep 8083` 为空，health 000 | 后端常驻可访问 | 产品验收于 22:40 以 JDK17 重启后恢复（`artifacts/backend-8083-pa.log`） | 启动脚本未固定 `JAVA_HOME`/绝对 java 路径 | **CLOSED**（`backend/scripts/start.sh` 固化 JDK17 绝对路径 + 60s health 探测；Stage 5c 实测 8083 按此方式运行） | 后端开发 |

## Stage 5b 修复指令

1. **PA-D-001（必修，P0）**：`common/Util.java` 的 `MAPPER` 注册 `JavaTimeModule` 并禁用 `WRITE_DATES_AS_TIMESTAMPS`；或 `AuditService` 只序列化显式 before/after 字段而非整行 DB map。修复后回归：
   - `PUT /admin/dishes/9`（confirm+reason）→ 200，`audit_log` 出现 before/after、reason、ip、request_id；
   - `PATCH /admin/dishes/{id}/status` → 200，员工端 ≤1s 不可见/恢复；
   - `PUT /admin/daily-menu` 与 `PUT /admin/daily-menu/{date}/{dishId}/stock` → 200 且审计落库。
2. **PA-D-002（建议）**：并发夹具改为 SQL 直插 + **复用已签发 token 或提高测试环境 IP 限流**，完成 50/10 场景后补 AC-035 证据；不得以 15/5 代替 50/10 记 PASS。
3. **PA-D-003（建议）**：启动脚本固定 `JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64` 与绝对路径 java，并在启动后做 health 探测。

## 历史缺陷（沿用，未在本节点关闭）

| ID | 级别 | 标题 | 状态 |
|---|---|---|---|
| （Stage 2–4 记录见 `docs/review-findings.md`） | — | — | — |
## Stage 5 G4 后端评审新增 / 复核（BR，2026-11-14 23:06 CST）

| ID | 级别 | 缺陷 | 位置 | 影响 | 修复指令 | Owner | 截止 | 状态 |
|---|---|---|---|---|---|---|---|---|
| D-BE-10 | P2 | AI 规则常规更新 500（`Map.of` 拒绝 null `rollbackToVersion`，NPE） | `admin/AdminService.java:545-546` | `PUT /admin/ai-rules` 主路径不可用（Tier3 AC-041） | 审计 after 改可空 Map 或省略该键；补 IT | S5b-BE | 2026-11-15 | **CLOSED**（BR S5c 复评：`PUT /admin/ai-rules` 200，version=4，审计落库） |
| D-BE-11 | P0 | 高风险管理操作不校验 `confirm`（`confirm=false` 仍 200） | `admin/AdminService.java` 6 处 + `OrderService.adminPatchStatus` | AC-032 P0 失败；见 `review-findings.md` G4-BE-B1 | 统一 `requireConfirm` → 400 `VALIDATION_CONFIRM_REQUIRED` | S5b-BE | 2026-11-14 23:20 | **CLOSED**（BR S5c：4 端点 confirm=false→400、DB/审计不变；confirm=true→200+审计） |
| D-BE-12 | P1 | 重复有效单分支 Redis 预占二次补偿 | `order/OrderService.java:121-137` | REDIS_PREALLOC 假可用 30s；DB 不超卖 | 补偿后 `prealloc=null` | S5b-BE | 2026-11-14 23:20 | **CLOSED**（BR S5c：`OrderService.java:130-132/141/145` 仅补偿一次） |

### 复核结果（BR）

| 原 ID | 复核结论 | 证据 |
|---|---|---|
| PA-D-001（P0，产品验收） | **CLOSED** | `Util.java:18-27` 已注册 JavaTimeModule；`WeBoxApiIT#adminDishCrudWritesAuditSnapshotsWithDatetimes` PASS；BR 实测 `PATCH /admin/dishes/20/status` → 200 且 `audit_log` 落 `DISH_STATUS/20` |
| PA-D-002（P2） | OPEN（测试基建） | 未变；50 并发仍由 S5 解决 |
| PA-D-003（P2） | OPEN（运维脚本） | 未变 |

## Stage 5 G4 测试执行新增（2026-11-14 23:20 CST）

| ID | 级别 | 关联 AC | 标题 | 复现 | 期望 vs 实际 | 状态 | Owner |
|---|---|---|---|---|---|---|---|
| TE-D-001 | P2 | AC-001/070 | 超长邮箱错误码/边界与契约不一致 | `POST /api/v1/auth/register`，email=`'a'*188+'@test.com'`（197 字符）及 201 字符变体 | 契约：200 内合法邮箱 201、>200 → `VALIDATION_EMAIL_LENGTH`；实际：均 400 `VALIDATION_EMAIL_FORMAT`（`@Email` 先于长度校验，且 local-part>64 被拒） | OPEN | 后端开发 |
| TE-D-002 | P2（低） | AC-029 | preview 不校验 address 长度 | `POST /orders/preview` body `address='A'*201` | 下单 #18 为 1–200；preview 实际 200 接受，提交时才 400，前后不一致 | OPEN | 后端开发 |
| TE-D-003 | P3 | 测试基建 | `tests/sql/reset.sql` 硬编码演示库 `USE req_6343a752e110` | 直接执行将清空演示订单 | 应默认 `_test` 或强制 `ALLOW_DEMO_RESET=1` 守卫；本节点改用 `_test` 副本 | OPEN | Test Designer |
| TE-D-004 | P3 | 测试基建 | `assertions.sql` §6 查询 `order_items.order_no`（列不存在） | 直接执行在 §6 中断 | 改用 `id`，修正副本后全部通过 | OPEN | Test Designer |

**复核 PA-D-002**：本轮以 `--server.forward-headers-strategy=native` + 测试夹具逐请求唯一 `X-Forwarded-For`，在 `req_6343a752e110_test` 实测 `RACE_N=50 RACE_K=10`：`ready=50/50`，201=10、409_STOCK=40、`available=0`、`reserved=10`、ledger RESERVE=10。证据 `artifacts/test-conc-order.log`。**建议 PA-D-002 → CLOSED（测试基建已补 50/10 证据）**。
**PA-D-001**：沿用 BR 22:43 复测结论 CLOSED；本轮 authz/orders 走 `/admin` 只读接口 200，未重复写操作回归。

## G4 架构抽检追加（Architecture，2026-11-14 22:52 CST）

> 去重：DEF-001 同 `D-BE-11`/`G4-BE-B1`；DEF-008 同 `D-BE-12`/`G4-BE-M1`；PA-D-002 已由 S5-Test 50/10 证据关闭，不在本表重复。

| ID | 级别 | 标题 | 证据/根因 | Owner | 截止 | 关闭标准 | 状态 |
|---|---|---|---|---|---|---|---|
| DEF-002 | P1 | 下单 5/min/用户限流缺失 | AC-049；`OrderService.submit` 无 `RateLimiter` | S5b-BE | 23:40 | 60s 第 6 次 `POST /orders` → 429 | **CLOSED**（干净用户实测 6th/7th=429，跨用户隔离） |
| DEF-003 | P1 | AC-058 备份/恢复脚本与告警文档缺失 | `backend/scripts/` 无 `backup.sh`/`restore.sh`；无 `docs/observability.md` | S5b-BE / S5-Test | 23:40 | 备份→恢复临时库核心行数一致；阈值文档存在 | **CLOSED**（脚本+observability.md 存在；restore 17 表、8 张核心表行数 MATCH） |
| DEF-004 | P1 | 管理端改库存/每日菜单不发 SSE、不同步 Redis | `AdminService.java:282-304,236-279`；AC-030/036 | S5b-BE | 23:40 | SSE 客户端 ≤1s 收到 `event:stock`；Redis==DB | **CLOSED**（实连 8083：两次写各收 1 条 stock；Redis=DB=46） |
| DEF-005 | P1 | Confirmed 自动完成（AUTO_COMPLETE）缺失 | `ScheduledJobs.java:28-52`；backend-design v1.1 §4.5 | S5b-BE | 23:40 | 过期 Confirmed 下一 tick → Completed + 系统审计 | **CLOSED**（构造过期 Confirmed：t+40s→Completed，SYSTEM 审计；探针已清理） |
| DEF-006 | P1 | 菜单卡片快捷加购绕过过敏原确认 | `DishCard.tsx:24-45`；D11/G3P-M4 | S5b-FE | 23:40 | 含 Egg 菜卡片加购 → 弹窗 → 确认后 +1 | **CLOSED**（Stage 5c：`useAddToCart` 三入口统一，截图 `s5b-fe-allergen-card.png` 显示卡片加购弹窗；Cancel 不入车 E2E 交 Stage 6） |
| DEF-007 | P1 | 缓存失效在事务内而非 afterCommit | `AdminService.java:100,117,131,153,274,297,347` | S5b-BE | 23:40 | 并发读写写后 ≤1s 新值 | **CLOSED**（7 处均 `Util.afterCommit(menuService::invalidate)`，无事务直接执行） |
| DEF-009 | P2 | 包结构与 backend-design §1.2 不一致 | 实际 10 包；依赖方向正确 | S5 文档节点 | 23:45 | backend-design/README 增“实现偏差”段 | OPEN |
| DEF-010 | P2 | Redis 预占在 T1 内（措辞冲突） | `OrderTxService:153`；architecture §4 | S2-Architecture | 23:45 | architecture §4 措辞修正 | OPEN |
| DEF-011 | P2 | AI 线程未传播 RequestContext | `AiController:42,67` | S5b-BE | 23:45 | AI 日志含 requestId | OPEN |
| DEF-012 | P2 | 前端 204 死分支 | `client.ts:78-80` | S5b-FE | 23:45 | 删除且 typecheck 通过 | **CLOSED**（Stage 5c：`grep 204 frontend/src/api/client.ts` 无命中） |
| DEF-013 | P2 | 文档端口/启动脚本 | `backend/README.md:16/45/48/91`（8090）、`frontend/README.md:51`（refresh 500 过期）、根 README 未生成；含 PA-D-003 | S5 文档节点 / S5b-BE | 23:25 | 根 README 写标准 8080/5173 + 实际 8083/5175；启动脚本固定 JDK17 + health 探测 | **部分 CLOSED**：根 README（8083/5175+标准端口）、`scripts/start.sh`（JDK17+health）已修；`backend/README.md` 仍写 8090 → 残留 R-04 |
| DEF-014 | P2 | `JWT_SECRET` 未校验 ≥32 字节 | `JwtService.java:30-42` | S5b-BE | 23:45 | 启动长度校验/fail-fast | OPEN |
| DEF-015 | P2 | ticket 第 4 次兑换证据冲突 | `backend-g3-checks.txt` G3-4=200 vs `TicketStore.java:39` 应 401 | S5-Test | 23:35 | 重跑 TC-059b：1~3 次 200、第 4 次 401 | OPEN |
| DEF-016 | P2 | CHECK 3819 未映射 409 | `GlobalExceptionHandler.java:56-61` | S5b-BE | 23:45 | 3819→409 单测 | OPEN |

### PA-D-001 部署态复核（Architecture，与 BR/TE 结论不一致，需重启后复验）

- 代码修复已在工作树：`Util.java:25-29` 注册 `JavaTimeModule`；jar 22:43 重建且含 `jackson-datatype-jsr310`；`WeBoxApiIT#adminDishCrudWritesAuditSnapshotsWithDatetimes` 通过 → **代码 FIXED**。
- 但 8083 验收进程 PID 1355523 于 **22:40:47** 启动，早于修复/重建，仍加载旧类：22:46 `PUT /admin/dishes/20`（confirm+reason）→ **500**，日志 `backend-8083-pa.log:977` 为 `LocalDateTime` 序列化异常；同请求打到 8086（22:43 重建 jar）→ **200** 且审计落库。
- 另有 8086/其他实例可直接验证代码修复，但验收目标 8083 仍失败。**建议：PA-D-001 在 8083 重启后由 BR/TE 复验再记 CLOSED**；当前代码 FIXED / 部署态 OPEN。重启命令必须固定 `JAVA_HOME` 并 health 探测（合并 PA-D-003）。

## Stage 5 G4 前端评审新增（FR，2026-11-14 22:48 CST）

| ID | 级别 | 关联 AC | 标题 | 复现 | 期望 | 实际 | 根因 | 状态 | Owner |
|---|---|---|---|---|---|---|---|---|---|
| D-FE-01 | **P0/blocker** | AC-021/022/023 | 偏好页无法保存（默认值） | Preferences 直接 Save；或选 Balanced + 合法预算 | 200 保存成功 | 400 `VALIDATION_INVALID`（预算 0/0）/ `VALIDATION_CATEGORY`（Balanced） | 前端与后端 taste 枚举、预算空值语义不一致（`PreferencesPage.tsx:14,19-24,56-70` vs `MeController.java:67-73`） | **FIXED**（S5b-FE，待 FR/Test 复评） | FE S5b |
| D-FE-02 | P1/major | AC-021、D11 | 菜单卡片加购绕过过敏原弹窗 | 过敏原 Peanuts，点 Kung Pao 卡片 Add | 弹窗确认后入车 | 无弹窗直接入车 | 判定只在 `DishDetailPage`，`DishCard.tsx:24-45` 未复用 | **FIXED**（S5b-FE，待 FR/Test 复评） | FE S5b |
| D-FE-03 | P1/major | AC-014/AC-053 | 结算重复提交无同步闩锁，异常后无法确认订单 | 同一 tick 双触发 Place Order | 仅 1 个 POST，成功页 | 2 个 POST；500+409；订单已建、页面停留、购物车未清 | `CheckoutPage.tsx:127-183` 仅靠 state；无 in-flight ref；409 未关联已有单 | **FIXED**（S5b-FE，待 FR/Test 复评） | FE S5b |
| D-FE-04 | P2 | AC-045/AC-052、TC-076 | E2E 响应式/防抖用例空跑 | 运行 `tests/e2e/run_e2e.sh` | 登录后截图并断言真实页面 | 未登录截 `/login`；选择器不存在 | `run_e2e.sh:18-37`、`checklist.md:31-38` | OPEN | Test |

### 复评要求（S5b）

1. D-FE-01：默认 Save 200，Balanced/Medium 均可保存，刷新后过敏原仍在；补 `PUT /me/preferences` 前后端契约测试。
2. D-FE-02：卡片/详情/AI 三入口同一过敏原逻辑；E2E 断言 `allergen-modal` 出现与 Cancel 不入车。
3. D-FE-03：`useRef` 闩锁 + `IDEMPOTENCY_CONFLICT` 恢复；同 tick 双触发网络仅 1 个 `POST /orders`。
4. D-FE-04：三档 viewport 登录后截图 + 连点购物车断言重跑。

## Stage 5b 后端修复记录（2026-11-14，S5b-BE）

> 状态含义：FIXED = 代码+实测通过，等待复评；不得由开发自行 CLOSED。

| ID | 修复 | 证据 | 状态 |
|---|---|---|---|
| D-BE-11 / DEF-001 | `Util.requireConfirm` 统一接入 AdminService 6 处 + `OrderService.adminPatchStatus`；400 `VALIDATION_CONFIRM_REQUIRED`，校验在写库/审计之前 | `artifacts/s5b-curl-evidence.txt` §1/§2；`S5bFixTest#confirmFalseIsRejected` | FIXED |
| PA-D-001 / PA-D-003 部署态 | 22:51 重建 jar，kill 旧 PID 1355523，以 JDK17 绝对路径重启 8083；health 200；`PUT /admin/dishes/20` 200 且 audit 落 before/after | `artifacts/s5b-backend-fix.log`（PID/health/jar mtime）；audit 行 price 2600→1880 | FIXED |
| D-BE-12 | DuplicateKey 分支补偿后 `prealloc=null`，外层 catch 不再二次 INCRBY | 代码 diff；`mvn test` 全绿 | FIXED |
| DEF-002 | 下单 5/min/用户限流（`RateLimiter`，key=user id）；第 6 次 429 `RATE_LIMITED`，其他用户不受影响 | `artifacts/s5b-curl-evidence.txt` §6；`S5bFixTest#sixthOrderInWindowIsRateLimited` | FIXED |
| DEF-004 | 管理端改库存/每日菜单 afterCommit 发 SSE `stock` + `redisStock.sync`；实测 ≤1s 收到 `event:stock`，Redis==DB==46 | `artifacts/s5b-backend-fix.log` SSE 段 | FIXED |
| DEF-005 | `ScheduledJobs.autoCompleteOrders` 每分钟：Confirmed 且 delivery_date < 今日 → Completed + SYSTEM 审计 `ORDER_AUTO_COMPLETE` | 代码 + 单测启动；定时任务实测标 NOT TESTED（需跨日） | FIXED（定时实测 NOT TESTED） |
| DEF-007 | AdminService 7 处 `menuService.invalidate()` 改为 `Util.afterCommit` | diff：7 处全部包装 | FIXED |
| D-BE-10 | `Map.of` null → 可空 `LinkedHashMap`；另修正 `getAiRules` 查询列 `updated_at`→`created_at`（真实 500 根因）；`PUT /admin/ai-rules` 200 | `artifacts/s5b-curl-evidence.txt` §5/§5retry | FIXED |
| FR-B1 后端侧 | 偏好预算 0/0 视为未设置；taste `Balanced`→`Medium`；`PUT /me/preferences` 200 且返回 `tastePreference=Medium`、预算 null | `artifacts/s5b-curl-evidence.txt` §4 | FIXED |
| DEF-003 | `backend/scripts/backup.sh`、`restore.sh`（参数化、默认拒绝演示库）、`docs/observability.md`（5xx>1%、P95>1s、drift>0）；备份→临时库恢复 8 张核心表行数一致 | `artifacts/s5b-backup-restore.log` | FIXED |

## Stage 5c G4 Blocker/Major 关闭复核（Architecture，2026-11-14 23:01 CST）

> 详细报告：`docs/architecture-review-closure.md`；原始证据：`artifacts/s5c-architecture-closure-evidence.txt`、`artifacts/s5c-def005-autocomplete.log`。
> **结论 PASS**：2 Blocker + 7 Major 全部复核关闭；无 open P0/P1；残余 P2/P3 见下。

| 原 ID | 复核动作 | 结论 |
|---|---|---|
| DEF-001 / D-BE-11 / G4-BE-B1（Blocker） | 7/7 契约端点 `confirm=false` → 400 `VALIDATION_CONFIRM_REQUIRED`，`audit_log` delta=0、数据不变；`confirm=true` → 200 + 审计含时间字段 | **CLOSED** |
| PA-D-001 / G4A-B2（Blocker） | 8083 PID 1385859（22:51:54）加载 22:51:39 修复后 jar；health 200；菜品/状态/每日菜单写 200 + 审计 | **CLOSED** |
| DEF-002 ~ DEF-007（P1） | 逐项代码+运行复核（限流 429、备份恢复 MATCH、SSE/Redis=DB、auto-complete 实测、卡片过敏原弹窗、7 处 afterCommit） | **全部 CLOSED** |
| DEF-008 / D-BE-12（P1） | `DuplicateKeyException` 分支补偿后 `prealloc=null` | **CLOSED** |
| DEF-012 / PA-D-003（P2） | 204 死分支已删；start.sh 固化 JDK17+health | **CLOSED** |

### Stage 5c 新登记残余项（P3，不阻断）

| ID | 级别 | 内容 | Owner | SLA | 状态 |
|---|---|---|---|---|---|
| R-08 | P3 | 下单限流在业务校验前扣减，业务 4xx 也占 5/min 配额；属可接受防刷语义，文档注明即可 | S5b-BE | 2026-11-15 | OPEN（文档项） |
| R-09 | P3 | `autoCompleteOrders` 仅判 `delivery_date<today`，未实现“同日≥23:59”分支；同日单次日首个 tick 完成（≤60s 延迟），行为等价 | S5b-BE | 2026-11-15 | OPEN（文档项） |


## Stage 5c 后端 P0/P1 复评（BR，2026-11-14 23:06 CST）

> 详细报告：`docs/backend-rereview.md`；证据：`artifacts/s5c-backend-rereview-evidence.log`。**结论 PASS**：后端 P0/P1 全部 CLOSED，无 Stage 5d 后端项。

| 原 ID | 复评结论 | 独立证据 |
|---|---|---|
| D-BE-11 / G4-BE-B1 / G4A-B1 / G3P-M3（P0） | **CLOSED** | `PUT /admin/dishes/20`、`PATCH /admin/dishes/20/status`、每日菜单改库存、`PUT /admin/ai-rules` 在 `confirm=false` 下均 400 `VALIDATION_CONFIRM_REQUIRED`，DB 值与审计计数不变；`confirm=true` 均 200 且审计含 before/after |
| PA-D-001（P0） | **CLOSED** | 8083 PID 1385859（22:51:54 启动）加载 jar 22:51:39；health 200；三类 Console 写操作 200 + 审计 |
| D-BE-12 / G4-BE-M1 / G4A-M8（P1） | **CLOSED** | `OrderService.java:130-132` 内层补偿后 `prealloc=null`，外层 `:141/:145` 判空，无二次 INCRBY |
| DEF-002 / G4A-M2（P1） | **CLOSED** | 同用户第 6 次 `POST /orders` → 429 `RATE_LIMITED`；另一用户首次 400，未误伤 |
| DEF-003 / G4A-M3（P1） | **CLOSED** | 脚本+`docs/observability.md` 存在；新备份→临时库 17 表，8 张核心表行数全部 MATCH |
| DEF-004 / G4A-M4（P1） | **CLOSED** | 改库存后 SSE `event:stock` **28ms** 到达；Redis=49=DB；恢复后 Redis=46=DB |
| DEF-005 / G4A-M5（P1） | **CLOSED** | `backend-8083-s5b.log:6418` 23:00:16 `Auto-completed 1 confirmed orders past delivery day`（订单/审计随后被并行验收清理删除） |
| DEF-007 / G4A-M7（P1） | **CLOSED** | `AdminService.java:115,133,148,170,295,320,372` + 库存发布 `:47-52` 均为 `Util.afterCommit` |
| D-BE-10 / G4-BE-M2（P2） | **CLOSED** | `PUT /admin/ai-rules` 200、version=4、审计 `AI_RULE_UPDATE` |

**残余风险（不阻断）**：内存限流单实例语义（P2）、auto-complete 更新与审计非同一事务（P3）、无 confirm=false 端点级自动化测试（P2，本轮 curl 覆盖）。**Stage 5d 后端指令：无**；仅当 FR/Test 未闭合前端 P0/P1（D-FE-01/02/03）时由 Dispatcher 派定向 5d。

### 仍 OPEN 的 P2（不阻断 Stage 6，需 Owner 收口）

DEF-009（包结构文档）、DEF-010（architecture §4 Redis 措辞）、DEF-011（AI requestId）、DEF-013 残留（`backend/README.md` 8090）、DEF-014（JWT_SECRET 长度校验）、DEF-015（ticket 第 4 次兑换重跑）、DEF-016（CHECK 3819→409）。详见 `docs/architecture-review-closure.md` §3。

## Stage 5c 测试回归新增 / 关闭（2026-11-15 00:20 CST）

| ID | 级别 | 关联 AC | 标题 | 最小复现 | 期望 vs 实际 | 证据 | 状态 | Owner |
|---|---|---|---|---|---|---|---|---|
| S5C-D-001 | **P1** | AC-021 | 跨账号偏好残留：登出未清 `webox.prefs.v1`，`ensurePrefs()` 命中缓存不重新拉取 | 1) 账号 A 设置过敏原 Peanuts 并登出；2) 账号 B（无过敏原）登录；3) 不访问 Preferences 直接加购 Kung Pao Chicken | 过敏原按 B 的偏好判定；实际 store 仍为 A 的偏好，弹窗判定使用上一账号数据（本轮实测登录后 store 仍为上一账号 `allergens:[] / Japanese`，访问 /preferences 后才刷新为当前账号） | `frontend/src/store/authStore.ts:38-49` 未 `setPrefs(null)`；`frontend/src/store/prefsStore.ts:30-34` 有缓存即返回；截图 `artifacts/s5c-fe-allergen-modal.png`（无弹窗）→ 刷新偏好后 `s5c-fe-allergen-card-modal4.png`（弹窗正常） | **CLOSED（Stage 5e 产品定向复验 PASS，2026-11-14 23:40；报告 `docs/product-acceptance-v3.md` §1）**。修复内容：`authStore.logout/login/bootstrap` 统一清理 prefs+cart（内存与 localStorage）；`ensurePrefs()` 增加 `ownerUserId` 归属校验与请求代际防串写；证据 `artifacts/s5d-cross-account.log`、`s5d-a-login.png`、`s5d-b-no-modal.png`、`s5d-a-modal.png` | 前端开发 |
| S5C-D-002 | P2 | AC-015 | 订单接口限流 5 次/分/用户，同键幂等重试第 6 次返回 429 而非重放首次结果 | 同一用户 1 分钟内对 `POST /orders` 发 6 次（同 Idempotency-Key 同体） | 契约：同键同体重放首次结果；实际前 5 次正常、第 6 次 `429 RATE_LIMITED`（单未重复，数据正确） | `OrderService.java:102` `rateLimiter.check("order:user:"+id,5,60000)`；`artifacts/s5c-test-regress.log` statuses=...,429 | OPEN（设计确认） | 后端开发 |
| S5C-D-003 | P3 | 测试基建 | 并行节点共用 `req_6343a752e110_test`，mvn/重置期间幂等表被清导致瞬时 500 与订单 ID 漂移 | 回归执行期间另一节点跑 `mvn test`/重置 `_test` | 应隔离库；实际 `IdempotencyService.claim:40` 抛 `EmptyResultDataAccessException`（INSERT 后行被外部删除），清理后复测通过 | `artifacts/s5c-backend-8084.log:35-47`；`artifacts/s5c-test-regress2.log` 对照复测 | OPEN（测试基建） | Test Designer |

### 关闭 / 复验

| 原 ID | 复验结论 | 证据 |
|---|---|---|
| D-BE-11（P0 confirm） | **CLOSED**：改价/上下架/每日菜单/改库存 `confirm=false` 均 400 `VALIDATION_CONFIRM_REQUIRED`，DB 与审计不变；`confirm=true` 均 200 + 审计 | `artifacts/s5c-test-regress.log` / `s5c-regress.json` |
| PA-D-001（P0 Console 写 500） | **CLOSED**：`PUT /admin/dishes/1`、`PATCH .../status`、`PUT .../stock` 200，`price_cents` 落库、`audit_log` 0→1 | 同上 |
| PA-D-002（P2 并发夹具） | **CLOSED**：SQL 直插 50 用户 + 唯一 `X-Forwarded-For`，ready=50/50；50 并发抢 10 → 201=10、409=40、available=0、ledger 增量=10、reconcile drift=[] | `artifacts/s5c-test-regress4.log` |
| D-BE-12（P1 Redis 二次补偿） | 代码已改为补偿后 `prealloc=null`；本轮未构造 REDIS_PREALLOC 重复单复现，按幂等/DB 账本回归通过 | `s5c-test-idem-final.log` |

## Stage 5c 产品复验关闭 / 新增（产品工程师，2026-11-14 23:14 CST）

> 详细报告：`docs/product-acceptance-v2.md`；证据目录：`artifacts/s5c-product/`。**结论 CHANGES**：1 个 P1 未闭环（S5C-D-001），其余 P0/P1 关闭。

### 关闭

| 原 ID | 级别 | 复验结论 | 独立证据 |
|---|---|---|---|
| PA-D-001 | P0 | **CLOSED**：8083 新进程改价/上下架/每日菜单/改库存均 200，DB 生效，`audit_log` 含 before/after/reason；`confirm=false` → 400 且无变更 | `artifacts/s5c-product/ac030-032-curl.log` |
| D-FE-01 | P0/blocker | **CLOSED**：偏好默认/整页保存 200；刷新后 Peanuts/Japanese/Mild/Rich/10.00/15.00/For You 全保留 | `b7-preferences-saved.png`、`b8-preferences-after-refresh.png`、`ac021-023-api.log` |
| D-FE-02 / DEF-006 | P1 | **CLOSED**：卡片快捷加购含过敏原菜 → 弹窗；Cancel 不入车、Add anyway +1 | `b2-allergen-modal.png`、`b3-cart-after-allergen.png` |
| D-FE-03 | P1 | **CLOSED**：同 tick 双击 Place Order 仅 1 个 POST/201，成功页 + 购物车清空；重复单展示 View Existing Order | `b5-double-submit-success.png`、`b6-duplicate-recovery.png` |
| PA-D-002 | P2 | **CLOSED**：50/50 用户、201=10/409=40、available=0、ledger RESERVE=10 | `artifacts/test-conc-order.log`（与测试执行结论一致） |
| PA-D-003 | P2 | **CLOSED**：8083 JDK17 稳定运行；`scripts/start.sh` 固定 JDK17 + health 探测 | `s5b-backend-fix.log`、`backend/scripts/start.sh` |

### Stage 5d 定向修复（待产品定向复验，未 CLOSED）

| ID | 级别 | 关联 AC | 复验结论 | 独立证据 |
|---|---|---|---|---|
| S5C-D-001 | **P1** | AC-021/022/023 | **CLOSED（Stage 5e 产品定向复验通过，2026-11-14 23:40；`docs/product-acceptance-v3.md`）**：登录/登出/引导失败均清理 prefs+cart（内存 + `webox.prefs.v1`/`webox.cart.v1`）；`ensurePrefs()` 校验持久化 `ownerUserId` 与当前会话一致，否则清空并重拉；登录后强制重拉 `GET /me/preferences`。本地复验：A(Peanuts)→登出→B 加购 Kung Pao 不弹窗；B→登出→A 加购弹 Peanuts 确认；登出后两 key 均为 `null` | `artifacts/s5d-cross-account.log`、`s5d-a-login.png`、`s5d-b-no-modal.png`、`s5d-a-modal.png`、`s5d-build.log`；代码 `frontend/src/store/{authStore,prefsStore,cartStore}.ts` |

### 新增 P2（不阻断）

| ID | 级别 | 内容 | Owner |
|---|---|---|---|
| PA-D-004 | P2 | `GET /api/v1/admin/dishes/{id}` 未定义路由被统一异常处理为 500（应 404/405）；契约未定义该端点，属错误码一致性 | 后端开发 |
| TE-D-005 | P2 | 共享 `agent-browser` daemon 多工作区共用同一标签页导致跨会话跳转；产品复验改用隔离 Chrome（CDP 9444）。测试基建应支持独立上下文 | Test Designer |

### Stage 5d 门槛

S5C-D-001 修复 + 产品定向复验通过并在此台账改 **CLOSED** 前，G4/G5 不得 GO；其余 P0/P1 已无 open。
**门槛已满足（2026-11-14 23:40）**：S5C-D-001 已改 CLOSED，无 open P0/P1，G4/G5 可 GO。

## Stage 5e 测试侧快回归（测试执行工程师，2026-11-14 23:18 CST）

> 报告：`docs/test-report-v3.md`；证据：`artifacts/s5e-*.log`、`s5e-*.png`。

| ID | 级别 | 测试侧复验结论 | 证据 |
|---|---|---|---|
| S5C-D-001 | P1 | **TEST VERIFIED**：全新浏览器 profile（排除历史残留）下，A(服务端 Peanuts) 加购 Kung Pao 弹窗 → 登出 `{auth,prefs,cart}` 全 `null` → B(服务端 `[]`) 加购无弹窗 → 登出全 `null` → A 重新登录再次弹窗 → 最终全 `null`。服务端偏好接口复核 A=`["Peanuts"]`、B=`[]` | `artifacts/s5e-cross-account.log`、`s5e-prefs-server.log`、`s5e-a-peanuts-modal.png`、`s5e-b-no-modal.png`、`s5e-a-modal-again.png` |
| 冒烟 9 项 | — | **PASS 9/9**：health、注册、登录、菜单、偏好保存/回读、下单、同键幂等重放、订单列表、员工 `/admin` 403 | `artifacts/s5e-smoke.log` |

**测试侧结论**：本轮无新增 P0/P1；S5C-D-001 待产品定向复验后由产品侧改 CLOSED。S5C-D-002（P2）、S5C-D-003（P3）状态不变。

## Stage 5e 产品定向复验（产品工程师，2026-11-14 23:40 CST）

> 报告：`docs/product-acceptance-v3.md`；证据目录：`artifacts/s5e-product/`；账号独立新建：A=`s5e_prod_a_2318@test.com`(121, Peanuts)、B=`s5e_prod_b_2318@test.com`(122, 无过敏原)。**结论 PASS。**

| ID | 级别 | 复验结论 | 独立证据 |
|---|---|---|---|
| S5C-D-001 | **P1** | **CLOSED**：A 加购 Kung Pao(dishId=1) 弹 `This dish contains an allergen you flagged: Peanuts. Add anyway?`，确认前不入车；A 登出后 `webox.prefs.v1`/`webox.cart.v1`/`webox.auth.v1` 均 `null`；B 登录后**未访问 Preferences**，`prefs` 已为 `ownerUserId=122 / allergens=[]`，直接加购同菜 **无弹窗**并入车；B 登出全 `null`；A 再登录加购**再次弹窗**（`ownerUserId=121`） | `artifacts/s5e-product/{run-a-flow.log,run-b-flow.log,run-a-return.log,a2-modal-peanuts.png,b1-no-modal.png,a4-return-modal.png,a3-after-logout.png,b2-after-logout.png}` |

### 同期回归冒烟（AC-030/032/014/015/053）

| AC | 结论 | 证据 |
|---|---|---|
| AC-030 | **PASS**：下架 dish1 → 员工菜单 20→19 且不可见；恢复 20 且可见 | `artifacts/s5e-product/regression-smoke.log` |
| AC-032 | **PASS**：confirm=false → 400 且 DB 不变；confirm=true → 200、DB 2500、审计含 before/after/reason/ip；回滚 2200 且新增审计 | 同上 |
| AC-014 | **PASS**：201、`WB20261115-0019`、total 2200、snapshot 非空、items 1 行、ledger RESERVE 恰 1 条（36→35） | 同上 |
| AC-015 | **PASS**：同键同体重放同 orderId=19；同键改 qty → 409 `IDEMPOTENCY_CONFLICT`；缺头 → 400 | 同上 |
| AC-053 | **PASS**：500ms 内连点 Add 10 次 → 购物车仅 1 行 qty=1 | `run-ac053.log`、`ac053-doubleclick.png` |

## Stage 5e 产品全量 PRD 功能验证（产品工程师，2026-11-14 23:59 CST）

> 触发：用户要求启动前后端并验证 PRD 功能是否全部实现。报告：`docs/prd-verification-final.md`；证据：`artifacts/prd-verify/`。
> 服务：后端 8083（PID 1385859，health db/redis/cache UP）、前端 5175（PID 1321104，`/api` 代理 200）。**API 106/106 通过（2 条初判为断言口径问题，已复核）；Tier 1/2 PASS，Tier 3 PASS（AI 配置项 PARTIAL）。**

| ID | 级别 | 内容 | 影响 | 建议/证据 | 状态 |
|---|---|---|---|---|---|
| PRD-GAP-001 | P2 | AI 推荐未配置 LLM Key：`/ai/recommend` 返回 `meta.fallback=true, model=rule-based`；SSE `meta→dish→reason→done`、过敏原/售罄过滤、卡片与理由均正常 | Tier 3 未满足 PRD“必须实际接入 LLM”；Tier 1/2 不受影响 | 配置 `.env` 的 `LLM_API_KEY`（可选 `LLM_BASE_URL/LLM_MODEL`）重启后端，复验 `fallback=false`；证据 `artifacts/prd-verify/ai-and-upload.log` | OPEN |
| OBS-001 | P3 | 看板默认“今日”按配送日口径，晚间创建、次日配送的订单不计入 today；`?date=2026-11-15` 可见 8 单/¥354.80 | 语义符合“今日经营”，非缺陷 | 文档注明口径；证据 `prd-verify.log` 看板段 | OPEN（文档项） |

**产品侧结论**：无新增 P0/P1；GO 门槛满足。环境说明：首轮 agent-browser 复用历史登录会话（`s5c_e2e2@webox.com`, id=119）并在清空会话前保存过一次 Peanuts（测试账号副作用，未动业务数据），已在报告 §6 披露；复验使用独立新建 A/B 账号。
