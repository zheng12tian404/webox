# G2 交叉评审 — 架构 / 契约 / 数据模型 / 测试方案（后端可落地性视角）

- 评审人：后端技术方案设计师（BTL）
- 评审对象（作者≠评审者）：`docs/architecture.md`(255)、`docs/api-contract.md`(185)、`docs/data-model.md`(147)、`docs/schema.sql`(367)、`docs/test-plan.md`(320)、`docs/test-cases.md`(139)
- 时间：2026-11-14 22:04 CST（Stage 3，时间盒 5 分钟）
- 视角：接口可落地性 / 契约一致性 / 事务与并发正确性 / 测试钩子可用性
- 结论：**CHANGES** —— 1 blocker + 8 major，均可由默认决策闭合，**不阻塞 Stage 4 编码**；`docs/backend-design.md` 已给出逐项落地口径，`api-contract.md` / `test-plan.md` 需在 Stage 3b 回写文字。

## 1. 结论依据（先肯定）

| 维度 | 结论 | 证据 |
|---|---|---|
| 端点数 | PASS（39 个） | `api-contract.md` #1–#38 + #33b；正文写“38 个”是计数笔误（见 §4 观察项 O-1） |
| 事务边界 | 基本 PASS | `architecture.md` §4 单事务、事务内禁 LLM/HTTP/SSE；ledger 同事务 |
| 防超卖 | PASS | 条件 UPDATE + `ck_stock_nonneg` + 唯一 ledger；`schema.sql` 已实跑 |
| 唯一有效单 | PASS | `active_key` STORED 生成列 + 唯一索引；NULL 语义正确 |
| 幂等数据模型 | PASS（实现语义需补，见 B1） | `idempotency_records` 唯一键 + response 快照 + 24h |
| DDL 可执行 | PASS | 17 表、utf8mb4、金额 BIGINT 分；Architecture 已实跑 |
| 种子可演示 | PASS | 20 菜/20 图/当日+2 日菜单；BCrypt 实测 `Admin12345`、`Employee123` 均 `True` |
| 测试脚本与契约 | 基本 PASS | `tests/api/*.mjs` 使用契约路径（如 `/admin/daily-menu/{date}/{dishId}/stock`）；`test-plan.md` §7 钩子表为旧稿（M5） |

## 2. Blocker（不闭合则 AC 无法按契约实现）

| ID | 级别 | 位置 | 问题 | 影响 | 建议 / 默认决策 | 责任 |
|---|---|---|---|---|---|---|
| G2-BE-B1 | Blocker | `architecture.md` §4 步骤 1/5、§5；`api-contract.md` §3.2；AC-015 | 幂等记录（IN_PROGRESS）与订单业务写在**同一事务**；业务 4xx（`STOCK_INSUFFICIENT`、`ORDER_DUPLICATE`）抛异常会整体回滚，**首个 409 快照丢失**。同键异体/重放语义无法按契约实现；若靠“重新执行”得到 409，则库存回补后同键重试可能变成 201，违反幂等 | AC-015 不可判定；并发下同键可能产生第二单 | **三段式事务**：T0 独立事务抢占幂等键（提交 IN_PROGRESS）→ T1 业务事务（失败回滚）→ T2 独立事务落 COMPLETED/FAILED 快照。详见 `backend-design.md` §4.2 | S3-BTL（已给默认决策）/ S2-Architecture 回写契约 |

## 3. Major（影响实现一致性或测试可执行，不阻塞开工）

| ID | 级别 | 位置 | 问题 | 建议 / 默认决策 |
|---|---|---|---|---|
| G2-BE-M1 | Major | `api-contract.md` #24；`assumptions.md` A-02；AC-019/042/060 | 管理端 `PATCH /admin/orders/{id}/status` 未定义合法迁移矩阵：`toStatus=Cancelled` 可从哪些状态进入？`Confirmed→Cancelled` 与 A-02“Confirmed 不可取消”冲突；`Completed` 后能否回退未写 | 固定矩阵：`Pending→Confirmed`、`Confirmed→Completed`、`Pending→Cancelled`；`Confirmed→Cancelled`/`Completed→*`/同态 → 409 `ORDER_STATE_INVALID`。**v1.1 起由独立 `order/statemachine` 模块实现：Action 负责 A→B，`Completed`（成功）与 `Cancelled`（失败/关闭）为吸收终态；Pending 30min、Confirmed 配送日 23:59 自动推进到终态（见 `backend-design.md` §4.5）** |
| G2-BE-M2 | Major | `api-contract.md` #11/#12 vs #14/#30/#32 | 同名 `available` 类型不一致：菜单列表/详情是**可订布尔**，SSE `stock` 与 Console 是**整数余量**；契约未标类型，前后端联调易错 | 固定：菜单列表/详情 `available:boolean`；SSE `stock.data.available:int`；Console `available:int`。新增 `lowStock=0<available<=3`，`soldOut=available==0`（不新增字段） |
| G2-BE-M3 | Major | `api-contract.md` #17/#18；A-06 | `preview` 是否校验库存、`confirmAutoSwitch` 语义、`existingOrderId` 来源未定义；`confirmAutoSwitch=false` 时截单切换行为未写 | 默认：preview 不锁库存、不因库存 409（仅算价+截单+限购+选项校验）；submit 始终按提交时刻自动切换并回写 `autoSwitched`，`confirmAutoSwitch` 仅兼容前端、服务端不据此拒绝；preview 在生效餐次已有有效单时回 `existingOrderId` |
| G2-BE-M4 | Major | `architecture.md` §8；AC-043 | `REDIS_PREALLOC` 只写“失败降级 DB”，未定义 **Redis 已 DECR、DB 条件 UPDATE 失败时的补偿 INCR**，也未定义重启/漂移后的再同步；可能误报售罄（DB 未超卖，但 Redis 少卖） | Lua 预占成功→DB 条件 UPDATE；DB 失败/异常→`INCRBY` 补偿；Redis 任何异常→本请求直接走 DB_ATOMIC。每 30s 将 Redis 值对齐 DB `available`（DB 为账本）；Redis 值只减不增的窗口≤30s |
| G2-BE-M5 | Major | `test-plan.md` §1.4/§7 H3/H4/H5/H7/H10 vs `api-contract.md` #24/#32/#33/#37 | 测试方案钩子表为旧稿：H3 路径 `/admin/menu/{date}/dishes/{id}/stock`（契约是 `/admin/daily-menu/{serveDate}/{dishId}/stock`）；H4 用 `/confirm`、`/complete`（契约是 `PATCH .../status`）；H5 返回 `{items:[{expected,actual}]}`（契约是 `drift:[{bookAvailable,ledgerDerived}]`）；H10 用 `/admin/ai/rules` + `/rollback`（契约是 `/admin/ai-rules`，无回滚端点）；H7 事件表漏 `snapshot`；§1.4 引用不存在的“§7 测试钩子”。`tests/api/*.mjs` 已按契约写，风险集中在文档与新增脚本 | 以 `api-contract.md` 为唯一锚点回写 `test-plan.md` §7；H10 回滚改用 `PUT /admin/ai-rules` 的 `rollbackToVersion`（见 M6）；H7 增 `snapshot`。Stage 4 不实现旧路径 |
| G2-BE-M6 | Major | `api-contract.md` #36/#37；AC-041；`test-plan.md` H10 | AC-041 要求规则“可回滚”，契约只有 `PUT` 新建 config，没有回滚能力/字段；新增 `POST /rollback` 会把端点数变为 40，与“39 端点”冲突 | 保持 39 端点：`PUT /admin/ai-rules` 请求增加**可选** `rollbackToVersion:int`（向后兼容）；实现为“复制旧版本配置生成新 version 并置 active”，审计留痕，不修改历史行 |
| G2-BE-M7 | Major | `api-contract.md` #14/#15；`architecture.md` §10.3 | `stream-ticket` 写“单次使用”，但原生 `EventSource` 断线会**复用同一 URL 自动重连**，第二次连接必 401，与“断线 3s 重连”冲突 | 主路径用 `fetch + ReadableStream + Bearer`（无 ticket）；ticket 仅兜底：60s TTL 内允许最多 3 次兑换（绑定 user+IP），或前端每次重连前用 Bearer 换新 ticket。默认取“TTL 内最多 3 次” |
| G2-BE-M8 | Major | `api-contract.md` #22/#24；AC-032 | 员工取消 `reason?`（可选），但管理端取消与所有高风险操作要求 `reason 1–200`（`VALIDATION_REASON_REQUIRED`）；契约未区分两类调用 | 区分：员工本人取消 `reason` 可选（≤200，写入 `cancel_reason`）；管理员经 `PATCH status` 取消 `reason` 必填（1–200）并写审计。同一 Service 用调用方角色判定 |
| G2-BE-M9 | Major | `test-plan.md` §3 L2、§9 | 集成测试（`@SpringBootTest`）直接使用演示库 `req_6343a752e110`；并发/取消/重置脚本会污染演示数据，且 `reset.sql` 可能清空正在验收的订单 | 固定分离：集成测试用 `req_6343a752e110_test`（`application-test.yml`），Flyway 自动建；L3–L5 脚本用演示库但 `RUN_ID` 用户隔离；`reset.sql` 仅允许 `_test` 库或显式 `ALLOW_DEMO_RESET=1` |

## 4. 观察项（不记缺陷）

| ID | 内容 | 处置 |
|---|---|---|
| O-1 | `api-contract.md` 标题写“端点清单（38 个）”，实际列 #1–#38 + #33b = **39** | 文字改为 39；本方案按 39 全覆盖 |
| O-2 | 契约错误码 `VALIDATION_TEST_CLOCK_FORBIDDEN` 未列入 §1.1 表 | 实现按该码返回 400；建议 Architecture 补表 |
| O-3 | `scripts/reseed_today.sql`、`scripts/backup.sh` 被文档引用但仓库尚不存在 | 列入 Stage 4 P1 交付（`backend-design.md` §11），不阻塞 |
| O-4 | `GET /menu/stream` 首事件 `snapshot` 在 §2.1 有、§3.3 事件全集也有；测试方案漏写 | 以契约 §3.3 为准 |
| O-5 | 种子 `password_hash` 已实测匹配文档密码（BCrypt cost 10） | 保留，不重算 |

## 5. 交叉评审结论

- **CHANGES**：1 blocker（B1）+ 8 major（M1–M9）。全部在 `docs/backend-design.md` 给出可直接编码的默认决策，Stage 4 无需等待二次评审即可开工。
- 需 Stage 3b 回写：`api-contract.md`（B1 事务语义、M1 迁移矩阵、M2 类型、M6 `rollbackToVersion`、M7 ticket 语义、M8 reason 规则）与 `test-plan.md`（M5 钩子表、M9 测试库隔离）。
- 未发现不可实现的规则、金额浮点、先查后改扣库存、Redis 当账本等红线。