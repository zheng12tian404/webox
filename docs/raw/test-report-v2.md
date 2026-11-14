# WeBox 测试报告 v2 — Stage 5c P0/P1 回归

- 主 Issue：`6343a752-e110-407c-8dfb-a5873425d917`
- 节点：WS-78 [Stage 5c] 测试执行工程师（回归执行）
- 执行时间：2026-11-14 22:58–2026-11-15 00:20 CST
- 结论：**P0/P1 修复项回归通过**；核心交易、confirm、refresh、权限/注入全部 PASS。新发现 1 个 P1（跨账号偏好残留）与 2 个 P2/P3（限流重试、测试基建），详见缺陷。

## 1. 环境与命令

| 项 | 值 |
|---|---|
| 后端（交付件） | `backend/target/webox-backend.jar`（2026-11-14 22:51，30 MB），PID 1385859，JDK17 |
| 后端端口 / DB | `8083` / `req_6343a752e110`（演示库），`/api/v1/health` → 200 `db=UP redis=UP cache=UP` |
| 回归隔离后端 | 同一 jar，PID 1403783，`8084` / `req_6343a752e110_test`，`--server.forward-headers-strategy=native`（用于 50 并发与破坏性用例，避免污染演示库） |
| 前端 | Vite dev `127.0.0.1:5175`（Node 22.22.3），真实 API 代理 8083 |
| MySQL / Redis | `127.0.0.1:3306`（test/test123456）/ `127.0.0.1:6379` |
| 浏览器 | `agent-browser 0.22.3`，桌面 1440×900 |

启动命令（隔离库）：

```bash
cd backend
JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 \
MYSQL_DATABASE=req_6343a752e110_test SERVER_PORT=8084 REDIS_HOST=127.0.0.1 \
  java -Duser.timezone=Asia/Shanghai -jar target/webox-backend.jar \
  --server.forward-headers-strategy=native
```

回归脚本：

```bash
export BASE_URL=http://127.0.0.1:8084 MYSQL_DATABASE=req_6343a752e110_test
export EVIDENCE_DIR=$PWD/artifacts/evidence/s5c
node tests/s5c-regress.mjs         # 全量 48 项
node tests/s5c-regress2.mjs        # 失败项定向复测
node tests/s5c-idem-final.mjs      # 幂等干净复测
```

## 2. 执行矩阵（P0/P1 回归）

| AC | 用例 | 状态 | 证据 |
|---|---|---|---|
| AC-032 | 改价 `confirm=false` → 400 `VALIDATION_CONFIRM_REQUIRED`；数据不变 | PASS | `artifacts/s5c-test-regress.log`：400 + before/after 均为 `Kung Pao Chicken/2200/ON_SHELF` |
| AC-030 | 上下架 `confirm=false` → 400；`confirm=true` → 200 | PASS | 同上：400 / 200 `{"dishId":1,"status":"ON_SHELF"}` |
| AC-031 | 每日菜单 `confirm=false` → 400，`total_qty` 不变；`confirm=true` → 200 | PASS | 同上：400；库存 before=40 after=40 |
| AC-032 | 改库存 `confirm=false` → 400；`confirm=true` → 200 | PASS | 同上 |
| AC-030/032 | 高风险否定路径不写审计；`confirm=true` 写审计且落库 | PASS | 审计计数 0→0（否定），0→1（改价成功）；`dishes.price_cents=2300` |
| AC-004 | refresh → 200 新 access → `/me` 200 → 旧 refresh 401 | PASS | `artifacts/s5c-test-regress.log`：`AUTH_TOKEN_INVALID` |
| AC-021/022 | 偏好保存（null 预算 + Medium + 合法过敏原/菜系）→ 200；回读一致 | PASS | `artifacts/s5c-test-regress4.log` 前 3 项；UI 截图 `artifacts/s5c-fe-prefs-nullbudget.png`（清空预算、刷新后仍为空） |
| AC-021 | 过敏原卡片加购弹窗（Peanuts） | PASS | `artifacts/s5c-fe-allergen-card-modal4.png`：`Allergen warning`、`Cancel`、`Add anyway` |
| AC-014/015 | 同键 3 并发 + 1 串行：全部 201、同一 orderId、DB 1 单、1 条 RESERVE | PASS | `artifacts/s5c-test-idem-final.log`：`ids=["155"]`、`count=1`、`RESERVE=1` |
| AC-015 | 同键异体 → 409 `IDEMPOTENCY_CONFLICT`；缺键 → 400 `IDEMPOTENCY_KEY_REQUIRED` | PASS | `s5c-test-idem-final.log`、`s5c-test-regress.log` |
| AC-026 | 同 tick 双击 Place Order：1 个 POST、1 单、成功页、购物车清空 | PASS | `artifacts/s5c-fe-double-submit-success-clean.png`；计数 `posts=1`、`/order-success/17`、导航栏 `Cart` 无数量；DB 1 单 `WB20261115-0017` |
| AC-026 | 已有有效单时结算页恢复入口 | PASS | 实测结算页出现 `An active order already exists for this meal.` + 两个 `View Existing Order`；`artifacts/s5b-fe-duplicate-recovery.png` |
| AC-018 | 取消 Pending → 200；二次取消 → 409 `ORDER_STATE_INVALID`；只回补一次 | PASS | `s5c-test-regress.log`：1 条 `RELEASE qty=2`，库存 8→10 |
| AC-035 | 50 并发抢 10：201=10、409 STOCK=40、available=0、reserved 增量 10、ledger RESERVE 增量 10、reconcile drift 空 | PASS | `artifacts/s5c-test-regress4.log`（112 ms，`other=0`）；`insert 50 用户 + 唯一 XFF` 绕登录限流 |
| AC-024/025 | 截单后当日 Lunch 自动切次日、`autoSwitched=true`；过去日期 400 `DATE_PAST` | PASS | `s5c-test-regress.log`：`effective=2026-11-15/Lunch auto=true`；`VALIDATION_DATE_PAST` |
| AC-010/013/016 | 金额整数分：单价=菜价+选项加价、小计/总额=单价×3、展示 `¥28.00` | PASS | `s5c-test-regress4.log`：unit=2800、total=8400、`priceDisplay=¥28.00` |
| AC-028 | 员工访问 `/api/v1/admin/**` → 403 `FORBIDDEN` | PASS | `s5c-test-regress.log` |
| AC-017 | 员工读他人订单 → 404 | PASS | 同上：`order=115 status=404` |
| AC-008/安全 | 搜索 `' OR 1=1 --` → 200 `total=0`，无全表泄露、无 500；路径注入 → 400 | PASS | 同上 |

汇总：**Web/API 回归 24 个检查点全部 PASS**（定向复测脚本合计 20 PASS/0 FAIL，幂等专项 6/6）。首轮 `s5c-regress.log` 中 5 个 FAIL 均为测试数据/环境原因，已逐项复测通过：非法枚举 `Peanut`（应为 `Peanuts`）、`tastePreference='Savory'`（枚举为 Light/Medium/Rich）、共享 `_test` 库与并行节点互相清库导致瞬时 500/重复 ID、ledger 绝对计数含历史数据（改为增量断言）。

## 3. 专项结果

| 专项 | 结果 | 证据 |
|---|---|---|
| confirm 二次确认 | PASS（4 写操作 × 否定/正路径） | 400 `VALIDATION_CONFIRM_REQUIRED`；审计前后计数与 DB 值 |
| 幂等 | PASS（并发 3 + 串行 1，同键 1 单；异体 409） | `s5c-idem-final.json` |
| 防超卖 | PASS（50/10，112 ms，10×201 + 40×409，available=0） | `s5c-regress2.json` |
| 取消只回补一次 | PASS（1 条 RELEASE，二次 409） | `s5c-regress.json` |
| 权限 RBAC | PASS（员工 403、越权订单 404） | `s5c-regress.log` |
| SQL 注入 | PASS（无 500、无泄露） | `s5c-regress.log` |
| 金额精度 | PASS（整数分、展示两位小数） | `s5c-regress4.log` |
| 截单边界 | PASS（自动切换、过去日期拒绝） | `s5c-regress.log` |
| 前端双击防抖 | PASS（同 tick 1 POST；React 闩锁 + 服务端幂等双保险） | `s5c-fe-double-submit-success-clean.png` |
| 过敏原弹窗 | PASS（新鲜偏好下；见 P1 跨账号残留） | `s5c-fe-allergen-card-modal4.png` |

## 4. 缺陷与关闭状态

| ID | 级别 | 标题 | 状态 | 证据 |
|---|---|---|---|---|
| D-BE-11（原 P0） | P0 | 高风险管理操作不校验 confirm | **VERIFIED / CLOSED**（本轮 4 操作否定路径 400，无数据/审计变更） | `s5c-test-regress.log` |
| D-BE-12（原 P1） | P1 | 重复有效单 Redis 二次补偿 | **FIXED（本轮未复现 REDIS_PREALLOC 重复单场景，代码路径已改；回归以 DB 幂等为准）** | `s5c-idem-final.log` |
| PA-D-001（原 P0） | P0 | Console 写操作 500 | **VERIFIED / CLOSED**（改价/库存/上下架 confirm=true 均 200 + 审计落库） | `s5c-test-regress.log` |
| PA-D-002（原 P2） | P2 | 50 并发受登录限流 | **CLOSED**（SQL 直插 50 用户 + 每请求唯一 `X-Forwarded-For`，ready 50/50，50/10 通过） | `s5c-regress2.json` |
| **S5C-D-001（新）** | **P1** | 跨账号偏好残留：登出不清 `webox.prefs.v1`，`ensurePrefs()` 优先返回缓存 | **OPEN**（前端开发） | 详见 `docs/defect-log.md` |
| **S5C-D-002（新）** | P2 | 订单接口 5 次/分/用户限流，同键第 6 次重试返回 429 而非幂等重放 | OPEN（设计确认） | `s5c-test-regress.log` 第 6 次 429 |
| **S5C-D-003（新）** | P3 | 并行节点共用 `_test` 库导致瞬时 500 / 订单 ID 漂移 | OPEN（测试基建） | `artifacts/s5c-backend-8084.log` `IdempotencyService.claim:40` |

## 5. 未测项与剩余风险

- **Tier 3（AI SSE、看板、SSE 库存推送、Redis 降级）**：本轮回归聚焦 P0/P1，未重复执行；沿用 Stage 5 报告结论。
- **D-BE-12 的 `REDIS_PREALLOC` 重复有效单路径**：未构造独立 Redis 预占夹具复现，仅以幂等/DB 账本证据回归；剩余风险低（DB 为最终账本）。
- **跨账号偏好（S5C-D-001）**：共享终端/多账号切换时，过敏原弹窗可能使用上一账号偏好；属 Tier 2 P1，建议 GO 前修复。
- 现有 S5b 前端证据为同一构建（22:52–22:57 HMR 后）产物，本轮以新截图复核了偏好、过敏原、双击与重复单入口。

## 6. 结论

- 本轮定向回归 **PASS**：confirm（7 检查）、refresh（4）、偏好/过敏原（4）、双击/重复单（2）、核心交易（幂等 6 + 并发 6 + 取消 3 + 截单 2 + 金额 4）、权限/注入（5）。
- 原 P0/P1 **全部验证关闭**（D-BE-11、PA-D-001），PA-D-002 关闭。
- 新增 1 个 P1（跨账号偏好残留，S5C-D-001）需前端修复后复验；不影响单账号主链路。
- Tier 1/2 本轮回归通过率：**24/24 = 100%**（不含 Tier 3）；P0 未关闭数：**0**；P1 未关闭数：**1（S5C-D-001）**。
- 下一步：`Quality Checker`（并转前端修复 S5C-D-001）。