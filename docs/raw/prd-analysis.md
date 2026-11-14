# PRD 分析 — WeBox 企业员工餐食订购平台（V3.0 全栈合并版）

- 版本：v1.0（Stage 1 产品工程师，2026-11-14 21:52 CST）
- 输入：`docs/PRD.md`（294 行）、`RUNBOOK.md`（132 行，D1–D22）、`docs/scenario-profile.md` v2
- 配套：`docs/acceptance-matrix.md`（AC-001…AC-060）、`docs/assumptions.md`
- 结论：**PASS（分析完成）**；Tier 1/2 为必做门槛（≥45/50），Tier 3 为 +10 加分

## 1. 背景、目标与非目标

### 1.1 背景（PRD §1）
- 公司约 200 名员工、菜品约 50 个且持续增长；每天 09:30–10:00 为订餐高峰，菜单被高频访问。
- 员工用手机与电脑访问；员工下单、管理员通过 Console 管菜品/订单/看经营。
- 两类用户同一系统、不同权限；用户可见内容**全英文**；价格人民币精确到分。

### 1.2 产品目标（可判定）
| 目标 | 判定口径 |
|---|---|
| 员工 3 分钟内完成“登录→选餐→下单” | 新用户注册登录后，从菜单到提交 ≤3 分钟；订单成功页含订单号与配送信息 |
| 高峰不超卖、不重复下单、不重复回补 | 并发抢购成功数=库存数；幂等键只建 1 单；取消只回补 1 次 |
| 规则由服务端强制执行 | 5 份上限、截单切换、唯一有效单、仅 Pending 可取消均在 API 层生效（非仅前端） |
| Console 可运营当日菜单 | 管理员增改/上下架/设当日与次日菜单及库存，员工端即时反映 |
| 经营数据可信 | 看板数字与真实订单/DB 聚合一致 |

### 1.3 非目标（明确不做）
- 真实支付、退款资金流、发票（RUNBOOK D22：取消只回补库存与状态；退款仅审计预留）。
- 多租户/多站点运营（仅保留 `site_id='HQ'` 字段边界）。
- 微服务、消息队列、多机房、审批流引擎（RUNBOOK §4：2 小时不做过度设计）。
- 站外通知（短信/邮件/推送）、第三方配送轨迹。
- 完整菜品营养库/审计报表导出平台。

## 2. 用户角色与权限矩阵

角色枚举：`EMPLOYEE`（默认注册角色）、`ADMIN`（种子账号，禁止自助注册为 ADMIN）。

| 能力 | 员工 EMPLOYEE | 管理员 ADMIN | 约束 |
|---|---|---|---|
| 注册/登录/刷新保持会话 | ✅（仅 EMPLOYEE） | ✅（种子） | 注册请求携带 role=ADMIN → 400 或强制 EMPLOYEE |
| 菜单列表/详情/筛选/搜索 | ✅ | ✅ | 未登录 401 |
| 购物车/结算/下单 | ✅ | ✅ | 仅本人订单 |
| 查看订单 | ✅ 仅本人 | ✅ 全部 | 他人订单 403/404 |
| 取消订单 | ✅ 仅本人 Pending | ✅ 仅 Pending（需原因） | Confirmed/Completed 不可取消 |
| Console 页面与 `/api/v1/admin/**` | ❌ 403 | ✅ | 后端强制，非前端隐藏 |
| 菜品增改/上下架/图片 | ❌ | ✅ | 高风险操作需 confirm+reason+审计 |
| 设置每日菜单与库存 | ❌ | ✅ | 当日与次日可设 |
| 经营看板 | ❌ | ✅ | 数据来自真实订单 |
| 审计日志查询 | ❌ | ✅ | 不可改/不可删 |
| 数据范围 | SELF（本人订单/地址/偏好） | ALL（HQ 全站） | 横向越权 403/404 |
| 字段权限 | 仅本人地址/邮箱可见 | 订单列表地址脱敏，详情可见 | 密码哈希永不返回 |

> 说明：PRD 未设“站点管理员”；`site_id` 仅作为数据范围预留字段，默认 `HQ`，不实现多站点切换（ASSUMED A-22）。

## 3. 需求分层与端到端定义

### 3.1 Tier 1 核心（30 分，必做）

| 功能组 | 功能点 | 分值 | “端到端可用”定义 | AC |
|---|---|---|---|---|
| T1-AUTH 注册登录 | 邮箱注册（格式/去重/密码≥8 含字母数字/BCrypt）、登录、JWT 会话、刷新不丢、错误反馈 | 6 | 新邮箱注册→登录→刷新仍登录→登出后受保护页 401 | AC-001~005 |
| T1-MENU 菜单 | 当日菜单卡片（图/名/价/菜系）、菜系多选筛选、名称+描述关键词搜索、详情（描述/蛋白/过敏原/辣度）、自定义选项与实时加价 | 9 | 登录→列表→筛选 Chinese+Japanese→搜索→详情选 Whole Wheat+Cheese 价格实时 +¥3.00→加入购物车 | AC-006~010 |
| T1-CART 购物车 | 加购（每次 +1）、同菜同配置合并、不同配置分行、调量/删除、实时总价、空态 | 7 | 同菜同配置点 2 次=1 行×2；换配置=2 行；调量/删除总价即时正确 | AC-011~012 |
| T1-ORDER 下单 | 结算页（明细/选项/小计/总价/日期默认当天/餐次/地址）、提交成功页（订单号+配送信息）、我的订单+详情、取消 Pending | 8 | 结算→提交→成功页→我的订单→详情→取消 Pending→状态 Cancelled 且库存恢复 | AC-013~019 |

**Tier1 门槛**：以上四组全部端到端可用（非仅接口 200）；任一主链路断（登录/菜单/加购/提交）对应组 0 分。

### 3.2 Tier 2 进阶（20 分，主要考察项）

| 功能组 | 功能点 | 分值 | “端到端可用”定义 | AC |
|---|---|---|---|---|
| T2-PREF 偏好 | 过敏原标记+加购弹窗（不过滤）、菜系/辣度/口味偏好、“为我推荐”开关软排序与高亮、单餐预算超限提示不阻断 | 8 | 标记 Egg→加购含蛋菜弹窗可继续；开推荐偏好菜系靠前高亮，关闭恢复默认；预算超限有提示仍可下单 | AC-021~023 |
| T2-RULE 订餐规则 | 每单总份数≤5（按钮禁用+API 拒绝）、截单 10:00/15:00 服务端判定与自动切最近餐次、同日同餐次唯一有效单（View Existing Order） | 6 | 第 6 份被拦；10:01 午餐→晚餐；重复单 409 且按钮变 View Existing Order | AC-020、AC-024~027 |
| T2-CONSOLE 菜品管理 | 管理员表格+搜索/分类筛选、新增/编辑（图≤5MB）、上下架、设置指定日期菜单与当日供应量 | 6 | 管理员建菜→员工可见；下架→员工不可见；设当日菜单+库存→员工可下单并在看板/库存体现 | AC-028~033 |

### 3.3 Tier 3 挑战（+10，可选；不挤占 Tier1/2）

| 功能组 | 功能点 | 分值 | “端到端可用”定义 | AC |
|---|---|---|---|---|
| T3-STOCK 库存 | 剩余量展示、≤3 低库存提示、售罄禁购、提交二次校验、并发不超卖、SSE 实时更新（失败 5s 轮询）、取消恢复、两种库存模式、流水对账 | 4 | 并发 50 抢 10 只成功 10；他人下单 2s 内看到库存变化；取消后恢复；DB 为最终账本 | AC-034~037、AC-043~044 |
| T3-AI 推荐 | 自然语言选餐、候选硬过滤（上架/库存/过敏原/近 7 天）、卡片+理由、SSE、可加购、无 Key 规则降级、规则可配置回滚 | 3 | 输入 `I want something light today`→先出卡后出理由→可加购；过敏/售罄/近 7 天不出现；无 Key 显示 rule-based fallback | AC-038~041 |
| T3-DASH 看板 | 今日订单/收入/各状态数、Top10 柱状、午晚对比、7 天趋势、低库存列表、手动/自动刷新 | 3 | 下单后看板数字与 DB 一致；多下 1 单刷新后订单数+1 | AC-042 |

> Tier3 级联：依赖下单的项在“下单不可用”时对应加分归零；Tier3 未实现不影响 Tier1/2 门槛判定，但所有项必须标 `N/A（Tier 3 未实现）`。

## 4. 业务规则精确化（可执行判定）

### 4.1 每单数量上限（PRD §4.2）
- 规则：单个订单内所有明细 `qty` 之和 ≤ 5；按**总份数**，非品种数（3+3=6 超限）。
- 前端：购物车合计达 5 后，菜单“Add to Cart”与购物车“+”禁用；提示英文 `Order limit reached: max 5 items per order.`（文案可微调，须英文）。
- 后端：`POST /orders` 与 `POST /orders/preview` 均校验，超限返回 400 `ORDER_LIMIT_EXCEEDED`。
- 边界：5 份允许、6 份拒绝；单份 qty 也必须 ≥1 且为整数（0/-1/1.5 → 400 `VALIDATION_QUANTITY`）。

### 4.2 截单时间与自动切换（PRD §4.2 + RUNBOOK D2/D3）
- 时区：`Asia/Shanghai`，以**服务端时钟**为准；客户端时间不参与判定。
- 截单点：Lunch 10:00:00、Dinner 15:00:00；**等于截单点即视为已截单**（`now < cutoff` 才可订）。
- 自动切换表（请求餐次已截单时）：

| 请求 | 当前时间（上海） | 实际下单餐次 | 响应 |
|---|---|---|---|
| 当日 Lunch | < 10:00:00 | 当日 Lunch | 正常 |
| 当日 Lunch | ≥10:00:00 且 <15:00:00 | 当日 Dinner | 200 + `autoSwitched=true` |
| 当日 Lunch | ≥15:00:00 | 次日 Lunch | 200 + `autoSwitched=true` |
| 当日 Dinner | <15:00:00 | 当日 Dinner | 正常 |
| 当日 Dinner | ≥15:00:00 | 次日 Lunch | 200 + `autoSwitched=true` |
| 未来日期 Lunch/Dinner | 任意（且该日菜单已发布） | 请求值 | 正常，不触发当日截单 |
| 过去日期 | 任意 | 拒绝 400 `VALIDATION_DATE_PAST` | — |

- 结算页 `preview` 返回 `effectiveDate/effectiveMeal/cutoffAt/autoSwitched`，用户确认后提交；提交时服务端**重新计算**，响应返回最终生效值（不信任客户端缓存的餐次）。
- 自动切换后的餐次参与唯一有效单判定；若该餐次已有有效单 → 409 `ORDER_DUPLICATE` + `existingOrderId`。
- 次日无菜单/未发布 → 409 `ORDER_MEAL_UNAVAILABLE`（不落单）。
- 验收边界：09:59:59 / 10:00:00 / 10:01 / 14:59:59 / 15:00:00 / 15:01 六点 + 跨日（AC-024/025）。

### 4.3 同日同餐次唯一有效单（PRD §4.2 + D5）
- 业务键：`(user_id, delivery_date, meal_type)`，仅 `status ∈ {Pending, Confirmed}` 有效；Cancelled/Completed 不占用。
- 实现约束：生成列 `active_key`（有效时=`user:date:meal`，无效=NULL）+ 唯一索引；冲突返回 **409 `ORDER_DUPLICATE`**，`data.existingOrderId`。
- 前端：结算页若已有有效单，主按钮变 `View Existing Order` 并跳转该单详情；重复提交时按 409 处理。
- 允许：同日不同餐次（午餐+晚餐）、不同日同餐次。

### 4.4 过敏原提醒（PRD §4.1 + D11）
- 用户过敏原集合与菜品过敏原集合交集非空 → 加购时前端弹窗 `This dish contains an allergen you flagged: [Egg]. Add anyway?`，确认后正常加入。
- **不过滤**：菜单仍展示、搜索仍可搜到；后端加购/下单不因过敏原阻断。
- 唯一硬过滤场景：AI 推荐候选集（D12/AI-1）。
- 过敏原枚举固定：`Peanuts, Dairy, Egg, Gluten, Soy, Fish, Shellfish`；不在枚举内输入 → 400。

### 4.5 预算提示（PRD §4.1 + D14）
- 偏好字段：`budgetMinCents`、`budgetMaxCents`（整数分）；校验 `0 < min ≤ max`，超范围 400。
- 购物车总价（服务端重算）> `budgetMaxCents` → 结算页展示提示（英文，含金额），`budgetExceeded=true`；**不阻断**下单（仍 201）。
- 未设置预算 → 不提示；预算只影响提示，不影响价格与库存。

### 4.6 取消规则（PRD §3.4 + D4）
- 员工：仅本人 **Pending** 可取消；Confined/Completed → 409 `ORDER_STATE_INVALID`。
- 管理员：可取消 Pending（必填原因 ≤200，写审计）；Confirmed 取消 → 409（ASSUMED A-02）。
- 取消成功：状态 Cancelled、记录 `cancelledAt/cancelReason`、库存 `reserved -= qty`、写 1 条 `inventory_ledger(RELEASE)`；重复取消 409 且**不再回补**。
- 超时：Pending 创建 30 分钟后由任务置 Cancelled（`reason=TIMEOUT`）并释放一次（ASSUMED A-03，P2；未实现标 NOT TESTED）。

### 4.7 搜索与筛选（PRD §3.2）
- 搜索：对 `name`、`description` 做大小写不敏感子串匹配；关键词 trim 后长度 1~50；>50 → 400 `VALIDATION_SEARCH_LENGTH`；`%`/`_` 转义。
- 筛选：`category` 多值（逗号分隔或重复参数），取 OR；非法分类 → 400 `VALIDATION_CATEGORY`。
- 排序：默认稳定排序（上架时间倒序 + id 升序）；“为我推荐”开启时按偏好软排序，不删除任何菜。
- 分页：`page≥1`（默认 1）、`1≤size≤100`（默认 20）；越界 400 `VALIDATION_PAGINATION`；响应含 `total/page/size`。

### 4.8 Console 菜品与每日菜单（PRD §4.3 + D20/D21）
- 菜品字段：name(≤100)、description(≤1000)、priceCents(>0)、category(枚举)、allergens(枚举多选)、spiceLevel(枚举)、protein(≤50)、image(≤5MB, jpg/png/webp)。
- 上下架：`status=ON_SHELF/OFF_SHELF`；下架后员工列表/详情不可见（详情 404）。
- 每日菜单：`(dish_id, serve_date)` 设 `total_qty`；默认次日，可设当日；`total_qty=0` 视为当日售罄；未配置的菜当日不可下单。
- 高风险操作（改价/上下架/改库存/取消订单）：`confirm=true` + `reason`（1~200）+ 审计（前后值、操作者、IP、时间）；缺 reason → 400 `VALIDATION_REASON_REQUIRED`。
- 图片：20 张 `docs/product_images/image_01..20.jpg` 映射到 20 道种子菜；缺失显示占位图，不得裂图。

## 5. 交易不变量（Tier1/2 强制）

| # | 不变量 | 实现口径 | 验收 |
|---|---|---|---|
| INV-1 | 金额整数分 | DB `BIGINT`；API 只传/回 `*Cents`；展示层格式 `¥xx.xx`；无 float/double | AC-054 |
| INV-2 | 服务端重算 | 请求只含 dishId/qty/optionIds；单价取自 DB；总价=Σ(unit+ΣoptionΔ)×qty | AC-016、AC-014 |
| INV-3 | 不超卖 | `UPDATE dish_daily_stock SET reserved=reserved+n WHERE serve_date=? AND dish_id=? AND total_qty-reserved-sold>=n`；影响行数=0 → 409 `STOCK_INSUFFICIENT` | AC-035 |
| INV-4 | 提交才占用 | 加购不写库存；`POST /orders` 事务内占用；失败整体回滚 | AC-014、AC-035 |
| INV-5 | 只回补一次 | `inventory_ledger` 唯一键 `(order_id, entry_type)`；重复释放冲突即忽略 | AC-019、AC-044 |
| INV-6 | 幂等 | `Idempotency-Key`（8~64，建议 UUID）+ 用户维度唯一；同键同体返回首次结果，同键异体 409 `IDEMPOTENCY_CONFLICT`；缺失 400 `IDEMPOTENCY_KEY_REQUIRED`；保留 24h | AC-015 |
| INV-7 | 唯一有效单 | 生成列+唯一索引，见 §4.3 | AC-026 |
| INV-8 | 订单快照 | 明细存 dishName/unitPriceCents/options[{name,priceDeltaCents}]/qty/subtotalCents + `snapshot_json`；历史单不随改价变化 | AC-055 |
| INV-9 | 状态机 | 仅 `Pending→Confirmed`、`Pending→Cancelled`、`Confirmed→Completed`、`Pending→Cancelled(TIMEOUT)`；其余 409 `ORDER_STATE_INVALID` | AC-019/060 |
| INV-10 | 事务边界 | 下单事务内不调用 LLM/外部 HTTP；Redis 操作在 DB 事务外且失败可回退 | 代码审查 AC-043 |

### 5.1 库存模型（RUNBOOK D7/D8）
- 表 `dish_daily_stock(dish_id, serve_date, total_qty, reserved_qty, sold_qty, inventory_mode)`；`available = total - reserved - sold`。
- 提交：`reserved += qty`（原子条件）；取消/超时：`reserved -= qty`；管理员确认：`reserved -= qty, sold += qty`；完成：不变。
- 流水 `inventory_ledger(id, order_id, dish_id, serve_date, entry_type RESERVE/RELEASE/CONFIRM/ADJUST, qty, before_available, after_available, business_key UNIQUE, created_at, operator)`。
- 模式：`DB_ATOMIC`（默认）/ `REDIS_PREALLOC`（热点菜预占，Redis 失联降级 DB，DB 为最终账本，异步对账）；两模式均经 `InventoryService`。

### 5.2 订单状态机

```text
Pending ──(admin confirm)──> Confirmed ──(admin complete)──> Completed(terminal)
   │
   ├──(employee/admin cancel, reason)──> Cancelled(terminal)
   └──(timeout 30min, system)──────────> Cancelled(terminal, reason=TIMEOUT)
```

## 6. 数据与种子（D1/D20/D21）

| 数据 | 要求 | 验收 |
|---|---|---|
| 账号 | `admin@webox.com / Admin12345`（ADMIN）、`employee@webox.com / Employee123`（EMPLOYEE），BCrypt | AC-004、AC-056 |
| 菜品 | 9 道 PRD 菜（英文名/描述/价格/分类/蛋白/过敏原/辣度/选项）全部入库并上架 | AC-056、AC-009 |
| 扩展菜 | 另 11 道英文菜（凑 20 道，用于分页/列表性能与 20 张图映射） | AC-006、AC-056 |
| 图片 | 20 张 `image_01..20.jpg` 映射种子菜；缺失占位 | AC-029、AC-056 |
| 当日菜单/库存 | 9 道 PRD 菜当日可下单，`total_qty 20~50`；扩展菜按需 | AC-056 |
| 未来菜单 | 次日 + 后天各一批，支撑截单切次日与日期选择 | AC-025、AC-058 |
| 历史订单 | 可选：预置近 7 天样本用于看板趋势与 AI 近 7 天过滤 | AC-042、AC-038 |
| 地址簿 | 员工可保存历史地址（≤200），结算页可选/新增 | AC-013 |

## 7. 非功能要求（数字锚点）

| 维度 | 指标 | 锚点/口径 |
|---|---|---|
| 规模 | 员工 200、菜品 50（种子 20）、订单历史 30 天≈6000 | 容量假设 |
| 峰值 | 70% 午餐订单集中在 09:30–10:00 ≈ 4.7 单/分；按 **10× 预留** 设计 ≈ 1 单/秒，压测 5/10 QPS | RUNBOOK 峰值 + 10x |
| 菜单列表 | P95 ≤200ms（未命中缓存）/ ≤100ms（命中）@50 QPS，50 道菜 | AC-045 |
| 搜索/筛选 | P95 ≤250ms @20 QPS | AC-045 |
| 菜品详情 | P95 ≤150ms @20 QPS | AC-045 |
| 下单提交 | P95 ≤500ms @10 QPS | AC-046 |
| 登录 | P95 ≤300ms @10 QPS | AC-005 |
| 实时库存 | SSE 变化推送 ≤2s；断线 5s 重连/轮询 | AC-036 |
| AI | 首 token ≤3s、总 ≤20s；无 Key 降级 ≤1s 出结果 | AC-039/040 |
| 可用性 | 演示窗口核心路径 5xx=0，SLO 99.5%/月（演示折算）；降级不 500 | AC-058 |
| 并发正确性 | 50 并发抢 10 份 → 成功 10、40 个 409，`available=0` 不为负 | AC-035 |
| 缓存 | 菜单列表/详情 TTL 60s，管理端写操作后 ≤1s 失效；库存不缓存超过 1s | AC-045、AC-030 |
| 分页 | 默认 1/20，`size≤100`；越界 400 | AC-006、AC-048 |
| 输入长度 | 邮箱≤200、地址≤200、搜索≤50、密码 8~64、菜名≤100、描述≤1000、原因≤200 | AC-048 |
| 上传 | 图片 ≤5MB，jpg/png/webp；请求体 ≤1MB（非图片） | AC-029 |
| 限流 | 登录 10 次/分/IP+邮箱；下单 5 次/分/用户；AI 10 次/分/用户；超限 429 `RATE_LIMITED` | AC-049 |
| 多实例 | JWT 无状态、无本地内存正确性依赖、幂等靠 DB 唯一键；演示单实例，设计兼容 | AC-059 |
| 备份恢复 | `scripts/backup.sh`（mysqldump）每日；恢复演练 1 次；RPO≤24h、RTO≤30min | AC-058 |
| 图文/语言 | 用户可见全英文；`¥xx.xx`；375/768/1440 无横向滚动 | AC-052、AC-057 |

## 8. 补充说明 16 条落地（任务清单逐项；RUNBOOK 称“12 条”，以枚举为准全部覆盖）

| # | 要求 | 可验收口径 | AC |
|---|---|---|---|
| S1 | 幂等 | 同 Key 重试 1 单；异体 409；缺失 400；DB 唯一约束 | AC-015 |
| S2 | 唯一有效单 | 生成列唯一索引；重复 409+已有单 ID | AC-026、AC-027 |
| S3 | 原子扣减 | 条件 UPDATE/Redis 预占；影响行数 0 即失败；不为负 | AC-035、AC-043 |
| S4 | 取消只回补一次 | ledger 唯一业务键；重复取消 409 且无二次回补 | AC-019、AC-037 |
| S5 | 截单服务端判定 | 服务端时钟 Asia/Shanghai；六边界；等于即关闭 | AC-024、AC-025 |
| S6 | 金额分 | BIGINT cents；服务端重算；显示两位小数 | AC-016、AC-054 |
| S7 | 订单快照 | 名称/单价/选项/加价/小计冻结 + snapshot_json | AC-055 |
| S8 | 库存策略可配置 | 菜品级 `DB_ATOMIC`/`REDIS_PREALLOC`；统一服务；DB 最终账本 | AC-043 |
| S9 | 库存流水与对账 | ledger 全量流水；对账接口/脚本零漂移；异常告警 | AC-044 |
| S10 | RBAC+数据范围+字段权限+审计 | 角色矩阵、SELF/ALL、敏感字段脱敏、audit_log 可查 | AC-028、AC-032、AC-033、AC-051 |
| S11 | 高风险操作可控 | 二次确认+必填原因+审计+可回滚（改价回滚到前值并再审计） | AC-032 |
| S12 | 偏好事实源与画像软排序/硬过滤 | 显式偏好为准；画像只排序；售罄/过敏原/近 7 天硬过滤 | AC-021、AC-022、AC-038 |
| S13 | AI 实时可配置可交互，先结果后解释 | SSE 事件 `meta→dish→reason→done`；规则热更新/回滚；多轮会话落库 | AC-039、AC-041 |
| S14 | 统一错误码/分页/鉴权/幂等/版本 | `/api/v1`；`{code,message,data,requestId}`；错误码分段；page/size | AC-047、AC-048 |
| S15 | 多实例/限流降级/备份恢复/SLO 告警 | 无状态+唯一约束；429 限流；备份恢复演练；告警阈值文档+health | AC-049、AC-058、AC-059 |
| S16 | 账本对账、限额、审计、告警、补偿 | 对账漂移检测；超卖/超限拦截；审计不可改；ADJUST 补偿流水+原因 | AC-044、AC-032、AC-035 |

## 9. 交付评分卡映射

### 9.1 功能完成度（Tier1 30 + Tier2 20，门槛 45/50；Tier3 +10，封顶 60）
见 §3.1–3.3。扣分口径：非端到端可用该项 0 分；半可用按 50% 上限；Tier3 加分不得用于弥补 Tier1/2 门槛。

### 9.2 前端 5 项（各 4 分）

| 项 | 业务锚点 | 实现要求 | 证据 AC |
|---|---|---|---|
| FE-1 响应式 | PRD §1 手机+电脑 | 375/768/1440 三档：菜单 1/2/3 列、导航可折叠、结算可用、无横向滚动 | AC-052 |
| FE-2 分页/长列表性能 | PRD §3.2 菜品增长/高峰 | 服务端分页（默认 1/20，≤100）；50 道菜滚动无卡顿；筛选/搜索服务端执行；请求去重 | AC-006、AC-045 |
| FE-3 防抖/节流 | PRD §3.3 高峰频繁加购 | 加购 300ms 节流+在途禁用；提交按钮禁用+同一幂等键；连点不重复 | AC-053、AC-015 |
| FE-4 价格精度 | PRD §3.2 精确到分 | 全链路整数分；展示 `¥xx.xx`；选项加价实时；无浮点误差 | AC-010、AC-054 |
| FE-5 输入校验 | PRD §3.1/§3.2 | 注册邮箱/密码、地址≤200、搜索≤50、原因≤200 前后端一致 | AC-003、AC-008、AC-048 |

### 9.3 后端 5 项（各 4 分）

| 项 | 业务锚点 | 实现要求 | 证据 AC |
|---|---|---|---|
| BE-1 缓存 | 09:30–10:00 高峰+菜单高频 | 菜单列表/详情缓存 TTL 60s；管理端写后 ≤1s 失效；库存 1s 内一致；无脏读 | AC-045、AC-030 |
| BE-2 幂等 | PRD §3.4 连续点击只 1 单 | Idempotency-Key+用户唯一约束；同体重放、异体 409；并发安全 | AC-015 |
| BE-3 SQL 注入防护 | PRD §3.2 搜索 | 全参数化/预编译；LIKE 转义；注入串 200 空结果不 500 | AC-008 |
| BE-4 权限 | PRD §1/§3.1/§4.3 | JWT+URL/方法级授权；员工 Console 403；本人订单隔离；401/403 区分 | AC-028、AC-051 |
| BE-5 并发/防超卖 | PRD §5.1 | 条件 UPDATE；50 并发抢 10 成功 10；库存不为负；取消只回补一次 | AC-035、AC-019 |

## 10. 假设与默认决策（完整表见 `docs/assumptions.md`）

**D1–D22 全部采纳，无修改**；以下补充可执行口径（不改变决策方向）：

| 决策 | 补充口径 | 影响 |
|---|---|---|
| D1 种子账号 | 注册接口忽略/拒绝 role=ADMIN；管理员仅种子 | 安全 |
| D2 时区 | 服务端强制 Asia/Shanghai；DB/连接时区一致 | 截单 |
| D3 截单 | 等于截单点即关闭；未来日期不触发当日截单；切次日须有菜单 | AC-024/025 |
| D4 状态机 | 增加 Pending 30 分钟超时（A-03，P2）；Confirmed 不可取消 | AC-060 |
| D5 唯一单 | 409 `ORDER_DUPLICATE` + `existingOrderId`；仅 Pending/Confirmed 占用 | AC-026 |
| D6 幂等 | 必填头，缺失 400；保留 24h；并发用唯一约束 | AC-015 |
| D7 库存 | `available=total-reserved-sold`；两模式均经 InventoryService | AC-043 |
| D8 占用时点 | 提交占用、取消释放、确认转 sold | AC-014/019 |
| D9 快照 | 明细字段 + snapshot_json | AC-055 |
| D10 选项 | 必选组校验、选项归属校验、DB 价重算 | AC-010 |
| D11 过敏原 | 前端提醒、后端不阻断、AI 硬过滤 | AC-021/038 |
| D12 偏好 | 显式偏好事实源；画像仅软排序；硬过滤=售罄/过敏/近 7 天 | AC-022/038 |
| D13 为我推荐 | 软排序+高亮；关闭恢复稳定默认序 | AC-022 |
| D14 预算 | 仅提示、不阻断 | AC-023 |
| D15 权限 | EMPLOYEE/ADMIN；`/admin/**` 403；audit_log | AC-028/032/033 |
| D16 高风险 | confirm+reason+audit；改价可回滚 | AC-032 |
| D17 实时库存 | SSE `/api/v1/menu/stream`；失败 5s 轮询；事件仅 dishId/available | AC-036 |
| D18 AI | 确定性候选过滤；SSE；无 Key 降级；规则表可调/回滚 | AC-038~041 |
| D19 分页/错误码 | 统一 envelope 与错误码分段 | AC-047/048 |
| D20 图片 | 20 张映射；缺失占位 | AC-029/056 |
| D21 种子 | 当日 9 菜上架、库存 20~50；未来 1~2 天 | AC-056 |
| D22 支付 | 不实现支付/退款；取消仅库存+状态 | AC-019/020 |

## 11. 待确认项与风险（详见 assumptions §5）

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | 2 小时时间盒下 Tier3 存在未完成风险（概率高） | 加分少 | 先保 Tier1/2 端到端；Tier3 按 4/3/3 增量做 |
| R2 | 现场无 LLM Key | AI 真实效果无法验证 | 规则降级可演示；真实模型标 NOT TESTED |
| R3 | Redis 不可用 | 热点预占失效 | 自动降级 DB_ATOMIC，禁止 500 |
| R4 | 截单边界难以在真实时钟精确触发 | 边界漏测 | 服务注入 Clock，JUnit 固定时间；E2E 用未来菜单 |
| R5 | 低库存/售罄演示与 D21“库存 20~50”冲突 | 演示状态缺失 | 用管理员改库存到 3/0 后演示，再恢复 |
| R6 | 管理员订单处理范围未在 PRD 明确 | 范围多做/少做 | 仅实现 Confirm/Complete/Cancel(Pending)，P2 |
| R7 | “12 条补充说明”与实际枚举 16 项不一致 | 漏项 | 按 16 项全部覆盖（§8） |

## 12. 语言 / 货币 / 时区
- 用户可见文案：**英文**（界面/按钮/菜单数据/错误/Toast/AI 理由/看板）；代码注释可用中文。
- 货币：人民币，符号 `¥`，展示 `¥22.50`；存储整数分（BIGINT）。
- 时区：`Asia/Shanghai`；日期展示 `YYYY-MM-DD`；服务端时钟为唯一判据。
- 设备：手机 + 桌面响应式；API 前缀 `/api/v1`。

## 13. G1 自检（本节点）

| 检查项 | 结论 | 证据 |
|---|---|---|
| Tier1/2/3 分层完整且可映射评分卡 | PASS | §3 + §9，分值 30/20/+10 |
| GWT 覆盖核心规则与失败模式（并发/幂等/截单边界） | PASS | acceptance-matrix AC-001~060；§4/§5 |
| NFR 有数字锚点 | PASS | §7（P95/QPS/上限/限流） |
| 假设/默认决策齐全且与 RUNBOOK 一致 | PASS | §10 + assumptions.md（D1–D22） |
| 场景 required_checks 已映射 | PASS | scenario-profile v2 §2–§5 |
| 补充说明全部落地 | PASS | §8（S1–S16，16/16） |
| 语言英文 / 金额整数分口径 | PASS | §12、INV-1、AC-054/057 |
| 每条规则有可执行判定（数值/状态/错误码） | PASS | §4 全量含错误码与边界 |