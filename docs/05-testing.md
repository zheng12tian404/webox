# 05 · 测试方案、用例与执行报告

> 本文件整合 `docs/raw/test-plan.md`（测试方案设计师，G3 回写版）、`docs/raw/test-cases.md`（85 用例）与 Stage 4/5/5c 已落盘证据。
> **终版口径（Stage 5e，2026-11-14 23:20 CST）**：以 `docs/raw/test-report-v3.md`、`docs/raw/product-acceptance-v3.md` 为最新结论来源，Stage 5c 的 `test-report-v2.md`、`product-acceptance-v2.md`、`backend-rereview.md`、`architecture-review-closure.md` 作为基线；缺陷关闭与残余项见 §5.6（Stage 5c）与 §5.7（Stage 5e 终版）。
> **重要口径**：文档节点的职责是归档可核验证据，不替代测试执行工程师的报告。凡未取得命令输出的 AC，一律标 `NOT TESTED`，不得视为通过。

## 5.1 测试范围

| 层 | 内容 | 工具/脚本 |
|---|---|---|
| 单元 | 金额分计算、截单六边界与跨日、哈希、状态机、LIKE 转义 | JUnit 5（`backend/src/test/java/com/webox/UtilTest.java`） |
| 集成 | 测试库隔离、鉴权/校验/403、幂等重放与冲突、5 并发同键 1 单、6 人抢 3 份不超卖 | Spring Boot Test（`WeBoxApiIT`，`@ActiveProfiles("test")`，库 `req_6343a752e110_test`） |
| 接口契约 | 健康、登录、菜单、详情、预览、下单、重放、异体、重复单、取消、403、售罄 409、审计、看板、对账、AI 降级、401/400 边界 | `backend/scripts/smoke.sh` |
| 并发/幂等 | 15 用户抢 5 份；同键 5 并发 + 2 串行 | `tests/concurrency/order_race.mjs`、`tests/concurrency/idempotency_race.mjs` |
| 交易时序 | 30 分钟超时释放（SQL 回拨 + 两个调度周期）、Redis 整单补偿、测试时钟拒绝、SSE ticket、对账 | `backend/scripts/g3_checks.sh` |
| 前端 | `tsc --noEmit`、生产构建、真实后端联调、响应式截图（375/768/1440） | `npm run build`、`agent-browser`、`tests/e2e/` |

**明确不测**：支付/退款（PRD 无资金流）、真实 LLM 输出质量（无 Key）、多实例分布式调度、浏览器兼容矩阵（仅 Chromium）。

## 5.2 运行命令

```bash
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export PATH=/opt/gem/bin:/opt/nvm/versions/node/v22.22.3/bin:$JAVA_HOME/bin:/opt/maven/bin:$PATH
export MYSQL_HOST=127.0.0.1 MYSQL_PORT=3306 MYSQL_USER=test MYSQL_PASSWORD=test123456

# 1) 后端单测 + 集成测试（独立测试库）
cd backend && /opt/maven/bin/mvn test

# 2) 启动后端（本机 8083；标准 8080）
SERVER_PORT=8083 MYSQL_DATABASE=req_6343a752e110 REDIS_ENABLED=true \
  java -Duser.timezone=Asia/Shanghai -jar target/webox-backend.jar

# 3) 接口冒烟
BACKEND=http://127.0.0.1:8083 bash backend/scripts/smoke.sh

# 4) 交易时序专项
BACKEND=http://127.0.0.1:8083 bash backend/scripts/g3_checks.sh

# 5) 并发/幂等
node tests/concurrency/order_race.mjs
node tests/concurrency/idempotency_race.mjs

# 6) 前端
cd frontend && npm run typecheck && npm run build
```

## 5.3 已执行证据（Stage 4/5 落盘）

| # | 证据文件 | 执行内容 | 结果 |
|---|---|---|---|
| 1 | `artifacts/evidence/backend/mvn-test.log` | `mvn test` | `Tests run: 10, Failures: 0, Errors: 0, Skipped: 0`；`BUILD SUCCESS` |
| 2 | `artifacts/evidence/backend/concurrency/order_race.log` | 15 用户抢 5 份 | PASS 8 / FAIL 0；5 个 201、10 个 409 `STOCK_INSUFFICIENT`；`available=0`、`reserved+sold<=total`、ledger RESERVE=5 |
| 3 | `artifacts/evidence/backend/concurrency/idempotency_race.log` | 同键 5 并发 + 2 串行、异体、缺键 | PASS 6 / FAIL 0；7 次响应同一 `orderId`；DB 仅 1 单；仅 1 条 RESERVE；异体 409 `IDEMPOTENCY_CONFLICT`；缺键 400 |
| 4 | `artifacts/backend-smoke.txt` | 26 项冒烟（健康/登录/菜单/详情/预览/下单/重放/异体/重复单/取消/403/售罄/审计/看板/对账/AI） | `SMOKE COMPLETE`，各期望状态码与错误码命中 |
| 5 | `artifacts/backend-g3-checks*.txt` | 30 分钟超时释放、Redis 整单补偿、测试时钟、SSE ticket、对账、状态机 | 关键断言通过；`Completed→Cancelled` 409、缺 reason 400、审计前后值落库 |
| 6 | `artifacts/backend-testclock.txt` | `X-Test-Clock` 六边界/非 test profile 拒绝 | 与 AC-024/025 预期一致（详见文件） |
| 7 | `artifacts/evidence/frontend/frontend-build.log` | `tsc --noEmit && vite build` | `exit=0`；`dist` 生成 |
| 8 | `artifacts/evidence/frontend/*.png` | 登录/菜单/详情/购物车/结算/订单/偏好/Console/看板；375/768/1440 | 截图存在，无横向滚动，菜单 1/2/3 列 |
| 9 | `artifacts/evidence/frontend/frontend-real-api.log` | 真实后端联调（审计、403、preview） | 403 命中；preview 返回 `effectiveDate/effectiveMeal/autoSwitched/budgetExceeded` |
| 10 | `artifacts/backend-8084-refresh-check.log` | 文档节点回归 `POST /auth/refresh` | `health UP`、`login OK`、`refresh OK`（P1 修复验证） |

## 5.4 Tier 1 / Tier 2 AC 覆盖（证据归档口径）

> 状态含义：**PASS** = 有命令/DB 输出直接覆盖；**PARTIAL** = 有 UI 截图或间接证据、缺完整接口断言；**NOT TESTED** = 本次未取得执行证据，等待 `test-report.md`。

| AC | 能力 | 状态 | 主要证据 |
|---|---|---|---|
| AC-001 注册 | PASS | `mvn test`（WeBoxApiIT）、smoke |
| AC-002 重复邮箱 | PASS | WeBoxApiIT、smoke |
| AC-003 注册校验 | PASS | WeBoxApiIT、smoke |
| AC-004 登录 + 刷新保持 | PASS | smoke + `backend-8084-refresh-check.log`（refresh OK） |
| AC-005 登录限流 429 | PARTIAL | 登录限流已实测触发 429（夹具 20/min/IP，见 `test-report.md` §1）；第 11 次精确边界未单独签收 |
| AC-006 菜单分页/字段 | PASS | `artifacts/evidence/backend/api/api-menu.json`、smoke |
| AC-007 分类多选 | PASS | smoke / api-menu |
| AC-008 搜索 + 注入 | PASS | WeBoxApiIT（LIKE 转义）、smoke |
| AC-009 详情/选项组 | PASS | api-menu.json、smoke |
| AC-010 选项加价/非法选项 | PASS | WeBoxApiIT、smoke |
| AC-011 购物车行身份/合并 | PARTIAL | 前端截图 `frontend-cart.png`；无独立 E2E 断言 |
| AC-012 数量/总价/持久化 | PARTIAL | 前端截图；localStorage 设计见 02 |
| AC-013 结算预览 | PASS | smoke、`frontend-real-api.log`（preview） |
| AC-014 下单 + 快照 + 库存 | PASS | smoke、WeBoxApiIT、DB 断言 |
| AC-015 幂等并发/异体/缺键 | PASS | `idempotency_race` PASS 6/0 |
| AC-016 服务端重算 | PASS | smoke（伪造价格被忽略）、WeBoxApiIT |
| AC-017 订单可见性/防枚举 | PASS | smoke（他人订单 404） |
| AC-018 取消回补一次 | PASS | smoke + g3_checks（ledger 唯一） |
| AC-019 非 Pending 取消 409 | PASS | g3_checks（Completed→Cancelled 409） |
| AC-020 每单 ≤5 份 | PASS | 前端 `frontend-5-item-limit.png` + API 400 `ORDER_LIMIT_EXCEEDED`（smoke） |
| AC-021 过敏原提醒 | PASS | Stage 5c：卡片加购弹窗 Cancel 不入车、Add anyway 入车（`artifacts/s5c-product/b2-allergen-modal.png`）；跨账号缓存残留另记 S5C-D-001 |
| AC-022 For You 软排序 | PASS | Stage 5c：`/menu?sort=for-you` 10 个高亮、20 卡片全展示（`s5c-product/b4-for-you.png`） |
| AC-023 预算提示不阻断 | PASS | Stage 5c：预算 1500/商品 2200 → preview 200 且 `budgetExceeded=true` |
| AC-024 午餐截单三边界 | PASS | `UtilTest` 六边界 + `backend-testclock.txt` |
| AC-025 晚餐截单/跨日 | PASS | `UtilTest` 六边界 + `backend-testclock.txt` |
| AC-026 同日同餐次唯一单 | PASS | smoke（409 `ORDER_DUPLICATE` + existingOrderId） |
| AC-027 跨餐次/跨日/取消后再下 | PARTIAL | smoke 覆盖部分；取消后再下未见单独断言 |
| AC-028 员工访问 Console 403 | PASS | smoke、`frontend-real-api.log`（403） |
| AC-029 菜品 CRUD/图片 | PARTIAL | Console 截图 + smoke 部分；5MB 非图片未见执行 |
| AC-030 上下架可见性 | PASS | Stage 5c：`confirm=false` 400；`confirm=true` 200，员工菜单 20→19→20（`s5c-product/ac030-032-curl.log`） |
| AC-031 每日菜单/库存设置 | PASS | Stage 5c：`PUT /admin/daily-menu` 与改库存均 200 + 审计（`s5c-product/ac030-032-curl.log`） |
| AC-032 改价审计/原因/回滚 | PASS | Stage 5c：confirm=false 400 无审计；confirm=true 200，before/after/reason/ip 落库；缺 reason 400 |
| AC-033 地址脱敏/敏感字段 | PARTIAL | 代码与 smoke 覆盖部分字段；未做全响应 grep |
| AC-034 低库存/售罄 UI | PARTIAL | 菜单/售罄截图；`Only 3 left` 视觉未单独验证 |
| AC-035 50 并发抢 10 | PASS | Stage 5c：`ready=50/50`、201=10、409_STOCK=40、`available=0`、ledger RESERVE=10（`artifacts/test-conc-order.log`、`s5c-test-regress4.log`） |
| AC-036 SSE 实时库存 | PARTIAL | 单客户端实测：改库存后 28ms 收到 `event:stock`，Redis=DB（`architecture-review-closure.md` §2）；双客户端时序未测 |
| AC-037 取消后实时恢复 | NOT TESTED | 未见取消后 SSE 恢复断言 |
| AC-038 AI 候选硬过滤 | PASS | smoke（器皿/过敏原过滤原因输出） |
| AC-039 AI SSE 事件顺序 | PASS | smoke（`meta→dish→reason→done`） |
| AC-040 无 Key 规则降级 | PASS | smoke（`fallback:true` + 规则理由） |
| AC-041 规则版本/回滚/无 Key 泄漏 | PARTIAL | 规则接口与审计有证据；≤60s 生效与 grep 未测 |
| AC-042 看板一致性 | PASS | 产品验收 v1/v2：`orders=2/revenue=17100` 与 DB 聚合一致（`product-acceptance.md` §1） |
| AC-043 Redis/DB 双策略降级 | PASS | g3_checks（整单补偿、Redis 故障降级 DB） |
| AC-044 对账零漂移 | PASS | smoke/g3_checks（drift=0）；50/10 并发后 `reconcile drift=[]` |
| AC-045 50 QPS 性能 | PARTIAL | 抽样：菜单 p95=7ms（n=198）、5xx=0（`test-api-perf.log`）；50 QPS×60s 未跑 |
| AC-046 10 QPS 下单性能 | PARTIAL | 抽样：下单 p95=39ms（n=10）、5xx=0；10 QPS×60s 未跑 |
| AC-047 统一错误包络 | PASS | smoke（400/401/403/404/409/429/500 路径） |
| AC-048 超长输入边界 | PASS | WeBoxApiIT（边界 200/50/64） |
| AC-049 限流阈值 | PARTIAL | 下单 5/min/用户：第 6 次 429 `RATE_LIMITED`（BR/S5c 实测）；登录 20/min 已触发；AI 10/min 未单独签收 |
| AC-050 无密钥/明文密码 | PASS | schema 中 BCrypt `$2b$`；未见明文；构建产物未含 Key（`defect-log.md`、代码审查） |
| AC-051 横向越权/篡改 token | PASS | smoke（404/401）、S5c 回归（员工读他人订单 404） |
| AC-052 响应式三断点 | PARTIAL | 375/768/1440 截图存在；`run_e2e.sh` 横向滚动断言为空跑（D-FE-04），未重跑 |
| AC-053 防重复点击 | PARTIAL | 结算同 tick 双击仅 1 个 `POST /orders`（S5c PASS）；菜单 500ms 连点 10 次加购未单测 |
| AC-054 金额整数分 | PASS | `UtilTest`、API `priceDisplay` 正则、DB BIGINT |
| AC-055 订单快照冻结 | PASS | smoke（改价后历史订单不变）；S5c 订单快照 283 字节落库 |
| AC-056 种子数据 | PASS | 20 道菜、当日库存、账号可登录、可下单（`product-acceptance.md` §1） |
| AC-057 全英文/金额格式 | PASS | 前端可见中文 0 处；菜单 20 条 `priceDisplay` 全部匹配 `^¥[0-9]+\.[0-9]{2}$` |
| AC-058 健康/备份恢复/告警 | PASS | `health` 200；`backup.sh`→`restore.sh` 8 张核心表行数 MATCH；`docs/raw/observability.md` 含 5xx>1%/P95>1s/drift>0 |
| AC-059 多实例兼容 | N/A | 设计兼容（JWT 无状态、唯一键在 DB）；双实例实跑按 AC 口径记 `N/A` |
| AC-060 30 分钟超时释放 | NOT TESTED | `@Scheduled` 未被测试时钟推进；自动完成（DEF-005）不等价于超时取消 |

**结论（Stage 5c 终版）**：Tier 1/2 共 33 条 = **PASS 27 / PARTIAL 6 / NOT TESTED 0**。原 P0（D-BE-11 confirm、PA-D-001 Console 500）与全部 P1 修复项已由后端复评、架构关闭复核、产品复验与测试回归四方独立确认 CLOSED。**新发现 open P1 1 个（S5C-D-001 跨账号偏好缓存残留）**，GO 前需前端修复并复验；P0=0。未取得执行证据的项仍标 `NOT TESTED`，不得计入通过。

## 5.5 Stage 5 已知未测项（历史基线，Stage 5c 更新见 §5.6）

1. 登录/下单/AI 限流 429（AC-005/049）——5c 部分补齐：下单 5/min、登录 20/min 已实测，AI 10/min 仍缺。
2. 50 QPS 菜单、10 QPS 下单持续压测（AC-045/046）——5c 仍为抽样 P95，未做 60s 持续压测。
3. 50 并发用户夹具——5c 已补齐并通过（50/50 就绪、10 成功/40 冲突）。
4. 真实 LLM 质量、超时与乱序（无 Key）——未变。
5. 多实例 30 分钟超时调度（单实例已验证）——未变（AC-059 记 N/A）。
6. 支付/退款（PRD 无资金流，不实现）——未变。
7. AC-022/037/053 等未取得完整输出——5c 已补齐 AC-022；AC-037/053 仍为 PARTIAL。

## 5.6 Stage 5c 终版执行结论（2026-11-14 23:08 CST）

### 5.6.1 结论

| 项 | 结论 | 依据 |
|---|---|---|
| P0 未关闭数 | **0** | D-BE-11、PA-D-001 均 CLOSED（BR + Architecture + Test + Product 四方复核） |
| P1 未关闭数 | **1** | **S5C-D-001** 跨账号偏好缓存残留（前端 `authStore.logout` 未清 `webox.prefs.v1`，`ensurePrefs()` 命中缓存即返回）；GO 前需修复 + 复验 |
| Tier 1/2 定向回归 | **24/24 PASS** | `docs/raw/test-report-v2.md` §2–§3 |
| 产品 19 条必查复验 | **19/19 PASS**（v1：16 PASS/2 FAIL/1 NOT TESTED） | `docs/raw/product-acceptance-v2.md` §2 |
| 后端复评 | **PASS**，P0/P1 全 CLOSED，P6+ 五项保持 PASS | `docs/raw/backend-rereview.md` §0/§4 |
| 架构关闭复核 | **PASS**，2 Blocker + 7 Major 全 CLOSED | `docs/raw/architecture-review-closure.md` §1–§2 |
| 可运行性 | `mvn test` **17/17 PASS**；`package` exit 0；`/health` 200（db/redis/cache UP） | `backend-rereview.md` §2 |

> 口径冲突处理：产品复验 v2 结论为“无 open P0/P1”，但测试复验 v2 新登记了 **S5C-D-001（P1）**；本文件采用更严格口径，按 **open P1 = 1** 记录，避免门禁虚报。

### 5.6.2 回归矩阵（Stage 5c）

| 范围 | 结果 | 证据 |
|---|---|---|
| confirm 二次确认（改价/上下架/每日菜单/改库存/AI 规则） | PASS 7/7 端点：`confirm=false` → 400 `VALIDATION_CONFIRM_REQUIRED`，DB 与审计 delta=0；`confirm=true` → 200 + before/after | `artifacts/s5c-test-regress.log`、`s5c-backend-rereview-evidence.log` |
| 幂等（同键 3 并发 + 1 串行） | PASS：同一 `orderId`、DB 1 单、1 条 RESERVE；异体 409；缺键 400 | `artifacts/s5c-test-idem-final.log` |
| 防超卖 50/10 | PASS：201=10、409_STOCK=40、`available=0`、ledger 增量 10、drift 空（112ms） | `artifacts/test-conc-order.log`、`s5c-test-regress4.log` |
| 取消回补一次 | PASS：1 条 RELEASE，二次取消 409 | `artifacts/s5c-test-regress.log` |
| refresh 轮换 | PASS：refresh 200 → `/me` 200 → 旧 refresh 401 `AUTH_TOKEN_INVALID` | 同上 |
| 偏好/过敏原/For You/预算 | PASS：保存回读一致；卡片加购弹窗、Cancel 不入车；10 个 For You 高亮；预算超限不阻断 | `s5c-product/ac021-023-api.log`、`b2/b3/b4/b7/b8-*.png` |
| 双击下单/重复单 | PASS：同 tick 双击仅 1 个 POST、成功页、购物车清空；重复单 409 + `existingOrderId` + 前端已有订单入口 | `s5c-fe-double-submit-success-clean.png`、`b5/b6-*.png` |
| 权限/越权/注入/金额/截单 | PASS：员工 403、他人订单 404、SQLi 无泄露、整数分、自动切换与过去日期 400 | `s5c-test-regress.log` |
| GateWay 之外的业务写审计 | PASS：改价/上下架/每日菜单/库存/AI 规则审计含 before/after/reason/ip/requestId | `product-acceptance-v2.md` §1.1 |
| 自动完成（DEF-005） | PASS（运行实测）：23:00:16 `Auto-completed 1 confirmed orders past delivery day`；同日 23:59 分支未实现（R-09，P3） | `backend-8083-s5b.log:6418` |
| SSE/Redis/DB（管理端改库存） | PASS：`event:stock` 28ms 到达；Redis=DB（49/49、恢复 46/46）；7 处缓存失效均 `afterCommit` | `backend-rereview.md` §1.5 |
| 备份/恢复 | PASS：新备份→临时库 17 表，8 张核心表行数全部 MATCH | `s5c-backend-rereview-evidence.log` |

### 5.6.3 缺陷关闭 / 残余项

| ID | 级别 | 内容 | 终态 | 证据 |
|---|---|---|---|---|
| D-BE-11 / G4-BE-B1 / G4A-B1 / G3P-M3 | P0 | 高风险写接口 `confirm` 门禁 | **CLOSED** | 7 端点 400；DB/审计不变（BR/Arch/Test/Product） |
| PA-D-001 / G4A-B2 | P0 | Console 写操作 500（`LocalDateTime` 序列化） | **CLOSED** | 8083 PID 1385859 加载 22:51:39 jar；改价/上下架/库存 200 + 审计 |
| D-BE-12 / G4-BE-M1 / G4A-M8 | P1 | 重复单 Redis 二次补偿 | **CLOSED** | `prealloc=null` 后外层判空；DB 幂等回归通过 |
| DEF-002 | P1 | 下单 5/min/用户限流 | **CLOSED** | 第 6 次 429；跨用户隔离 |
| DEF-003 | P1 | 备份/恢复脚本与告警文档 | **CLOSED** | 脚本 + `docs/raw/observability.md` + 恢复行数 MATCH |
| DEF-004 | P1 | 管理端改库存/菜单不发 SSE、不同步 Redis | **CLOSED** | 28ms 事件、Redis=DB |
| DEF-005 | P1 | Confirmed 过期自动完成 | **CLOSED** | 运行日志实测 |
| DEF-006 / D-FE-02 | P1 | 卡片快捷加购绕过过敏原确认 | **CLOSED** | 三入口共用 `useAddToCart`；Cancel/Add anyway 实拍 |
| DEF-007 | P1 | 缓存失效在事务内 | **CLOSED** | 7 处 `Util.afterCommit` |
| D-FE-01 / FR-B1 | P0 | 偏好默认值无法保存 | **CLOSED** | 默认/整页保存 200，刷新后保留 |
| D-FE-03 | P1 | 结算重复提交无同步闩锁 | **CLOSED** | 同 tick 1 POST、成功页、购物车清空 |
| D-BE-10 | P2 | AI 规则常规更新 500 | **CLOSED** | `PUT /admin/ai-rules` 200、version=4 |
| PA-D-002 | P2 | 50 并发受登录限流 | **CLOSED** | 50/50 就绪、50/10 通过 |
| PA-D-003 / DEF-012 | P2 | 启动脚本/204 死分支 | **CLOSED** | `start.sh` 固定 JDK17+health；204 分支已删 |
| **S5C-D-001** | **P1** | **跨账号偏好缓存残留（登出不清 `webox.prefs.v1`）** | **OPEN** | `frontend/src/store/authStore.ts:38-49` 未 `setPrefs(null)`；`prefsStore.ts:30-34` 缓存优先 |
| S5C-D-002 | P2 | 同键第 6 次重试返回 429 而非幂等重放 | OPEN（设计确认） | `test-report-v2.md` §4 |
| S5C-D-003 / TE-D-003/004/005 | P3 | 测试基建：共享 `_test` 库、reset 脚本、浏览器会话 | OPEN（测试基建） | `defect-log.md` |
| DEF-009/010/011/013/014/015/016、D-FE-04、TE-D-001/002、PA-D-004 | P2/P3 | 文档措辞、requestId、JWT 长度、ticket、CHECK 映射、响应式脚本、邮箱边界、preview 地址、未知路由 500 | OPEN（Owner/SLA 见 `defect-log.md`） | `defect-log.md` |

### 5.6.4 NOT TESTED（Stage 5c 终版）

1. **AC-060** 30 分钟未确认超时取消（`@Scheduled` 无法被 `X-Test-Clock` 推进；DEF-005 自动完成不等价）。
2. **AC-037** 取消后 SSE 实时恢复（未取得恢复断言）。
3. **AC-045/046** 50 QPS×60s、10 QPS×60s 持续压测（仅有抽样 P95=7ms/39ms）。
4. **AC-052** 三档响应式横向滚动 E2E 断言（D-FE-04 脚本空跑，仅截图）。
5. **AC-053** 菜单 500ms 连点 10 次加购（仅结算双击提交实测）。→ **Stage 5e 已补齐加购连点**：产品 v3 实测 10 连点后购物车仅 1 行 qty=1；结算页 10 连点沿用 Stage 5c 证据，AC-053 改判 PASS（见 §5.7）。
6. **真实 LLM** 输出质量、首 token/总时延、乱序（无 `LLM_API_KEY`；规则降级已验）。
7. **图片上传 UI 全流程**、双客户端 SSE 时序、多实例部署（AC-059 记 N/A）。
8. **D-BE-12 的 REDIS_PREALLOC 重复单运行时断言**（仅代码路径 + DB 幂等回归）。

### 5.6.5 证据索引

| 证据 | 路径 |
|---|---|
| 测试回归 v2 | `docs/raw/test-report-v2.md`；`artifacts/s5c-test-regress*.log`、`s5c-test-idem-final.log`、`s5c-test-regress4.log` |
| 产品复验 v2 | `docs/raw/product-acceptance-v2.md`；`artifacts/s5c-product/` |
| 后端复评 | `docs/raw/backend-rereview.md`；`artifacts/s5c-backend-rereview-evidence.log` |
| 架构关闭复核 | `docs/raw/architecture-review-closure.md`；`artifacts/s5c-architecture-closure-evidence.txt` |
| 缺陷台账 | `docs/raw/defect-log.md`（含 S5C-D-001/002/003） |
| 前端证据 | `artifacts/s5c-fe-*.png`、`artifacts/s5c-product/b*.png` |
| 50/10 并发 | `artifacts/test-conc-order.log` |

### 5.6.6 Scenario checks（active_profiles）

| Profile | 结论 | 证据 / 说明 |
|---|---|---|
| `general-engineering` | **PASS** | health 200；`mvn test` 17/17；前端构建 exit 0；英文/金额格式 |
| `transaction-order` | **PASS** | confirm 门禁、幂等、唯一单、条件扣减、ledger、取消回补、50/10、快照、截单 |
| `identity-access` | **PASS** | 员工 `/admin` 403、越权 404、BCrypt、confirm+审计、refresh 轮换 |
| `ai-llm` | **PASS（设计/降级）**；真实 LLM `NOT TESTED` | 候选过滤、无 Key 降级、事件顺序；真实模型无 Key 未验 |

## 5.7 Stage 5e 终版状态（2026-11-14 23:20 CST）

> 来源：`docs/raw/test-report-v3.md`（测试侧独立复验，23:17–23:19）、`docs/raw/product-acceptance-v3.md`（产品定向复验，23:40 记录）、`docs/raw/defect-log.md` 台账。Stage 5e 只做 P1 定向复验 + 冒烟回归，未重跑 Tier 3 全量；Tier 3 结论沿用 Stage 5c/5e 已有证据。
> 说明：两份 v3 报告均已实际生成并纳入，未使用 NOT TESTED 占位。

### 5.7.1 结论汇总

| 项 | 结论 | 依据 |
|---|---|---|
| **S5C-D-001**（P1，跨账号偏好/购物车残留） | **CLOSED**：Stage 5d 修复 → Stage 5e 测试独立复验 PASS → Stage 5e 产品定向复验 PASS | `test-report-v3.md` §2；`product-acceptance-v3.md` §1/§3；`defect-log.md` |
| P0 未关闭数 | **0** | `defect-log.md` |
| P1 未关闭数 | **0**（“GO 前无 open P0/P1”门禁已满足） | `product-acceptance-v3.md` §0/§3；`defect-log.md` 门槛行 |
| 测试侧快回归 | **15/15 PASS**（S5C-D-001 定向 6 项检查 + 冒烟 9/9） | `test-report-v3.md` §2/§3/§6 |
| 产品侧定向复验 + 回归 | **PASS**：AC-021/022/023 跨账号隔离；AC-030/032/014/015/053 回归 | `product-acceptance-v3.md` §1/§2 |
| 前端构建（Stage 5d 修复后） | `tsc --noEmit && vite build` exit 0 | `artifacts/s5d-build.log` |

### 5.7.2 S5C-D-001 复验矩阵（测试侧 + 产品侧）

| 场景 | 期望 | 测试侧（v3） | 产品侧（v3） |
|---|---|---|---|
| A（过敏原 Peanuts）加购 Kung Pao Chicken | 弹 Peanuts 确认，确认前不入车 | PASS | PASS（`a2-modal-peanuts.png`） |
| A 登出 | `auth`/`prefs`/`cart` 均为 `null` | PASS | PASS（`a3-after-logout.png`） |
| B（无过敏原）登录后**不访问 Preferences**直接加购同菜 | 不弹窗，按 B 偏好入车；`ownerUserId=122` | PASS | PASS（`b1-no-modal.png`） |
| B 登出 | 三键均 `null` | PASS | PASS（`b2-after-logout.png`） |
| A 重新登录再加购 | 重新拉取 A 偏好（`ownerUserId=121`）并再次弹窗 | PASS | PASS（`a4-return-modal.png`） |
| 最终登出 | `{auth:null,prefs:null,cart:null}` | PASS | PASS |

证据：测试侧 `artifacts/s5e-cross-account.log`、`s5e-cross-account-raw.log`、`s5e-prefs-server.log`、`s5e-a-peanuts-modal.png`、`s5e-b-no-modal.png`、`s5e-a-modal-again.png`；产品侧 `artifacts/s5e-product/{run-a-flow.log,run-b-flow.log,run-a-return.log,a2-modal-peanuts.png,b1-no-modal.png,a4-return-modal.png}`。

### 5.7.3 Tier 1 / Tier 2 结果（终版）

| Tier | AC 范围 | PASS | PARTIAL | NOT TESTED |
|---|---|---|---|---|
| Tier 1 | AC-001–019（19 条） | 16 | 3（AC-005 精确限流边界、AC-011/012 购物车 UI E2E 断言） | 0 |
| Tier 2 | AC-020–033（14 条） | 11 | 3（AC-027/029/033） | 0 |
| **Tier 1/2 合计** | **33 条** | **27** | **6** | **0** |

Stage 5e 产品 v3 本轮复验 AC-014/015/030/032 与 AC-021/022/023 均为 PASS；其中 AC-021/022/023 由 PARTIAL/FAIL（S5C-D-001）转为 **PASS**。Tier 3 与 NFR 状态不因 5e 变化，仅 AC-053 由 NOT TESTED 转 PASS（见 5.7.4）。

### 5.7.4 AC-053 状态变更

- 产品 v3 §2：500ms 内对 `add-to-cart-1` 连点 10 次 → 购物车仅 1 行 `qty=1`、无重复加购（`artifacts/s5e-product/run-ac053.log`、`ac053-doubleclick.png`）**PASS**。
- 结算页 10 连点仅 1 单沿用 Stage 5c 证据（`artifacts/s5c-product/b5-double-submit-success.png`），标 `PASS（复用）`。
- 因此 AC-053 由 `NOT TESTED` 改判 **PASS**；NFR 汇总相应变为 PASS 10 / PARTIAL 4 / NOT TESTED 1（AC-060）/ N/A 1（AC-059）。

### 5.7.5 NOT TESTED（Stage 5e 终版，未取得执行证据，不得视为通过）

1. **真实 LLM** 输出质量、首 token/总时延、乱序（环境无 `LLM_API_KEY`；规则降级路径已验）。
2. **AC-060** 30 分钟未确认超时取消（`@Scheduled` 无法被 `X-Test-Clock` 推进）。
3. **AC-037** 取消后 SSE 实时恢复（未取得恢复断言）。
4. **AC-045/046** 50 QPS×60s、10 QPS×60s 持续压测（仅有抽样 P95=7ms/39ms）。
5. **AC-052** 三档响应式横向滚动 E2E 断言（脚本空跑，仅截图）。
6. **DEF-005 跨日分支**：自动完成仅判 `delivery_date < today`，同日 23:59 跨日边界未实现/未测（R-09，P3）。
7. **图片上传 UI 全流程**、双客户端 SSE 时序、多实例部署（AC-059 记 `N/A`）。
8. **D-BE-12 的 REDIS_PREALLOC 重复单运行时断言**（仅代码路径 + DB 幂等回归）。
9. **跨设备 / 多标签页同时登录不同账号**（PRD 未要求；`product-acceptance-v3.md` §6.4 记 NOT TESTED）。

### 5.7.6 已知限制（Stage 5e）

1. 端口：8080 被 nginx、5173 被其他工作区占用，实测后端 8083、前端 5175。
2. 单实例调度：AC-060 未测，多实例需分布式锁。
3. 性能：仅抽样 P95，未做持续压测与容量规划。
4. AI：无 Key，仅验证规则降级；真实模型质量未知。
5. 残余 P2/P3：`S5C-D-002`（同键第 6 次重试 429）、`S5C-D-003`/`TE-D-003/004/005`（测试基建）、`PA-D-004`（未知路由 500）、`DEF-009/010/011/013/014/015/016`、`D-FE-04`、`TE-D-001/002`；均有 Owner/SLA，详见 `docs/raw/defect-log.md`，不阻断 GO。
6. 测试工具副作用（如实披露）：产品 v3 首轮 agent-browser 共享会话残留历史测试账号 `s5c_e2e2@webox.com`，清空前曾保存过一次 Peanuts；与验收账号 A/B 无关，未改动菜品/订单/库存（`artifacts/s5e-product/run-a-prefs.log`）。

### 5.7.7 Scenario checks（Stage 5e）

| Profile / 检查 | 结论 | 证据 |
|---|---|---|
| `identity-access`：跨账号偏好/购物车隔离（登出清内存 + localStorage） | **PASS** | `test-report-v3.md` §2/§5；`product-acceptance-v3.md` §1/§4 |
| `identity-access`：过敏原提示按当前账号判定（弹/不弹/再弹） | **PASS** | 同上 |
| `transaction-order`：下单 + 同键幂等重放（orderId=18/19 一致） | **PASS** | `test-report-v3.md` §3；`product-acceptance-v3.md` §2 |
| `transaction-order`：confirm 门禁 + 审计（AC-032） | **PASS** | `product-acceptance-v3.md` §2 |
| `general-engineering`：health/菜单/订单列表可用性、员工 `/admin` 403 | **PASS** | `test-report-v3.md` §3 |
| `ui-safe`：过敏原提醒不阻断、可 Add anyway；连点不重复加购 | **PASS** | `product-acceptance-v3.md` §2/§4 |

---

# 附 A：测试方案（`docs/raw/test-plan.md` 全文）
# 测试方案 — WeBox 企业员工餐食订购平台

- 版本：v1.1（G3 回写，2026-11-14 22:14 CST；依据 `docs/raw/cross-review-g3-test.md`）
- 前版：v1.0（Stage 2 Test Designer，2026-11-14 21:58 CST）
- 上游：`docs/raw/PRD.md`、`RUNBOOK.md` D1–D22、`docs/raw/prd-analysis.md`、`docs/raw/acceptance-matrix.md`（AC-001…060）、`docs/raw/scenario-profile.md` v2、`docs/raw/assumptions.md`
- 配套：`docs/raw/test-cases.md`（TC-001…TC-086）、`tests/`（可执行脚手架）、`docs/raw/cross-review-g1-test.md`、`docs/raw/review-findings.md`
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
3. 契约冻结：`docs/raw/api-contract.md` 含 §7 测试钩子（至少 H1/H3/H4/H5/H6/H7）。

**准出（Exit）**
1. Tier1/2 的 P0 AC 全部 PASS；P1 允许 ≤2 条 `NOT TESTED` 且有理由；Tier3 按 `N/A` 诚实标注。
2. 并发/幂等/取消/越权/注入/金额六类专项均有命令输出 + DB 前后快照。
3. 无 open P0/P1 缺陷；P2 有 Owner 与截止。
4. `docs/raw/test-report.md` 含 AC→结果→证据路径三列，缺证据不得 PASS。

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

> 用例详情见 `docs/raw/test-cases.md`；层级：U=单元、I=集成、A=API、C=并发、D=DB、E=E2E、R=审查、P=性能。自动化：`AUTO`=脚本可跑，`MAN`=人工/半自动（截图）。Tier3 未实现时状态列统一 `N/A(T3)`。

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

> 闭环状态（2026-11-14 22:10）：Architecture 已在 `api-contract.md` 落地全部钩子——`X-Test-Clock`（§1，#20）、`PATCH /admin/orders/{id}/status`（#24）、`PUT /admin/daily-menu/{date}/{dishId}/stock`（#32）、`GET /admin/inventory/reconcile` + `POST /admin/inventory/adjust`（#33/#33b）、`Idempotency-Key`（§1/§3.2）、SSE 事件（§3.3）、`requestId`+`X-Request-Id`（§1）。G1T-B1/B2/M1~M8 见 `docs/raw/review-findings.md` 均已 CLOSED。下表 H 编号与契约端点对应，Stage 5 按契约执行。

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

G3 评审（`docs/raw/cross-review-g3-test.md`）结论 CHANGES，本轮回写口径：

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
| P0 | 超卖/负库存、重复有效单、幂等失效、金额错误、越权成功、主链路 5xx、明文密码 | 立即进 `docs/raw/defect-log.md`，回 Stage 4 修复，复评+回归 |
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

---

# 附 B：测试用例（`docs/raw/test-cases.md` 全文）
# 测试用例 — WeBox 企业员工餐食订购平台

- 版本：v1.0（Stage 2 Test Designer，2026-11-14 22:00 CST）
- 映射：`docs/raw/acceptance-matrix.md` AC-001…AC-060（+ 建议 AC-061 提权用例 TC-084）
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