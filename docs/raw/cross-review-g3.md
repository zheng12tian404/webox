# G3 交叉评审 — 后端/前端技术方案（架构视角）

- 评审人：Architecture（S2，契约 owner）；作者≠评审者（BTL、FTL 为作者）
- 评审对象：`docs/backend-design.md`(719 行)、`docs/frontend-design.md`(691 行)、`docs/cross-review-g2.md`(55 行)、`docs/cross-review-g2-frontend.md`(83 行)
- 时间：2026-11-14 22:13 CST（硬截止 22:14）
- 结论：**PASS** —— G2 的 1 个后端 blocker 与 2 个前端 blocker 已由**契约 v1.1 回写 + 设计默认决策**闭环，无阻塞 Stage 4 的 blocker；7 项 major 中 6 项已在本轮回写闭合，1 项（测试钩子文档漂移）由 Test 在 Stage 5 按契约执行。

## 1. 架构符合性（与 `architecture.md` 对照）

| 检查点 | 结论 | 证据 |
|---|---|---|
| 前后端分离 / JDK17+Spring Boot / 独立 MySQL，无 H2/SQLite | PASS | backend-design L1–24、L92–142；frontend-design L9–99 |
| 下单单事务边界、事务内禁 LLM/HTTP/SSE | PASS | backend-design L329–367（T1 仅 DB 写；SSE `afterCommit` L541–548） |
| 防超卖 = 单条条件 UPDATE + CHECK 最后防线 | PASS | backend-design L241–303、L386–395；data-model §2.2 |
| 唯一有效单 `active_key` STORED 生成列 | PASS | backend-design L379–385；schema 未改语义 |
| ledger `UNIQUE(business_key)` 只回补一次 | PASS | backend-design L358–367、L386–412；data-model §2.3 |
| 幂等三段式 T0/T1/T2（G2-BE-B1） | PASS | backend-design L329–367、L368–378；契约新增 §3.2.1 |
| 截单/自动切换六边界 + 可注入 Clock | PASS | backend-design L426–438；契约 §3.1 |
| Redis 可选 + DB 为唯一账本 + 降级不 500 | PASS（补偿范围见 M1） | backend-design L396–412；architecture §8 |
| 缓存不含库存、TTL 60s | PASS | backend-design §6.1 |
| 权限/审计：`/admin/**` ADMIN、SELF 404、审计同事务、reason 必填 | PASS | backend-design L527–538；契约 #20/#22/#24 |
| 金额整数分 BigDecimal/long 无浮点 | PASS | backend-design §2.3、`Money`；frontend-design §6.1 |

## 2. 前后端契约一致性（v1.1 回写后逐项）

| 项 | 结论 | 说明 |
|---|---|---|
| 39 端点自洽 | PASS | #1–#38 + #33b = 39；契约标题与 §2.3 注释已改 39；前端 `EP` 常量已含 `/admin/inventory/adjust`（frontend-design L141–165），仅标题“38”笔误 |
| 字段类型 | PASS | `available:boolean` + 新增 `availableQty:int`（#11/#12）；SSE/Console `available:int`；`lowStock/soldOut` 布尔（契约 §1、#11/#30） |
| 错误码 | PASS（已修） | §1.1 增补 `VALIDATION_TEST_CLOCK_FORBIDDEN`；`VALIDATION_REASON_REQUIRED` 与端点用码对齐；`X-Test-Clock` 非 test profile 固定 400（不再“忽略/400”两义） |
| SSE | PASS | 菜单流 `snapshot`（单行 JSON 数组）/`stock` 仅 `dishId+available:int`；AI 流 `meta` 回传 `sessionId`；ticket 60s 内最多 3 次（G2-BE-M7） |
| 分页 | PASS | `page/size` 1/20/≤100，越界 400 `VALIDATION_PAGINATION`，与 FE 分页器一致 |
| 金额 | PASS | 全部 `*Cents` 整数分 + `priceDisplay` 仅校验，FE `formatMoney` 单点 |
| 下单/截单 | PASS | preview 不锁库存不报库存 409；submit 服务端重算并回显 `effectiveDate/effectiveMeal/autoSwitched`；`address` 必填 1–200 |
| 订单详情 | PASS（已修） | #20 固化字段级 JSON（items 快照含 `options[{name,priceDeltaCents}]`/`subtotalCents`） |
| 订单状态机 | PASS（已修） | `Pending→Confirmed→Completed`、`Pending→Cancelled`；`Confirmed→Cancelled`/`Completed→*`/同态 409；员工仅 Pending 可取消 |
| 看板口径 | PASS（已修） | `orders/mealSplit/trend.orders` 均非 Cancelled；`revenueCents` 仅非 Cancelled；`lowStock` = `0<=available<=3` |
| AI 规则回滚 | PASS（已修） | PUT #37 增可选 `rollbackToVersion`，复制为新 version，历史行不变，端点仍 39 |
| 菜单日期选择 | PASS（已修） | #13 `filters` 增 `dates:[{date,published}]`，不新增第 40 端点 |
| 删除地址/登出包络 | PASS（已修） | 统一 200 + 包络，删除返回 `{deleted:true}`，不使用 204 |

## 3. Major（6 项已回写闭合，1 项 Stage 5 执行）

| ID | 位置 | 问题 | 闭环决策 / Stage 4 指令 | 状态 |
|---|---|---|---|---|
| G3A-M1 | backend-design L386–412 | Redis 预占失败仅补偿“当前菜”，同单后续菜失败或 T1 因唯一单/其他异常回滚时，先前菜的 `DECRBY` 不回收 → 30s 对齐前少卖（不会超卖） | T1 内维护 `List<preallocated{dishId,qty}>`；Facade 捕获任何导致 T1 回滚的异常时按清单逐菜 `INCRBY`；`release/confirm` 不得二次补偿；30s 对齐兜底；新增 `RedisStockIT#rollback_compensates_all_dishes`（Redis 不可用记 NOT TESTED） | CLOSED（设计）+ Stage 4 实现 |
| G3A-M2 | backend-design L368–378、data-model §2.4 | 24h 幂等快照过期后同键再提交会命中 `orders.UNIQUE(user_id,idempotency_key)`，若误映射 `ORDER_DUPLICATE` 则语义错误 | 契约 §1 已明确键永久唯一、24h 仅停快照重放；Stage 4 将 `uk_orders_user_idem` 1062 映射 409 `IDEMPOTENCY_CONFLICT`；`IdempotencyIT#expired_key_same_user_conflicts` | CLOSED |
| G3A-M3 | frontend-design §10 #03 | FE 按 204 短路设计 client，与统一包络冲突 | 契约 v1.1 删除 204；FE `client.ts` 只按 200 包络解析，删除 204 分支 | CLOSED |
| G3A-M4 | frontend-design L551–570 #01/#02/#09 | 前端“契约缺口表”已过期：hasOptions/availableQty/订单详情字段/规则回滚均已入契约 | Stage 4 FE 必须按新字段直连：列表 `hasRequiredOptions=true` 跳详情、`false` 一键加购；订单详情按 #20 JSON 渲染；AI 规则页加“Rollback”动作（PUT + `rollbackToVersion`），若时间盒裁剪则 AC-041 记 `NOT TESTED`，不得虚报 | CLOSED（契约） |
| G3A-M5 | test-plan §7、backend-design L605–613 | 测试钩子/集成测试库文档与契约漂移（契约路径正确、测试表为旧稿） | 以 `api-contract.md` v1.1 为唯一锚点；Stage 5 只跑契约路径；新增 I10 反向用例断言生产 profile `X-Test-Clock` → 400 | OPEN → S2-Test / S5 |
| G3A-M6 | 契约 §1.1 vs backend ErrorCode | 错误码字面不一致（表内 `REASON_REQUIRED` vs 端点用 `VALIDATION_REASON_REQUIRED`） | 契约 §1.1 已标注实际码；Stage 4 `ErrorCode` 枚举逐字对齐 v1.1（含 `VALIDATION_TEST_CLOCK_FORBIDDEN`/`VALIDATION_REASON_REQUIRED`） | CLOSED |
| G3A-M7 | frontend-design L141 | 端点常量标题写“38 个”，实际 39（含 #33b） | 文档计数改为 39；Stage 4 以 39/39 做端点自检 | CLOSED |

## 4. Blocker 闭环指令（Stage 4 可直接执行）

| 原 G2 Blocker | 闭环方式 | Stage 4 必须做的事 |
|---|---|---|
| G2-BE-B1（幂等快照丢失） | 契约新增 §3.2.1 T0/T1/T2；backend-design L329–378 已给实现 | 严格三段式；业务 4xx 在 T2 落 COMPLETED 快照；仅 5xx/超时落 FAILED；同键并发轮询 ≤2s |
| G2FE-B1（列表无选项标记） | 契约 #11 增 `hasOptions/hasRequiredOptions` | 后端菜单查询返回两字段（按 `dish_option_groups` 存在性/required 计算，可随静态字段缓存 60s）；前端按标记决定加购入口 |
| G2FE-B2（订单详情无字段） | 契约 #20 固化 JSON | 后端 `OrderDetailVO` 严格按契约字段；前端 `types.ts` 删推断；E2E 以 `order-no/order-status/order-detail` testid 断言 |

## 5. 风险与剩余

- **R1**：`availableQty` 为新增字段，后端菜单 SQL 需 join `dish_daily_stock`；不得把数量放进 60s 静态缓存（库存每次查 DB，backend-design §6.1 已约束）。
- **R2**：Redis 同步为最终一致（≤30s），演示环境建议 `REDIS_ENABLED=false` 跑稳定主链路，Redis 用例单列。
- **R3**：测试文档（test-plan §7、test-cases 枚举大小写）仍为旧稿，S2-Test 未回写；Stage 5 以契约为准，避免按旧路径执行得 404。
- **R4**：前端 AI 规则回滚 UI 可能被时间盒裁剪，AC-041 存在 `NOT TESTED` 风险，需在 Stage 5 报告如实标注。

## 6. 结论与下一步

**PASS**：G3 无新增 blocker；契约 v1.1 已回写 G2-BE-B1/M1/M2/M6/M7/M8、G2FE-B1/B2/M1/M2/M3/M4/M5/M8/M9 对应点。剩余 major 仅 G3A-M5（文档漂移，不影响编码）与 G3A-M1 的 Redis 补偿实现（已给可执行指令）。
下一步：**Stage 4 后端实现 + 前端实现**（红线见交付评论）。

## 7. G3 补充 — 对“统一状态机 / 策略化 / 稳定性容灾”指令的架构回应（2026-11-14 22:18 CST）

发起人指令：统一状态机驱动业务流程、可扩展；稳定性、容灾、限流降级、故障恢复；不变量沉淀公共逻辑，变化点策略化/配置化。已写入 `docs/architecture.md` §19–§20 与 ADR-008~012，**契约不变**（不新增端点；仅 §1.1 增 503 `SERVICE_DEGRADED`）。

### 7.1 决策（含“不做什么”）

| 主题 | 决策 | 明确不做（反过度设计） |
|---|---|---|
| 统一状态机 | `common.statemachine` 表驱动：4 态×4 事件，Guard+Action；#22/#24/TIMEOUT 三入口共用；CAS 落库 | 不引 Flowable/Camunda/Spring StateMachine；不做运行时可编辑迁移表 |
| 策略化 | `StockStrategy`（DB/Redis 装饰+路由）、`CutoffPolicy`、`RecommendationEngine`（LLM/规则/降级组合）、`RateLimiter`、`AuditWriter` | 金额/账本/唯一单/幂等**禁止策略化**（不变量只有一份实现） |
| 配置化 | `webox.*` `@ConfigurationProperties`，env > yml，重启生效；仅 AI 权重走 `ai_rule_config` 热生效 | 不加配置表、不做动态脚本/热编排 |
| 稳定性 | 舱壁（AI 独立信号量 4、SSE≤500、Hikari 3s）+ LLM 熔断（5 次/30s）+ 降级阶梯 L0–L3 | Redis 不熔断（直接降级）；不做自动扩缩容/多活 |
| 容灾 | 小时 `mysqldump --single-transaction`、恢复演练、启动 Flyway/JWT_SECRET 校验、启动只读对账 | RTO≤10min / RPO≤5min 为**演示级**；不做主从自动切换、多机房 |
| 恢复 | Pending 60s 扫描发 TIMEOUT、幂等僵死 30s 接管、Redis 30s 对齐、1213 重试 1 次、优雅停机 20s | 不做分布式事务/Saga |

### 7.2 Stage 4 实施顺序（必须先做状态机与策略骨架，再接端点）

1. `common`: `Money`、`AppClock`、`ApiResponse/ErrorCode`、`IdempotencyFacade`、`AuditWriter`（不变量先行）。
2. `common.statemachine`: `StateMachine/TransitionTable/Guard/Action` + `OrderTransitionTable`；单测覆盖全矩阵（含非法迁移 409）。
3. `domain.strategy`: `StockStrategy` 接口 + `DbAtomic` 实现 + Router；Redis 实现作为装饰器（Redis 关闭时主链路仍全绿）。
4. `OrderStateService.transition(...)` 接入 #22、#24 与超时扫描器（三入口只发事件）。
5. 恢复与限流：`RateLimitAspect`、LLM 熔断、降级开关、优雅停机配置。
6. 最后接 `extra` 交付路径（菜单/看板/审计/AI），保证时间是花在不变量的正确性上。

### 7.3 验收与证据

- `OrderStateMachineTest`：4×4 全矩阵；非法迁移 409；三入口行为一致（同状态同副作用）。
- `StockStrategyRouterTest`：Redis 停止 → 自动 `DB_ATOMIC`，订单成功且无 5xx。
- `CutoffPolicyTest`：09:59:59/10:00:00/15:00:00/跨日/过去日期。
- `RateLimitIT`：第 11 次 429 + `Retry-After`。
- `GracefulShutdownIT`：在途订单完成、SSE 正常关闭（时间不足可 `NOT TESTED`）。
- 运维：`/health` 增 `degrade` 状态；降级/限流/非法迁移均有指标与 `requestId` 日志。

### 7.4 风险

- 状态机/策略骨架增加约 0.5–1h 工作量；**若 Stage 4 时间不足，裁剪顺序为：ArchUnit 依赖测试 → 优雅停机 IT → Redis 策略单测**，不得裁剪状态机统一与条件扣减（正确性红线）。
- 新增 503 `SERVICE_DEGRADED` 仅用于人工维护开关，Stage 4 不默认开启，避免误伤验收。
