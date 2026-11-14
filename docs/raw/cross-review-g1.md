# G1 交叉评审 — 产品产物（prd-analysis / acceptance-matrix / scenario-profile）

- 评审人：Architecture（作者≠评审者；被评审对象为 Stage 1 产品工程师产物）
- 时间：2026-11-14 22:02 CST
- 输入：`docs/prd-analysis.md`(317 行)、`docs/acceptance-matrix.md`(153 行)、`docs/scenario-profile.md`(136 行)、`docs/assumptions.md`(102 行)、`RUNBOOK.md`(132 行)
- 视角：可实施性 / 一致性 / 并发正确性 / 可验证性
- 结论：**PASS（可实现，可进入 Stage 2/3）**；4 项 major 澄清项，0 项 blocker

## 1. 评为 PASS 的关键依据

| 维度 | 结论 | 证据 |
|---|---|---|
| 业务规则可实现 | PASS | 5 份上限、截单切换表（6 边界 + 跨日）、唯一有效单均已给出可执行判定：prd-analysis §4.1–4.3 |
| 事务边界可落地 | PASS | INV-10 明确事务内不调 LLM/外部 HTTP；库存/ledger/订单同事务；prd-analysis §5 |
| 幂等/唯一约束 | PASS | INV-6 `Idempotency-Key`、INV-7 生成列 `active_key`+唯一索引，均可在 MySQL 8 实现 |
| 库存双模式 | PASS | `DB_ATOMIC`/`REDIS_PREALLOC` 统一 InventoryService、DB 为账本、条件 UPDATE 扣减：§5.1 |
| SSE / AI 降级 | PASS | D17/D18 明确 SSE 事件仅 dishId/available、候选确定性过滤、无 Key 降级 |
| 权限与审计 | PASS | 角色矩阵、SELF/ALL、403 非前端隐藏、audit_log 前后值：§2 + AC-028/032/033 |
| 测试钩子 | PASS（需架构补齐） | AC-024/025/060 要求固定时钟，矩阵已要求“说明时钟注入方式”，架构给出 `X-Test-Clock` 钩子 |

## 2. Major 澄清项（不阻塞 Stage 3，架构侧已给默认决策）

| ID | 级别 | 位置 | 问题 | 建议 | 处置 |
|---|---|---|---|---|---|
| G1-01 | major | prd-analysis INV-6 / AC-015 | 未定义幂等记录在**首次请求失败**（4xx/5xx/超时）时的语义：是否缓存 409？同键重试能否重新执行？ | 2xx/4xx 结果快照缓存并重放；5xx/超时不缓存并释放键（`FAILED` 态可重试）；保留 24h | 架构 §6 明确 |
| G1-02 | major | prd-analysis §4.2 / AC-024/025 | `preview` 与 `submit` 之间跨过截单点，响应餐次可能与页面展示不一致 | 以**提交时**服务端重算为准，响应回 `effectiveDate/effectiveMeal/autoSwitched`；前端成功页展示服务端值 | 架构 §7 明确 |
| G1-03 | major | scenario-profile §4 AI-1 / AC-038 | “近 7 天已点”未定义口径（按 created_at 还是 delivery_date？Cancelled 是否计入） | 按 `created_at >= now-7d` 且 `status != Cancelled`；按 user 维度 | 架构 §12 明确 |
| G1-04 | major | prd-analysis §3.1 / A-09 | 菜单接口需登录（401），但浏览器原生 `EventSource` 无法携带 `Authorization` 头，SSE 与鉴权冲突 | 前端用 `fetch` + `ReadableStream` 消费 SSE 并带 Bearer；保留短时 `streamTicket` 查询参数兜底 | 架构 §10.3 + api-contract |
| G1-05 | major | acceptance-matrix AC-035 | 50 并发需要 50 个不同用户，种子仅 2 个账号，测试夹具策略未定义 | Test Designer 在 `tests/` 用测试专用注册/种子脚本创建 ≥50 用户；不在生产种子中放测试账号 | 记录给 Stage 2 测试方案（review-findings） |
| G1-06 | major | prd-analysis §4.8 / D21 | `daily_menu`（是否上架）与 `dish_daily_stock`（库存）双数据源，未定义权威关系与写入原子性 | 管理端一次事务写两表；菜单可见性=当日 PUBLISHED 行存在；库存以 `dish_daily_stock` 为准 | 架构 §8 + data-model |

> 说明：另有 6 条 minor（文案示例不统一、看板“Completed”在无管理端流转时为 0、测试并发次数建议重复 3 次等），按协议只记录 major，不阻塞。全部 findings 登记见 `docs/review-findings.md`（G1-01…G1-06，责任阶段已标）。

## 3. 交叉评审结论

- **PASS**：产品产物具备“可实现 + 可验收 + 可测试”三要素，无需返工。
- 6 项 major 均为**默认决策可闭合**的实现级澄清，已在 Stage 2 架构/契约/数据模型中给出明确口径；Stage 3 BTL/FTL 按此实施即可。
- 未发现 blocker（无不可实现规则、无自相矛盾不变量、无无法验证的 AC）。