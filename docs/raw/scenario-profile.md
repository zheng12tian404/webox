# Scenario Profile — WeBox 企业员工餐食订购平台

- 版本：**v2（Stage 1 产品工程师细化，2026-11-14 21:52 CST）**
- 上一版：v1（Dispatcher T0 初判）
- PRD：`docs/PRD.md`（V3.0 全栈合并版）
- 场景库：`/home/gem/code/req-squad/scenario-library/profiles/`
- 配套：`docs/prd-analysis.md`、`docs/acceptance-matrix.md`、`docs/assumptions.md`

## 0. v2 变更摘要

1. 确认 v1 的 active_profiles 选择，不新增、不降级：`general-engineering`（默认）、`transaction-order`（主）、`identity-access`（次）、`ai-llm`（次，Tier 3，ASSUMED）。
2. 每个 profile 的 `required_checks` 逐条映射到 AC 编号（`AC-001…AC-060`），并补充**失败模式**、**边界值**与**证据类型**。
3. 明确 Tier 3 / 外部依赖项的 `N/A` 条件，禁止虚报 PASS。
4. 运行时证据统一在 Stage 5 采集；Stage 1 只对“映射完整性”负责，不对“运行时 PASS”负责。

## 1. active_profiles 确认

| Profile | 角色 | 加载依据 | 确定性 | 不做的后果 |
|---|---|---|---|---|
| `general-engineering` | 基础（全场景） | 全栈可运行、种子数据、文档、语言、证据 | CONFIRMED | 整体 GO 直接失败 |
| `transaction-order` | **主场景** | 下单/购物车/库存/截单/取消/金额/唯一单/幂等 | CONFIRMED | Tier1 下单归零，P6+ 幂等/并发归零 |
| `identity-access` | 次场景 | 员工/管理员双角色、Console 隔离、审计、横向越权 | CONFIRMED | 权限项归零，安全门禁失败 |
| `ai-llm` | 次场景（Tier 3 可选） | AI 选餐、LLM 理由、SSE、降级 | **ASSUMED**（Tier 3 加分项；未实现不阻塞 Tier1/2） | 仅 Tier3 +AI 3 分与 AI 项证据缺失；不得虚报 |

**未加载（维持 v1 判断）**

| Profile | 不加载理由 | 替代处理 |
|---|---|---|
| `workflow-approval` | PRD 未要求审批流；高风险操作仅需 `confirm + reason + audit`（RUNBOOK D16） | 归入 identity-access + AC-032 |
| `realtime-collaboration` | 实时项仅为库存推送，无多人协作编辑 | 归入 transaction-order + AC-036（SSE） |
| `reporting-analytics` | 看板为单管理员只读聚合，非分析平台 | 归入 general + AC-042 |
| `search-ranking` | 关键词子串搜索 + 偏好软排序，无搜索引擎 | 归入 general + transaction-order + AC-008/AC-022 |
| `file-media` | 图片仅上传/静态存储，无转码/CDN | 归入 general + AC-029 |
| `notification` | 无站外通知/邮件要求 | 不加载；站内 toast 归入 general |

## 2. transaction-order（主场景）— required_checks → AC 映射

### 2.1 不变量映射

| # | required_check（v1） | 可执行判定 | AC | 失败模式（必须被捕获） | 证据类型 |
|---|---|---|---|---|---|
| TO-1 | 金额全程整数分，服务端按 DB 单价+选项加价重算 | API 响应金额字段均为整数；篡改客户端价格不生效；订单 total=Σ(unit+options)×qty | AC-014、AC-016、AC-054 | 浮点 0.1+0.2、客户端算价、DB DECIMAL 回传浮点 | API+DB 断言+代码审查 |
| TO-2 | `available = total-reserved-sold >= 0`，任何路径不得为负 | 并发抢购后 DB `available>=0`；`reserved+sold<=total` | AC-035、AC-043 | 先查后改、无 `WHERE available>=n`、Redis 扣减不同步 DB | 并发脚本+DB 断言 |
| TO-3 | 提交才占用库存；取消/超时只释放一次 | 加购不扣库存；取消后 `ledger` 仅 1 条 RELEASE；重复取消无第二次回补 | AC-018、AC-019、AC-037、AC-060 | 取消重复回补、加购即扣、超时不释放 | DB 断言+API |
| TO-4 | 下单幂等：同 Key 1 单；同键异体 409 | 同 Key 并发/串行 3 次 = 1 行订单；异体 409 `IDEMPOTENCY_CONFLICT` | AC-015 | 无唯一约束、仅前端 disabled、异体覆盖 | 并发脚本+DB |
| TO-5 | 同用户+配送日+餐次唯一有效单（Pending/Confirmed） | 第二次提交 409 `ORDER_DUPLICATE`+`existingOrderId`；取消后可再下 | AC-026、AC-027 | 先查后插竞态、无生成列唯一索引、Cancelled 占位 | API+DB |
| TO-6 | 状态机仅 Pending→Confirmed→Completed、Pending→Cancelled | 非法迁移 409 `ORDER_STATE_INVALID`；Confirmed 不可取消 | AC-019、AC-060 | 任意状态可取消、Completed 回退 | API+DB |
| TO-7 | 截单由服务端时钟（Asia/Shanghai）判定，边界明确，过点自动切最近餐次 | 09:59:59/10:00:00/10:01、14:59:59/15:00:00/15:01 六边界；跨日切换 | AC-024、AC-025 | 前端判截单、时区 UTC、等于截单点仍放行 | API（注入 Clock）+单测 |
| TO-8 | 订单快照：名称/单价/选项/加价/小计创建时冻结 | 下单后改价改名，历史订单金额/名称不变 | AC-055、AC-014 | 订单只存 dish_id、详情页实时查价 | API+DB |
| TO-9 | 每单总份数 ≤5（总份数非品种数） | 第 6 份：按钮禁用+API 400 `ORDER_LIMIT_EXCEEDED` | AC-020 | 按品种数限制、仅前端限制 | E2E+API |
| TO-10 | 仅 Pending 可由员工取消；取消后库存恢复 | 员工取消 Confirmed 409；取消 Pending 后 available 增加 | AC-018、AC-019、AC-037 | 管理员代取消 Confirmed、不回补 | API+DB |

### 2.2 必须出现的证据（Stage 5 采集）

| 证据 | 对应 AC | 采集方式 |
|---|---|---|
| 并发下单（N=50 抢 K=10）成功单数=K，`available>=0` | AC-035 | `tests/concurrency/order_race.*` + SQL 断言 |
| 同幂等键并发/串行只 1 单；异体 409 | AC-015 | 并发脚本 + `SELECT count(*)` |
| 取消两次只回补一次，`sold+reserved` 与 ledger 对账一致 | AC-018、AC-044 | API 调用 + ledger 汇总 SQL |
| 截单六边界（含跨日） | AC-024、AC-025 | JUnit 固定 Clock + 接口验证 |
| 含加料订单合计 = Σ(单价+加价)×数量（分） | AC-014、AC-016 | API 断言 + DB 快照 |
| 同日同餐次第二单被拒/返回已有单；跨餐次/跨日允许 | AC-026、AC-027 | API |
| 两种库存模式各 ≥1 菜品且 DB 为最终账本 | AC-043 | 配置查询 + 并发/断电降级验证 |

### 2.3 红旗（评审一票否决候选）

先查后改扣库存、浮点/`double` 金额、客户端 total 参与结算、无唯一约束、无幂等键、取消不回补/重复回补、事务内调 LLM/外部服务、Redis 当唯一账本、订单只存 dish_id 不存快照。

## 3. identity-access（次场景）— required_checks → AC 映射

| # | required_check | 可执行判定 | AC | 失败模式 | 证据类型 |
|---|---|---|---|---|---|
| IA-1 | 密码 BCrypt/同等级哈希，无明文 | DB 哈希前缀 `$2`；日志/响应/文档 grep 无明文 | AC-001、AC-050 | MD5/明文、注册响应回显密码 | DB+代码/日志审查 |
| IA-2 | JWT 认证 + URL/方法级授权双层，员工访问 Console 必须 403 | 员工 token 调 `/api/v1/admin/**` → 403 `FORBIDDEN`，非前端隐藏 | AC-028 | 仅前端隐藏菜单、只做 URL 前缀不校验角色 | API+E2E |
| IA-3 | 角色矩阵覆盖菜单/下单/订单/Console 菜品/库存/看板 | 矩阵逐项验证（见 prd-analysis §3） | AC-017、AC-028~AC-033、AC-042 | 员工可读他人订单、可改菜品 | API |
| IA-4 | 输入校验（邮箱/密码/搜索/地址）后端为准 | 超长/格式错 400；密码 7 位拒绝、8 位含字母数字通过 | AC-003、AC-008、AC-048 | 仅前端 maxlength、SQL 特殊字符报 500 | API |
| IA-5 | 登录失败限流；401/403 区分 | 1 分钟内第 11 次 429 `RATE_LIMITED`；未登录 401、无权限 403 | AC-005、AC-049 | 401/403 混用、无限流 | API |
| IA-6 | 高风险操作写 `audit_log`（谁/何时/什么/前后值/原因/IP） | 改价/上下架/改库存/取消均有审计行；缺原因 400 | AC-032、AC-019 | 无审计、审计无前后值、可删除审计 | DB+API |
| IA-7 | 数据范围：员工仅本人订单；横向越权 403/404 | A 读/取消 B 订单 → 404/403，且 B 数据不变 | AC-017、AC-051 | 仅按 orderId 查询、越权可取消 | API+DB |

**必须证据**：员工 token 调 `/api/v1/admin/dishes` 403；员工读他人订单 403/404；`audit_log` 含改价/上下架/改库存/取消记录（前后值与原因）；密码哈希前缀 `$2`；无明文密码。

## 4. ai-llm（Tier 3，ASSUMED）— required_checks → AC 映射

| # | required_check | 可执行判定 | AC | 失败模式 | 证据类型 |
|---|---|---|---|---|---|
| AI-1 | 候选集由确定性代码先过滤：上架+当日有库存+排除过敏原+排除近 7 天已点 | 构造过敏原/售罄/近 7 天数据，响应 dishIds 全部在过滤后集合 | AC-038 | 让模型自由选菜、只过滤售罄 | API+DB |
| AI-2 | 模型不得决定价格/库存/权限；dishId 必须存在且在候选集 | 注入不存在/越权 dishId → 被丢弃；加购按 DB 价 | AC-038、AC-039 | 直接渲染模型文本、按模型价下单 | API+代码审查 |
| AI-3 | 无 Key/超时/限流降级规则推荐并标注，不得 500 | 无 `LLM_API_KEY` → 200 SSE `fallback:true` + `rule-based fallback` | AC-040 | 500/空白页、静默失败 | API+E2E |
| AI-4 | SSE 流式；首 token ≤3s、总超时 ≤20s | 事件时序 `meta→dish→reason→done`；计时断言 | AC-039 | 一次性返回、无超时、阻塞连接 | API+E2E |
| AI-5 | 规则配置化、可热更新与回滚；多轮会话可追溯 | 改权重 ≤60s 生效；回滚恢复；`ai_conversation` 落库 | AC-041 | 硬编码权重、无版本、无会话记录 | API+DB |
| AI-6 | Key 仅环境变量，不入库/日志/前端包 | grep 源码/构建产物/日志无 Key；DB 无 Key 字段 | AC-041、AC-050 | Key 写 yml/前端、日志打印 Authorization | 代码/构建/DB 审查 |

**N/A 规则**：若 Tier 3 未实现，AI-1~AI-6 在 Stage 5 一律记 `N/A（Tier 3 未实现）`，Tier 3 加分为 0；**不得**记 PASS。若实现但无真实 Key，AI-3 可 PASS（降级），AI-4/5 用规则模式验证，真实 LLM 质量记 `NOT TESTED`。

## 5. general-engineering — required_checks → AC 映射

| # | required_check | 可执行判定 | AC | 失败模式 | 证据 |
|---|---|---|---|---|---|
| GE-1 | 前后端可构建启动，README 含 JDK17+Spring Boot+MySQL（Redis 可选） | 干净环境按 README ≤15 分钟启动；`/api/v1/health` 200 | AC-058、AC-056 | 依赖 H2/SQLite、README 缺步骤、必须手动改配置 | 命令输出+截图 |
| GE-2 | 种子数据：当日菜单/库存/管理员/员工，当天可直接下单 | 9 道 PRD 菜品当日上架、库存 20~50；未来 1~2 天菜单；账号可登录 | AC-056 | 空库、库存 0、图片 404 | DB+API+E2E |
| GE-3 | 统一错误码/分页/鉴权/幂等/版本 `/api/v1` | 4xx/5xx 均 `{code,message,data,requestId}`；分页默认 1/20、上限 100 | AC-047、AC-048 | 各接口格式不一、200 包错误、无 requestId | API |
| GE-4 | 参数化查询，无拼接 SQL（搜索重点） | `' OR 1=1--` 返回空结果非 500；代码无字符串拼接 SQL | AC-008、AC-050 | `${}` 拼接、模糊查询注入、报错泄漏 SQL | API+代码审查 |
| GE-5 | 用户可见文案英文；价格 `¥xx.xx` | 关键页面无中文可见字符；金额正则 `^¥\d+\.\d{2}$` | AC-057、AC-054 | 中文 toast、`¥22.5`/`22.5元` | E2E+截图 |
| GE-6 | README/API/架构/测试/AI 对话原始导出齐全 | 文件存在且非空；`ai-conversations/` 为原生导出非截图 | AC-058（文档项） | 仅有截图、事后摘要 | 文件清单+抽样 |
| GE-7 | 证据可追溯（命令/日志/截图/DB） | 每个 PASS 有对应 AC 证据文件或命令输出 | AC-045~AC-060 | 口头 PASS、无输出 | 证据索引 |

## 6. 失败模式总表（跨 profile）

| 失败模式 | 触发条件 | 期望行为 | AC |
|---|---|---|---|
| 超卖 | 50 并发抢 10 份 | 10 成功、40 `STOCK_INSUFFICIENT`、库存不为负 | AC-035 |
| 重复下单 | 双击/网络重试 | 同幂等键 1 单；同餐次第 2 单 409+已有单 | AC-015、AC-026 |
| 重复回补 | 取消接口重放 | 只 1 条 RELEASE，库存只加一次 | AC-018、AC-019 |
| 截单边界误判 | 10:00:00/15:00:00 | 等于截单点即关闭并自动切换 | AC-024、AC-025 |
| 金额漂移 | 改价/浮点 | 历史单冻结；新单按 DB 分重算 | AC-016、AC-055 |
| 越权 | 员工调 Console/读他人订单 | 403/404，数据不变 | AC-028、AC-051 |
| 注入 | 搜索框 `' OR 1=1--` | 200 空结果，无 SQL 报错 | AC-008 |
| 前端假权限 | 隐藏按钮但 API 可调 | 后端 403 | AC-028 |
| AI 幻觉 | 模型输出不存在/过敏菜品 | 服务端丢弃，卡片仅候选集 | AC-038 |
| AI 无 Key | 未配置 Key | 规则降级+明确标注，非 500 | AC-040 |
| 缓存脏读 | 管理员改菜后仍显示旧数据 | 写后失效 ≤1s | AC-030、AC-045 |
| 库存模式单点 | Redis 宕机 | 降级 DB，正确性不变 | AC-043 |

## 7. 场景检查的运行时判据（Stage 5 执行）

- `transaction-order`：AC-014~AC-020、AC-024~AC-027、AC-035、AC-037、AC-043、AC-044 全部执行并留证据；任一 P0 失败 → 交易场景 FAIL。
- `identity-access`：AC-001~AC-005、AC-028、AC-032、AC-033、AC-048~AC-051；任一越权通过 → FAIL。
- `ai-llm`：AC-038~AC-041；未实现 → 全项 N/A，Tier 3 +0；实现但无 Key → AI-3 PASS、真实模型质量 NOT TESTED。
- `general-engineering`：AC-045~AC-060 与文档清单；缺 AI 对话原始导出 → 整体降级。

## 8. 使用约定（不变）

- 每个子 Issue 描述携带本文件路径与 active_profiles。
- 每个节点交付评论追加 `## Scenario checks`，逐项 `PASS / N/A / FAIL + 证据`；`N/A` 必须写理由；缺证据不得 PASS。
- Stage 1 的 PASS 仅指“检查项已映射为可执行 AC”；运行时结论由 Stage 5 按 AC 证据判定。