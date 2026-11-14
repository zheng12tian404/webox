# 评审发现台账（Review Findings）

- 口径：只登记 blocker / major；minor 不入账。
- 状态：`OPEN` / `CLOSED`；闭环责任阶段见「责任」列。
- 作者≠评审者：本文件由各阶段评审人追加，不覆盖他人条目。

## G1 — 测试视角评审产品产物（评审人：Test Designer，2026-11-14 21:56 CST）

评审对象：`docs/prd-analysis.md`、`docs/acceptance-matrix.md`、`docs/scenario-profile.md` v2。结论：**CHANGES**。

| ID | 级别 | 位置 | 问题 | 建议 | 责任 | 状态 |
|---|---|---|---|---|---|---|
| G1T-B1 | Blocker | AC-019、AC-042 | 无管理员订单流转接口/AC，无法构造 Confirmed/Completed 前置状态，AC-019 与看板状态分布不可判定 | `api-contract.md` 增 `POST /admin/orders/{id}/confirm`、`/complete`（confirm+reason+audit）；否则 AC-019/042 记 NOT TESTED | S2-Architecture / S1-产品 | OPEN |
| G1T-B2 | Blocker | AC-011、AC-012、A-10 | 购物车仅前端存储，无购物车 API，但 AC 标 `API` 验证，API 证据不可写 | 验证方式改为 `E2E + POST /orders/preview`（cart payload）；契约定义 preview 请求体 | S2-Architecture | OPEN |
| G1T-M1 | Major | AC-024/025/060、R4 | 截单边界与 30 分钟超时未定义时钟注入方式 | 契约增 `X-Test-Clock`（仅 test profile 生效）+ 可注入 `Clock`；Stage 5 验证生产 profile 忽略该头 | S2-Architecture | OPEN |
| G1T-M2 | Major | AC-035、D21/A-12 | 50 并发需 50 用户，种子仅 2 账号；注册限流未定义 | 脚本批量注册 `race_<ts>_*`；契约明确注册限流或提供 test 豁免 | S2-Architecture / S5-Test | OPEN |
| G1T-M3 | Major | AC-034、AC-043、A-17 | 低库存/售罄/`REDIS_PREALLOC` 菜品构造方式未定义 | 管理端支持设当日 `total_qty` 与 `inventory_mode`（审计）；种子至少 1 道 REDIS_PREALLOC | S2-Architecture / S2-数据 | OPEN |
| G1T-M4 | Major | AC-044 | 对账接口路径/返回结构/差异制造方式未定义 | 定义 `GET /admin/inventory/reconcile`、`POST /admin/inventory/adjust`；SQL 制造 drift=1 | S2-Architecture | OPEN |
| G1T-M5 | Major | AC-006 / AC-056 / D21 / A-12 | 当日菜单 9 道还是 20 道不一致，分页断言前置不确定 | 统一：20 道全部入库且当日菜单发布 20 道（≥9 为下限） | S2-Architecture / S2-数据 | OPEN |
| G1T-M6 | Major | AC-008/047/050 | `requestId` 来源与注入判据未定义 | 响应体 `requestId` + 响应头 `X-Request-Id` 同值；注入判据固定（200/空结果/无 SQL 关键字） | S2-Architecture | OPEN |
| G1T-M7 | Major | AC-036/039 | SSE 事件名/数据结构/重连语义未定义 | 固定 `event: meta|dish|reason|done|stock`、单行 JSON、`retry:3000`、15s 心跳 | S2-Architecture | OPEN |
| G1T-M8 | Major | prd-analysis §2 | 注册携带 `role=ADMIN` 的提权向量无 AC 覆盖 | 补 AC-061（400 或强制 EMPLOYEE + DB 无新 ADMIN）；未登录菜单 401 并入 AC-028 | S1-产品 / S2-Architecture | OPEN |

## G1 — 架构视角评审产品产物（评审人：Architecture，2026-11-14 22:02 CST）

评审对象同上；结论 **PASS**（6 major，无 blocker）。详见 `docs/cross-review-g1.md`。

| ID | 级别 | 位置 | 问题 | 处置 | 责任 | 状态 |
|---|---|---|---|---|---|---|
| G1A-01 | P1 | prd-analysis INV-6 / AC-015 | 幂等失败语义（4xx/5xx/超时）未定义 | 2xx/4xx 快照重放；5xx/超时 FAILED 可重试；24h | S2-Architecture → architecture §5 | CLOSED |
| G1A-02 | P1 | prd-analysis §4.2 / AC-024/025 | preview/submit 跨截单点餐次不一致 | submit 服务端时钟重算为准并回显 | S2-Architecture → §7 | CLOSED |
| G1A-03 | P1 | scenario-profile AI-1 / AC-038 | “近 7 天已点”口径未定义 | `created_at>=now-7d` 且 `status!=Cancelled` | S2-Architecture → §11 | CLOSED |
| G1A-04 | P1 | A-09 / SSE | EventSource 无法带 Authorization | fetch+ReadableStream Bearer；60s streamTicket 兜底 | S2-Architecture → §10.3 | CLOSED |
| G1A-05 | P1 | AC-035 | 50 并发用户夹具缺失 | 测试脚本批量建用户（BCrypt SQL 直插，规避注册限流） | S2-测试方案 / S5-Test | OPEN |
| G1A-06 | P1 | §4.8 / D21 | daily_menu 与 stock 双源一致性 | 单事务双写；publish_status+stock 分工 | S2-Architecture → §8 | CLOSED |

## S2 Architecture 对 Test Designer G1 项（G1T-*）的逐项回应

| ID | 回应 | 落点 | 状态 |
|---|---|---|---|
| G1T-B1 | 已提供 `GET /admin/orders` + `PATCH /admin/orders/{id}/status`（toStatus=Confirmed/Completed/Cancelled，confirm+reason+audit），可构造 AC-019/042 前置态 | api-contract #23–24 | CLOSED |
| G1T-B2 | 购物车无服务端表；契约定义 `POST /orders/preview` 请求体（items[dishId,qty,optionIds]）；AC-011/012 证据方式应为 E2E+preview，Stage 5 按此回填 | api-contract #17；assumptions A-10 | CLOSED（测试口径待 S5 调整） |
| G1T-M1 | `X-Test-Clock`（仅 test profile + 开关）已定义；JUnit 注入 Clock；生产忽略/400 | api-contract §1；architecture §15 | CLOSED |
| G1T-M2 | 注册限流 10/min/IP；并发夹具用 SQL 直插 50 用户（BCrypt）或 `webox.test.fixtures-enabled` 脚本，不经注册接口 | architecture §10、data-model §5 | CLOSED（实现归 S4/S5） |
| G1T-M3 | 管理端 `PUT /admin/daily-menu` 支持当日 totalQty+inventoryMode（审计）；种子 dish 1/9 为 REDIS_PREALLOC | api-contract #31/#32 | CLOSED |
| G1T-M4 | `GET /admin/inventory/reconcile` 已定义；新增 `POST /admin/inventory/adjust`（confirm+reason+ADJUST 流水）；drift 用 SQL 直改制造 | api-contract #33/#33b | CLOSED |
| G1T-M5 | 统一：20 道全部入库且当日全部 PUBLISHED（PRD 9 道库存 20–50，其余 40） | schema.sql 种子；data-model §5 | CLOSED |
| G1T-M6 | `requestId` 同时写入响应体与 `X-Request-Id` 响应头（MDC 生成）；注入判据：200/空或正常结果/无 SQL 关键字 | api-contract §1 | CLOSED |
| G1T-M7 | SSE 事件 `meta|dish|reason|done|stock`、单行 JSON、`retry:3000`、15s 心跳；断线 3 次切 5s 轮询 | api-contract §3.3；architecture §10.3 | CLOSED |
| G1T-M8 | 注册接口忽略 `role` 字段，强制 EMPLOYEE；建议 S1 补 AC-061（提权向量） | architecture §10 | CLOSED（架构侧）；产品补 AC 待 S1 |

## G2 — 前端视角评审架构/契约/测试产物（评审人：前端技术方案设计师，2026-11-14 22:08 CST）

评审对象：`docs/architecture.md`、`docs/api-contract.md`、`docs/data-model.md`、`docs/test-plan.md`、`docs/test-cases.md`。结论：**CHANGES**（2B + 8M）。详见 `docs/cross-review-g2-frontend.md`。

| ID | 级别 | 位置 | 问题 | 建议 | 责任 | 状态 |
|---|---|---|---|---|---|---|
| G2FE-B1 | Blocker | api-contract #11（L56） | 菜单列表项无 `hasOptions/hasRequiredOptions`，含必选组的菜品无法从卡片正确加购（必选项缺失→400），全量跳详情又破坏一键加购/防抖用例 | 菜单项增加 `hasOptions`、`hasRequiredOptions` 布尔字段（向后兼容） | S2-Architecture / S4-FE | OPEN |
| G2FE-B2 | Blocker | api-contract #20（L70） | 订单详情仅写“items 快照 + snapshot_json”，无字段级 JSON，T1 详情页/AC-017/AC-055 不可实现 | 固化 order detail JSON（含 items[{dishName,unitPriceCents,options[],qty,subtotalCents}] 与状态/时间/地址/取消字段） | S2-Architecture | OPEN |
| G2FE-M1 | Major | api-contract L12 vs L50 | `204` 空体与“所有响应含 envelope”冲突，前端统一 JSON 解析会抛错 | 改 200 envelope；或前端 client 204 短路（已按短路实现） | S2-Architecture / S4-FE | OPEN |
| G2FE-M2 | Major | api-contract L56/L67 | 无“已发布菜单日期”端点，结算配送日期只能盲选，错误滞后到 preview 409 | 增加 `GET /menu/dates`，或文档限定 today/today+1/today+2 并定义空态 | S2-Architecture / S4-FE | OPEN |
| G2FE-M3 | Major | api-contract L80 | 缺 `GET /admin/dishes/{dishId}`，且未定义列表行是否含编辑所需全字段 | 明确列表项含全字段或补详情端点 | S2-Architecture | OPEN |
| G2FE-M4 | Major | api-contract L41–43 | `expiresIn` 单位、refresh 轮换语义未定义，前端无法确定刷新定时与并发刷新 | 明确秒级 + refresh 轮换 + 401 统一语义 | S2-Architecture / S4-FE | OPEN |
| G2FE-M5 | Major | api-contract L99 | AI 请求带 `sessionId`，响应不回传，多轮会话无法关联 | `meta` 或 `done` 回传 `sessionId` | S2-Architecture | OPEN |
| G2FE-M6 | Major | test-cases L62/L64/L66 vs api-contract L16 | 枚举大小写冲突：测试写 `DINNER`，契约为 `Dinner` | 测试用例改 `Dinner`；前端统一契约枚举映射 | S2-Test / S4-FE | OPEN |
| G2FE-M7 | Major | test-plan L190–197 | §7 钩子表路径与 api-contract #24/#32/#33b/#37 漂移，测试脚本会 404 | 以 api-contract 为准回写 §7 | S2-Test | OPEN |
| G2FE-M8 | Major | api-contract L90 | 看板 `mealSplit`/`trend.orders` 口径未定义（订单数 vs 份数、是否含 Cancelled），AC-042 无法判定 | 明确口径并写入契约 | S2-Architecture | OPEN |
| G2FE-M9 | Major | api-contract #11 vs #14/#30/#32 | 与 BTL `G2-BE-M2` 交叉确认：`available` 在菜单为 boolean、SSE/Console 为 int；前端 `Only N left` 无数量来源，易虚构数字 | 契约统一命名：`available:boolean` + `availableQty:int`；或菜单直接给 `availableQty` | S2-Architecture / S4-FE | OPEN（前端已兜底：无计数时只显示 Low stock） |

## 复核记录

| 时间 | 阶段 | 动作 | 结果 |
|---|---|---|---|
| 2026-11-14 21:56 | S2 G1 | Test Designer 提交 2B+8M | Architecture 已逐项回应（见上表） |
| 2026-11-14 22:12 | S2 G1 | Architecture 提交 PASS + 6M | 5 CLOSED / 1 OPEN（G1A-05 测试夹具） |
| 2026-11-14 22:08 | S3 G2 | 前端技术方案设计师提交 CHANGES（2B+8M） | 待 Architecture/Test 在 G3 前回应；前端已按防御性方案实现 |
## G2 — 后端视角评审架构/契约/测试方案（评审人：BTL，2026-11-14 22:04 CST）

评审对象：`docs/architecture.md`、`docs/api-contract.md`、`docs/data-model.md`、`docs/schema.sql`、`docs/test-plan.md`、`docs/test-cases.md`。结论：**CHANGES**（1 Blocker + 8 Major，均已在 `docs/backend-design.md` 给默认决策，不阻塞 Stage 4）。详见 `docs/cross-review-g2.md`。

| ID | 级别 | 位置 | 问题 | 建议/默认决策 | 责任 | 状态 |
|---|---|---|---|---|---|---|
| G2-BE-B1 | Blocker | architecture §4/§5、api-contract §3.2、AC-015 | 幂等记录与业务同事务，业务 4xx 回滚导致首个 409 快照丢失；同键重放可能由 409 变 201 | 三段式 T0 抢占（独立提交）→ T1 业务 → T2 落快照；FAILED 仅 5xx | S3-BTL 已决策 / S2 回写契约 | OPEN（设计已闭合，待契约回写） |
| G2-BE-M1 | Major | api-contract #24、A-02、AC-019 | 管理端状态迁移矩阵未定义，Confirmed 取消与 A-02 冲突 | Pending→Confirmed→Completed；Pending→Cancelled；其余 409 | S3-BTL / S2 | OPEN（设计已闭合） |
| G2-BE-M2 | Major | api-contract #11/#12 vs #14/#30/#32 | `available` 跨端点类型不一致（boolean vs int） | 菜单 boolean；SSE/Console int；lowStock 0<avail≤3 | S3-BTL / S2 | OPEN（设计已闭合） |
| G2-BE-M3 | Major | api-contract #17/#18、A-06 | preview 库存校验、confirmAutoSwitch、existingOrderId 语义未定义 | preview 不锁库存不报库存 409；submit 始终自动切换并回显；preview 返回现有单 id | S3-BTL / S2 | OPEN（设计已闭合） |
| G2-BE-M4 | Major | architecture §8、AC-043 | Redis 预占后 DB 失败无 INCR 补偿；无重启再同步 | DB 失败补偿 INCR；Redis 异常整单降级 DB；30s 对齐 DB | S3-BTL | OPEN（设计已闭合） |
| G2-BE-M5 | Major | test-plan §1.4/§7 vs api-contract | 钩子表路径/结构与契约不一致（H3/H4/H5/H10），H7 缺 snapshot，引用不存在的 §7 | 以契约为锚回写；旧路径不实现 | S2-Test / S2-Architecture | OPEN |
| G2-BE-M6 | Major | api-contract #36/#37、AC-041 | 规则回滚无契约能力；新增端点会破坏 39 端点 | `PUT /admin/ai-rules` 增可选 `rollbackToVersion` | S2-Architecture | OPEN |
| G2-BE-M7 | Major | api-contract #14/#15 | ticket“单次使用”与 EventSource 重连冲突 | 主路径 Bearer fetch；ticket 60s 内最多 3 次兑换 | S2-Architecture / S3-BTL | OPEN（设计已闭合） |
| G2-BE-M8 | Major | api-contract #22/#24、AC-032 | 员工取消 reason 可选 vs 管理员高风险必填未区分 | 员工可选；管理员必填并审计 | S3-BTL / S2 | OPEN（设计已闭合） |
| G2-BE-M9 | Major | test-plan §3/§9 | 集成测试直连演示库，污染验收数据 | 单列 `req_6343a752e110_test`；演示库脚本仅 RUN_ID 隔离 | S2-Test / S4-BE | **CLOSED（G3 回写：test-plan §1.3/§8/§9/H8 已切 `_test` 库 + reset 守卫）** |
| G2-BE-M10 | Major | 评审意见 2026-11-14 22:12；backend-design §4.5 | 状态机未独立成模块、未定义终态、无法证明订单最终到达终态 | 新增 `com.webox.order.statemachine`：Action 负责 A→B；Completed（成功）/Cancelled（失败/关闭）吸收终态；Pending 30min 超时、Confirmed 配送日 23:59 自动完成；终态出度 0、非终态可达终态（v1.1 已落地） | S3-BTL / S4-BE | **CLOSED（v1.1）** |

## G3 可测性交叉评审（2026-11-14 22:13）

> 报告：`docs/cross-review-g3-test.md`。作者≠评审者：测试方案设计师评审设计/契约/测试产物。只列 blocker/major。

| ID | 级别 | 位置 | 问题 | Stage 4/5 可执行修复指令 | 责任 | 状态 |
|---|---|---|---|---|---|---|
| G3T-B1 | Blocker | test-plan §7 H3/H4/H5/H10 vs api-contract #24/#32/#33/#37 | 钩子路径与冻结契约不一致，Stage 5 按旧路径必 404，AC-019/042/031/044/041 前置不可构造 | H3→`PUT /admin/daily-menu/{serveDate}/{dishId}/stock`；H4→`PATCH /admin/orders/{orderId}/status`；H5→`GET /admin/inventory/reconcile`+`POST /admin/inventory/adjust`；H10→`PUT /admin/ai-rules`；脚本不得实现旧路径；Stage 5 先 curl 验证存在性 | S2-Test（已回写）/ S4-BE | **CLOSED（回写完成）** |
| G3T-B2 | Blocker | test-cases TC-040 vs backend-design:428/569 | `X-Test-Clock` 不作用于 `@Scheduled` 异步线程，+31min 无法触发 30 分钟超时，AC-060 必假阴性 | 方案 A：test profile 增 `POST /admin/orders/{id}/expire`（复用 CAS+RELEASE）；方案 B：SQL 回拨 `created_at` 后等 ≤60s tick；两者皆无→`NOT TESTED`，不得 PASS | S4-BE / S5-Test | **OPEN**（用例已改方案 B） |
| G3T-B3 | Blocker | test-plan §1.3/§8/§9、tests/sql/reset.sql | 测试仍连演示库；reset 无守卫直接清订单/ledger | 全部测试命令改连 `req_6343a752e110_test`；拆 `reset_test.sql`/`reset_demo.sql`（后者需 `ALLOW_DEMO_RESET=1`）；证据首行打印 `SELECT DATABASE()` | S4-BE / S5-Test | **CLOSED（文档回写；执行需 Stage 5 验证）** |
| G3T-M1 | Major | api-contract #11/#12 vs #14/#30/#32；TC-057 | `available` boolean/int 混用；TC-057 首屏断言 `Only 3 left` 与前端兜底矛盾，存在虚构数字风险 | TC-010b 断言菜单 boolean、SSE/Console int；TC-057 首屏只断言 `lowStock`/`Low stock`，`snapshot` 后断言 `Only N left`；契约后续统一建议 `availableQty:int` | S4-FE / S2 | **CLOSED（用例已回写）** |
| G3T-M2 | Major | api-contract #17；test-cases | preview「不报库存 409」无正向用例 | 新增 TC-029b：库存 0 时 preview 200 且不含 `STOCK_INSUFFICIENT`；submit 才 409 | S5-Test | **CLOSED（用例已回写）** |
| G3T-M3 | Major | api-contract #24/#22；G2-BE-M8 | 管理员状态矩阵与 reason 角色差异无用例 | 新增 TC-037b：合法/非法迁移矩阵、缺 reason 400、员工 reason 可选、审计逐条 | S4-BE / S5-Test | **CLOSED（用例已回写）** |
| G3T-M4 | Major | backend-design:374-375；TC-034 | 幂等 T0/T1/T2 只断言同 orderId，未断言记录状态与 4xx 快照/5xx FAILED | 新增 TC-034b：`idempotency_records.status` COMPLETED/FAILED、错误快照含 `existingOrderId`、FAILED 同键可重试且仍 1 单 | S4-BE / S5-Test | **CLOSED（用例已回写）** |
| G3T-M5 | Major | backend-design:16/381-384/411 | `active_key` 失效、`uk_orders_active`、ledger business_key/before-after 无 DB 断言 | 新增 TC-036b：`active_key IS NULL`、`SHOW INDEX`、ledger 唯一与连续、reconcile drift=0、ADJUST 不重复计入 | S4-BE / S5-Test | **CLOSED（用例已回写）** |
| G3T-M6 | Major | api-contract #15/#14；G2-BE-M7 | SSE ticket（60s/3 次）与事件字段裁剪无用例 | 新增 TC-059b：1~3 次成功、第 4 次/过期 401、data 仅 `dishId+available`、`retry:3000`、15s 心跳 | S4-BE / S5-Test | **CLOSED（用例已回写）** |
| G3T-M7 | Major | test-plan §8 H2；tests/sql 清单 | 50 并发用户夹具无具体文件，Redis 停启恢复无命令 | 生成 `tests/sql/seed_users.sql`（50 用户）；`order_race.mjs` 批量登录取 JWT；Redis 停启/恢复命令写 `tests/README.md`；证据附用户数 SQL | S5-Test | **OPEN**（脚本 Stage 5 首跑前补齐） |

## G3 — 架构视角评审后端/前端技术方案（评审人：Architecture，2026-11-14 22:13 CST）

评审对象：`docs/backend-design.md`、`docs/frontend-design.md`、`docs/cross-review-g2.md`、`docs/cross-review-g2-frontend.md`。结论：**PASS**（0 blocker；7 major，6 项本轮回写闭合，1 项转 Stage 5）。详见 `docs/cross-review-g3.md`。

| ID | 级别 | 位置 | 问题 | 建议 / 闭环指令 | 责任 | 状态 |
|---|---|---|---|---|---|---|
| G3A-M1 | Major | backend-design L386–412 | Redis 预占补偿仅覆盖失败菜，T1 整单回滚时先前菜 `DECRBY` 未回收，30s 对齐前少卖 | T1 维护预占清单，Facade 捕获回滚异常后逐菜 `INCRBY`；单测 `RedisStockIT#rollback_compensates_all_dishes` | S4-BE | OPEN（指令已给） |
| G3A-M2 | Major | backend-design L368–378、data-model §2.4 | 24h 后同键重提交命中 `uk_orders_user_idem`，误映射 `ORDER_DUPLICATE` | 契约 §1 明确键永久唯一；1062 映射 409 `IDEMPOTENCY_CONFLICT`；`IdempotencyIT#expired_key_same_user_conflicts` | S4-BE | CLOSED（契约 v1.1） |
| G3A-M3 | Major | frontend-design §10 #03 | FE 按 204 短路，与统一包络冲突 | 契约改 200 + `{deleted:true}`；FE 删除 204 分支 | S2-Architecture / S4-FE | CLOSED（契约 v1.1） |
| G3A-M4 | Major | frontend-design L551–570 | 前端契约缺口表过期（hasOptions/availableQty/订单详情/规则回滚已入契约） | Stage 4 FE 按新字段直连；AI 规则回滚若裁剪则 AC-041 记 NOT TESTED | S4-FE | CLOSED（契约 v1.1） |
| G3A-M5 | Major | test-plan §7、backend-design L605–613 | 测试钩子表/用例枚举仍为旧稿（路径漂移、`DINNER` 大小写） | 以 api-contract v1.1 为唯一锚点；新增 I10 断言生产 profile `X-Test-Clock`→400；S5 只跑契约路径 | S2-Test / S5 | OPEN（不影响 Stage 4 编码） |
| G3A-M6 | Major | api-contract §1.1 vs backend ErrorCode | 错误码字面不一致（REASON_REQUIRED vs VALIDATION_REASON_REQUIRED） | 契约 §1.1 标注实际码；Stage 4 枚举逐字对齐（含 VALIDATION_TEST_CLOCK_FORBIDDEN） | S4-BE | CLOSED（契约 v1.1） |
| G3A-M7 | Major | frontend-design L141 | 端点常量标题“38 个”，实际 39（含 #33b） | 文档改 39；Stage 4 39/39 自检 | S4-FE | CLOSED（契约 v1.1） |

### G3 blocker 闭环登记

| 原 ID | 闭环方式 | 状态 |
|---|---|---|
| G2-BE-B1 | api-contract §3.2.1 T0/T1/T2 + backend-design L329–378 | CLOSED |
| G2FE-B1 | api-contract #11 `hasOptions/hasRequiredOptions` | CLOSED |
| G2FE-B2 | api-contract #20 字段级 JSON | CLOSED |
| G2-BE-M1/M2/M6/M7/M8；G2FE-M1/M2/M3/M4/M5/M8/M9 | api-contract v1.1 对应端点回写 | CLOSED |

| 时间 | 阶段 | 动作 | 结果 |
|---|---|---|---|
| 2026-11-14 22:13 | S3 G3 | Architecture 提交 PASS（0B+7M） | 3 个 G2 blocker + 11 个 major 契约回写闭合；G3A-M1/M5 待实现/测试阶段 |

## G3 — 产品视角评审后端/前端/验收方案（评审人：产品工程师，2026-11-14 22:10 CST）

评审对象：`docs/backend-design.md`、`docs/frontend-design.md`、`docs/acceptance-matrix.md`、`docs/prd-analysis.md`、`docs/scenario-profile.md` v2。结论：**CHANGES**（0 Blocker / 5 Major OPEN + 1 Major 已闭环），不阻断 Stage 4。详见 `docs/cross-review-g3-product.md`。

| ID | 级别 | 位置 | 问题 | 修复指令 | 责任 | 状态 |
|---|---|---|---|---|---|---|
| G3P-M1 | Major | backend-design L428/L569、AC-060 | 超时任务不在请求上下文，`X-Test-Clock` 无法推进 30 分钟；AC-060 只能 NOT TESTED | 增 test-only `webox.test.time-offset-minutes` 注入 `Clock.offset`，或在 test-plan 固化 `created_at=now()-31m` 夹具；写入 AC-060 用例步骤 | S4-BE / S2-Test | OPEN |
| G3P-M2 | Major | backend-design L357、AC-020 | `qty 1–5` 若用 `@Max(5)` 会先返回 `VALIDATION_*`，与 AC-020 断言 `ORDER_LIMIT_EXCEEDED` 冲突 | DTO 仅 `@Min(1)`；`qty>5` 或 `Σqty>5` 由 Service 统一抛 400 `ORDER_LIMIT_EXCEEDED`（data.limit/requested） | S4-BE | OPEN |
| G3P-M3 | Major | backend-design L203/206/207/210/211/213/217、AC-032 | 高风险端点只声明 `confirm=true`，未定义 `confirm=false` 行为，绕过 UI 可无确认改价/改库存 | #24/#27/#28/#31/#32/#33b/#37 服务层校验 `confirm==true`，否则 400 `VALIDATION_CONFIRM_REQUIRED`；补错误码与 AC-032 追加断言（无审计行） | S4-BE / S2-Architecture | OPEN |
| G3P-M4 | Major | frontend-design L175 vs L188/L252、AC-021/D11 | 无必选组菜品从菜单卡片快捷加购绕过 `AllergenModal`，过敏原提醒只覆盖详情/AI 路径 | 过敏原判定下沉到唯一 `addToCart` 入口（menu/detail/AI 三入口共用）；E2E 补“无选项含 Egg 卡片加购→弹窗→确认后 +1” | S4-FE | OPEN |
| G3P-M5 | Major | backend-design §13 L694–703、评分卡 | BE-1..BE-5 有实现机制但无显式映射表（FE 已有 L355–363） | §13 增 5 行表：缓存/幂等/注入/权限/并发 → 文件·类·AC 锚点 | S4-BE（文档收尾） | OPEN |
| G3P-M6 | Major | acceptance-matrix、prd-analysis L33、AC-061 | 注册携带 `role:"ADMIN"` 的提权向量无 AC（G1T-M8 遗留） | 已在 `acceptance-matrix.md §4.1` 追加 AC-061（Tier1 P0）：400 `VALIDATION_ROLE` 或强制 EMPLOYEE，DB 无新增 ADMIN；AC-001~060 语义不变 | S1-产品（本次） | **CLOSED** |

**复核记录追加**：2026-11-14 22:10 S3 G3 产品评审提交 CHANGES（0B/5M + 1M 已闭合）；Tier1/2 33 条 AC 前后端落点全量抽检 33/33 PASS；Tier3 全部有设计或可 N/A；文案英文与 `¥xx.xx` 双端一致。Stage 4 可启动，M1–M5 并行修正。

## G4 — 后端代码评审（评审人：BR，2026-11-14 23:02 CST）

评审对象：`backend/` 全部源码 + schema + pom + 测试；报告 `docs/backend-review.md`。结论：**CHANGES**（1 Blocker + 1 Major + 7 Minor；P6+ 五项全部 PASS）。

| ID | 级别 | 位置 | 问题 | Stage 5b 可执行修复指令 | 责任 | 状态 |
|---|---|---|---|---|---|---|
| G4-BE-B1 | **Blocker** | `admin/AdminService.java:107-136,236-304,335-353,524-548`；`dto/Dtos.java:38-56` | 契约 v1.1 #24/#27/#28/#31/#32/#33b/#37 要求 `confirm:true`，代码从不读取 `req.confirm()`；`confirm:false` 仍可改价/上下架/改库存/调库存/改 AI 规则。实测 `PUT /admin/daily-menu/{date}/{dishId}/stock {"confirm":false,...}` → 200。AC-032（P0）不满足 | 新增私有 `requireConfirm(Boolean c)`：非 TRUE 抛 `400 VALIDATION_CONFIRM_REQUIRED`；在 `updateDish`/`updateDishStatus`/`saveDailyMenu`/`updateStock`/`adjust`/`putAiRules`/`adminPatchStatus` 入口调用；补 IT：`confirm=false` → 400、`audit_log` 无新增、价格/库存不变 | S5b-BE | **CLOSED**（BR S5c 复评：4 端点 confirm=false→400、DB/审计 delta=0；confirm=true→200+审计） |
| G4-BE-M1 | Major | `order/OrderService.java:121-130` + `:134-137` | DuplicateKey（`uk_orders_active`）路径内层已 `redisStock.compensate(prealloc)`，外层 `catch ApiException` 再补偿一次 → Redis 预占被 `INCRBY` 两次，REDIS_PREALLOC 可售数虚高至 30s 对齐；DB 不超卖 | 内层补偿后置 `prealloc = null;`（或标记已补偿），保证每份预占只补一次；补 IT：重复单后 Redis `GET key` == DB available | S5b-BE | **CLOSED**（BR S5c：`OrderService.java:130-132/141/145` 每份预占只补偿一次） |
| G4-BE-m1 | Minor | `realtime/SseHub.java:63-75` | 库存事件广播不分订阅日期 | `Entry` 带 date，按 date 过滤 | S5b-BE | OPEN |
| G4-BE-m2 | Minor | `catalog/MenuController.java:75` | `/menu/stream?date=abc` 未捕获解析异常 → 500（应 400） | 改用 `Util.parseDate` | S5b-BE | OPEN |
| G4-BE-m3 | Minor | `auth/AuthService.java:36-57` | 注册无 10/min/IP 限流（架构 §10、G1T-M2） | `limiter.check("register:ip:"+ip,10,60_000)` | S5b-BE | OPEN |
| G4-BE-m4 | Minor | `auth/AuthService.java:88-118` | refresh 不校验用户 `status='ACTIVE'` | refresh SQL 加 status 条件 | S5b-BE | OPEN |
| G4-BE-m5 | Minor | `admin/AdminService.java:236-304` | 改 `total_qty` 后未 `redisStock.sync`，REDIS_PREALLOC 最多 30s 陈旧 | 写后同步 Redis | S5b-BE | OPEN |
| G4-BE-m6 | Minor | `ai/AiController.java:42,67` | 固定线程池+无界队列，排队可致 SSE 25s 超时 | 有界队列+拒绝策略 | S5b-BE | OPEN |
| G4-BE-m7 | Minor | `auth/AuthService.java:139-140` | refresh TTL 硬编码 7 天，配置项失效 | 注入 `webox.jwt.refresh-ttl-seconds` | S5b-BE | OPEN |

### 复核记录

| 时间 | 阶段 | 动作 | 结果 |
|---|---|---|---|
| 2026-11-14 23:02 | S5 G4 | BR 提交 CHANGES（1B+1M+7m） | B-1/M-1 待 Stage 5b 修复后复评 |

### P1 `/auth/refresh` 专项复核（BR）

- `AuthService.java:101-110` 使用 `Util.localDateTime(...)` 替代 `Timestamp` 盲 cast，过期/撤销/未知 token 均 401；轮换 `UPDATE ... WHERE revoked=0` 原子生效。
- 证据：`WeBoxApiIT#refreshRotatesTokensRejectsReuseAndExpired` PASS；生产 profile 实测旧 refresh 复用 → 401。
- **状态：CLOSED（修复正确）**；遗留 m-4 不阻塞。

### 复核记录（BR Stage 5c）

| 时间 | 阶段 | 动作 | 结果 |
|---|---|---|---|
| 2026-11-14 23:06 | S5c | BR 对后端 P0/P1 逐项复评（`docs/backend-rereview.md`） | **PASS**：G4-BE-B1/G4-BE-M1/G4-BE-M2/G4A-B1/G4A-M2~M5/M7/M8/G3P-M3 全部 CLOSED；证据 `artifacts/s5c-backend-rereview-evidence.log` |

## G4 — 架构符合性抽检（评审人：Architecture，2026-11-14 22:46 CST；22:48 与 BR 交叉复核后更新）

评审对象：`architecture.md`、`api-contract.md` v1.1、`data-model.md`、`schema.sql`、`backend/`、`frontend/`、`artifacts/`、实库 `req_6343a752e110`。报告：`docs/architecture-review.md`。**结论 CHANGES（1 Blocker / 7 Major / 9 Minor）**；Blocker 为 BR 已实测的 G4-BE-B1（本次抽检独立复核同一根因，合并关闭）。

### G4 架构新增/复核发现

| ID | 级别 | 位置 | 问题 | Stage 5b 指令 | 责任 | 状态 |
|---|---|---|---|---|---|---|
| G4A-B1 | **Blocker** | 同 G4-BE-B1；`AdminService.java:107,122,236,282,335,524`；`OrderService.java:328` | 高风险写接口未读取 `confirm`，`confirm:false` 可改价/改库存/改规则/状态迁移；AC-032 P0 不满足 | 服务端 `requireConfirm`，否则 400 `VALIDATION_CONFIRM_REQUIRED`；契约 §1.1 补码；IT 断言 400 + 无审计行 + 数据不变 | S5b-BE | **CLOSED**（与 G4-BE-B1 合并；BR S5c 独立实测 400/200+审计） |
| G4A-M2 | Major(P1) | AC-049；architecture §10.6/§20.2；`AuthService.java:61-62`、`AiController.java:59` | 登录/AI 有限流，**下单 5/min/用户未实现** | `OrderService.submit` 注入 `RateLimiter`，60s 第 6 次 → 429；统一 §10.6/§20.2 数字 | S5b-BE | **CLOSED**（第 6 次 429；其他用户不受影响） |
| G4A-M3 | Major(P1) | AC-058；architecture §12/§16.4 | `backup.sh`/`restore.sh` 与告警阈值文档缺失 | 补备份/恢复到临时库脚本 + `docs/observability.md`（5xx>1%/5min、P95>1s、drift>0） | S5b-BE / S5-Test | **CLOSED**（脚本+observability.md；恢复 8 表行数 MATCH） |
| G4A-M4 | Major(P1) | architecture §3/§10.3；AC-030/036；`AdminService.java:282-304,236-279` | 管理端改库存/每日菜单只失效缓存，**不推 SSE、不同步 Redis** | 新增 `InventoryService.publishAvailable`（afterCommit），两处调用并 `redisStock.sync` | S5b-BE | **CLOSED**（SSE 28ms；Redis==DB；afterCommit） |
| G4A-M5 | Major(P1) | backend-design v1.1 §4.5；`ScheduledJobs.java:28-52` | **Confirmed 自动完成（AUTO_COMPLETE）缺失**，终态可达保证不成立 | 60s 任务：Confirmed 且过期/当日≥23:59 → Completed + 系统审计（不动库存） | S5b-BE | **CLOSED**（23:00:16 运行日志自动完成 1 单 + 系统审计代码路径） |
| G4A-M6 | Major(P1) | D11；G3P-M4；`DishCard.tsx:24-45`；`MenuService.java:59-97` | 菜单卡片快捷加购无过敏原确认；仅详情页有 modal | 菜单项补 `allergens[]`（或先 GET 详情），命中偏好过敏原弹窗，确认后才 add | S5b-FE | OPEN |
| G4A-M7 | Major(P1) | architecture §3/§9；`AdminService.java:100,117,131,153,274,297,347` | 缓存失效在事务内执行而非 afterCommit；窄窗口可回填旧值（≤60s） | 抽 `afterCommit(Runnable)` 包装失效；非事务路径直接失效 | S5b-BE | **CLOSED**（7 处失效 + 库存发布均 afterCommit） |
| G4A-M8 | Major(P1) | 同 G4-BE-M1；`OrderService.java:121-137,134-142` | 重复单 DuplicateKey 路径内层已 compensate，外层 catch 再补 → Redis INCRBY 两次，REDIS_PREALLOC 可售虚高至 30s 对齐（DB 不超卖） | 内层补偿后 `prealloc=null` 或已补偿标记；验收 Redis 值==DB available | S5b-BE | **CLOSED**（与 G4-BE-M1 合并） |

### G4 Minor（P2，登记/文档）

| ID | 级别 | 问题 | 处置 |
|---|---|---|---|
| G4A-P1 | P2 | 实际包结构与 backend-design §1.2 细粒度模块不一致；依赖方向正确、无循环 | backend-design/README 增“实现偏差”段 |
| G4A-P2 | P2 | Redis 预占在 T1 内（architecture §4 字面禁止）；backend-design §4.4 已定义整单补偿 | 修 architecture §4 措辞 |
| G4A-P3 | P2 | 管理端改库存未同步 Redis → ≤30s 假 409 | 随 G4A-M4 修 |
| G4A-P4 | P2 | AI 线程未传播 RequestContext（测试时钟/MDC requestId） | TaskDecorator/显式传时钟 |
| G4A-P5 | P2 | `client.ts:78-80` 204 死分支 | 删除 |
| G4A-P6 | P2 | 根 README 未生成；`backend/README.md:16/45/48/91` 写 8090；`frontend/README.md:51` refresh 500 已过期 | S5 文档节点统一 8083/5175（端口偏差非缺陷，RUNBOOK:47） |
| G4A-P7 | P2 | `JWT_SECRET` 未校验 ≥32 字节 | 启动校验 |
| G4A-P8 | P2 | 残余证据缺口：ticket 第 4 次兑换证据与 `TicketStore.java:39` 冲突（AC-035 50/10 已由 `test-conc-order.log` 补证；AC-045 已有抽样 perf） | S5-Test 重跑 TC-059b |
| G4A-P9 | P2 | `GlobalExceptionHandler.java:56-61` CHECK 3819 未映射 409 | 补映射（当前条件 UPDATE 已规避） |

### G4 对既有发现的状态复核

| 原 ID | G4 复核结论 | 证据 |
|---|---|---|
| G3A-M1（Redis 整单补偿） | **CLOSED** | `RedisStockService.compensate:89-99` + `backend-g3-checks-2.txt` |
| G3A-M2（同键永久唯一） | **CLOSED** | `OrderService:147-149`；`WeBoxApiIT` |
| G3T-B2 / G3P-M1（30 分钟超时） | **CLOSED（方案 B）** | `backend-g3-checks.txt` G3-1（回拨 created_at，130s 后 Cancelled+TIMEOUT+1 条 RELEASE） |
| G3T-B3（测试库隔离） | **CLOSED** | `WeBoxApiIT` 断言 `_test`；`backend-db-check.txt` |
| G3P-M2（qty>5 错误码） | **CLOSED** | `OrderTxService:55-57` → 400 `ORDER_LIMIT_EXCEEDED` |
| G2-BE-B1（T0/T1/T2） | **CLOSED** | `OrderService:99/120/131`；`IdempotencyService:28-87` |
| G2-BE-M4（Redis 失败补偿） | **CLOSED** | 同 G3A-M1 |
| G2-BE-M10（状态机/终态） | **部分 CLOSED** | 迁移矩阵/终态吸收有；**AUTO_COMPLETE 缺失 → G4A-M5** |
| G3P-M3（confirm 校验） | **CLOSED** | S5c 复评：4 端点 `confirm=false` → 400 `VALIDATION_CONFIRM_REQUIRED`，DB/审计不变；`confirm=true` → 200+审计 |
| G3P-M4（过敏原统一入口） | **仍 OPEN** | `DishCard` 直接 add → G4A-M6 |
| G1A-05 / G3T-M7（50 用户夹具） | **CLOSED** | S5-Test 以逐请求唯一 `X-Forwarded-For` 完成 50/50 就绪；`artifacts/test-conc-order.log`：201=10/409=40、available=0、ledger RESERVE=10 |
| G3A-M5 / G2-BE-M5（测试钩子文档漂移） | **仍 OPEN（测试文档侧）** | S5-Test 以 api-contract v1.1 为锚回写 |

### 复核记录

| 时间 | 阶段 | 动作 | 结果 |
|---|---|---|---|
| 2026-11-14 22:46 | S5 G4 | Architecture 架构抽检 | CHANGES（1B/7M/9m）；B1 与 G4-BE-B1 合并，M8 与 G4-BE-M1 合并 |
| 2026-11-14 22:48 | S5 G4 | 与 BR 交叉复核 | 确认 G4-BE-B1/G4-BE-M1 可复现；8083 旧进程仍 500、8086 修复 jar 200；架构侧 17 项核对 PASS、schema 实库一致；端口偏差非缺陷 |

### G4 追加（BR，2026-11-14 23:06 CST）

| ID | 级别 | 位置 | 问题 | Stage 5b 可执行修复指令 | 责任 | 状态 |
|---|---|---|---|---|---|---|
| G4-BE-M2 | Major | `admin/AdminService.java:545-546` | 常规 AI 规则更新（`rollbackToVersion=null`）审计 after 用 `Map.of(..., null)` → NPE → 500 INTERNAL，事务回滚，AI 权重主路径不可用。实测 `PUT /admin/ai-rules`（合法 config）→ 500，日志 NPE@`:546`；AC-041/AI-5 不可用 | 审计 after 改为 `LinkedHashMap` 或省略 null 键；补 IT：无回滚规则更新 200、version+1、审计落库 | S5b-BE | **CLOSED**（BR S5c：PUT /admin/ai-rules 200、version=4、审计落库） |

### PA-D-001 复核（BR 独立复验）

- 产品验收登记 P0：Console 菜品写操作 500（Util 裸 ObjectMapper 无法序列化 LocalDateTime）。
- 当前代码 `common/Util.java:18-27` 已注册 `JavaTimeModule` + 禁用 `WRITE_DATES_AS_TIMESTAMPS`；新增 IT `adminDishCrudWritesAuditSnapshotsWithDatetimes`。
- BR 复测：`PATCH /admin/dishes/20/status` → 200，`audit_log` 行 `DISH_STATUS/20/reason` 落库。
- **PA-D-001 → CLOSED（BR 复核，22:43 重建包）**。

## Stage 5 G4 测试执行复核（2026-11-14 23:20 CST，测试执行工程师）

- 环境：8084 test profile + `req_6343a752e110_test`；8083 演示 profile。破坏性用例未触碰演示库。
- API：101 PASS / 9 FAIL / 1 SKIP。9 个 FAIL 中 6 个为脚手架断言（page=2、TC-017 必选组、snapshot_json、TC-045 tomorrow 重合、TC-072 期望 429、限流串扰），2 个为产品 P2（邮箱错误码、preview address），1 个为 T-05 同源。
- 并发：idempotency 6/6；order_race 50/10 全绿（无超卖、无负库存、ledger 对账一致），补齐 PA-D-002 证据。
- 安全：员工 `/admin/**` 403、横向越权 404、未登录 401、篡改 JWT 401、SQL 注入 4 种 payload 无泄露；生产 profile `X-Test-Clock` 400。
- 阻塞：E2E 员工提交订单因共享 agent-browser 会话被其他节点抢占未完成（NOT TESTED，非产品失败）；Console 截图仅 Dashboard 可用。
- 结论：无 open P0/P1；TE-D-001/TE-D-002 为 P2，建议 Leader 建修复节点；测试脚手架 T-01~T-08 由 Test Designer 修正。

## G4 — 前端视角评审产品代码 + 测试代码（评审人：FR，2026-11-14 22:48 CST）

评审对象：`frontend/` 全部代码、`tests/e2e/*`、`docs/api-contract.md` v1.1、前端证据。结论：**CHANGES**（1 blocker + 3 major）。只列 blocker/major，minor 见 `docs/frontend-review.md`。

| ID | 级别 | 位置 | 问题 | 失败场景/证据 | 修复指令 | 责任 | 状态 |
|---|---|---|---|---|---|---|---|
| G4-FE-B1 | Blocker | `frontend/src/pages/employee/PreferencesPage.tsx:14,19-24,56-70`；`backend/.../auth/MeController.java:67-73` | 偏好保存契约不一致，默认保存 100% 失败 | 默认 `Balanced` + `0/0` → 400 `VALIDATION_CATEGORY`/`VALIDATION_INVALID`；浏览器 Save 仅出 error toast，无保存成功；AC-021/022/023 不可达 | 未用预算发 `null`；`TASTE` 对齐 `Light/Medium/Rich`；补字段级提示与回归 | FE + BE | OPEN |
| G4-FE-M1 | Major | `frontend/src/components/dish/DishCard.tsx:24-45` | 菜单卡片快捷加购绕过过敏原弹窗（G3P-M4 仍 OPEN） | Peanuts 用户点击 Kung Pao 卡片：`allergen-modal=false` 且 cart +1；详情页同菜正确弹窗 | 过敏原判定下沉唯一加购入口，三入口共用 | FE | OPEN |
| G4-FE-M2 | Major | `frontend/src/pages/employee/CheckoutPage.tsx:127-183` | 无同步 in-flight 闩锁；异常恢复缺失 | 同 tick 双触发 → 2 个 POST（同 key），后端 500+409，订单已建但页面停留结算页、通用错误、购物车未清空 | `useRef` 闩锁；409 时展示已有单；补恢复文案；后端 500 联动 BE | FE（+BE） | OPEN |
| G4-FE-M3 | Major | `tests/e2e/run_e2e.sh:18-37`、`tests/e2e/checklist.md:31-38` | E2E 响应式/防抖用例空跑：未登录截图、选择器不存在、断言对象错误 | TC-075 截到 `/login`；`[data-testid=add-to-cart]` 不存在；加购无网络却按网络过滤断言 | 先登录再截图；选择器改 `add-to-cart-<id>`；断言购物车行/数量 | Test | OPEN |

复核要求：G4-FE-B1/M1/M2 修复后由 FR（非作者）复评 `CLOSED` 并附证据；M3 由测试执行复跑三档截图 + 连点用例。
