# G3 可测性交叉评审 — 测试方案设计师

- 时间：2026-11-14 22:13 CST（Stage 3b，SLA 15min）
- 评审人：测试方案设计师（非作者）
- 评审对象：`docs/backend-design.md`（48KB，v1.1 22:06）、`docs/frontend-design.md`（61KB，22:07）、`docs/api-contract.md`（14KB，21:57）、`docs/test-plan.md`（v1.0 21:58）、`docs/test-cases.md`（v1.0 22:00）
- 结论：**CHANGES（可进入 Stage 4，但 3 个 blocker 必须在 Stage 4 落地/Stage 5 前闭合）**

## 1. 结论摘要

| 维度 | 结论 | 依据 |
|---|---|---|
| 设计可测性（T0/T1/T2、条件扣减、active_key、ledger、30min 超时、截单 Clock、SSE ticket、双库存降级、AI 无 Key 降级） | **基本可测**；30min 超时与多数钩子可测，但存在 1 个不可执行 blocker | backend-design.md:14/16/19/22-23/329-383/404-441/543-571 |
| 测试钩子明确性 | **CHANGES**：钩子表与冻结契约不一致、库隔离未执行 | test-plan.md:184-197 vs api-contract.md:20/60/74/85-93 |
| 用例与新契约一致性 | **CHANGES**：available boolean/int、preview 不报库存、管理员状态流转、reason 规则、SSE ticket 均缺断言 | test-cases.md:24/53/92-94/111 |
| AC 覆盖 | **60/60 AC + 建议 AC-061 均有 ≥1 用例（61/61）**；新增 6 条用例后 85 条 | test-cases.md:140 |

**Blocker：3（B1~B3）；Major：7（M1~M7）；Minor：0（按门禁只列 blocker/major）。**

## 2. Blocker

### G3T-B1 测试钩子表与冻结契约不一致，Stage 5 将直接 404

- 证据：`test-plan.md:190-197` 仍写 H3 `PUT /admin/menu/{date}/dishes/{dishId}/stock`、H4 `POST /admin/orders/{id}/confirm|complete`、H5 `GET /admin/inventory/reconcile` + `POST /admin/inventory/adjust`、H10 `PUT /admin/ai/rules` + `POST .../rollback`；冻结契约实际为 `PUT /admin/daily-menu/{serveDate}/{dishId}/stock`（#32）、`PATCH /admin/orders/{orderId}/status`（#24，body `{toStatus,confirm,reason}`）、`GET /admin/inventory/reconcile` + `POST /admin/inventory/adjust`（#33/#33b）、`PUT /admin/ai-rules`（#37）（`api-contract.md:74/87/89/93`）。
- 影响：TC-051/TC-052/TC-037/TC-064/TC-067 的前置构造无法执行；管理员状态机 AC-019/AC-042 不可判定。
- 修复指令（Stage 4/5）：
  1. `test-plan.md` §7 表按契约路径重写（已在本轮回写完成）。
  2. 测试脚本以契约 path 为准，禁止实现旧路径；`tests/api` 中如出现旧 path 一律改。
  3. Stage 5 首条命令用 `curl -i` 验证 #24/#32/#37 存在性，失败即记 P0 blocker。

### G3T-B2 30 分钟超时无法用 `X-Test-Clock` 触发（AC-060 不可测）

- 证据：backend-design.md:428 明确 `AppClock.now()` 在**异步线程回退系统时钟**；:569 超时任务查询 `created_at < now()-30m`。TC-040（test-cases.md:68）写“H1 前进 31 分钟触发超时任务”，但 `@Scheduled` 线程不读请求头，H1 对已存在订单的 `created_at` 也无影响 → 该用例必然假阴性。
- 影响：AC-060 P0 类库存回补不可判定；若虚标 PASS 将掩盖二次回补缺陷。
- 修复指令（二选一，优先 1）：
  1. Stage 4 增加 test profile 专用 `POST /api/v1/admin/orders/{id}/expire`（仅 `webox.test.clock-enabled=true`，走同一 CAS 取消 + RELEASE 逻辑），TC-040 改为调用它；重复调用 2 次断言仅 1 条 RELEASE。
  2. 不改代码：TC-040 改为 SQL 回拨 `UPDATE orders SET created_at = created_at - INTERVAL 31 MINUTE WHERE id=?;`，等待 ≤60s 调度 tick 后断言；证据附 SQL 前后值与 ledger。
  3. 若两者都未实现：Stage 5 记 `NOT TESTED`，不得记 PASS。
- 已在本轮 test-cases.md TC-040 中改为方案 2（SQL 回拨）并保留方案 1 备注。

### G3T-B3 集成/并发测试仍指向演示库，未落 `req_6343a752e110_test`

- 证据：`test-plan.md:36/195/203/217/226/246` 全部为 `req_6343a752e110`；G2-BE-M9 仍 OPEN（`review-findings.md:92`）。`tests/sql/reset.sql` 直接 `DELETE FROM orders/inventory_ledger/idempotency_records`（:6-9），对演示库执行会清空演示数据。
- 影响：Stage 5 并发/幂等 50 用户会污染验收种子，AC-056/AC-079 演示可用性被破坏；违反“每 issue 独立库”。
- 修复指令：
  1. 全部测试命令/脚本连接 `req_6343a752e110_test`；演示库只由 RUNBOOK 初始化脚本管理。
  2. `reset.sql` 增加 `SELECT IF(@ALLOW_DEMO_RESET=1,'ok',SIGNAL SQLSTATE '45000')` 守卫，或拆为 `reset_test.sql`（无守卫）与 `reset_demo.sql`（需显式环境变量）。
  3. Stage 5 证据首行打印 `SELECT DATABASE()`，必须为 `req_6343a752e110_test`。
- 已在本轮回写 test-plan §1.3/§8/§9 与 H8。

## 3. Major

### G3T-M1 `available` 类型契约缺断言，TC-057 期望与前端兜底矛盾
- 证据：api-contract #11/#12 为 boolean、#14 SSE/#30/#32 为 int（`backend-design.md:226-230`；`frontend-design.md:171/568` 已登记缺口 14）。
- 问题：TC-057（test-cases.md:92）首屏即期望 `Only 3 left`，但菜单初始只给 boolean，前端无计数来源（只会显示 `Low stock`）。
- 修复：TC-057 拆两段——首屏断言 `lowStock=true` 且显示 `Low stock`（不得出现虚构数字）；SSE `snapshot` 后断言 `Only 3 left`。新增 TC-010b：`GET /menu` 断言 `available` 为 JSON boolean、`lowStock`/`soldOut` 为 boolean；SSE/Console 断言 `available` 为 int。
- 已回写 test-cases.md TC-057/TC-010b。

### G3T-M2 preview「不报库存错」无正向用例
- 证据：backend-design.md:196 / api-contract #17：preview 不锁库存、不报库存 409。
- 修复：新增 TC-029b：库存 0 的菜 preview → 200，返回金额/有效餐次/`existingOrderId`，不含 `STOCK_INSUFFICIENT`；随后 submit → 409 `STOCK_INSUFFICIENT`。证据为两次响应。
- 已回写。

### G3T-M3 管理员状态流转与 reason 规则未覆盖
- 证据：api-contract #24 状态矩阵（Pending→Confirmed→Completed；Pending→Cancelled；其余 409）与 reason 1–200 必填；#22 员工 reason 可选、管理员必填（G2-BE-M8）。
- 修复：新增 TC-037b：管理员 `PATCH /admin/orders/{id}/status` 走完整矩阵（合法 3 条 + 非法 3 条 409），缺 reason → 400 `VALIDATION_REASON_REQUIRED`，审计各 1 条；员工取消不带 reason → 200，管理员取消不带 reason → 400。
- 已回写。

### G3T-M4 T0/T1/T2 幂等状态与 4xx 快照无断言（G2-BE-M5 口径）
- 证据：backend-design.md:374-375（业务 4xx 落 COMPLETED 快照、5xx 落 FAILED 可重试）、:336-350。
- 问题：TC-034 只断言同 orderId，未断言 `idempotency_records.status` 与错误快照，无法区分“重放”与“重新执行”。
- 修复：TC-034 追加 DB 断言：并发 7 次后该 `(user_id,key)` 恰 1 行且 `status='COMPLETED'`；重复单场景快照含 `ORDER_DUPLICATE+existingOrderId`；注入 5xx（如停 DB 连接）后 `status='FAILED'`，同键重试可成功且不产生第 2 单。
- 已回写 TC-034b。

### G3T-M5 active_key / ledger 不变量断言缺失
- 证据：backend-design.md:16/381-384（`active_key` 生成列 + `uk_orders_active`）、:411（每次写 1 条 ledger，唯一键只回补一次）。
- 修复：新增 TC-036b：取消/完成后 `SELECT active_key FROM orders WHERE id=?` 为 NULL；`SHOW INDEX FROM orders` 含 `uk_orders_active`；ledger `business_key` 唯一、`before_available-after_available=qty`；对账 SQL（backend-design.md:292-302）在每次下单/取消/确认后 `drift=0`；`ADJUST` 不重复计入。
- 已回写。

### G3T-M6 SSE ticket 与事件裁剪无用例
- 证据：api-contract #15 `/menu/stream-ticket` 60s、最多 3 次兑换（G2-BE-M7）；#14 SSE 仅 `dishId+available`。
- 修复：新增 TC-059b：ticket 兑换 1 次成功、同 ticket 第 2/3 次成功、第 4 次 401；>60s 后 401；事件 `data` 仅含 `dishId/available`，无 name/priceCents；15s 心跳存在；`retry:3000`。
- 已回写。

### G3T-M7 并发/降级夹具未落到具体文件
- 证据：test-plan H2 只写“复用注册或 `tests/sql/seed_users.sql`”，实际 `tests/sql/` 仅有 `reset.sql/assertions.sql`（文件清单）；50 用户 JWT 生成不在脚本中。
- 修复：Stage 5 首跑前生成 `tests/sql/seed_users.sql`（50 个 `race_<RUN_ID>_NN@test.com`，同一 `Passw0rd1` 哈希）并在 `order_race.mjs` 中批量登录取 JWT；Redis 停启命令与恢复命令写入 `tests/README.md`；证据附用户数 SQL。
- 已回写 test-plan §8/§9。

## 4. 设计可测性逐项结论（要求项）

| 设计点 | 可测性 | 测试锚点 | 结论 |
|---|---|---|---|
| T0/T1/T2 幂等事务 | 可测（需 DB 断言） | TC-033/034/034b | M4 补齐后 PASS |
| 条件扣减（`UPDATE ... WHERE available>=n`） | 可测 | TC-058 50 并发 | PASS（设计 :360） |
| `active_key` + `uk_orders_active` | 可测 | TC-036b/TC-044 | M5 补齐后 PASS |
| ledger 每动作 1 条 + business_key | 可测 | TC-036/TC-058/TC-067 | M5 补齐后 PASS |
| 30 分钟超时 | **当前不可测** | TC-040 | B2 |
| 截单 Clock 六边界+跨日 | 可测（H1 仅 test profile；生产 400） | TC-039a~g/TC-083b | PASS |
| SSE ticket | 可测 | TC-059b | M6 补齐后 PASS |
| 双库存降级（Redis 停） | 可测 | TC-066 | PASS（附 `redis-cli shutdown` 与恢复） |
| AI 无 Key 降级 | 可测 | TC-063 | PASS（1s 内 `fallback:true`） |

## 5. 钩子核对结果

| 钩子 | 契约落点 | 测试方案 | 结论 |
|---|---|---|---|
| `X-Test-Clock` | api-contract:20（test profile + `webox.test.clock-enabled=true`；否则 400） | test-plan H1 | PASS（B2 仅影响调度线程） |
| 独立测试库 | 无契约行（测试侧） | 本次改为 `req_6343a752e110_test` | B3 |
| 50 用户 SQL 夹具 | 无 | 新增 `tests/sql/seed_users.sql` | M7 |
| 库存重置 | reset.sql | 需 test 库守卫 | B3/M5 |
| DB 断言路径 | `tests/sql/assertions.sql` | §9 第 7 步 | PASS（需切库） |

## 6. 用例统计

- 原：79 个编号（TC-039a~g 计 7），AC 60/60 + AC-061。
- 本次新增：TC-010b、TC-029b、TC-034b、TC-036b、TC-037b、TC-059b（6 条）。
- 现：**85 条编号**；Tier1/2 AC 全部有 ≥1 条可直接执行用例；10 项评分卡均有专项步骤。
- Stage 5 执行顺序见 `test-plan.md` §12；未执行一律 `NOT TESTED`。

## 7. 进入 Stage 4 的条件

- B1 已在本轮回写 test-plan（执行层以契约为准），**Stage 4 无需改设计即可开工**。
- B2、B3 必须在 Stage 4 交付物中闭合（test profile expire 端点或 reset_test.sql + 测试库配置）。
- M1~M7 已在 test-cases 补齐，Stage 5 直接执行；实现未提供的能力记 `N/A`/`NOT TESTED`，不得虚报。