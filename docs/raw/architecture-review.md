# 架构符合性抽检（G4）— WeBox 员工餐食订购平台

- 评审人：Architecture（作者≠开发者）
- 时间：2026-11-14 22:46 CST
- 输入：`docs/architecture.md`、`docs/api-contract.md` v1.1、`docs/data-model.md`、`docs/schema.sql`、`backend/`、`frontend/`、`artifacts/`、实库 `req_6343a752e110`
- 方法：静态代码逐项对照 + 实库 information_schema/不变量 SQL + 既有运行证据复核
- **结论：CHANGES（2 Blocker / 7 Major / 9 Minor）**。核心交易不变量（幂等、唯一有效单、条件扣减、ledger、取消只回补一次、截单、快照）已落地并有证据；Blocker 为 ①`confirm:false` 可执行高风险写（G4-BE-B1，本次抽检在修复后 jar 上再次实测 200）；②PA-D-001 部署态：22:40 启动的 8083 进程早于 22:42 的 Util 修复，Console 菜品写仍 500（同版本 jar 在 8086 已验证 200）。7 个 Major 为契约/风险控制/NFR 落点缺口，交 Stage 5b 修复，不要求重构。

## 1. 核对矩阵

| # | 核对项 | 设计基线 | 实现证据（文件:行） | 实库/运行证据 | 结论 |
|---|---|---|---|---|---|
| 1 | 前后端分离 + JDK17/Spring Boot + 独立 MySQL | architecture §1/§15 | `backend/pom.xml:20-25`（java 17、Boot 3.3.5）；`application.yml:1-14` MySQL JDBC；`frontend/package.json` React18+Vite | `ss` 3306 MySQL 监听；DB `req_6343a752e110` 17 表 | **PASS** |
| 2 | 无 H2/SQLite/嵌入式库 | RUNBOOK §3 | `grep -rniE "h2\|sqlite\|hsqldb\|derby" pom/资源/Java/frontend` → 0 命中；`webox-backend.jar` 依赖仅 `mysql-connector-j-8.3.0` | 同上 | **PASS** |
| 3 | schema 与 `schema.sql` 一致（实际 DB） | data-model §9 | `diff docs/schema.sql backend/src/main/resources/db/schema.sql` → 完全相同 | 17/17 表、列集合 0 差异、10/10 `UNIQUE KEY` 存在；`orders` DDL 与文档逐字段一致（见 §4） | **PASS** |
| 4 | 模块边界/依赖方向 | architecture §2；backend-design §1.2 | 实际包：`auth/catalog/order/inventory/admin/ai/realtime/security/common/config/dto/job`；`admin → catalog/inventory`、`order → inventory/catalog`；无反向依赖、无循环 | — | **PASS（结构简化，见 P1）** |
| 5 | 事务边界：无 LLM/HTTP/SSE | architecture §4 | `OrderTxService.execute` `@Transactional`（:123-227）仅 DB 写；SSE 由 `InventoryService.publish` 注册 `afterCommit`（:122-130）；AI 在独立线程池调用 HTTP（`AiController:42,67,185-235`），不在事务内 | — | **PASS**（Redis 写见 P2） |
| 6 | 幂等 T0/T1/T2 | api-contract §3.2.1 | `OrderService.submit:99` T0 claim → `:120` T1 execute → `:131` T2 complete（4xx 快照 `:126-129`，5xx `fail:140`）；`IdempotencyService:28-91` | `idempotency_records` COMPLETED=16；并发 7 请求 → 1 单（`conc-idem.json`） | **PASS** |
| 7 | active_key + 唯一有效单 | data-model §2.1 | `schema.sql:124-132` STORED 生成列 + `uk_orders_active`；冲突映射 `OrderService:145-166` | 实库：`Cancelled/Completed` 行 `active_key=NULL`；`Confirmed` 行 `112:2026-11-15:Lunch`；索引存在 | **PASS** |
| 8 | 条件扣减/防超卖 | data-model §2.2 | `InventoryService.reserve:34-51` `UPDATE ... WHERE total-reserved-sold>=?`，0 行→409；按 `dish_id` 升序（`OrderTxService:143`） | `NEG=0`、`over_reserved=0`；**50 抢 10 → 201=10/409=40、available=0**（`artifacts/test-conc-order.log`）；15/5 亦通过（`conc-order.json`） | **PASS** |
| 9 | ledger 唯一/只回补一次 | data-model §2.3 | `InventoryService.release:60-73`、`confirm:76-88`、`reserveLedger:90-95` 均 `INSERT IGNORE` + 唯一 `business_key`；先状态 CAS 后回补（`OrderService.cancel:279-293`） | `uk_ledger_business_key` 存在；`DUP_LEDGER=0`；`DRIFT=0`；取消后 `RESERVE/RELEASE` 各 1 条（`artifact backend-g3-checks.txt` G3-1/G3-6） | **PASS** |
| 10 | Redis 降级/整单补偿 | architecture §8/§20.3；G3A-M1 | `RedisStockService.prealloc:54-87` 异常即整单 `markDegraded`；`compensate:89-99` 逐菜 INCRBY；`alignAll:107-122` 30s 对齐；DB 条件 UPDATE 始终兜底 | `backend-g3-checks-2.txt`：dish 11 售罄失败后 dish 9 Redis=30=DB available（整单补偿生效） | **PASS**（预占在 T1 内见 P2；stale 窗口见 P3） |
| 11 | 缓存 TTL/失效 | architecture §3/§9 | `AppConfig:14-20` Caffeine 60s/500；库存不进缓存（`MenuService:63,116-123` 每次查 DB） | 代码核对 | **PASS（失效时点偏差见 M7）** |
| 12 | JWT/RBAC | architecture §10；D15 | `SecurityConfig:41-49` `/admin/**` hasRole(ADMIN)、其余 authenticated、SSE/health 白名单；`JwtFilter:30-43`；`JwtService:65-86` HMAC+exp | `WeBoxApiIT.authValidationAndPermissions`：员工 403、未登录 401；`backend-real-api` 403 证据 | **PASS**（JWT 密钥长度见 P7；confirm 见 M1） |
| 13 | SSE | architecture §10.3；D17 | `SseHub:30-45` snapshot/retry:3000、`:63-75` stock 仅 dishId+available、`:77-86` 15s 心跳；`TicketStore:32-43` 60s/3 次/IP；`MenuController.stream:61-77` Bearer 或 ticket | `backend-g3-checks.txt` G3-4：snapshot 数组与 `:ping`；前端 3 次失败切 5s 轮询（`useMenuStream.ts:46-77`） | **PASS**（ticket 第 4 次证据冲突见 P8；管理端改库存不推 SSE 见 M4） |
| 14 | AI 候选过滤/幻觉/降级/规则版本 | architecture §11；D18 | `AiController.candidates:123-173` 硬过滤上架/当日库存>0/过敏原/近 7 天；`:218-230` 只接受候选集内 dishId；`:82-91` 无 Key/失败 → `fallback:true` 规则排序；`:141-145` 规则表 active 版本；`:237-248` 会话落库 | 无 Key 降级证据 `artifacts/frontend-ai-drawer-real.png`；真实 LLM 质量 **NOT TESTED**（无 Key） | **PASS**（异步上下文见 P4） |
| 15 | NFR 数字落点 | architecture §12 | 见 §5 | 见 §5 | **部分 PASS** |
| 16 | 端口偏差 | RUNBOOK:47 | 标准 8080/5173；实际 8083/5175（8080 nginx、5173 其他工作区） | `ss`：8080/5173/5175 监听；抽检时 8083/8090 无监听（历史实例已退出），运行证据取 `artifacts/backend-8083.log`、`frontend-real-api.log` | **PASS（非缺陷）**，README 必须说明 |
| 17 | 种子/演示数据 | D21；data-model §5 | `schema.sql:289-369` 20 菜/16 组/41 选项/当日+1+2 日菜单/2 账号/AI 规则 | 实库 20/16/41；`daily_menu` 当日 PUBLISHED=20；库存行 60（3 天） | **PASS** |
| 18 | Console 写链路运行态 | AC-030/031/032 | `Util.java:25-29` 已注册 `JavaTimeModule`；`AuditService:34-38` 序列化 DB 行 | 8083（22:40 启动，早于修复）`PUT /admin/dishes/20` → **500**；8086（22:43 重建 jar）同请求 → **200** 且审计落库；`artifacts/backend-8083-pa.log:977` 为 `LocalDateTime` 序列化异常 | **FAIL（部署态），代码修复已验证** |

## 2. 契约一致性（39 端点）

- 端点总数静态计数 **39/39**（`grep -rE "@(Get|Post|Put|Patch|Delete)Mapping"`：auth 5 + me 5 + menu 5 + orders 6 + admin dishes 5 + admin menu/dashboard/audit/ai-rules 9 + admin orders 2 + ai 1 + health 1）。
- 统一包络/`requestId`：`Api.envelope`（`common/Api.java:9-20`）+ `RequestIdFilter:33-34`；全部 200（无 204 业务分支）。
- 金额整数分：`BIGINT` + `Util.money:30-33`；前端 `utils/money.ts` 无浮点运算。
- 幂等/唯一单/截单/SSE 事件名/AI 事件名与契约 v1.1 逐项一致（代码引用见 §1）。
- 偏差：高风险写接口 `confirm=true` 未在服务端校验（M1）；无下单限流（M2）。

## 3. 与设计的偏差登记

| ID | 偏差 | 判定 | 说明 |
|---|---|---|---|
| D-01 | backend-design §1.2 的 `user/analytics/audit/order.statemachine/inventory 接口` 等细粒度包未落地，实际按 10 个包合并；状态机为 `order/OrderStateMachine` 静态迁移表 + 各入口 CAS | **可接受（P1，需登记）** | 依赖方向未反转、迁移矩阵与契约一致、无功能缺失；2h 时间盒下的模块化单体简化。但需在 backend-design/README 增加“实现偏差”段，避免文档承诺与代码结构长期漂移 |
| D-02 | Redis 预占发生在 T1 事务内（architecture §4 字面禁止“事务内 Redis 写作为正确性前提”） | **可接受（P2，需修正措辞）** | backend-design §4.4 已明确“整单预占补偿 + DB 为唯一账本”；Redis 不作为正确性前提，失败降级/回滚补偿齐全。architecture §4 应改为“允许非正确性前提的 Redis 预占，但必须整单补偿” |
| D-03 | `DbBootstrap` 用 `schema.sql` 首次启动建库，未用 Flyway | **可接受（已文档化）** | backend/README §2 明确；仅在 `users` 表不存在时执行，幂等。风险：半初始化库会跳过（见 §6） |
| D-04 | 管理端改库存只失效缓存，不推 SSE、不同步 Redis | **不可接受（Major M4）** | 与 architecture §3“管理端改库存 → afterCommit SSE”及 AC-030/036 不一致 |
| D-05 | 缓存失效在事务内执行（非 afterCommit） | **不可接受（Major M7）** | 窄窗口内并发读者可回填旧值，最长陈旧 60s，违反“写后 ≤1s 可见”的设计表述 |
| D-06 | 下单 5/min/用户限流未实现 | **不可接受（Major M2）** | AC-049 P1 明确“下单 6 次/分 → 429” |
| D-07 | Confirmed 自动完成任务缺失 | **不可接受（Major M5）** | backend-design v1.1 §4.5 承诺 AUTO_COMPLETE 终态可达；实际 `ScheduledJobs` 无该任务 |
| D-08 | `confirm=true` 服务端未校验 | **不可接受（Blocker，G4-BE-B1）** | G3P-M3 仍 OPEN；契约 #24/#27/#28/#31/#32/#33b/#37 明确要求；BR 已于 23:02 实测 `confirm:false` → 200。本次架构抽检独立复核代码路径确认同一根因 |
| D-09 | 菜单卡片快捷加购无过敏原确认 | **不可接受（Major M6）** | D11/G3P-M4 仍 OPEN；仅详情页弹窗（`DishDetailPage:224-238`） |
| D-10 | AI 异步线程未传播 RequestContext（测试时钟/MDC） | **可接受（P4）** | 不影响交易正确性；AI 日志缺 requestId、测试时钟对 AI 无效 |
| D-11 | 前端保留 204 死分支 | **可接受（P5）** | 契约已全 200，删除即可 |
| D-12 | 文档端口/refresh 说明过期 | **可接受（P6）** | 端口偏差本身不视为缺陷（RUNBOOK:47 已登记）；README 需统一 8083/5175 并删除 refresh 500 旧结论 |
| D-13 | PA-D-001 修复未部署到 8083 验收实例 | **不可接受（Blocker B2，运维）** | `Util.java` 22:42 已修、jar 22:43 重建；8083 进程 22:40 启动仍加载旧类 → 菜品写 500。8086 同 jar 实测 200，证明代码修复有效；重启 8083 即可关闭 |

## 4. Schema 与实库对比证据

```text
$ diff docs/schema.sql backend/src/main/resources/db/schema.sql   → 无差异
$ mysql ... information_schema
TABLES 17
orders 17 列 / idempotency_records 11 / inventory_ledger 12 / dish_daily_stock 8 / ...
列集合对比：schema.sql 17 表 vs 实库 17 表，mismatched=0，ALL_COLUMNS_MATCH=True
UNIQUE KEY：10/10 存在（uk_users_email, uk_rt_hash, uk_menu_dish_date, uk_orders_no,
  uk_orders_active, uk_orders_idem, uk_ledger_business_key, uk_idem_user_key,
  uk_addr_user_address, uk_ai_rule_version）
ENGINE=InnoDB；字符集/排序规则 utf8mb4 / utf8mb4_0900_ai_ci
orders.active_key = GENERATED STORED（CASE status IN Pending/Confirmed → user:date:meal）
实库数据：orders 8 行（Cancelled 6 / Completed 1 / Confirmed 1）；Cancelled/Completed active_key=NULL；
  Confirmed active_key='112:2026-11-15:Lunch'
NEG=0  DRIFT=0  DUP_LEDGER=0  MENU_TODAY=20  IDEM(COMPLETED)=16
```

### 4.1 运行态抽检（2026-11-14 22:45–22:48，实调 8083/8086）

| 探测 | 结果 | 结论 |
|---|---|---|
| `POST /auth/refresh`（新 token）→ 旧 refresh 复用 | 200 + 新 token 对；旧值复用 **401 `AUTH_TOKEN_INVALID`** | AC-004 运行态 PASS（`Util.localDateTime` 修复有效） |
| 8083 `PUT /admin/dishes/20`（confirm=true，no-op） | **500 `INTERNAL`**；日志 `InvalidDefinitionException ... LocalDateTime`（`backend-8083-pa.log:977`） | 8083 进程 22:40 启动，早于 22:42 的 Util 修复 → B2 |
| 8086（22:43 重建 jar）同一请求 | **200**，`audit_log` 新增 `DISH_UPDATE`（before/after 含 `created_at`） | PA-D-001 **代码修复已验证** |
| 8086 `PUT /admin/dishes/20`（confirm=false） | **200 OK**，审计落库 | **G4-BE-B1 确认**（B1 仍未修） |
| 实库审计 | `DISH_UPDATE 20` 两条；`STOCK_UPDATE 17:2026-11-14`（BR 探针） | 审计链路正常（修复后 jar） |

## 5. NFR 落点

| NFR | 目标 | 落点证据 | 结论 |
|---|---|---|---|
| 规模 | 200 员工/50 菜/30 天 6000 单 | 单库单表、覆盖索引（schema.sql:48-49,88-89,133-134） | PASS（设计） |
| 菜单/搜索/详情延迟 | P95 200/250/150ms @50QPS | Caffeine + 索引；`tests/api/perf.mjs` | **PASS（抽样）**：菜单 P95=7ms（n=198）、5xx=0（`artifacts/test-api-perf.log`）；正式 50QPS×60s 未跑 |
| 下单 P95 | ≤500ms @10QPS | 单事务 ≤8 SQL、无外部调用（OrderTxService） | **PASS（抽样）**：下单 P95=39ms（n=10）、5xx=0（`test-api-perf.log`） |
| 并发正确性 | 50 抢 10 → 10 成功、available=0 | 条件 UPDATE + 唯一索引 + ledger | **PASS**：`artifacts/test-conc-order.log` 50/50 就绪，201=10、409=40、available=0、ledger RESERVE=10 |
| 缓存 | TTL60s、写后 ≤1s、库存不缓存 | TTL/库存不缓存 PASS；失效时点 FAIL（M7） | **FAIL（M7）** |
| 分页 | 1/20，size≤100 | `Util.validatePage:94-98`；`Pagination.tsx`；MenuPage 服务端分页 | PASS |
| 限流 | 登录 10/min、下单 5/min、AI 10/min →429 | 登录 `AuthService:61-62`、AI `AiController:59`；**下单缺失** | **FAIL（M2）** |
| 实时库存 | 推送 ≤2s、断线 5s 轮询 | SSE 15s 心跳/retry3s/3 次失败轮询；管理端改库存不推送 | **部分 FAIL（M4）** |
| AI | 首 token ≤3s/总 20s/降级 ≤1s | 连接 3s、请求 8s、规则降级 <1s；无 Key 证据 | PASS（真实 LLM NOT TESTED） |
| 可用性 | 5xx=0、健康检查 | `/health` 返回 db/redis/cache（HealthController:24-40）；smoke 5xx=0 | PASS（压测未跑） |
| 备份/RTO/RPO | backup.sh/restore 演练/告警阈值文档 | **脚本与文档均缺失** | **FAIL（M3）** |
| 可观测 | requestId、慢日志、5xx 计数 | MDC requestId（RequestIdFilter:32-34）PASS；慢日志/告警文档缺失 | **部分 FAIL（M3）** |
| 多实例 | 无状态、依赖 DB 唯一键 | JWT 无状态、约束在 DB；Caffeine 仅性能层 | PASS（双实例 N/A，AC-059） |

## 6. 抽检风险

| 风险 | 触发条件 | 影响 | 缓解 |
|---|---|---|---|
| 高风险写接口 confirm 仅前端校验 | 绕过 Console 直接调 API | 改价/改库存/状态迁移可无二次确认执行（仍有 reason+审计） | M1 服务端校验 |
| 下单无限流 | 脚本/恶意用户高频提交 | 占用连接与库存行锁，影响交易 P95 | M2 |
| 管理端改库存无 SSE | 员工菜单页常驻 | 前端库存显示滞后至下一次轮询/刷新 | M4 |
| Confirmed 永不自动完成 | 管理员未手动完成 | 订单长期停留非终态，违背 §4.5 终态可达 | M5 |
| 缓存失效竞态 | 写事务提交前并发读同一菜单 | 最长 60s 旧数据 | M7 |
| 重复单路径 Redis 双补偿 | `ORDER_DUPLICATE` 且两菜均 REDIS_PREALLOC | Redis 可售虚高、最多 30s 内误判 409；DB 库存不受影响 | M8（内层补偿后 `prealloc=null`） |
| 验收实例加载旧 jar | 8083 进程早于 22:43 重建 | Console 菜品写 500，AC-030/032 无法验收 | B2 重启（8086 已证代码修复有效） |
| 备份缺失 | 演示/生产数据损坏 | 无法满足 AC-058 恢复演练 | M3 |
| 半初始化库 | 建表中断后重启 | `DbBootstrap` 看到 `users` 即跳过，缺表启动失败 | P8/运维检查（`table_count=17` 校验） |

## 7. Stage 5b 修复指令（按优先级）

> 硬冻结窗口内只做以下 P1；每项给出文件定位与验收命令，禁止顺手重构。修复后 Architecture 复评（G4）+ 回归。

| ID | 级别 | 修复 | 文件定位 | 验收 |
|---|---|---|---|---|
| G4A-B2 | **Blocker（运维）** | 用 22:43 后重建的 jar 重启 8083 验收实例（当前 8083 进程 22:40 启动，早于 Util 修复）；重启后回归 Console 菜品编辑/上下架 | 进程 PID 1355523；`artifacts/backend-8083-pa.log:977`；`Util.java:25-29` | `PUT /admin/dishes/20`（confirm+reason）→ 200，`audit_log` 新增 before/after；8083 与 8086 行为一致 |
| G4A-B1 | **Blocker** | 服务端校验 `confirm==true`，否则 400 `VALIDATION_CONFIRM_REQUIRED`；契约 §1.1 补码。与 `G4-BE-B1` 同一根因，复评时合并关闭 | `AdminService.java:107,122,236,282,335,524`；`OrderService.java:328`；`docs/api-contract.md §1.1` | `confirm=false` → 400，`audit_log` 无新增行，数据不变（当前 8086 实测仍 200） |
| G4A-M2 | P1 | 下单限流 5/min/用户（或按 §20.2 统一 10/min 并改文档） | `OrderService.submit:91` 注入 `RateLimiter`；`architecture §10.6/§20.2` 统一数字 | 60s 内第 6 次 `POST /orders` → 429 `RATE_LIMITED` |
| G4A-M3 | P1 | 补 `backend/scripts/backup.sh`、`restore.sh` 与告警阈值文档（5xx>1%/5min、P95>1s、drift>0） | `backend/scripts/`；`docs/observability.md` 或 `doc/06-deployment.md` | `bash backup.sh` → `restore.sh` 到临时库 → 17 表核心行数一致；文档存在 |
| G4A-M4 | P1 | 管理端改库存/每日菜单后 afterCommit 发 SSE + `redisStock.sync` | `AdminService.updateStock:282-304`、`saveDailyMenu:236-279`；新增 `InventoryService.publishAvailable(dishId,date)` | 已连接 SSE 客户端在 PUT stock 后 ≤1s 收到 `event:stock` |
| G4A-M5 | P1 | 60s 定时任务：`Confirmed` 且（`delivery_date<CURDATE()` 或当日 ≥23:59）→ `Completed` + 系统审计（不动库存） | `job/ScheduledJobs.java:28` | 回拨/构造过期 Confirmed → 下一 tick 变 Completed；`audit_log` 有系统记录 |
| G4A-M6 | P1 | 卡片快捷加购纳入过敏原确认：菜单项补 `allergens[]`（或先 GET 详情），命中偏好过敏原时弹窗，确认后才 add | `MenuService.list:59-97`、`api/types.ts MenuItem`、`components/dish/DishCard.tsx:24-45` | E2E：含 Egg 菜卡片加购 → `allergen-modal` → 确认后购物车 +1 |
| G4A-M7 | P1 | 缓存失效改为 `afterCommit`（`TransactionSynchronizationManager`），图片上传等非事务路径直接失效 | `AdminService.java:100,117,131,153,274,297,347`；`catalog/MenuService.java:28` | 并发读+写压测：写后 ≤1s 读到新值，无旧值回填 |
| G4A-M8 | P1 | 重复单 `DuplicateKeyException` 路径内层已 `compensate`，外层 `catch ApiException` 再补一次 → Redis 预占被 INCRBY 两次（DB 不超卖，但 REDIS_PREALLOC 可售虚高至 30s 对齐）。内层补偿后置 `prealloc=null` 或加已补偿标记。与 `G4-BE-M1` 同一根因 | `OrderService.java:121-137,134-142` | 构造 ORDER_DUPLICATE 后 Redis `GET webox:stock:{date}:{dishId}` == DB available（30s 内） |

**P2（登记/文档，不阻断 5b）**：P1 包结构与 backend-design §1.2 差异（补“实现偏差”段）；P2 Redis 预占在 T1 内（修 architecture §4 措辞）；P3 管理端改库存未同步 Redis 造成 ≤30s 假 409（建议随 M4 一起修）；P4 AI 线程无 RequestContext（TaskDecorator）；P5 前端 204 死分支（`client.ts:78-80`）；P6 文档：根 README 未生成、`backend/README.md:16/45/48/91` 写 8090、`frontend/README.md:51` 仍称 refresh 500（已修复）；P7 `JWT_SECRET` 未校验 ≥32 字节（`JwtService:30-42`）；P8 残余测试证据：ticket 第 4 次兑换重跑（`TicketStore:39` 与 `backend-g3-checks.txt` G3-4 不一致；AC-035 50/10 已由 `artifacts/test-conc-order.log` 补证）；P9 `DataAccessException` 统一 500，CHECK 3819 未映射 409（`GlobalExceptionHandler:56-61`，当前条件 UPDATE 已规避）。

## 8. 端口偏差说明（不视为缺陷）

- 8080 被系统 nginx 占用、5173 被其他工作区占用；本项目实际 **后端 8083 / 前端 5175**，已在 `RUNBOOK.md:47` 登记。
- 交付根 `README.md`（S5 文档节点 D24）必须同时写：标准端口（`SERVER_PORT=8080`、`VITE_DEV_PORT=5173`）与本次实际端口（8083/5175），并注明 8080/5173 被占用时的覆盖方式；`backend/README.md` 的 8090 与 `frontend/README.md:51` 的 refresh 500 旧结论需同步更正。
- 抽检时 8083/8090 无监听（历史验证实例已退出）；运行态以 `artifacts/backend-8083.log`、`artifacts/frontend-real-api.log` 与实库为准，Stage 6 启动后复验 `/api/v1/health`。

## 9. G4 自检

| 项 | 结论 | 证据 |
|---|---|---|
| 逐项核对模块边界/无 H2/独立 MySQL/事务/幂等/active_key/条件扣减/ledger/Redis/缓存/JWT/SSE/AI | PASS | §1 17 项 |
| schema 与 schema.sql 实库一致 | PASS | §4（17/17、列 0 差异、10/10 唯一键） |
| 偏差全部登记（有理由可接受，未登记记 major） | PASS | §3 D-01~D-12 + §7 |
| 结论 PASS/CHANGES + Stage 5b 指令 | PASS | CHANGES，2B/7M/9m（B1=G4-BE-B1 确认；B2=PA-D-001 部署态） |
| 端口偏差明确且不视为缺陷 | PASS | §8、RUNBOOK:47 |
| 未修改业务代码（作者≠开发者） | PASS | 本次仅新增/追加评审文档 |
| 证据可复核（文件+行号、DB 输出、DDL 对比、测试输出） | PASS | §1、§4、§5、§7 |

## 10. 证据索引

- `backend/src/main/java/com/webox/order/OrderService.java`、`OrderTxService.java`、`IdempotencyService.java`
- `backend/src/main/java/com/webox/inventory/InventoryService.java`、`RedisStockService.java`
- `backend/src/main/java/com/webox/admin/AdminService.java`、`catalog/MenuService.java`、`job/ScheduledJobs.java`
- `backend/src/main/java/com/webox/config/SecurityConfig.java`、`security/JwtFilter.java`、`realtime/SseHub.java`、`ai/AiController.java`
- `backend/src/main/resources/db/schema.sql`；`docs/schema.sql`；`docs/api-contract.md` v1.1；`docs/data-model.md`
- 运行证据：`artifacts/backend-8083.log`、`artifacts/backend-8083-pa.log`（PA-D-001 异常与修复前后对比）、`artifacts/frontend-real-api.log`、`artifacts/backend-testclock.txt`、`artifacts/backend-db-check.txt`、`artifacts/backend-g3-checks*.txt`、`artifacts/evidence/backend/concurrency/*.json`、`artifacts/evidence/backend/mvn-test.log`
- 本次实调：8083 `PUT /admin/dishes/20` → 500（旧进程）；8086 同请求 → 200；8086 `confirm:false` → 200（B1）；refresh 轮换 200/旧值 401
- 实库：`req_6343a752e110`（17 表；NEG=0/DRIFT=0/DUP_LEDGER=0；`active_key` 语义实测）