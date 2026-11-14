# 验收矩阵 — WeBox 员工餐食订购平台

- 版本：v1.0（Stage 1 产品工程师，2026-11-14 21:53 CST）
- 上游：`docs/prd-analysis.md`、`docs/scenario-profile.md` v2、`RUNBOOK.md` D1–D22
- 编号：**AC-001 … AC-060**（Tier1 19 条 / Tier2 14 条 / Tier3 11 条 / NFR+不变量 16 条）
- 口径：每条 AC 必须可按“验证方式”复现；PASS 必须附证据路径；未执行标 `NOT TESTED`；Tier3 未实现标 `N/A（Tier 3 未实现）`。

## 0. 使用说明

| 字段 | 取值 |
|---|---|
| 优先级 | P0=主链路/资损/安全；P1=规则/权限；P2=增强；P3=Tier3 加分 |
| 验证方式 | `API`（curl/接口测试）、`E2E`（agent-browser）、`DB`（SQL 断言）、`CONC`（并发脚本）、`SHOT`（截图）、`REV`（代码/配置/日志审查）、`DOC`（文档/文件核对） |
| 阶段 | `S4-BE` 后端开发、`S4-FE` 前端开发、`S5-Test` 测试执行、`S5-产品` 产品验收抽查 |
| 评分卡锚点 | `T1-*`/`T2-*`/`T3-*` 功能分；`FE-1..5` 前端 5 项；`BE-1..5` 后端 5 项 |

## 1. Tier 1 核心（必做，30 分）

| ID | P | 角色 | Given-When-Then（可执行判定） | 验证 | 评分卡 | 阶段 |
|---|---|---|---|---|---|---|
| AC-001 | P0 | 访客 | **Given** 新邮箱 `u001@test.com` 未注册；**When** POST `/api/v1/auth/register`（email、password=`Abc12345`）；**Then** 201，返回用户 id/role=`EMPLOYEE`，DB `password_hash` 以 `$2` 开头且无明文，响应不含密码 | API+DB | T1-AUTH/FE-5 | S4-BE/S4-FE/S5-Test |
| AC-002 | P0 | 访客 | **Given** `u001@test.com` 已注册；**When** 同邮箱（含大小写变体 `U001@test.com`）再注册；**Then** 409 `AUTH_EMAIL_EXISTS`，用户数不变 | API+DB | T1-AUTH | S4-BE/S5-Test |
| AC-003 | P0 | 访客 | **Given** 注册表单；**When** 分别提交 非法邮箱、7 位密码、纯字母密码、201 字符邮箱；**Then** 均 400 `VALIDATION_EMAIL_FORMAT`/`VALIDATION_PASSWORD_POLICY`/`VALIDATION_EMAIL_LENGTH`；**且** 8 位含字母数字通过 201 | API | T1-AUTH/FE-5 | S4-BE/S4-FE/S5-Test |
| AC-004 | P0 | 员工/管理员 | **Given** 已注册；**When** 正确密码登录；**Then** 200 返回 JWT（`EMPLOYEE`）；浏览器刷新后 `/api/v1/auth/me` 仍 200；**And** 种子 `admin@webox.com/Admin12345` 登录 role=`ADMIN` | API+E2E | T1-AUTH | S4-BE/S4-FE/S5-Test |
| AC-005 | P0 | 员工 | **Given** 账号存在；**When** 连续 10 次错误密码后第 11 次尝试；**Then** 前 10 次 401 `AUTH_INVALID_CREDENTIALS`，第 11 次 429 `RATE_LIMITED`；正确密码登录 P95≤300ms | API | T1-AUTH/BE-4 | S4-BE/S5-Test |
| AC-006 | P0 | 员工 | **Given** 当日 20 道菜上架；**When** GET `/api/v1/menu?page=1&size=20`；**Then** 200，20 条卡片含 id/name/imageUrl/priceCents(整数)/priceDisplay(`^¥\d+\.\d{2}$`)/category/spiceLevel，`total≥9`，`page=1,size=20`；**And** `size=101` → 400 `VALIDATION_PAGINATION`；P95≤200ms | API+E2E | T1-MENU/FE-2/FE-4/BE-1 | S4-BE/S4-FE/S5-Test |
| AC-007 | P0 | 员工 | **Given** 菜品含 Chinese/Japanese/Western；**When** `category=Chinese,Japanese` 且 `category=Japanese,Western` 分别请求；**Then** 仅返回所选分类并集，数量等于 DB `IN` 计数；非法分类 → 400 `VALIDATION_CATEGORY` | API+DB | T1-MENU/FE-2 | S4-BE/S4-FE/S5-Test |
| AC-008 | P0 | 员工 | **Given** 菜品 Kung Pao Chicken 描述含 chicken；**When** 搜索 `CHICKEN`；**Then** 命中名称或描述（大小写不敏感）；**And** 搜索 `' OR 1=1--` 返回 200 空/正常结果、非 500 且无 SQL 报错；**And** 51 字符关键词 → 400 `VALIDATION_SEARCH_LENGTH` | API+DB | T1-MENU/FE-5/BE-3 | S4-BE/S4-FE/S5-Test |
| AC-009 | P0 | 员工 | **Given** 菜品 Classic Beef Burger；**When** GET 详情；**Then** 返回 description/protein/allergens（枚举内）/spiceLevel∈{None,Mild,Medium,Hot}；选项组 Bun(required, Plain/Whole Wheat)、Sauce(required)、Add-ons(optional, Cheese+¥3/Bacon+¥5/Egg+¥2)；价格均整数分 | API | T1-MENU/FE-4 | S4-BE/S5-Test |
| AC-010 | P0 | 员工 | **Given** Burger 基础价 ¥38.00；**When** 选 Whole Wheat+Sauce=Mustard+Cheese(+¥3)；**Then** 前端显示 ¥41.00 且 API 价格同；**And** 提交其他菜品的 optionId → 400 `VALIDATION_OPTION_INVALID`；必选组缺失 → 400 `VALIDATION_OPTION_REQUIRED` | API+E2E | T1-MENU/FE-4 | S4-BE/S4-FE/S5-Test |
| AC-011 | P0 | 员工 | **Given** 空购物车；**When** 同菜同配置加购 2 次，再加同菜不同配置 1 次；**Then** 购物车 2 行（配置 A×2、配置 B×1），每行展示选项名，总价=Σ(单价+加价)×数量（分），无浮点尾差 | E2E+API | T1-CART/FE-4 | S4-FE/S5-Test |
| AC-012 | P0 | 员工 | **Given** 购物车 2 行；**When** 第 1 行 +、−、删除第 2 行；**Then** 数量与总价实时正确；减到 0 该行移除；全空显示空态且总价 ¥0.00；刷新后购物车仍存在（本地持久化） | E2E | T1-CART | S4-FE/S5-Test |
| AC-013 | P1 | 员工 | **Given** 购物车有 2 份；**When** GET `/api/v1/orders/preview`；**Then** 返回明细（名/选项/数量/小计/总价 cents）、`effectiveDate`（默认今日）、`effectiveMeal`、`cutoffAt`、`autoSwitched`、`budgetExceeded`、地址簿列表；地址新增 >200 字符 → 400 `VALIDATION_ADDRESS_LENGTH` | API+E2E | T1-ORDER/T2-RULE | S4-BE/S4-FE/S5-Test |
| AC-014 | P0 | 员工 | **Given** 有效购物车与地址；**When** POST `/api/v1/orders`（Idempotency-Key）；**Then** 201，`orderNo` 匹配 `^WB\d{8}-\d{4,}$`，status=`Pending`，`totalCents`=服务端重算，快照含每行 dishName/unitPriceCents/options/qty/subtotal，`snapshot_json` 非空；DB 库存 `reserved+qty`；`inventory_ledger` 恰 1 条 `RESERVE` | API+DB | T1-ORDER/BE-2 | S4-BE/S5-Test |
| AC-015 | P0 | 员工 | **Given** 同一 `Idempotency-Key=K1` 与同一请求体；**When** 并发 5 次 + 串行再 2 次提交；**Then** DB 仅 1 个订单，7 次响应 `orderId` 相同；**And** 同 K1 改数量 → 409 `IDEMPOTENCY_CONFLICT`；**And** 缺头 → 400 `IDEMPOTENCY_KEY_REQUIRED`；库存只扣 1 次 | CONC+DB | T1-ORDER/BE-2 | S4-BE/S5-Test |
| AC-016 | P0 | 员工 | **Given** DB 单价 ¥22.00；**When** 请求体附带伪造 `priceCents=1`（或下单前管理员改价 ¥25.00）；**Then** 订单 `totalCents` 以 DB 实时单价重算（¥25.00×qty），伪造字段被忽略/400，客户端 total 不参与结算 | API+DB | T1-ORDER/FE-4 | S4-BE/S5-Test |
| AC-017 | P0 | 员工 | **Given** 员工 A 有 2 单、员工 B 有 1 单；**When** A GET `/api/v1/orders` 与 B 的订单 id；**Then** 列表仅 A 的 2 单（倒序）；B 的单 → 404 `ORDER_NOT_FOUND`（或 403 `FORBIDDEN`）；详情含选项/数量/小计/总价/状态 | API+DB | T1-ORDER/BE-4 | S4-BE/S5-Test |
| AC-018 | P0 | 员工 | **Given** Pending 订单含 2 份菜、库存 available=10；**When** 取消一次；**Then** 200，status=`Cancelled`、`cancelledAt` 非空，available=12，ledger 仅 1 条 `RELEASE`；**When** 再取消；**Then** 409 `ORDER_STATE_INVALID`，available 仍 12、无第 2 条 RELEASE | API+DB | T1-ORDER/BE-5/T3-STOCK | S4-BE/S5-Test |
| AC-019 | P0 | 员工/管理员 | **Given** 订单 status=`Confirmed`；**When** 员工取消 / 管理员取消；**Then** 均 409 `ORDER_STATE_INVALID`，状态与库存不变（ASSUMED A-02） | API | T1-ORDER | S4-BE/S5-Test |

## 2. Tier 2 进阶（20 分）

| ID | P | 角色 | Given-When-Then（可执行判定） | 验证 | 评分卡 | 阶段 |
|---|---|---|---|---|---|---|
| AC-020 | P0 | 员工 | **Given** 购物车已有 4 份；**When** 再加 1 份后尝试第 6 份；**Then** 第 6 次 Add/`+` 禁用并提示英文上限原因；直接 API 提交 6 份 → 400 `ORDER_LIMIT_EXCEEDED`；3+3 组合同样拒绝；5 份允许提交 | E2E+API | T2-RULE | S4-BE/S4-FE/S5-Test |
| AC-021 | P1 | 员工 | **Given** 员工过敏原=`Egg`；**When** 加购 Korean Bibimbap（Egg,Soy）；**Then** 弹窗含 `allergen` 与 `Egg`，确认后菜品进入购物车；菜单/搜索仍可见该菜；API 加购/下单不因过敏原阻断；未标记过敏原用户无弹窗 | E2E+API | T2-PREF | S4-FE/S5-Test |
| AC-022 | P1 | 员工 | **Given** 偏好菜系=`Japanese`、辣度=`Mild`；**When** 开启 `For You`；**Then** 匹配菜排序靠前且有高亮标记，非匹配菜仍展示；**When** 关闭；**Then** 恢复稳定默认序（上架时间倒序+id）；两次结果集合相同，仅顺序/样式不同 | API+E2E+DB | T2-PREF/FE-2 | S4-BE/S4-FE/S5-Test |
| AC-023 | P1 | 员工 | **Given** 单餐预算上限 ¥15.00；**When** 购物车总额 ¥22.00 进入结算；**Then** `budgetExceeded=true` 且页面展示提示；**And** Place Order 仍 201（不阻断）；未设预算/未超限无提示 | API+E2E | T2-PREF | S4-BE/S4-FE/S5-Test |
| AC-024 | P0 | 员工 | **Given** 服务端时钟 Asia/Shanghai 固定；**When** 分别于 09:59:59 / 10:00:00 / 10:01:00 提交“当日 Lunch”；**Then** 09:59:59→Lunch；10:00:00 与 10:01→Dinner（`autoSwitched=true`，响应回有效餐次）；库存/唯一单按生效餐次判定 | API+DB | T2-RULE | S4-BE/S5-Test |
| AC-025 | P0 | 员工 | **Given** 同上；**When** 14:59:59 / 15:00:00 / 15:01 提交“当日 Dinner”，以及 16:00 提交“次日 Lunch”；**Then** 14:59:59→当日 Dinner；15:00:00/15:01→次日 Lunch（autoSwitched）；16:00 次日 Lunch 正常；过去日期 → 400 `VALIDATION_DATE_PAST` | API+DB | T2-RULE | S4-BE/S5-Test |
| AC-026 | P0 | 员工 | **Given** 员工已有当日 Lunch 的 Pending 单；**When** 结算页加载并再次提交同日同餐次；**Then** 主按钮显示 `View Existing Order` 并跳转；直接 POST → 409 `ORDER_DUPLICATE` 且 `data.existingOrderId` 为已有单；订单数不变、库存不再扣减 | API+E2E+DB | T2-RULE/BE-5 | S4-BE/S4-FE/S5-Test |
| AC-027 | P1 | 员工 | **Given** 已有当日 Lunch 有效单；**When** 下当日 Dinner、次日 Lunch；**Then** 均 201；**When** 取消 Lunch 单后再下同日 Lunch；**Then** 201（Cancelled 不占用唯一键） | API+DB | T2-RULE | S4-BE/S5-Test |
| AC-028 | P0 | 员工/管理员 | **Given** 员工 JWT；**When** GET `/api/v1/admin/dishes`、访问 `/console`；**Then** API 403 `FORBIDDEN`，Console 路由不渲染管理功能；管理员同请求 200；未登录 → 401 `AUTH_UNAUTHORIZED` | API+E2E | T2-CONSOLE/BE-4 | S4-BE/S4-FE/S5-Test |
| AC-029 | P1 | 管理员 | **Given** 管理员已登录；**When** 新增菜品（含 jpg≤5MB）、按名称搜索、按分类筛选、编辑描述/过敏原；**Then** 列表与员工端同步；上传 >5MB/非图片 → 400 `VALIDATION_IMAGE`；无图显示占位图不裂图 | API+E2E | T2-CONSOLE/FE-5 | S4-BE/S4-FE/S5-Test |
| AC-030 | P0 | 管理员 | **Given** 菜品 ON_SHELF；**When** 下架；**Then** 员工列表不含、详情 404；**When** 上架；**Then** 恢复可见；管理端写后 ≤1s 前端可见（缓存失效） | API+DB+E2E | T2-CONSOLE/BE-1 | S4-BE/S5-Test |
| AC-031 | P1 | 管理员 | **Given** 菜品 X；**When** 设置当日菜单且 `total_qty=30`，设置次日菜单；**Then** 员工当日/次日菜单出现该菜且剩余 30；未配置日期不出现；`total_qty=0` 显示 `Sold out` 且不可下单；管理端修改后员工端反映 | API+DB+E2E | T2-CONSOLE/T3-STOCK | S4-BE/S4-FE/S5-Test |
| AC-032 | P0 | 管理员 | **Given** 菜品价 ¥22.00；**When** 改价 ¥25.00 但缺 reason/confirm；**Then** 400 `VALIDATION_REASON_REQUIRED`；**When** 携带 confirm+reason=`price adjustment`；**Then** 200，`audit_log` 有 actor/action/object/before=2200/after=2500/reason/ip/time；**When** 回滚到 ¥22.00；**Then** 产生第 2 条审计且当前价为 2200 | API+DB | T2-CONSOLE/BE-4 | S4-BE/S5-Test |
| AC-033 | P1 | 管理员/员工 | **Given** 管理员查看订单列表；**When** 列表与详情对比；**Then** 列表地址脱敏、详情完整；员工仅见本人完整地址；任何响应/审计/日志不含 password_hash 或 token；员工访问 `/admin/orders` → 403 | API+REV | T2-CONSOLE/BE-4 | S4-BE/S5-Test |

## 3. Tier 3 挑战（+10，可选）

| ID | P | 角色 | Given-When-Then（可执行判定） | 验证 | 评分卡 | 阶段 |
|---|---|---|---|---|---|---|
| AC-034 | P2 | 员工 | **Given** 菜品剩 3 份/0 份；**When** 查看菜单；**Then** 分别显示 `Only 3 left` 视觉强调 / `Sold out` 且 Add 禁用；0 份直接提交 → 409 `STOCK_INSUFFICIENT` 且返回 dishId/requested/available | API+E2E+SHOT | T3-STOCK | S4-BE/S4-FE/S5-Test |
| AC-035 | P0 | 50 并发员工 | **Given** 菜品 available=10；**When** 50 个不同用户并发提交各 1 份；**Then** 恰 10 个 201、40 个 409 `STOCK_INSUFFICIENT`；DB `available=0` 且 `reserved+sold≤total`，无负值；ledger 汇总与库存一致 | CONC+DB | T3-STOCK/BE-5 | S4-BE/S5-Test |
| AC-036 | P2 | 员工 | **Given** 两名员工同时打开菜单；**When** A 下单 1 份；**Then** B 页面 ≤2s 内库存减 1（SSE `/api/v1/menu/stream`，事件含 dishId/available），无需刷新；断线 5s 内重连；SSE 不可用时 5s 轮询仍更新 | API+E2E | T3-STOCK/BE-1 | S4-BE/S4-FE/S5-Test |
| AC-037 | P2 | 员工 | **Given** 菜品取消前 available=7；**When** 取消含 1 份的 Pending 单；**Then** available=8，其他客户端 ≤2s 看到；售罄菜恢复为 1 后 Add 可用 | API+E2E+DB | T3-STOCK | S4-BE/S5-Test |
| AC-038 | P2 | 员工 | **Given** 用户过敏原 Egg、昨日已点 Bibimbap、菜 X 售罄；**When** 调 AI 推荐；**Then** 响应 dishIds 不含含 Egg 菜、Bibimbap、售罄菜；模型返回候选集外 dishId 被服务端丢弃；所有推荐菜均在候选集且价格取 DB | API+DB | T3-AI | S4-BE/S5-Test |
| AC-039 | P2 | 员工 | **Given** 已配置 Key；**When** 输入 `I want something light today`；**Then** SSE 事件顺序 `meta→dish(卡片)→reason(理由)→done`，首事件 ≤3s、总 ≤20s；卡片可直接加购成功 201；关闭网络后重试有明确错误/降级 | API+E2E | T3-AI | S4-BE/S4-FE/S5-Test |
| AC-040 | P2 | 员工 | **Given** 未设置 `LLM_API_KEY`；**When** 请求 AI 推荐；**Then** 200 SSE（`fallback:true`）且页面标注 `rule-based fallback`，仍返回过滤后的候选菜；无 500/白屏 | API+E2E | T3-AI | S4-BE/S4-FE/S5-Test |
| AC-041 | P2 | 管理员/员工 | **Given** 规则表权重 `spice=1`；**When** 改为 3 并保存；**Then** ≤60s 生效无需重启；**When** 回滚；**Then** 恢复旧版本；`ai_conversation` 记录 user/prompt/response/dishes；DB/日志/前端包 grep 无 API Key | API+DB+REV | T3-AI/BE-4 | S4-BE/S5-Test |
| AC-042 | P2 | 管理员 | **Given** DB 有今日订单；**When** 打开看板并刷新；**Then** 今日订单数/收入/Completed/Pending/Cancelled 与 DB 聚合一致；Top10 按销量降序；Lunch/Dinner 对比；近 7 天趋势点数=7；低库存 ≤3 列表与库存一致；新增 1 单后刷新 +1 | API+DB+E2E+SHOT | T3-DASH | S4-BE/S4-FE/S5-Test |
| AC-043 | P2 | 员工 | **Given** 菜 A=`DB_ATOMIC`、菜 B=`REDIS_PREALLOC`；**When** 分别并发下单；**Then** 两者成功数=库存数；停掉 Redis 后 B 仍可正确下单（降级 DB），无 500/超卖；DB 为最终账本 | API+CONC+REV | T3-STOCK/BE-1/BE-5 | S4-BE/S5-Test |
| AC-044 | P2 | 管理员 | **Given** 完成下单/取消/确认/调整；**When** 运行对账接口/脚本；**Then** `available` 与 ledger 推导值零漂移；人工制造 1 份差异 → 对账返回 `drift=1` 并告警/审计，补偿写 `ADJUST` 流水（含原因）后归零 | API+DB | T3-STOCK | S4-BE/S5-Test |

## 4. NFR、安全与不变量（16 条）

| ID | Tier | P | 角色 | Given-When-Then（可执行判定） | 验证 | 评分卡 | 阶段 |
|---|---|---|---|---|---|---|---|
| AC-045 | T1/T2 | P0 | 系统 | **Given** 50 道菜与预热缓存；**When** 50 QPS 持续 60s 查菜单/筛选/搜索；**Then** 列表 P95≤200ms（缓存命中≤100ms）、搜索 P95≤250ms、详情≤150ms，5xx=0；管理端改菜后 ≤1s 读到新数据 | CONC+API | BE-1/FE-2 | S5-Test |
| AC-046 | T1 | P0 | 系统 | **Given** 200 用户与当日库存充足；**When** 10 QPS 提交订单 60s（不同用户/幂等键）；**Then** P95≤500ms，5xx=0，订单数=成功响应数，库存守恒 | CONC+DB | T1-ORDER/BE-2/BE-5 | S5-Test |
| AC-047 | 全部 | P0 | 系统 | **Given** 触发 400/401/403/404/409/429/500；**When** 检查响应；**Then** 统一 `{code,message,data,requestId}`，HTTP 状态与 code 段匹配，无堆栈/SQL/密钥泄漏 | API | BE-3/BE-4 | S4-BE/S5-Test |
| AC-048 | T1/T2 | P0 | 系统 | **Given** 超长输入；**When** email=201、address=201、search=51、reason=201、password=65；**Then** 均 400 且 `data.field` 指向字段；边界值 200/200/50/200/64 通过 | API | FE-5/BE-4 | S4-BE/S5-Test |
| AC-049 | T1/T2 | P1 | 系统 | **Given** 限流阈值；**When** 登录 11 次/分、下单 6 次/分/用户、AI 11 次/分/用户；**Then** 超限 429 `RATE_LIMITED`，未超限正常 | API | BE-4 | S4-BE/S5-Test |
| AC-050 | 全部 | P0 | 系统 | **Given** 源码/日志/响应/文档；**When** 执行 grep 明文密码、`Authorization` 日志、Key；**Then** 无命中；DB 密码 `$2` 开头；前端构建产物无 API Key | REV+DB | BE-3/BE-4 | S4-BE/S5-Test |
| AC-051 | T1/T2 | P0 | 员工 | **Given** 员工 A/B；**When** A 读/取消 B 的订单、改 B 地址、篡改 JWT；**Then** 前两者 404/403 且数据不变，篡改 token 401 `AUTH_TOKEN_INVALID` | API+DB | BE-4 | S4-BE/S5-Test |
| AC-052 | 全部 | P1 | 员工 | **Given** 375×812 / 768×1024 / 1440×900；**When** 打开菜单、详情、购物车、结算、我的订单；**Then** 无横向滚动，菜单 1/2/3 列，操作可达，截图留证 | SHOT | FE-1 | S4-FE/S5-产品 |
| AC-053 | T1 | P1 | 员工 | **Given** 菜单页；**When** 500ms 内连点 Add 10 次；**Then** 加购请求 ≤2 且购物车数量=成功请求数（无重复加购）；**When** 间隔 1s 点击 5 次；**Then** 数量=5；**And** 结算页连点提交 10 次仅 1 单（按钮禁用+幂等） | E2E+DB | FE-3/BE-2 | S4-FE/S5-Test |
| AC-054 | T1/T2 | P0 | 系统 | **Given** 订单含 ¥35.80 主菜 + ¥3.00 加料 ×2；**When** 计算并展示；**Then** API `totalCents=7760`（整数），页面 `¥77.60`，DB 为 BIGINT，全链路无 float/double；所有金额正则 `^¥\d+\.\d{2}$` | API+DB+REV | FE-4 | S4-BE/S4-FE/S5-Test |
| AC-055 | T1 | P0 | 员工 | **Given** 订单已创建（Kung Pao ¥22.00）；**When** 管理员改名为 `Kung Pao Chicken Deluxe`、改价 ¥25.00；**Then** 历史订单详情仍显示原名/¥22.00/原子项；新订单显示新值；DB 快照字段与 snapshot_json 均冻结 | API+DB | T1-ORDER | S4-BE/S5-Test |
| AC-056 | 全部 | P0 | 系统 | **Given** 全新环境按 README 启动；**When** 检查种子；**Then** 当日 ≥9 道 PRD 菜上架、库存 20~50、未来 1~2 天菜单存在；20 张图片文件映射且可访问；`admin@webox.com`/`employee@webox.com` 可登录；当天可直接完成 1 单 | API+DB+DOC | T1/T2 | S4-BE/S5-Test |
| AC-057 | 全部 | P1 | 员工/管理员 | **Given** 全部页面；**When** 扫描用户可见文案；**Then** 均为英文（无中文可见字符，菜单/错误/Toast/AI/看板一致），金额 `¥xx.xx` | E2E+REV | FE-4 | S4-FE/S5-产品 |
| AC-058 | 全部 | P1 | 运维 | **Given** 运行中系统；**When** GET `/api/v1/health`；**Then** 200 含 db（+redis 可选）状态；执行 `scripts/backup.sh` 后用备份恢复到临时库，核心表行数一致；告警阈值文档含 5xx>1%/5min、P95>1s、库存漂移>0 | API+DB+DOC | T1/T2 | S4-BE/S5-Test |
| AC-059 | 全部 | P2 | 架构 | **Given** 代码与配置；**When** 审查多实例兼容；**Then** JWT 无状态、无本地内存正确性依赖、幂等/限流/唯一性依赖 DB 唯一键或 Redis；双实例实跑记为 `N/A（时间盒，设计兼容）`，不得虚报 PASS | REV | BE-2/BE-4 | S5-产品/S5-Test |
| AC-060 | T2 | P2 | 系统 | **Given** Pending 单创建；**When** 30 分钟未确认（测试可注入时钟）；**Then** 定时任务置 Cancelled（reason=`TIMEOUT`），库存释放 1 次且仅 1 条 RELEASE；重复任务执行无二次回补；未实现则标 `NOT TESTED` | API+DB | T2-RULE | S4-BE/S5-Test |

### 4.1 G3 追加（2026-11-14 22:10 CST，产品工程师）

> 仅追加，**不改变 AC-001~060 任何语义**。来源：G1 测试评审 M8（`docs/review-findings.md`）+ `cross-review-g3-product.md`。

| ID | Tier | P | 角色 | Given-When-Then（可执行判定） | 验证 | 评分卡 | 阶段 |
|---|---|---|---|---|---|---|---|
| AC-061 | T1 | P0 | 访客 | **Given** 新邮箱未注册且系统仅 1 个种子 ADMIN；**When** POST `/api/v1/auth/register`，请求体额外携带 `role:"ADMIN"`（或 `"roles":["ADMIN"]`）；**Then** 二选一且仅需满足其一：① 400 `VALIDATION_ROLE`（严格拒绝未知/禁止字段），或 ② 201 但响应 `role="EMPLOYEE"`（字段被忽略）；**And** 两种情况 DB 中 ADMIN 用户数均不变，新用户角色必为 `EMPLOYEE`；**And** 响应/日志不含密码 | API+DB | T1-AUTH/BE-4 | S4-BE/S5-Test |

## 5. 覆盖统计与追溯

| 层级 | 条数 | 编号 | 门槛 |
|---|---|---|---|
| Tier 1 | 19 | AC-001~019 | 全部 P0/P1 端到端 |
| Tier 2 | 14 | AC-020~033 | 全部 P0/P1 端到端 |
| Tier 3 | 11 | AC-034~044 | 可选；未实现标 N/A |
| NFR/安全/不变量 | 16 | AC-045~060 | P0 必须 PASS（AC-059/060 可 N/A/NOT TESTED） |
| **合计** | **60** | AC-001~060 | Tier1/2 ≥45/50 |
| G3 追加 | 1 | AC-061（Tier1 P0，注册提权向量） | P0 必须 PASS；计入 Tier1（现 20 条） |

### 5.1 场景 required_check → AC

| 场景检查 | AC |
|---|---|
| TO-1 金额整数分/服务端重算 | AC-014、AC-016、AC-054 |
| TO-2 不超卖 | AC-035、AC-043 |
| TO-3 提交占用/只回补一次 | AC-014、AC-018、AC-019、AC-037、AC-060 |
| TO-4 幂等 | AC-015 |
| TO-5 唯一有效单 | AC-026、AC-027 |
| TO-6 状态机 | AC-019、AC-020、AC-060 |
| TO-7 截单/自动切换 | AC-024、AC-025 |
| TO-8 订单快照 | AC-055 |
| IA-1 密码哈希/无明文 | AC-001、AC-050 |
| IA-2 Console 403 | AC-028 |
| IA-3 角色矩阵 | AC-017、AC-028~033、AC-042 |
| IA-4 输入校验 | AC-003、AC-008、AC-048 |
| IA-5 限流/401/403 | AC-005、AC-049 |
| IA-6 审计 | AC-032、AC-018 |
| IA-7 横向越权 | AC-017、AC-051 |
| AI-1~6 | AC-038~041、AC-050 |
| GE-1~7 | AC-045~060、AC-056~058 |

### 5.2 评分卡 → AC

| 评分项 | AC |
|---|---|
| T1-AUTH / T1-MENU / T1-CART / T1-ORDER | AC-001~019 |
| T2-PREF / T2-RULE / T2-CONSOLE | AC-020~033 |
| T3-STOCK / T3-AI / T3-DASH | AC-034~044 |
| FE-1 响应式 | AC-052 |
| FE-2 分页/列表性能 | AC-006、AC-007、AC-022、AC-045 |
| FE-3 防抖/节流 | AC-053、AC-015 |
| FE-4 价格精度 | AC-006、AC-010、AC-011、AC-016、AC-054、AC-057 |
| FE-5 输入校验 | AC-003、AC-008、AC-029、AC-048 |
| BE-1 缓存 | AC-006、AC-030、AC-036、AC-043、AC-045 |
| BE-2 幂等 | AC-014、AC-015、AC-046、AC-053 |
| BE-3 SQL 注入防护 | AC-008、AC-047、AC-050 |
| BE-4 权限 | AC-005、AC-017、AC-028、AC-032、AC-033、AC-047、AC-049~051 |
| BE-5 并发/防超卖 | AC-018、AC-026、AC-035、AC-043、AC-046 |

## 6. 执行约定

1. 测试按 AC 编号建用例，结果回填 `PASS/FAIL/N/A/NOT TESTED` + 证据路径（`artifacts/` 下）。
2. P0 FAIL 直接进 `docs/defect-log.md`，按缺陷闭环回到 Stage 4 修复；GO 前无 open P0/P1。
3. 并发类 AC（015/035/043/046）必须保留原始输出与 DB 前后快照。
4. 截单类 AC（024/025/060）必须说明时钟注入方式；无固定时钟证据不得判 PASS。
5. Tier3 未实现：AC-034~044 一律 `N/A（Tier 3 未实现）`，不计分、不占门槛。