# 测试用例 — WeBox 企业员工餐食订购平台

- 版本：v1.0（Stage 2 Test Designer，2026-11-14 22:00 CST）
- 映射：`docs/acceptance-matrix.md` AC-001…AC-060（+ 建议 AC-061 提权用例 TC-084）
- 编号：TC-001…TC-086（TC-039a~g 为截单七边界）
- 结果取值：`PASS / FAIL / N/A / NOT TESTED`；本文只写用例，不预填结果。
- 约定：`$BASE`=`http://127.0.0.1:8080`；`H1`=`X-Test-Clock`；`IK`=`Idempotency-Key`；金额均为整数分。

## A. 认证与账号（AC-001~005）

| ID | AC | 层级 | 前置 | 步骤 | 期望 | 证据 |
|---|---|---|---|---|---|---|
| TC-001 | AC-001 | API+DB | 新邮箱 `u001_<runId>@test.com` 未注册 | `POST /api/v1/auth/register` body `{email,password:"Abc12345"}` | 201；`data.role=EMPLOYEE`；响应无 password；DB `password_hash` 以 `$2` 开头 | `api-auth.json` + `SELECT email,password_hash` |
| TC-002 | AC-002 | API+DB | TC-001 已注册 | 同邮箱再注册；再用 `U001_...@test.com` 大小写变体注册 | 两次均 409 `AUTH_EMAIL_EXISTS`；`SELECT count(*)` 用户数不变 | 响应 + 计数前后 |
| TC-003 | AC-003 | API | 无 | 依次提交：`bad-email`、`Abc123`（7 位）、`abcdefgh`（纯字母）、201 字符邮箱、`Abc12345`（合法） | 前四 400 且 code 分别 `VALIDATION_EMAIL_FORMAT`/`VALIDATION_PASSWORD_POLICY`/`VALIDATION_PASSWORD_POLICY`/`VALIDATION_EMAIL_LENGTH`；最后 201 | `api-validation.json` |
| TC-004 | AC-004 | API+E2E | 种子账号存在 | 员工正确密码登录 → 带 JWT `GET /auth/me` → 浏览器刷新 → 管理员登录 | 员工 200 + role=EMPLOYEE；`/auth/me` 200；刷新后仍登录；admin 200 + role=ADMIN | JWT 片段（脱敏）+ 刷新截图 |
| TC-005 | AC-005/049 | API | 账号存在 | 连续 10 次错误密码，第 11 次正确密码；统计响应时间 | 前 10 次 401 `AUTH_INVALID_CREDENTIALS`；第 11 次 429 `RATE_LIMITED`；正确登录（未限流账号）P95≤300ms | `api-auth.json` + 延迟数组 |
| TC-006 | AC-004 | E2E | 已登录 | 深链访问 `/orders`、`/console`（员工） | 会话保持；员工 `/console` 不渲染管理功能 | 截图 |

## B. 菜单、筛选、搜索、详情、选项（AC-006~010）

| ID | AC | 层级 | 前置 | 步骤 | 期望 | 证据 |
|---|---|---|---|---|---|---|
| TC-010 | AC-006 | API+E2E | 当日菜单 20 道 | `GET /menu?page=1&size=20`；再 `page=2` | 200；20 条；字段 id/name/imageUrl/priceCents(int)/priceDisplay(`^¥\d+\.\d{2}$`)/category/spiceLevel；`total≥9`；分页元数据正确 | `api-menu.json` |
| TC-011 | AC-006/048 | API | 同上 | `GET /menu?size=101`；`size=100`；`page=0` | 101→400 `VALIDATION_PAGINATION`；100→200；page=0→400 | 响应码 |
| TC-012 | AC-007 | API+DB | 含 Chinese/Japanese/Western | `category=Chinese,Japanese`；`category=Japanese,Western`；`category=Klingon` | 前两者仅返回并集，数量=DB `IN` 计数；非法分类 400 `VALIDATION_CATEGORY` | `api-menu.json` + DB 计数 |
| TC-013 | AC-008 | API | Kung Pao 描述含 chicken | 搜索 `CHICKEN`、`chicken`、`ChIcKeN` | 均命中名称或描述（大小写不敏感），结果集一致 | `api-menu.json` |
| TC-014 | AC-008/BE-3 | API | 同上 | 搜索 `' OR 1=1--`、`%`、`_`、`'; DROP TABLE dish;--` | 200；空或正常结果；无 5xx；响应不含 `SQL`/`syntax`/`java.`/`Exception` | `api-validation.json` + 响应原文 |
| TC-015 | AC-008/048 | API | 同上 | 搜索 50 字符（通过）与 51 字符 | 50→200；51→400 `VALIDATION_SEARCH_LENGTH` | 响应码 |
| TC-016 | AC-009 | API | Classic Beef Burger 在售 | `GET /menu/{id}` | description/protein/allergens（枚举内）/spiceLevel∈{None,Mild,Medium,Hot}；选项组 Bun(required, Plain/Whole Wheat)、Sauce(required)、Add-ons(optional, Cheese+300/Bacon+500/Egg+200 分)；价格整数分 | `api-menu.json` |
| TC-017 | AC-010 | API+E2E | Burger 3800 分 | 选 Whole Wheat + Mustard + Cheese(+300)：`POST /orders/preview` 携带选项；前端查看价格 | `totalCents` 含加价；预计 4100；页面显示 `¥41.00` | preview JSON + 截图 |
| TC-018 | AC-010 | API | 同上 | 提交其他菜品的 optionId；缺失必选 Bun | 400 `VALIDATION_OPTION_INVALID`；400 `VALIDATION_OPTION_REQUIRED` | 响应码 |

## C. 购物车（AC-011~012，前端存储 + preview 校验）

| ID | AC | 层级 | 前置 | 步骤 | 期望 | 证据 |
|---|---|---|---|---|---|---|
| TC-023 | AC-011 | E2E+preview | 空购物车 | 同菜同配置加购 2 次；同菜不同配置加购 1 次；用同一 cart payload 调 `/orders/preview` | 购物车 2 行（A×2、B×1）；每行显示选项名；总价=Σ(单价+加价)×数量（分），无浮点尾差 | 截图 + preview 金额 |
| TC-024 | AC-012 | E2E | 2 行购物车 | 第 1 行 `+`、`−`、删除第 2 行；减到 0；清空 | 数量/总价实时正确；0 移除该行；空态且总价 `¥0.00` | 步骤截图 4 张 |
| TC-025 | AC-012 | E2E | 有购物车 | 刷新页面；关闭再打开标签页 | 购物车仍在（localStorage），金额一致 | 截图 |

## D. 下单、详情、取消（AC-013~019）

| ID | AC | 层级 | 前置 | 步骤 | 期望 | 证据 |
|---|---|---|---|---|---|---|
| TC-029 | AC-013 | API+E2E | 登录、购物车 2 份 | `POST /orders/preview`（cart payload）；地址 201 字符 | 返回明细（名/选项/数量/小计/总价 cents）、`effectiveDate`（默认今日）、`effectiveMeal`、`cutoffAt`、`autoSwitched`、`budgetExceeded`、地址簿；地址 201→400 `VALIDATION_ADDRESS_LENGTH` | `api-orders.json` |
| TC-030 | AC-014 | API+DB | 有效购物车+地址+IK | `POST /orders`，body 只含 dishId/qty/optionIds | 201；`orderNo ^WB\d{8}-\d{4,}$`；status=Pending；`totalCents` 服务端重算；明细含 dishName/unitPriceCents/options/qty/subtotal；`snapshot_json` 非空；库存 `reserved+qty`；ledger 恰 1 条 RESERVE | 响应 + DB 快照 + ledger 行 |
| TC-031 | AC-016 | API+DB | DB 单价 2200 | 请求体附带 `priceCents=1`；再在管理员改价 2500 后下单新用户 | 伪造字段被忽略（或 400）；订单 total=DB 实时价×qty；客户端 total 不参与 | 响应 + DB total |
| TC-032 | AC-017 | API+DB | 员工 A 2 单、B 1 单 | A `GET /orders`；A `GET /orders/{B_id}` | 列表仅 A 的 2 单倒序；B 的单 404 `ORDER_NOT_FOUND`（或 403）；详情字段完整 | `api-authz.json` |
| TC-033 | AC-015 | API+DB | 新用户、IK=K1 | 串行提交 K1 两次（同 body），再第 3 次 | 3 次响应同一 orderId；DB 仅 1 单；库存只扣 1 次；ledger 1 条 RESERVE | 3 次响应 + 计数 |
| TC-034 | AC-015 | 并发+DB | 新用户、IK=K1 | 5 个并发同 K1 同 body + 2 个串行；随后同 K1 改 qty | 7 次同一 orderId；DB 1 单；改 qty → 409 `IDEMPOTENCY_CONFLICT`；缺 IK → 400 `IDEMPOTENCY_KEY_REQUIRED` | `conc-idem.json` + DB |
| TC-035 | AC-015/047 | API | 新用户 | 缺 `Idempotency-Key`；IK 长度 7/8/64/65 | 缺失 400；7/65→400；8/64→201 | 响应码 |
| TC-036 | AC-018/BE-5 | API+DB | Pending 单含 2 份、available=10 | 取消一次；再取消一次；查 ledger | 第 1 次 200 + Cancelled + cancelledAt；available=12；ledger 1 条 RELEASE；第 2 次 409 `ORDER_STATE_INVALID`；available 仍 12，无第 2 条 RELEASE | DB 前后 + ledger |
| TC-037 | AC-019 | API+DB | 订单 Confirmed（H4 置态） | 员工取消；管理员取消 | 均 409 `ORDER_STATE_INVALID`；状态与库存不变；审计记录尝试（若实现） | 响应 + DB |

## E. 规则：数量上限、截单、超时、偏好、唯一单（AC-020~027）

| ID | AC | 层级 | 前置 | 步骤 | 期望 | 证据 |
|---|---|---|---|---|---|---|
| TC-038 | AC-020 | E2E+API | 购物车 4 份 | 加第 5 份（允许）；再加第 6 份；API 直接提交 6 份；3+3 组合；5 份提交 | 第 6 次 Add/`+` 禁用并英文提示；6 份 API→400 `ORDER_LIMIT_EXCEEDED`；3+3 同样 400；5 份 201 | 截图 + 响应码 |
| TC-039a | AC-024 | API+U | H1=09:59:59 | 提交当日 Lunch | 生成当日 Lunch；`autoSwitched=false` | 响应 + 日志 |
| TC-039b | AC-024 | API+U | H1=10:00:00 | 提交当日 Lunch | 等于截单点即关闭 → 当日 Dinner；`autoSwitched=true`；响应 `effectiveMeal=DINNER` | 同上 |
| TC-039c | AC-024 | API+U | H1=10:01:00 | 提交当日 Lunch | 当日 Dinner；`autoSwitched=true` | 同上 |
| TC-039d | AC-025 | API+U | H1=14:59:59 | 提交当日 Dinner | 当日 Dinner；不切换 | 同上 |
| TC-039e | AC-025 | API+U | H1=15:00:00 | 提交当日 Dinner | 次日 Lunch；`autoSwitched=true` | 同上 |
| TC-039f | AC-025 | API+U | H1=15:01:00 | 提交当日 Dinner | 次日 Lunch；`autoSwitched=true` | 同上 |
| TC-039g | AC-025 | API+U | H1=16:00:00、次日菜单已发布 | 提交次日 Lunch；再提交过去日期 | 次日 Lunch 正常 201；过去日期 400 `VALIDATION_DATE_PAST` | 同上 |
| TC-040 | AC-060 | API+DB | Pending 单 | **H1 对 `@Scheduled` 线程无效**（backend-design:428）：优先调 test profile `POST /admin/orders/{id}/expire`；否则 `UPDATE orders SET created_at=created_at-INTERVAL 31 MINUTE WHERE id=?` 后等 ≤60s tick；重复触发 2 次 | 状态 Cancelled、reason=TIMEOUT；ledger 仅 1 条 RELEASE；available 只加一次；重复任务无二次回补；`active_key IS NULL` | SQL 前后 + ledger + 调度日志 |
| TC-041 | AC-021 | E2E+API | 用户过敏原=Egg | 加购 Korean Bibimbap；确认弹窗；搜索 Egg 相关菜 | 弹窗含 `allergen` 与 `Egg`；确认后入车；菜单/搜索仍可见；API 下单不阻断；无过敏原用户无弹窗 | 截图 + 响应 |
| TC-042 | AC-022 | API+E2E | 偏好 Japanese/Mild | 开 `For You`；关闭 | 开启时匹配菜靠前且有高亮，非匹配仍展示；关闭恢复默认稳定序；两次集合相同 | 两种顺序 JSON 对比 |
| TC-043 | AC-023 | API+E2E | 预算上限 1500 分 | 购物车 2200 分进结算；下单；未设预算用户对照 | `budgetExceeded=true` 且页面英文提示；仍 201；未设/未超无提示 | preview + 截图 |
| TC-044 | AC-026 | API+E2E+DB | 已有当日 Lunch Pending | 重新加载结算页；直接 POST 同日同餐次 | 按钮变 `View Existing Order` 并跳转；POST→409 `ORDER_DUPLICATE` + `data.existingOrderId`；订单数不变、库存不扣 | 截图 + 响应 + DB |
| TC-045 | AC-027 | API+DB | 已有当日 Lunch 单 | 下单当日 Dinner；下单次日 Lunch | 均 201；库存按各自餐次扣减 | 响应 + DB |
| TC-046 | AC-027 | API+DB | 当日 Lunch 单 | 取消 Lunch 单→再下同日 Lunch | 取消后 201；新建单 status=Pending；旧单 Cancelled 不占唯一键 | 响应 + DB |

## F. Console 与权限（AC-028~033）

| ID | AC | 层级 | 前置 | 步骤 | 期望 | 证据 |
|---|---|---|---|---|---|---|
| TC-047 | AC-028 | API | 员工 JWT / 管理员 JWT / 无 JWT | 员工 `GET /admin/dishes`；管理员同请求；无 JWT 调 `/menu` 与 `/admin/dishes` | 员工 403 `FORBIDDEN`；管理员 200；无 JWT 401 `AUTH_UNAUTHORIZED` | `api-authz.json` |
| TC-048 | AC-028 | E2E | 员工登录 | 访问 `/console` | 路由不渲染管理功能（重定向/无权限页），不能通过 UI 调用 | 截图 |
| TC-049 | AC-029 | API+E2E | 管理员 | 新增菜（jpg 1MB）、按名搜索、按分类筛选、编辑描述/过敏原；上传 6MB、txt | 列表与员工端同步；>5MB/非图片 400 `VALIDATION_IMAGE`；无图显示占位图 | 截图 + 响应 |
| TC-050 | AC-030/BE-1 | API+DB+E2E | 菜 ON_SHELF | 下架→员工列表/详情；上架→再查；记录写后可见时间 | 下架后列表不含、详情 404；上架恢复；写后 ≤1s 读到新值 | 时间戳 + 响应 |
| TC-051 | AC-031 | API+DB+E2E | 管理员 | 设当日菜单 `total_qty=30`、次日菜单；设 `total_qty=0`；改库存 | 当日/次日出现且剩余正确；0 显示 `Sold out` 不可下单；未配置日期不出现 | 截图 + DB |
| TC-052 | AC-032 | API+DB | 菜价 2200 | 改价缺 reason/confirm；带 confirm+reason 改 2500；回滚 2200 | 缺参 400 `VALIDATION_REASON_REQUIRED`；成功 200；audit_log 2 条含 actor/action/object/before/after/reason/ip/time；当前价 2200 | 响应 + audit 查询 |
| TC-053 | AC-033 | API+REV | 管理员有订单；员工有地址 | 管理员订单列表 vs 详情；员工查本人地址；grep 全部响应 | 列表地址脱敏、详情完整；员工仅本人完整；无 password_hash/token/Authorization | 响应 + grep 输出 |

## G. Tier 3：库存、并发、SSE、AI、看板、对账（AC-034~044）

| ID | AC | 层级 | 前置 | 步骤 | 期望 | 证据 |
|---|---|---|---|---|---|---|
| TC-057 | AC-034 | API+E2E+截图 | H3 设库存 3 与 0 | 看菜单（首屏，SSE 前）；等 `snapshot` 到达后再看；对 0 库存菜提交 | 首屏菜单 `available` 为 boolean、`lowStock=true` 且显示 `Low stock`（**不得虚构数字**）；`snapshot` 后显示 `Only 3 left`；0 库存 `soldOut=true`、Add 禁用；提交 → 409 `STOCK_INSUFFICIENT` + dishId/requested/available(int) | 截图（首屏+SSE 后）+ 响应 |
| TC-058 | AC-035 | 并发+DB | H3 设 available=10；50 个不同用户 JWT | Promise.all 50 个 `POST /orders` 各 1 份 | 恰 10 个 201、40 个 409 `STOCK_INSUFFICIENT`；DB `available=0`；`reserved+sold≤total`；无负值；ledger 汇总与库存一致 | `conc-order.json` + 前置/后置 SQL |
| TC-059 | AC-036 | API+E2E | A/B 两客户端打开菜单 | A 下单 1 份；B 监听 `/menu/stream`；断网 5s 后恢复；关闭 SSE 走轮询 | B ≤2s 收到 `{dishId,available}`；5s 内重连；SSE 不可用时 5s 轮询仍更新 | 事件日志 + 截图 |
| TC-060 | AC-037 | API+E2E+DB | 菜 available=7，Pending 单含 1 份 | 取消；另一客户端监听；库存改 0 后取消另一单 | available=8；≤2s 推送；售罄菜恢复为 1 后 Add 可用 | 事件 + DB |
| TC-061 | AC-038/AI-1 | API+DB | 用户过敏 Egg、昨日点 Bibimbap、菜 X 售罄；构造模型返回越界 dishId | 调 AI 推荐（规则模式或 mock LLM） | 响应 dishIds 不含含 Egg 菜、Bibimbap、售罄菜；候选集外 dishId 被丢弃；价格取 DB | 响应 + 候选集 SQL |
| TC-062 | AC-039 | API+E2E | 有 Key（或 mock SSE） | 输入 `I want something light today` | 事件顺序 `meta→dish→reason→done`；首事件≤3s、总≤20s；卡片可加购 201；断网重试有明确错误/降级 | `ai-sse.log` + 截图 |
| TC-063 | AC-040 | API+E2E | `LLM_API_KEY` 未设置、重启后端 | 请求 AI 推荐 | 200 SSE `fallback:true`；页面标注 `rule-based fallback`；返回过滤后候选；无 500/白屏 | SSE 原文 + 截图 |
| TC-064 | AC-041 | API+DB+REV | 管理员 | 读规则权重 spice=1 → 改 3 保存 → ≤60s 观察 → 回滚；grep Key | ≤60s 生效无需重启；回滚恢复；`ai_conversation` 有 user/prompt/response/dishes；源码/DB/日志/前端包无 Key | 前后响应 + grep |
| TC-065 | AC-042 | API+DB+E2E | 今日有订单 | 打开看板刷新；再下 1 单后刷新 | 订单数/收入/Completed/Pending/Cancelled 与 DB 聚合一致；Top10 按销量降序；Lunch/Dinner；7 天 7 点；低库存 ≤3 一致；新增单后 +1 | 看板截图 + SQL 聚合 |
| TC-066 | AC-043 | 并发+REV | 菜 A=`DB_ATOMIC`、菜 B=`REDIS_PREALLOC` | 分别并发下单至库存耗尽；停 Redis 后对 B 下单 | 两者成功数=库存数、无超卖；Redis 停后 B 仍正确（降级 DB），无 500；DB 为最终账本 | 并发输出 + `redis-cli shutdown` 证据 |
| TC-067 | AC-044 | API+DB | 完成下单/取消/确认 | 调对账；用 SQL 制造 1 份差异；补偿后再对账 | 初始 `drift=0`；制造后 `drift=1` 且告警/审计；`ADJUST` 补偿（含原因）后归零 | 对账 JSON + ledger |

## H. NFR、安全与不变量（AC-045~060）

| ID | AC | 层级 | 前置 | 步骤 | 期望 | 证据 |
|---|---|---|---|---|---|---|
| TC-068 | AC-045 | 性能 | 50 道菜+预热 | 50 QPS×60s 菜单/筛选/搜索；详情 20 QPS；管理端改菜后读 | 列表 P95≤200ms（命中≤100ms）、搜索≤250ms、详情≤150ms、5xx=0；改后 ≤1s 新值 | `perf-menu.json` |
| TC-069 | AC-046 | 性能+DB | 200 用户、库存充足 | 10 QPS×60s 下单（不同用户+IK） | P95≤500ms；5xx=0；订单数=成功响应数；库存守恒 | `perf-order.json` + DB |
| TC-070 | AC-047 | API | 构造 400/401/403/404/409/429/500 | 逐一触发并检查 body/header | 均 `{code,message,data,requestId}`；HTTP 与 code 段匹配；无堆栈/SQL/密钥 | `api-error.json` |
| TC-071 | AC-048 | API | 无 | email 200/201、address 200/201、search 50/51、reason 200/201、password 64/65 | 超长 400 且 `data.field` 指向；边界值通过 | `api-validation.json` |
| TC-072 | AC-049 | API | 独立用户 | 下单 6 次/分；AI 11 次/分 | 超限 429 `RATE_LIMITED`；未超限正常 | 响应码序列 |
| TC-073 | AC-050 | REV+DB | 全仓+运行中 | `grep -rniE "password.*=.*['\"]|authorization.*log|LLM_API_KEY" backend frontend`；查 DB 哈希；扫前端 dist | 无明文密码/Authorization 日志/Key；DB `$2` 前缀；dist 无 Key | `security-grep.txt` |
| TC-074 | AC-051 | API+DB | A/B 员工；B 的订单 | A 读/取消 B 单；A 改 B 地址；篡改 JWT 签名 | 读/取消 404 或 403，B 数据不变；篡改 token 401 `AUTH_TOKEN_INVALID` | 响应 + DB 前后 |
| TC-075 | AC-052 | E2E+截图 | 前端运行 | 375×812、768×1024、1440×900 遍历菜单/详情/购物车/结算/我的订单 | `scrollWidth ≤ innerWidth+1`；菜单列 1/2/3；操作可达 | 9~15 张截图 |
| TC-076 | AC-053 | E2E+DB | 菜单页/结算页 | 500ms 内点 Add 10 次；间隔 1s 点 5 次；结算连点 Submit 10 次 | 加购请求 ≤2 且购物车数量=成功数；1s×5 数量=5；提交仅 1 单 | 网络日志 + DB |
| TC-077 | AC-054 | API+DB+REV | 主菜 3580 分 + 加料 300×2 | 提交并查 DB/页面；grep float/double | `totalCents=7760`；页面 `¥77.60`；DB BIGINT；无 float/double；全部金额 `^¥\d+\.\d{2}$` | 响应 + DB + grep |
| TC-078 | AC-055 | API+DB | 已创建 Kung Pao 订单 | 管理员改名/改价 → 查历史单 → 下新单 | 历史单仍原名/2200/原子项，snapshot_json 冻结；新单新值 | 两次响应 + DB |
| TC-079 | AC-056 | API+DB+DOC | 全新库按 README 启动 | 查健康、菜单、图片、账号、下单 1 次 | 当日 20 道（≥9 PRD 菜）上架、库存 20~50、未来 1~2 天存在；20 图 200；两账号可登录；当天可下单 | `health.json` + 清单 |
| TC-080 | AC-057 | E2E+REV | 全页面 | 扫描可见文本（含错误/Toast/AI/看板） | 无中文可见字符；金额 `¥xx.xx` | `zh-scan.txt` + 截图 |
| TC-081 | AC-058 | API+DB+DOC | 运行中 | `GET /health`；跑 `scripts/backup.sh` 恢复到临时库；查告警文档 | 200 含 db（redis 可选）；核心表行数一致；文档含 5xx>1%/5min、P95>1s、漂移>0 | 命令输出 |
| TC-082 | AC-042 补充 | 审查 | 代码/配置 | 审查无状态、无本地内存正确性依赖 | 幂等/限流/唯一性依赖 DB 唯一键或 Redis | 代码引用 |
| TC-083 | AC-059 | 审查 | 代码/配置 | 多实例兼容审查 | PASS/N/A（时间盒，设计兼容），不得虚报双实例 PASS | `design-review.md` |
| TC-084 | AC-061（建议） | API+DB | 新邮箱 | 注册 body 带 `role:"ADMIN"` | 400 `VALIDATION_ROLE` 或强制 EMPLOYEE；DB 无新增 ADMIN | 响应 + 角色计数 |
| TC-085 | 全链路 | E2E | 种子+员工账号 | 登录→筛选→搜索→详情→加购→结算→下单→我的订单→详情→取消→库存恢复 | 全流程 ≤3 分钟；每步断言关键字段；截图留证 | 视频/截图序列 |
| TC-086 | AC-058（DOC/GE-6） | 审查 | 仓库 | 检查 README/API/架构/测试/`ai-conversations/` | 文件存在非空；AI 对话为原生导出（非截图/摘要） | 文件清单 |

## J. G3 回写新增用例（2026-11-14 22:13）

| ID | AC | 层级 | 前置 | 步骤 | 期望 | 证据 |
|---|---|---|---|---|---|---|
| TC-010b | AC-006/034 | API | 当日菜单 | `GET /menu`；`GET /menu/{id}`；`GET /menu/stream` snapshot；`GET /admin/daily-menu` | 菜单/详情 `available` 为 JSON **boolean**、`lowStock`/`soldOut` boolean；SSE `snapshot/stock` 与 Console `available` 为 **int**；若契约后期统一为 `availableQty:int`，则断言该字段且菜单无 boolean 歧义 | 4 份响应原文 + 类型断言脚本输出 |
| TC-029b | AC-013/034 | API | 菜 B 库存 0 | `POST /orders/preview` 含 B；随后 `POST /orders` 含 B | preview **200**，含明细/总额/effectiveMeal/cutoffAt，**不含** `STOCK_INSUFFICIENT`、不锁库存；submit 409 `STOCK_INSUFFICIENT` | 两次响应 + DB 库存不变 |
| TC-034b | AC-015 | 并发+DB | 新用户、IK=K1 | 并发 5 + 串行 2 同键同体；再同键异体；再注入 5xx（停 DB/杀连接）后同键重试 | 前 7 次 1 单；`idempotency_records` 该 `(user_id,key)` 恰 1 行 `status='COMPLETED'`；异体 409 快照含 `ORDER_DUPLICATE+existingOrderId`；5xx 后 `status='FAILED'`，重试成功且仍 1 单 | `conc-idem.json` + `SELECT user_id,idempotency_key,status,response_snapshot` |
| TC-036b | AC-018/AC-027 | API+DB | Pending 单 2 份 | 取消后查 `active_key`/索引/ledger；再完成一单同查；跑对账 SQL | `active_key IS NULL`；`SHOW INDEX FROM orders` 含 `uk_orders_active`；ledger `business_key` 唯一、`before_available-after_available=qty`；对账 `drift=0`；`ADJUST` 不重复计入 | `SHOW INDEX` + ledger 行 + reconcile JSON |
| TC-037b | AC-019/AC-032 | API+DB | 管理员；Pending/Confirmed/Completed 各 1 单 | #24 合法迁移 3 条；非法迁移（Confirmed→Cancelled、Completed→Confirmed、Cancelled→Any）；缺 reason；员工取消不带 reason | 合法 200 且审计 1 条/次；非法 409 `ORDER_STATE_INVALID`；缺 reason 400 `VALIDATION_REASON_REQUIRED`；员工取消无 reason 200，管理员缺 reason 400（G2-BE-M8） | 响应矩阵 + `audit_log` + 订单状态 |
| TC-059b | AC-036 | API+SSE | 登录 | `POST /menu/stream-ticket` → 兑换 1/2/3 次；第 4 次；另取 ticket 等 >60s 再兑换；查事件 data | 1~3 次 200；第 4 次 401；过期 401；事件 data 仅 `dishId`+`available`（无 name/priceCents）；`retry:3000`；15s 心跳 `: ping` | ticket 响应 + SSE 原文 + 时间戳 |

## I. 用例统计

| 分组 | 数量 | 覆盖 AC |
|---|---|---|
| 认证 | 6 | AC-001~005 |
| 菜单/购物车 | 13（+TC-010b） | AC-006~012 |
| 下单/取消 | 13（+TC-029b/034b/036b/037b） | AC-013~019 |
| 规则/偏好 | 15（含 TC-039a~g） | AC-020~027、AC-060 |
| Console/权限 | 7 | AC-028~033 |
| Tier3 | 12（+TC-059b） | AC-034~044 |
| NFR/安全 | 16 | AC-045~059 |
| 补充（提权/全链路/文档） | 3 | AC-061、GE-6、全链路 |
| **合计** | **85 个编号（TC-039a~g 计 7）** | **AC 60/60 + 建议 AC-061** |

> G3 回写：TC-040（超时触发方式）、TC-057（available 类型/首屏不虚构数字）已按冻结契约修订；新增 6 条用例覆盖 G3T-M1~M6/M9 口径。