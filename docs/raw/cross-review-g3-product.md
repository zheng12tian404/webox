# G3 业务验收交叉评审 — 产品工程师视角

- 评审人：产品工程师（作者≠评审者：本文件不是 PRD/AC 作者）
- 时间：2026-11-14 22:10 CST
- 评审对象：`docs/backend-design.md`（719 行）、`docs/frontend-design.md`（691 行）、`docs/acceptance-matrix.md`（61 条 AC）、`docs/prd-analysis.md`、`docs/scenario-profile.md` v2
- 结论：**CHANGES（0 Blocker / 5 Major OPEN + 1 Major 本次已闭环）**
- 判定：**不阻断 Stage 4 启动**。5 项 Major 均为“口径/证据可执行性”修正，可在 Stage 4 编码并行完成；P0 资损/越权/金额链路无阻断项。

## 1. 结论摘要

| 维度 | 结论 | 证据 |
|---|---|---|
| Tier1/Tier2 AC 前后端落点 | **PASS（33/33 有落点；0 悬空）** | 见 §2 全量抽检表；FE 19 路由 L102–127，BE 39 端点 L166–221 |
| Tier3 AC 可 N/A 或已设计 | **PASS** | AC-034~044 均有 FE 页面/组件（R03/R11/R15/R17、AI Drawer）+ BE 端点/任务（#8.1/#8.2/#9），允许 T+45 后整体 N/A（FE L601） |
| 8 项核心业务规则 | **PASS with 3 Major 口径** | 见 §3；M2（5 份错误码）、M3（confirm 语义）、M4（过敏原全路径） |
| 文案英文 / 金额 `¥xx.xx` | **PASS** | FE `en.ts` L414–521 全量英文 key；`formatMoney` L365–379；BE `ApiResponse` 英文 message L143–160；PRD L301–304 |
| 评分卡 5+5 | **FE PASS；BE 实现点齐备但缺显式映射表（M5）** | FE L355–363 五行表；BE L501–537 有机制无 BE-1..5 对照表 |

## 2. Tier1/Tier2 AC 落点抽检（全量 33 条）

| AC | 前端落点 | 后端落点（端点/表/校验） | 结论 |
|---|---|---|---|
| 001 | R02 `/register` L107 | #1 L169；`users.email` UNIQUE；BCrypt | PASS |
| 002 | R02 `auth.emailExists` | #1 1062→409 L169 | PASS |
| 003 | FE-5 L363；R02 表单 | #1 DTO email≤200/密码 8–64 | PASS |
| 004 | R01 + `authStore` L307 | #2 登录、#5 `/auth/me`；种子 ADMIN | PASS |
| 005 | R01 `login-error`/429 映射 | #2 + §6.2 10/min L517 | PASS |
| 006 | R03 菜单网格/分页 L168 | #11 `MenuQuery` page/size≤100 | PASS |
| 007 | R03 FilterBar 多选 L174 | #11 `category IN` 枚举校验 | PASS |
| 008 | R03 SearchBox `maxLength=50` L176 | #11 LIKE 转义 + `#{}` §7.6 | PASS |
| 009 | R04 详情/选项 L182 | #12 选项组/选项 | PASS |
| 010 | R04 整数加价 L183 | #12/#18 + §4.1 服务端重算 | PASS |
| 011 | R05 按 `dishId+options` 分行 L191 | 购物车无服务端（A-10）；preview #17 提供明细 | PASS（口径已登记 G1T-B2） |
| 012 | R05 localStorage persist L198 | 无后端依赖（设计如此） | PASS |
| 013 | R06 preview 全字段 L202 | #17 preview 重算/地址/autoSwitch | PASS |
| 014 | R06 提交 L206–214 | #18 + §4.1 快照/ledger RESERVE | PASS |
| 015 | R06 幂等键 L208 | §4.2 T0/T1/T2 + `UNIQUE(user_id,idem_key)` | PASS |
| 016 | R06 只传 dishId/qty/optionIds L207 | §4.1 L357 DB 价重算 | PASS |
| 017 | R08/R09 列表/详情 | #19 `WHERE user_id`、#20 SELF 404 | PASS |
| 018 | R09 取消按钮 L218 | #22 + §4.5 CAS + ledger RELEASE | PASS |
| 019 | R09 仅 Pending 显示取消 L217 | §4.5 Confirmed→Cancelled 409 | PASS |
| 020 | R03/R05 份数≥5 禁用 L175/L195 | §4.1 L357 `Σqty≤5` → `ORDER_LIMIT_EXCEEDED` | PASS（M2 口径需锁定） |
| 021 | R04 `AllergenModal` L188 | 后端不阻断（D11，设计） | PASS（M4：快捷加购路径缺失） |
| 022 | R03 `For You` L172/L178 | #11 `forYou` 软排序 | PASS |
| 023 | R06 预算黄色提示 L205 | #17 `budgetExceeded` | PASS |
| 024 | R06 自动切换横幅 L204 | §4.6 `equals=closed` + 切换链 | PASS |
| 025 | R06 日期/餐次 | §4.6 跨日 + `VALIDATION_DATE_PAST` | PASS |
| 026 | R06 `View Existing Order` L204 | §4.3 `active_key` 唯一索引 + 409 | PASS |
| 027 | R09 取消后重下 | §4.3 取消置 `active_key=NULL` | PASS |
| 028 | `RequireAdmin`→/403 L128 | §7.2 `hasRole('ADMIN')` + 401/403 分离 | PASS |
| 029 | R12 Dishes 表单/图片 L233 | #25–29 魔数/≤5MB/审计 | PASS |
| 030 | R12 上下架 | #28 + §6.1 afterCommit 失效 ≤1s | PASS |
| 031 | R13 Daily Menu 库存 L234 | #30/#31/#32 单事务 upsert | PASS |
| 032 | R12 `ConfirmReasonModal` L233 | #27 before/after 审计 + reason 1–200 | PASS（M3：confirm=false 语义未定） |
| 033 | R14（P2 可裁剪）+ 契约字段 | #23 列表地址 `***` 脱敏；员工 403 | PASS（AC 验证方式为 API+REV，不依赖 R14 页面） |

Tier3：AC-034/036/037（#8.1 SSE + R03 徽标）、AC-035/043（§4.4 双库存）、AC-038~041（#8.2 + AI Drawer）、AC-042（#5.4 + R11）、AC-044（#33/#33b + R15）。未实现时按 FE L601 记 `N/A（Tier 3 未实现）`，不虚报。

## 3. 核心业务规则逐项核对

| # | 规则 | 设计落点 | 结论 |
|---|---|---|---|
| R1 | 单餐 5 份上限（总份数非品种数） | BE L357 `qty 1–5、Σqty≤5`；FE L175/L195/L445 | **PASS with M2**：qty>5 可能先被 Bean Validation 拦截为 `VALIDATION_*`，与 AC-020 断言的 `ORDER_LIMIT_EXCEEDED` 不一致 |
| R2 | 截单自动切餐次（服务端时钟 Asia/Shanghai） | BE §4.6 L426–438；FE L204 只展示服务端 `effectiveMeal` | PASS（六边界单测要求明确） |
| R3 | 唯一有效单（用户+日+餐次） | BE §4.3 生成列 `active_key`+唯一索引；FE L204 按钮切换 | PASS |
| R4 | 过敏原提醒（提醒不阻断） | FE L188 详情弹窗、L396 状态矩阵、L252 AI 卡片 | **PASS with M4**：菜单卡片“无必选项直接加购”（L175）未经过 `AllergenModal`，与 D11“加购时弹窗”不一致 |
| R5 | 预算提示不阻断 | BE #17 `budgetExceeded`；FE L205/L461 | PASS |
| R6 | 仅 Pending 可取消 | BE §4.5 CAS；FE L217–218 | PASS |
| R7 | Console 权限与审计 | BE §7.2/§7.8 审计同事务、仅 INSERT；FE `RequireAdmin`、R16 | PASS（AC-033 证据走 API+DB，R14/R16 裁剪不破坏 AC） |
| R8 | 高风险操作二次确认 | FE `ConfirmReasonModal` L233/L235；BE #24/#27/#28/#31/#32/#33b/#37 均含 confirm+reason | **PASS with M3**：后端未定义 `confirm=false` 的返回码，二次确认目前只在前端成立 |

## 4. 文案 / 金额 / 错误提示

- 用户可见文案：`frontend-design.md` L414–521 全量 `en.ts` key 为英文；DoD L621 要求 `grep` 中文仅注释命中 → PASS。
- 金额：BE 全部 `*Cents` 为 long/BIGINT（L222–232）、`priceDisplay` 由 `Money.display` 生成；FE `formatMoney` L365–379 输出 `¥77.60` 且禁止浮点中间值 → PASS（AC-054/057）。
- 错误提示可理解性：FE §7.1 状态矩阵把 409/429/403/404/SSE/AI 降级映射为英文 action 文案（L382–404）；后端 message 也统一英文（L143–160）→ PASS。
- 唯一注意：`ORDER_LIMIT_EXCEEDED`、`VALIDATION_CONFIRM_REQUIRED` 等错误码需在 `en.ts` 有对应 key（M2/M3 修复时同步补 2 个 key）。

## 5. 评分卡 5 + 5

| 项 | 实现点 | 结论 |
|---|---|---|
| FE-1 响应式 | `tokens.css`/`DishGrid`/`AppLayout`；三档断点；AC-052 | PASS |
| FE-2 分页/长列表 | `useApiQuery`/`Pagination`；服务端分页 size≤100；memo | PASS |
| FE-3 防抖/节流 | 搜索 300ms、加购 300ms+在途禁用、提交 disabled+幂等 | PASS |
| FE-4 金额精度 | `utils/money.ts` 单点；整数分；AC-054 | PASS |
| FE-5 输入校验 | `utils/validation.ts`；邮箱/密码/地址/搜索/原因/预算 | PASS |
| BE-1 缓存 | Caffeine 5 cache + afterCommit 失效；不缓存库存/订单（§6.1） | 实现点齐备；**缺显式 BE-1 标注（M5）** |
| BE-2 幂等 | §4.2 T0/T1/T2 + 双唯一约束 | 实现点齐备；**缺显式 BE-2 标注（M5）** |
| BE-3 SQL 注入 | 全 `#{}` + LIKE 转义 + ORDER BY 白名单（§7.6） | 实现点齐备；**缺显式 BE-3 标注（M5）** |
| BE-4 权限 | JWT + URL/方法级 + SELF + 401/403 分离（§7.2/7.3） | 实现点齐备；**缺显式 BE-4 标注（M5）** |
| BE-5 并发/防超卖 | 条件 UPDATE + Redis Lua 补偿 + 30s 对齐 + 死锁重试（§4.4/4.7） | 实现点齐备；**缺显式 BE-5 标注（M5）** |

## 6. Major 清单（Stage 4 可执行修复指令）

> 全部为非阻断项；修复不改变任何 AC 语义。

### G3P-M1（Major）AC-060 超时任务时钟不可注入
- 位置：`backend-design.md` L428（TestClockFilter 为 request 级，异步线程回退系统时钟）、L569（60s 任务用 `now()`）。
- 影响：AC-060 要求“测试可注入时钟”，但定时任务不在请求上下文，无法用 `X-Test-Clock` 推进 30 分钟；按现方案只能 `NOT TESTED`。
- 修复指令（Stage 4，1 行配置 + 1 条测试约定）：新增 test-only 属性 `webox.test.time-offset-minutes`（仅 `test` profile 生效）注入 `Clock.offset(base, Duration)`；或在 `test-plan.md` 固化“SQL 回填 `orders.created_at=now()-31m` 后触发一次任务”的夹具。二者择一，写入 `test-cases.md` AC-060 用例的操作步骤。

### G3P-M2（Major）5 份上限错误码可能被 Bean Validation 抢占
- 位置：`backend-design.md` L357（qty 1–5 与 Σ≤5 并列映射 `ORDER_LIMIT_EXCEEDED`）；AC-020。
- 影响：若 DTO 用 `@Max(5)`，单行 `qty=6` 会先返回 `VALIDATION_*`；AC-020 断言固定为 `ORDER_LIMIT_EXCEEDED`，测试将 FAIL。
- 修复指令：`SubmitReq/PreviewReq.items[].qty` 仅保留 `@Min(1)`；`qty>5` 或 `Σqty>5` 一律由 `OrderTxService` 统一抛 400 `ORDER_LIMIT_EXCEEDED`（`data.limit=5, requested=N`）；`en.ts` 增 `menu.orderLimit` 映射（已存在，L445）。

### G3P-M3（Major）高风险操作 `confirm=false` 语义未定义
- 位置：`backend-design.md` L203/L206/L207/L210/L211/L213/L217；AC-032。
- 影响：DTO 声明 `confirm=true`，但未定义 false 时的行为/错误码；当前“二次确认”只靠前端，绕过 UI 直调 API 可无确认改价/改库存，违背 D16 与 IA-6。
- 修复指令：所有高风险端点（#24/#27/#28/#31/#32/#33b/#37）服务层显式校验 `confirm==true`，否则 400 `VALIDATION_CONFIRM_REQUIRED`；将错误码补入 `api-contract.md §1.1` 与 `ErrorCode`；AC-032 追加一条断言（不改原语义）：“confirm=false → 400 `VALIDATION_CONFIRM_REQUIRED` 且无审计行”。

### G3P-M4（Major）过敏原提醒未覆盖“快捷加购”路径
- 位置：`frontend-design.md` L175（无必选项直接 `cartStore.add`）vs L188（仅详情弹窗）、L252（AI 卡片弹窗）。
- 影响：无必选组但含过敏原的菜品从菜单卡片一键加购会绕过提醒，违背 D11“加购时弹窗”与 AC-021 的业务意图（AC-021 只抽样 Bibimbap，测不出该缺口）。
- 修复指令：把过敏原判定下沉到唯一的 `addToCart` 入口（`cartStore`/`useAddToCart`），菜单卡片、详情页、AI 卡片三入口共用；命中时统一打开 `AllergenModal`。E2E 增 1 条：无选项含 Egg 菜品从菜单卡片 Add → 出现弹窗，确认后数量 +1。Stage 5 记入 AC-021 证据补充（不新增 AC）。

### G3P-M5（Major）后端评分卡 BE-1..BE-5 缺显式映射
- 位置：`backend-design.md` §6/§7 有机制、§13 L694–703 有自检，但无 BE-1..BE-5 对照表；FE 侧 L355–363 已逐项映射。
- 影响：交付评分时需人工推导，无法做到“每项有锚点”的一票核对；不改变实现正确性。
- 修复指令：在 `backend-design.md §13` 增 5 行表：`BE-1 缓存→§6.1 CaffeineMenuCache/afterCommit + AC-006/030/045`；`BE-2 幂等→§4.2 OrderFacade/IdempotencyService + AC-014/015`；`BE-3 注入→§7.6 MyBatis #{} + AC-008/047`；`BE-4 权限→§7.2 SecurityConfig/SELF + AC-028/033/051`；`BE-5 并发→§4.4 InventoryService + AC-018/035/043`。

### G3P-M6（Major，本次已闭环）注册提权向量无 AC
- 位置：`prd-analysis.md` L33“禁止自助注册为 ADMIN”；`backend-design.md` L532 已强制 EMPLOYEE；`test-cases.md` TC-084 已备；`acceptance-matrix.md` 原缺 AC。
- 处置：本次已在 `acceptance-matrix.md §4.1` 追加 **AC-061**（Tier1 P0）：携带 `role:"ADMIN"` 注册 → 400 `VALIDATION_ROLE` 或强制 `EMPLOYEE`，DB 无新增 ADMIN。原有 AC-001~060 语义未改动。
- 状态：**CLOSED（S1 产品本次追加）**；Stage 4 按 AC-061 实现（`role` 字段忽略或严格拒绝二选一，`AuthService.register` 硬编码 EMPLOYEE）。

## 7. 抽检证据

- 文件规模：`backend-design.md` 719 行；`frontend-design.md` 691 行；`acceptance-matrix.md` 61 条 AC（60 + AC-061）。
- 端点覆盖：BE §2.2 声明 39/39，逐行核对 #1–#38 + #33b 均存在 Controller/Service 落点（L166–221）。
- 路由覆盖：FE §2.1 R01–R19 共 19 条，员工 10 / Console 7 / 系统 2（L102–127）。
- 业务规则落点：BE §4.1–§4.7（L327–445）、§7（L527–537）、§9（L565–575）；FE §3.1–§3.7（L168–241）、§6（L355–379）、§7.1（L382–404）。
- 场景检查：`scenario-profile.md` v2 的 TO-1~10、IA-1~7、AI-1~6、GE-1~7 均能在两端方案中定位；本阶段只判“设计覆盖”，运行时不预判。

## 8. Scenario checks（设计阶段）

| Profile | 结论 | 证据 |
|---|---|---|
| transaction-order TO-1~TO-10 | PASS（TO-9 带 M2 口径） | BE §4.1–4.6；FE §3.4/3.5 |
| identity-access IA-1~IA-7 | PASS（IA-6 带 M3 口径） | BE §7；FE §2.2/§3.7；AC-061 已补 |
| ai-llm AI-1~AI-6 | PASS（Tier3 可 N/A） | BE §8.2；FE §3.8/§14 |
| general-engineering GE-1~GE-7 | PASS | BE §1/§3.4/§10；FE §1.3/§9/§11.4 |

## 9. 下一步

- Stage 4 启动不受阻：先做 P0 交易链路（幂等/唯一单/条件扣减/快照/5 份上限），M2/M3 在写订单与管理端端点时一并落地；M1 在定时任务落地时补测试缝；M4 在前端加购入口统一时落地；M5 在文档收尾时补表。
- Stage 5 按 AC-061 增加提权用例（TC-084 已就绪），并在 AC-020/021/032 的用例中补 M2/M3/M4 的断言。
- 无 open Blocker；GO 门槛不受影响。