# 测试方案 — WeBox 企业员工餐食订购平台

- 版本：v1.1（G3 回写，2026-11-14 22:14 CST；依据 `docs/cross-review-g3-test.md`）
- 前版：v1.0（Stage 2 Test Designer，2026-11-14 21:58 CST）
- 上游：`docs/PRD.md`、`RUNBOOK.md` D1–D22、`docs/prd-analysis.md`、`docs/acceptance-matrix.md`（AC-001…060）、`docs/scenario-profile.md` v2、`docs/assumptions.md`
- 配套：`docs/test-cases.md`（TC-001…TC-086）、`tests/`（可执行脚手架）、`docs/cross-review-g1-test.md`、`docs/review-findings.md`
- 结论：**测试方案 PASS（可执行）**；运行时结论由 Stage 5 按证据判定，本文件不预判 PASS。

## 1. 范围

### 1.1 In Scope

| 层 | 范围 |
|---|---|
| Tier 1 | 注册登录、当日菜单（列表/筛选/搜索/详情/选项）、购物车、下单/订单列表/详情/取消 |
| Tier 2 | 偏好设置与过敏原提醒、为我推荐软排序、预算提示；订餐规则（5 份上限/截单切换/唯一有效单）；Console 菜品管理（增改/上下架/每日菜单与库存/改价审计） |
| Tier 3 | 库存展示与低库存/售罄、并发防超卖、SSE 实时、取消回补、AI 推荐（候选硬过滤/SSE/无 Key 降级/规则回滚）、经营看板、对账、两种库存模式 |
| NFR/安全 | 统一错误码、分页上限、输入长度、限流 429、越权 401/403/404、SQL 注入、金额整数分、敏感信息不泄漏、响应式、防抖、P95 延迟、hedge/降级、种子数据 |

### 1.2 Out of Scope（明确不测）

| 项 | 理由 |
|---|---|
| 真实支付/退款/发票资金流 | PRD 无支付；RUNBOOK D22 不实现 |
| 多租户/多站点切换、微服务、消息队列、多机房 | 非目标（prd-analysis §1.3） |
| 双实例实跑 | 时间盒；AC-059 记 `N/A（时间盒，设计兼容）`，只做代码审查 |
| 站外通知（短信/邮件/推送） | PRD 未要求 |
| 真实 LLM 回答质量（无 Key 场景） | 现场无 Key；规则降级必须 PASS，真实模型质量 `NOT TESTED` |
| Tier 3 未实现部分 | 一律 `N/A（Tier 3 未实现）`，不记 PASS |

### 1.3 环境

| 资源 | 值 |
|---|---|
| JDK / Maven | `/usr/lib/jvm/java-17-openjdk-amd64` / `/opt/maven/bin/mvn` |
| Node | `/opt/nvm/versions/node/v22.22.3/bin`（`node -v` = v22.x，原生 fetch） |
| MySQL | `127.0.0.1:3306`，`test/test123456`，库 **`req_6343a752e110_test`**（utf8mb4，`Asia/Shanghai`） |
| Redis | `127.0.0.1:6379`（可选；`REDIS_PREALLOC` 用例需要；不可用时验证降级） |
| 后端 / 前端 | `http://127.0.0.1:8080` / `http://127.0.0.1:5173`（proxy `/api`） |
| 浏览器 | `/opt/gem/bin/agent-browser`（375×812 / 768×1024 / 1440×900） |
| 证据目录 | `artifacts/test/<runId>/`（JSON 输出、截图、DB 快照、命令日志） |

### 1.4 准入 / 准出

**准入（Entry）**
1. 后端 `GET /api/v1/health` 200 且 `db=UP`；前端 5173 可打开登录页。
2. 种子达标：20 道菜入库、当日菜单 20 道（库存 20~50）、次日/后天菜单存在、20 张图片 200、`admin@webox.com` 与 `employee@webox.com` 可登录。
3. 契约冻结：`docs/api-contract.md` 含 §7 测试钩子（至少 H1/H3/H4/H5/H6/H7）。

**准出（Exit）**
1. Tier1/2 的 P0 AC 全部 PASS；P1 允许 ≤2 条 `NOT TESTED` 且有理由；Tier3 按 `N/A` 诚实标注。
2. 并发/幂等/取消/越权/注入/金额六类专项均有命令输出 + DB 前后快照。
3. 无 open P0/P1 缺陷；P2 有 Owner 与截止。
4. `docs/test-report.md` 含 AC→结果→证据路径三列，缺证据不得 PASS。

## 2. 测试策略（风险驱动）

优先级：**交易正确性 > 权限/安全 > 规则一致性 > 体验类 > Tier3 加分**。时间不足时砍 Tier3 与体验项，不砍金额/幂等/并发/权限/证据。

| 优先级 | 断言对象 | 失败后果 |
|---|---|---|
| R-1 交易正确性 | 金额整数分与服务端重算、库存不超卖、只回补一次、幂等 1 单、唯一有效单、快照冻结 | 资损/超卖/重复单 |
| R-2 权限与安全 | 员工→`/admin/**` 403、横向越权 403/404、未登录 401、SQL 注入、密钥/密码不泄漏 | 数据泄漏/提权 |
| R-3 规则一致性 | 5 份上限、截单六边界+跨日、状态机、审计 | 规则失效 |
| R-4 体验类 | 响应式、分页、防抖、金额展示、校验、英文文案 | 评分卡失分 |
| R-5 Tier3 | SSE、AI 过滤/降级、看板、对账、双库存模式 | 仅加分项 |

## 3. 测试层级

| 层级 | 工具 | 覆盖 | 产出 |
|---|---|---|---|
| L1 单元测试 | JUnit 5 + Mockito | `Clock` 截单判定（六边界+跨日）、金额计算（long 分）、5 份上限、状态机迁移、选项加价、唯一键生成 | `mvn test` 报告 |
| L2 集成测试 | `@SpringBootTest` + MockMvc + Testcontainers 不启用（用真实 MySQL `req_6343a752e110_test`） | 注册/登录/菜单/下单/取消/权限/错误码/幂等键 | surefire 报告 + JSON |
| L3 API 契约/异常 | Node 22 fetch（`tests/api/*.mjs`） | AC-001~060 的 HTTP 状态、错误码、envelope、分页、限流、注入、越权 | `artifacts/test/<runId>/api-*.json` |
| L4 并发/幂等 | `tests/concurrency/*.mjs`（Promise.all + 独立 JWT） | 50 抢 10、同 Key 并发 5+串行 2、异体 409、取消竞态 | 原始输出 + DB 前后快照 |
| L5 数据库断言 | `mysql` CLI + `tests/sql/assertions.sql` | 库存非负、ledger 对账、唯一有效单、金额合计、密码哈希、审计字段 | `db-*.tsv` |
| L6 E2E | `agent-browser`（headless） | 注册→选餐→加购→结算→下单→我的订单→取消；Console 下架；响应式三档；防抖 | 截图 + DOM 断言 |
| L7 安全审查 | grep + 代码/配置审查 | 明文密码、Authorization 日志、API Key、拼接 SQL、float 金额 | `security-grep.txt` |
| L8 性能 | `tests/api/perf.mjs`（固定并发 50 QPS / 10 QPS 60s） | 菜单 P95、下单 P95、5xx=0 | 延迟直方图 JSON |

## 4. AC → 用例覆盖矩阵（AC-001…060）

> 用例详情见 `docs/test-cases.md`；层级：U=单元、I=集成、A=API、C=并发、D=DB、E=E2E、R=审查、P=性能。自动化：`AUTO`=脚本可跑，`MAN`=人工/半自动（截图）。Tier3 未实现时状态列统一 `N/A(T3)`。

| AC | Tier | 用例 | 层级 | 自动/手工 | 证据 |
|---|---|---|---|---|---|
| AC-001 | T1 | TC-001 | A+D | AUTO | `api-auth.json` + DB hash 查询 |
| AC-002 | T1 | TC-002 | A+D | AUTO | 409 + 用户数不变 |
| AC-003 | T1 | TC-003 | A | AUTO | 400 三类错误码 + 8 位通过 |
| AC-004 | T1 | TC-004 | A+E | AUTO/MAN | JWT + `/auth/me` + admin 登录 + 刷新截图 |
| AC-005 | T1 | TC-005 | A | AUTO | 10×401 + 第 11 次 429 + P95 |
| AC-006 | T1 | TC-010/TC-011 | A+E | AUTO | 20 条 + 正则 + size=101→400 |
| AC-007 | T1 | TC-007 | A+D | AUTO | 并集数量=DB IN 计数 |
| AC-008 | T1 | TC-013/TC-014/TC-015 | A+D | AUTO | 大小写命中 + 注入 200 空 + 51 字→400 |
| AC-009 | T1 | TC-009 | A | AUTO | 选项组/枚举/整数分 |
| AC-010 | T1 | TC-010 | A+E | AUTO | ¥41.00 + 非法 option 400 + 必选缺失 400 |
| AC-011 | T1 | TC-023 | E+preview | MAN/AUTO | 2 行 + 合计断言（preview） |
| AC-012 | T1 | TC-024 | E | MAN | 截图 + 刷新持久化 |
| AC-013 | T1 | TC-029 | A+E | AUTO | preview 字段齐全 + 地址 201→400 |
| AC-014 | T1 | TC-030/TC-065 | A+D | AUTO | orderNo 正则 + ledger 1 RESERVE |
| AC-015 | T1 | TC-033/TC-034/TC-035 | C+D | AUTO | 7 次 1 单 + 异体 409 + 缺头 400 |
| AC-016 | T1 | TC-031 | A+D | AUTO | 篡改价无效 + 改价后按 DB 重算 |
| AC-017 | T1 | TC-032 | A+D | AUTO | 仅本人 2 单 + 他人 404 |
| AC-018 | T1 | TC-036 | A+D | AUTO | 回补 1 次 + 第 2 次 409 + 1 RELEASE |
| AC-019 | T1 | TC-037 | A+D | AUTO | Confirmed 取消 409（依赖 H4） |
| AC-020 | T2 | TC-038 | E+A | AUTO | 第 6 份禁用 + API 400 + 3+3 拒绝 |
| AC-021 | T2 | TC-041 | E+A | MAN/AUTO | 过敏原弹窗文案 + 后端不阻断 |
| AC-022 | T2 | TC-042 | A+E | AUTO | 集合相同、顺序不同 + 关闭恢复 |
| AC-023 | T2 | TC-043 | A+E | AUTO | budgetExceeded=true 且仍 201 |
| AC-024 | T2 | TC-039a/b/c | A+U | AUTO | 09:59:59/10:00:00/10:01 三快照 |
| AC-025 | T2 | TC-039d/e/f/g | A+U | AUTO | 14:59:59/15:00/15:01/16:00 次日 |
| AC-026 | T2 | TC-044 | A+E+D | AUTO | 409 + existingOrderId + 库存不扣 |
| AC-027 | T2 | TC-045/TC-046 | A+D | AUTO | 跨餐次/跨日 201；取消后可再下 |
| AC-028 | T2 | TC-047/TC-048 | A+E | AUTO | 员工 403、未登录 401、Console 不渲染 |
| AC-029 | T2 | TC-049 | A+E | AUTO | 新增/筛选/编辑 + >5MB 400 + 占位图 |
| AC-030 | T2 | TC-050 | A+D+E | AUTO | 下架 404、上架恢复、≤1s |
| AC-031 | T2 | TC-051 | A+D+E | AUTO | 当日/次日菜单 + qty=0 售罄 |
| AC-032 | T2 | TC-052 | A+D | AUTO | 缺 reason 400 + 2 条审计前后值 |
| AC-033 | T2 | TC-053 | A+R | AUTO | 列表脱敏/详情完整 + 无密码/Token |
| AC-034 | T3 | TC-057 | A+E+SHOT | AUTO/MAN | Only 3 left / Sold out / 409 明细 |
| AC-035 | T3 | TC-058 | C+D | AUTO | 10×201 + 40×409 + available=0 |
| AC-036 | T3 | TC-059 | A+E | AUTO | ≤2s 事件 + 断线重连 + 轮询降级 |
| AC-037 | T3 | TC-060 | A+E+D | AUTO | 取消后 +1 且 ≤2s 推送 |
| AC-038 | T3 | TC-061 | A+D | AUTO | 过敏/售罄/近 7 天全不在候选 |
| AC-039 | T3 | TC-062 | A+E | AUTO | `meta→dish→reason→done` + 首事件 ≤3s |
| AC-040 | T3 | TC-063 | A+E | AUTO | 无 Key → 200 SSE `fallback:true` |
| AC-041 | T3 | TC-064 | A+D+R | AUTO | 改权重 ≤60s + 回滚 + 无 Key |
| AC-042 | T3 | TC-065 | A+D+E | AUTO | 聚合与 DB 一致 + 新增单 +1 |
| AC-043 | T3 | TC-066 | C+R | AUTO | 两模式成功数=库存；Redis 停降级 |
| AC-044 | T3 | TC-067b | A+D | AUTO | drift=0；制造 1 → 补偿归零 |
| AC-045 | NFR | TC-068 | P | AUTO | 菜单 P95 / 搜索 P95 / 5xx=0 |
| AC-046 | NFR | TC-069 | P+D | AUTO | 下单 P95≤500 + 订单数=成功数 |
| AC-047 | NFR | TC-070 | A | AUTO | 7 类状态码 envelope + requestId |
| AC-048 | NFR | TC-071 | A | AUTO | 5 字段超长 400 + 边界通过 |
| AC-049 | NFR | TC-005/TC-072 | A | AUTO | 登录/下单/AI 429 |
| AC-050 | NFR | TC-073 | R+D | AUTO | grep 0 命中 + `$2` 前缀 |
| AC-051 | NFR | TC-074 | A+D | AUTO | 越权 403/404 + 篡改 token 401 |
| AC-052 | NFR | TC-075 | E+SHOT | MAN | 375/768/1440 截图无横向滚动 |
| AC-053 | NFR | TC-076 | E+D | AUTO | 500ms 10 连点 ≤2 请求；1s×5=5 |
| AC-054 | NFR | TC-077 | A+D+R | AUTO | totalCents=7760 + `¥77.60` + 无 float |
| AC-055 | NFR | TC-078 | A+D | AUTO | 历史单冻结 + 新单新值 |
| AC-056 | NFR | TC-079 | A+D+DOC | AUTO | 20 菜/20 图/2 账号/当日可下单 |
| AC-057 | NFR | TC-080 | E+R | MAN/AUTO | 页面文本无中文 + `¥xx.xx` |
| AC-058 | NFR | TC-081 | A+D+DOC | AUTO | health + 备份恢复行数一致 + 告警文档 |
| AC-059 | NFR | TC-083 | R | MAN | `N/A（时间盒，设计兼容）` |
| AC-060 | NFR | TC-040 | A+D | AUTO | 注入时钟 +30min 自动取消 1 次释放 |
| （补）AC-061 提权 | — | TC-084 | A+D | AUTO | 注册 `role=ADMIN` → 400/强制 EMPLOYEE |

**覆盖统计**：60/60 AC 有对应用例；Tier1 19/19、Tier2 14/14 全部有 ≥1 自动化用例；Tier3 11/11 有脚本，未实现时记 `N/A(T3)`；NFR 16/16 有断言。另补 TC-084 覆盖 G1 发现的提权向量（AC-061 建议）。

## 5. 质量评分卡专项（前端 5 + 后端 5）

| 评分项 | 用例 | 具体步骤 | 通过判据 |
|---|---|---|---|
| FE-1 响应式 | TC-075 | agent-browser 设 375×812 / 768×1024 / 1440×900，遍历菜单/详情/购物车/结算/我的订单 | `document.scrollingElement.scrollWidth <= innerWidth+1`；菜单列数 1/2/3；按钮可点 |
| FE-2 长列表/分页 | TC-010/TC-011 | `page=1&size=20`、`page=2`、`size=100`、`size=101`；50 道菜滚动 | 分页正确、size=101→400、列表 P95≤200ms |
| FE-3 防抖/节流 | TC-076 | 500ms 内点 Add 10 次；间隔 1s 点 5 次；结算连点 Submit 10 次 | 请求 ≤2 且数量=成功数；1s×5 数量=5；仅 1 单 |
| FE-4 金额精度 | TC-010/TC-077 | 选 Whole Wheat+Cheese；¥35.80+¥3.00×2；全页面正则扫描 | `totalCents=7760`；显示 `¥77.60`；全部 `^¥\d+\.\d{2}$`；无浮点误差 |
| FE-5 输入校验 | TC-003/TC-071 | 非法邮箱/7 位密码/201 邮箱、地址 201、搜索 51、原因 201 | 前端提示英文且后端同样 400；边界值通过 |
| BE-1 缓存 | TC-050/TC-068 | 菜单高频读命中；管理员改菜后立即读 | 命中 P95≤100ms；写后 ≤1s 读到新值；无脏读 |
| BE-2 幂等 | TC-034 | 同 Key 并发 5 + 串行 2；异体；缺头 | 7 次同 orderId；DB 1 单；409/400 正确 |
| BE-3 注入防护 | TC-014 | 搜索 `' OR 1=1--`、`%`、`_`、`'; DROP TABLE` | 200/空结果，无 5xx，无 SQL 关键字 |
| BE-4 权限 | TC-047/TC-074 | 员工调 `/admin/**`；读/取消他人单；篡改 JWT；未登录 | 403/404/401，数据不变 |
| BE-5 并发/防超卖 | TC-058 | 50 用户并发抢 10 份；取消两次 | 10 成功/40 STOCK_INSUFFICIENT；available≥0；1 条 RELEASE |

## 6. 负向与边界矩阵

| 类别 | 输入/条件 | 期望 | TC |
|---|---|---|---|
| 空值 | 缺 email/password/items/address/dishId | 400 `VALIDATION_*`，`data.field` 指向字段 | TC-003/TC-029/TC-070 |
| 越权 | 员工调 Console；A 读/取消 B 单；篡改 JWT | 403 / 404 / 401，DB 不变 | TC-047/TC-074 |
| 重复 | 同 Key 并发+串行；同日同餐次；重复取消 | 1 单 / 409+existingOrderId / 409 无二次回补 | TC-034/TC-044/TC-036 |
| 并发 | 50 抢 10；同 Key 5 并发；取消竞技 | 10 成功；1 单；1 RELEASE | TC-058/TC-034/TC-036 |
| 库存不足 | 0 份下单；下单时被抢空 | 409 `STOCK_INSUFFICIENT` + dishId/requested/available | TC-057 |
| 截单 | 09:59:59/10:00:00/10:01/14:59:59/15:00:00/15:01/16:00/过去日期 | Lunch/Lunch 关闭→Dinner/…/次日 Lunch/400 `VALIDATION_DATE_PAST` | TC-039 |
| 数量上限 | 5 份通过；6 份；3+3 | 201；400 `ORDER_LIMIT_EXCEEDED`；400 | TC-038 |
| 重复下单 | 同日同餐次第二单 | 409 `ORDER_DUPLICATE` + existingOrderId | TC-044 |
| 过敏原/预算 | Egg 过敏加购含蛋菜；预算 ¥15 买 ¥22 | 弹窗可继续；`budgetExceeded=true` 仍 201 | TC-041/TC-043 |
| 错误码 | 400/401/403/404/409/429/500 | `{code,message,data,requestId}` 且状态匹配 | TC-070b |
| 长度 | email 200/201、address 200/201、search 50/51、reason 200/201、password 64/65 | 边界通过、超长 400 | TC-071 |
| 分页 | size=100/101、page=0 | 100 通过、101→400、0→400 | TC-070 |

## 7. 测试钩子需求（提交 Architecture 写入 `api-contract.md` / `data-model.md`）

> 闭环状态（2026-11-14 22:10）：Architecture 已在 `api-contract.md` 落地全部钩子——`X-Test-Clock`（§1，#20）、`PATCH /admin/orders/{id}/status`（#24）、`PUT /admin/daily-menu/{date}/{dishId}/stock`（#32）、`GET /admin/inventory/reconcile` + `POST /admin/inventory/adjust`（#33/#33b）、`Idempotency-Key`（§1/§3.2）、SSE 事件（§3.3）、`requestId`+`X-Request-Id`（§1）。G1T-B1/B2/M1~M8 见 `docs/review-findings.md` 均已 CLOSED。下表 H 编号与契约端点对应，Stage 5 按契约执行。

| # | 钩子 | 契约要求 | 服务的 AC | 安全约束 |
|---|---|---|---|---|
| H1 | 时钟注入 | `X-Test-Clock: 2026-11-14T09:59:59+08:00`，仅 `SPRING_PROFILES_ACTIVE=test` 或 `TEST_CLOCK_ENABLED=true` 生效；内部 `Clock` Bean | AC-024/025/060 | 生产 profile 必须忽略；TC-083b 验证忽略 |
| H2 | 批量测试用户 | `tests/sql/seed_users.sql` 建 50 个 `race_<RUN_ID>_01..50@test.com`（同 `Passw0rd1` 哈希）；`order_race.mjs` 批量登录取 JWT | AC-035/046 | 仅测试库，不落演示库 |
| H3 | 管理员设置当日库存 | **契约 #32**：`PUT /api/v1/admin/daily-menu/{serveDate}/{dishId}/stock` body `{totalQty≥0,confirm:true,reason 1–200}`；写 audit | AC-031/034/043 | confirm+reason+audit；409 若 <reserved+sold |
| H4 | 订单状态流转 | **契约 #24**：`PATCH /api/v1/admin/orders/{orderId}/status` body `{toStatus:"Confirmed"|"Completed"|"Cancelled",confirm:true,reason 1–200}`；矩阵 Pending→Confirmed→Completed、Pending→Cancelled，其余 409 | AC-019/042 | 管理员角色 + 审计；非法迁移 409 |
| H5 | 对账与补偿 | **契约 #33/#33b**：`GET /api/v1/admin/inventory/reconcile?date=` → `{drift,items[]}`；`POST /api/v1/admin/inventory/adjust` body `{dishId,serveDate,delta,confirm:true,reason}` 写 `ADJUST` | AC-044 | 审计 + 原因；409 若 <reserved+sold |
| H6 | 幂等键 | `POST /api/v1/orders` 必须 `Idempotency-Key: 8~64`；缺失 400 `IDEMPOTENCY_KEY_REQUIRED`；同键异体 409 `IDEMPOTENCY_CONFLICT` | AC-015/053 | 用户维度唯一 |
| H7 | SSE 契约 | `GET /api/v1/menu/stream?date=`：`event: snapshot|stock`，`data` 单行 JSON，`retry:3000`，15s 心跳 `: ping`；`snapshot` 为 `{dishId,available}[]`，`stock` 为 `{dishId,available}`（int）。AI 流事件 `meta|dish|reason|done` | AC-036/039/040 | 只推 dishId/available |
| H7b | SSE ticket | `POST /api/v1/menu/stream-ticket` → `{ticket,expiresIn:60}`；同 ticket 最多 3 次兑换，第 4 次/过期 401 | AC-036 | 32B 随机；仅 test 断言不落日志 |
| H8 | 数据隔离/重置 | **独立库 `req_6343a752e110_test`**；`tests/sql/reset_test.sql` 清订单/明细/ledger/幂等/库存占用并重播种子；演示库仅 `reset_demo.sql` + `ALLOW_DEMO_RESET=1` | 全部 | 禁止未设守卫对演示库执行 |
| H9 | 请求追踪 | 响应体恒含 `requestId`（UUID），响应头 `X-Request-Id` 同值；审计记录 IP | AC-047/032 | requestId 不含敏感信息 |
| H10 | AI 规则配置 | **契约 #37**：`PUT /api/v1/admin/ai-rules` body `{configKey,config,confirm:true,reason}`；无 rollback 端点（缺口 09），回滚用同接口写回旧值，或记 `NOT TESTED` | AC-041 | 审计 + 无 Key 落库 |
| H11 | 超时触发（AC-060） | `X-Test-Clock` 对 `@Scheduled` 线程无效（backend-design:428）。优先 test profile `POST /admin/orders/{id}/expire`；否则 SQL 回拨 `created_at - 31 MINUTE` 后等 ≤60s tick | AC-060 | 仅测试库/test profile |

### 7.1 G3 回写（2026-11-14 22:13，测试方案设计师）

G3 评审（`docs/cross-review-g3-test.md`）结论 CHANGES，本轮回写口径：

- **B1 路径以契约为锚**：H3/H4/H5/H10 已按 `api-contract.md` #32/#24/#33/#37 重写；旧路径不实现、不调用。
- **B2 超时**：`X-Test-Clock` 不作用于 `@Scheduled`。TC-040 改为 SQL 回拨 `created_at` 或调用 test profile expire 端点；两者皆无 → `NOT TESTED`。
- **B3 库隔离**：全部命令改连 `req_6343a752e110_test`；首条证据打印 `SELECT DATABASE()`；`reset.sql` 仅对演示库需 `ALLOW_DEMO_RESET=1`。
- **M1 available 类型**：菜单 `available` 为 boolean，SSE/Console 为 int；TC-010b 断言类型；TC-057 首屏只断言 `Low stock`，收到 `snapshot` 后才断言 `Only N left`。
- **M2 preview**：TC-029b 断言库存 0 时 preview 200 且不含 `STOCK_INSUFFICIENT`。
- **M3 状态机/reason**：TC-037b 断言 #24 矩阵、管理员 reason 必填、员工 reason 可选、审计。
- **M4 幂等快照**：TC-034b 断言 `idempotency_records.status`（业务 4xx→COMPLETED 快照；5xx→FAILED 可重试）。
- **M5 active_key/ledger**：TC-036b 断言 `active_key NULL`、`uk_orders_active`、ledger `business_key` 唯一与 before/after 连续、对账 drift=0。
- **M6 ticket**：TC-059b 断言 60s/3 次兑换/第 4 次 401/事件仅 `dishId+available`。
- **M7 夹具**：`tests/sql/seed_users.sql` 50 用户；Redis 停启与恢复命令进 `tests/README.md`。

Stage 5 执行顺序不变；新增用例插入对应分组，未执行一律 `NOT TESTED`。

## 8. 测试数据策略

| 数据 | 要求 | 隔离/清理 |
|---|---|---|
| 库 | `req_6343a752e110_test`（本需求专属，小写字母数字） | 每次 run 前 `reset.sql`；不与其它 issue 共用 |
| 菜品 | 20 道：9 道 PRD 菜 + 11 道英文补充菜；图片 `image_01..20.jpg` | 种子 SQL 固定 id/name/priceCents |
| 当日菜单 | **20 道全部发布，total_qty 20~50**（解决 G1T-M5） | 次日/后天各一批；未配置日期不出现 |
| 库存模式 | 至少 1 道 `REDIS_PREALLOC`（建议 Kung Pao Chicken），其余 `DB_ATOMIC` | 由种子指定；可管理端切换 |
| 账号 | `admin@webox.com/Admin12345`（ADMIN）、`employee@webox.com/Employee123`（EMPLOYEE）；并发用 `race_<runId>_01..60@test.com/Passw0rd1` | runId 时间戳保证唯一 |
| 订单 | 每次 run 用新用户/新日期，避免唯一有效单互斥 | 结束不删（保留证据），下轮 reset |
| 低库存/售罄 | 演示前用 H3 设 3/0，测后恢复 | 恢复命令写进 `tests/README.md` |
| 近 7 天/AI | 预置历史订单；或按 runId 用户先下单再调 AI | reset 清理 |

## 9. 执行命令（Stage 5 可直接复制）

```bash
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export PATH=/opt/gem/bin:/opt/nvm/versions/node/v22.22.3/bin:$JAVA_HOME/bin:/opt/maven/bin:$PATH
export MYSQL_HOST=127.0.0.1 MYSQL_PORT=3306 MYSQL_USER=test MYSQL_PASSWORD=test123456 MYSQL_DATABASE=req_6343a752e110_test
export REDIS_HOST=127.0.0.1 REDIS_PORT=6379
export BASE_URL=http://127.0.0.1:8080
export RUN_ID=$(date +%Y%m%d%H%M%S)
export EVIDENCE_DIR=/home/gem/code/req-squad/workspace/6343a752-e110-407c-8dfb-a5873425d917/artifacts/test/$RUN_ID
mkdir -p "$EVIDENCE_DIR"

# 1) 建库/重置
mysql -h$MYSQL_HOST -u$MYSQL_USER -p$MYSQL_PASSWORD -e "CREATE DATABASE IF NOT EXISTS \`req_6343a752e110_test\` DEFAULT CHARSET utf8mb4;"
mysql -h$MYSQL_HOST -u$MYSQL_USER -p$MYSQL_PASSWORD req_6343a752e110_test < tests/sql/reset.sql

# 2) 启动后端（test profile 开测试钩子）
cd backend && $JAVA_HOME/bin/java -jar target/*.jar --spring.profiles.active=test > "$EVIDENCE_DIR/backend.log" 2>&1 &
# 或：/opt/maven/bin/mvn spring-boot:run -Dspring-boot.run.profiles=test
# 3) 启动前端
cd frontend && npm ci && npm run dev -- --port 5173 > "$EVIDENCE_DIR/frontend.log" 2>&1 &

# 4) 健康与种子
curl -s $BASE_URL/api/v1/health | tee "$EVIDENCE_DIR/health.json"
node tests/api/smoke.mjs | tee "$EVIDENCE_DIR/api-smoke.json"
# 5) 契约/异常/权限/幂等/金额
node tests/api/auth.mjs      | tee "$EVIDENCE_DIR/api-auth.json"
node tests/api/menu.mjs      | tee "$EVIDENCE_DIR/api-menu.json"
node tests/api/orders.mjs    | tee "$EVIDENCE_DIR/api-orders.json"
node tests/api/authz.mjs     | tee "$EVIDENCE_DIR/api-authz.json"
node tests/api/validation.mjs| tee "$EVIDENCE_DIR/api-validation.json"
# 6) 并发/幂等竞态
node tests/concurrency/order_race.mjs        | tee "$EVIDENCE_DIR/conc-order.json"
node tests/concurrency/idempotency_race.mjs  | tee "$EVIDENCE_DIR/conc-idem.json"
# 7) DB 断言
mysql -h$MYSQL_HOST -u$MYSQL_USER -p$MYSQL_PASSWORD req_6343a752e110_test < tests/sql/assertions.sql | tee "$EVIDENCE_DIR/db-assertions.tsv"
# 8) E2E
bash tests/e2e/run_e2e.sh 2>&1 | tee "$EVIDENCE_DIR/e2e.log"
```

## 10. 证据规范

| 规则 | 内容 |
|---|---|
| 命名 | `artifacts/test/<RUN_ID>/<area>-<case>.json|png|log` |
| 每个 PASS 必备 | 命令原样 + 退出码 + 关键响应片段 + 对应 DB 查询结果 |
| 并发类 | 原始并发输出 + 执行前/后 `SELECT dish_id,total_qty,reserved_qty,sold_qty` + ledger 汇总 |
| 截单类 | 请求头 `X-Test-Clock` 原值 + 响应 `effectiveMeal/autoSwitched` + 服务端日志时间 |
| E2E | 截图文件名含 viewport 与步骤号；DOM 断言文本 |
| 未执行 | 一律 `NOT TESTED` + 原因；Tier3 未实现 `N/A（Tier 3 未实现）` |
| 禁止 | 口头 PASS、仅截图无命令、PASS 无 DB/响应证据 |

## 11. 缺陷分级与闭环

| 级别 | 判定 | 处置 |
|---|---|---|
| P0 | 超卖/负库存、重复有效单、幂等失效、金额错误、越权成功、主链路 5xx、明文密码 | 立即进 `docs/defect-log.md`，回 Stage 4 修复，复评+回归 |
| P1 | 规则失效（截单/5 份/取消回补）、错误码不符、SSE 不工作、审计缺失 | 同类闭环，GO 前必须关闭 |
| P2 | 体验/文案/排序/看板细节、非核心 NFR 未达 | 记 Owner + 截止，可不阻塞 GO |
| P3 | 文案微调、视觉细节 | 记录即可 |

## 12. 时间盒（Stage 5：23:25–23:40，15 分钟）

| 时间 | 动作 |
|---|---|
| 23:25–23:27 | 健康检查、reset、种子核对、前端可打开（TC-079） |
| 23:27–23:30 | 认证/菜单/购物车/结算（TC-001~010、TC-029） |
| 23:30–23:34 | 下单/幂等/唯一单/取消/金额快照（TC-030~037、TC-044~046、TC-077~078） |
| 23:34–23:37 | 并发/越权/注入/校验/限流（TC-058、TC-034、TC-047、TC-067、TC-071~074） |
| 23:37–23:39 | 截单边界（H1）+ Tier3 抽测（SSE/AI 降级/看板） |
| 23:39–23:40 | E2E 截图 + 回填 `test-report.md` + 标 NOT TESTED |

超时策略：先保 Tier1/2 P0 与证据，Tier3 未跑完记 `N/A/NOT TESTED`；不得以缺证据判 PASS。

## 13. NFR 验证口径

| NFR | 方法 | 判据 |
|---|---|---|
| 菜单列表 | 50 QPS×60s（`perf.mjs`） | P95≤200ms（缓存命中≤100ms），5xx=0 |
| 搜索/筛选 | 20 QPS×60s | P95≤250ms |
| 详情 | 20 QPS×60s | P95≤150ms |
| 下单 | 10 QPS×60s，不同用户+幂等键 | P95≤500ms，订单数=成功响应数 |
| 登录 | 10 QPS | P95≤300ms |
| 分页 | size=100/101、page=0 | 100 通过、越界 400 |
| 限流 | 登录 11/分、下单 6/分、AI 11/分 | 超限 429 `RATE_LIMITED` |
| SSE | 下单触发库存变化 | ≤2s 收到；断线 5s 重连；不可用时 5s 轮询 |
| AI | 首事件/无 Key | 首事件≤3s、总≤20s；无 Key 200 SSE `fallback:true` |
| 缓存 | 管理员写后读 | ≤1s 失效 |
| 恢复 | `scripts/backup.sh` + 恢复临时库 | 核心表行数一致；health 200 |

## 14. 风险与未测项（本阶段）

| # | 风险 | 缓解 |
|---|---|---|
| T-R1 | 时钟钩子未实现 → 截单类 P0 不可判定 | H1 必须在 Stage 2 契约落地；否则 TC-039/083 记 NOT TESTED，且 `test-report.md` 显式标注，不虚报 |
| T-R2 | 无 LLM Key | 只验证降级与过滤；真实模型质量 NOT TESTED |
| T-R3 | Redis 不稳 | 记录降级证据；REDIS_PREALLOC 用例允许 `N/A(Redis 不可用)` |
| T-R4 | 并发机竞争导致 P95 抖动 | 重跑 3 次取中位数；保留原始输出 |
| T-R5 | 时间盒内 Tier3 未跑 | 按 N/A 记录，不影响 Tier1/2 判定 |

## 15. Scenario checks（本阶段自检，运行时结论由 Stage 5 执行）

| Profile / check | 本阶段结论 | 证据 |
|---|---|---|
| transaction-order TO-1~TO-10 | PASS（已映射 TC；运行时 Stage 5） | §4 矩阵、TC-030/031/034/036/039/044/058/077/078 |
| identity-access IA-1~IA-7 | PASS（已映射 TC；运行时 Stage 5） | TC-001/005/047/053/067/074 |
| ai-llm AI-1~AI-6 | PASS（已映射 TC，Tier3 未实现可 N/A） | TC-061~064 |
| general-engineering GE-1~GE-7 | PASS（已映射 TC；运行时 Stage 5） | TC-068~083、TC-086 |
| 场景失败模式总表 12 项 | PASS（均有用例） | §6 负向矩阵 |
| G1 测试发现闭环 | PASS | `review-findings.md`：G1T-B1/B2/M1~M8 均 CLOSED（契约落点见 §7 注） |