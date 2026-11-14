# G1 交叉评审（测试视角）— PRD 分析 / 验收矩阵 / 场景 Profile

- 评审人：测试方案设计师（Test Designer）
- 评审对象（作者≠评审者）：`docs/prd-analysis.md`、`docs/acceptance-matrix.md`、`docs/scenario-profile.md` v2
- 时间：2026-11-14 21:56 CST（Stage 2，时间盒 5 分钟）
- 口径：只提 **blocker / major**；minor 不记。

## 0. 结论

**CHANGES** —— 产品产物的分层、AC 可执行口径、场景映射整体可用（Tier1/2 全覆盖、失败模式明确），但存在 **2 个 blocker、8 个 major**，集中在「AC 可自动验证的前置状态不可构造」与「契约未定义导致断言不可写」。均可由 Architecture（Stage 2）在 `api-contract.md` / `data-model.md` 中补齐，或由产品工程师补 1~2 条 AC；不需要重做 Stage 1。

## 1. Blocker（不解决则对应 P0 AC 无法判定 PASS/FAIL）

| ID | 位置 | 问题 | 影响 | 建议（责任阶段） |
|---|---|---|---|---|
| B1 | AC-019、AC-042；prd-analysis §4.6 / A-16 | 矩阵要求验证 `Confirmed` 状态订单不可取消、看板统计 Completed/Pending/Cancelled，但**没有任何 AC 或接口定义如何把订单置为 Confirmed/Completed**。测试无法构造前置状态。 | AC-019、AC-042 只能 NOT TESTED；状态机与看板状态分布无证据 | Architecture 在 `api-contract.md` 定义管理员订单流转：`POST /api/v1/admin/orders/{id}/confirm`、`/complete`（confirm+reason+audit）。若时间不足，产品侧把 A-16 标 P2 且 AC-019 用 DB 直接置态作为**仅测试环境**兜底（需 Architecture 认可）（S2-Architecture / S1-产品） |
| B2 | AC-011、AC-012；A-10 购物车 | AC 验证方式标 `E2E+API`，但 A-10 明确购物车是前端 Zustand+localStorage、服务端只做结算校验 → **不存在购物车 API**，API 侧无法断言「2 行 / 合并同配置 / 总价」。 | 两条 P0 的 API 证据不可写，只剩 E2E；与矩阵「PASS 必须有证据」冲突 | 改写验证方式为 `E2E+preview`：购物车行内断言用 E2E，金额/明细用 `POST /api/v1/orders/preview` 携带同一 cart payload 断言。Architecture 需定义 preview 的请求体（cart lines 结构）（S2-Architecture） |

## 2. Major

| ID | 位置 | 问题 | 影响 | 建议 |
|---|---|---|---|---|
| M1 | AC-024、AC-025、AC-060；R4 | 截单六边界与 30 分钟超时要求「注入时钟」，但**未定义注入方式**；真实时钟无法在 30 分钟内复现 09:59:59/10:00:00。 | 截单/超时类 P0 只能 NOT TESTED | 契约新增测试钩子：`X-Test-Clock: <ISO-8601+08:00>`，仅在 `spring.profiles.active=test` 或 `TEST_CLOCK_ENABLED=true` 时生效，生产禁用；服务端以可注入 `Clock` Bean 判定。Stage 5 必须证明「生产 profile 下该头被忽略」（S2-Architecture） |
| M2 | AC-035；种子 D21/A-12 | 50 并发抢 10 需 **50 个不同用户**，种子仅 2 个账号；注册接口是否限流未定义（AC-049 只定义登录/下单/AI）。 | 并发用例无法开跑或 setup 阶段被 429 | 测试脚本用注册接口批量建 50 用户（前缀 `race_<ts>_`）；契约明确注册限流策略，若限流则提供 test profile 下注册豁免或种子批量用户 SQL（S2-Architecture / S5-Test） |
| M3 | AC-034、AC-043；A-17 | 低库存 3 / 售罄 0 / `REDIS_PREALLOC` 模式菜品的**构造方式未定义**：种子按 D21 全部 20~50 且默认 `DB_ATOMIC`。 | AC-034/043 前置条件不可达 | 管理端必须支持「设置当日库存 total_qty」与「设置菜品 inventory_mode」，且写审计；种子显式指定至少 1 道 `REDIS_PREALLOC` 菜品（S2-Architecture / S2-数据） |
| M4 | AC-044 | 对账接口/脚本未定义路径与返回结构，`drift` 如何制造（人工改库？ADJUST 接口？）未定义。 | 对账类 Tier3 无法自动化 | 契约：`GET /api/v1/admin/inventory/reconcile?date=` → `{drift, items[]}`；`POST /api/v1/admin/inventory/adjust`（confirm+reason+audit）。测试用 SQL 制造 1 份差异后调对账（S2-Architecture） |
| M5 | AC-006 vs AC-056 vs D21/A-12 | AC-006 前置「当日 20 道菜上架，`total≥9`」，AC-056 只要求「≥9 道 PRD 菜上架」，D21 写「9 道菜全部上架、库存 20~50」，A-12 又说种子 20 道。**当日菜单到底 9 道还是 20 道不一致**。 | 分页/列表性能用例前置数据不确定，`total≥9` 与 20 道分页断言冲突 | 统一为：**种子 20 道菜全部入库，且当日菜单发布 20 道**（库存 20~50），AC-056 的「≥9」是下限而非目标。Architecture 在 data-model 种子说明中固定（S2-Architecture） |
| M6 | AC-008、AC-047、AC-050 | 统一 envelope `{code,message,data,requestId}` 要求 requestId，但未定义响应头/字段来源；注入用例要断言「无 SQL 报错」，需可判定的判据。 | 错误契约断言不稳定 | 契约：响应体恒含 `requestId`（UUID），响应头 `X-Request-Id` 同值；注入判据固定为 `status==200 && body.code=='OK' && data.items 为空/正常 && 响应文本不含 'SQL'/'syntax'/'java.'`（S2-Architecture） |
| M7 | AC-036、AC-039 | SSE 事件名、`data` JSON 结构、心跳/重连语义未定义（只有 `meta→dish→reason→done` 顺序）。 | SSE 用例无法断言事件类型 | 契约固定：`event: meta|dish|reason|done|stock`；`data` 为单行 JSON；`retry: 3000`；库存事件 `{dishId, available}`；15s 心跳注释行（S2-Architecture） |
| M8 | prd-analysis §2 角色矩阵 | 写明「注册请求携带 role=ADMIN → 400 或强制 EMPLOYEE」，但 **AC-001…060 无任一条覆盖该提权向量**。同时「未登录访问菜单 401」（A-09）只被 AC-028 部分覆盖。 | 提权/未认证访问可能漏测 | 建议产品补 **AC-061**：注册携带 `role=ADMIN` → 400 `VALIDATION_ROLE` 或强制 `EMPLOYEE`，DB 无 ADMIN 新用户；未登录 GET `/api/v1/menu` → 401 并入 AC-028 的描述（S1-产品 / S2-架构落实现） |

## 3. 已确认可测（不记问题）

- AC-001~005 认证：注册/重复/校验/登录/限流均有明确状态码与 DB 断言，可脚本化。
- AC-014~019 交易：幂等键、唯一有效单、取消、快照、金额重算口径明确；ledger 唯一键（INV-5）使「只回补一次」可 DB 断言。
- AC-021~023 偏好：软排序/高亮/预算提示均给了可判定字段（`budgetExceeded`、排序集合对比）。
- AC-028/032/033/051 权限与审计：403/404、audit_log 字段齐全，可 API+DB 断言。
- AC-052/053/054/057 前端评分卡：响应式三档、防抖次数、金额正则均有量化判据。
- AC-059/060 允许 N/A / NOT TESTED，口径诚实，不构成缺陷。

## 4. 评审动作与去向

1. 本文发现逐条登记到 `docs/review-findings.md`（ID 前缀 `G1T-`，责任阶段标注）。
2. 需契约落地的测试钩子汇总到 `docs/test-plan.md` §7，提交 Architecture；Stage 3 由 BTL/FTL 做 G2 评审本测试方案时复核闭环。
3. blocker B1/B2 若在 Stage 2 未闭环，Stage 5 对应 AC 记 `NOT TESTED` 并在 `test-report.md` 说明，不得虚报 PASS。