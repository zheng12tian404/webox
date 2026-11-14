# G4 架构抽检关闭复核（Stage 5c）— WeBox 员工餐食订购平台

- 复核人：Architecture（作者≠开发者）
- 时间：2026-11-14 23:01 CST
- 输入：`docs/architecture-review.md`（2 Blocker / 7 Major）、`docs/defect-log.md`、`backend/`、8083 运行实例
- 方法：契约端点逐条静态复核 + 8083 运行态实调 + 实库/审计/SSE 对照；`docs/backend-rereview.md` 未生成，以代码与运行证据为准
- **结论：PASS**（2 Blocker 全关闭；7 Major 全关闭；残余 P2/P3 已登记 Owner/SLA，不阻断 Stage 6）

## 1. Blocker 关闭

| ID | 原标题 | 复核证据 | 结论 |
|---|---|---|---|
| G4A-B1 = DEF-001 = D-BE-11 = G4-BE-B1 | 高风险写接口 `confirm=false` 仍可执行 | 静态：`Util.requireConfirm`（`Util.java:45`）接入 7/7 契约端点（AdminService 6 处 + `OrderService.adminPatchStatus`）。运行态：`confirm=false` 打 #24/#27/#28/#31/#32/#33b/#37 共 7 个端点 → **全部 400 `VALIDATION_CONFIRM_REQUIRED`**，`audit_log` 计数 20→20（delta=0），`dishes.id=1`/`orders.id=10` 数据不变；`confirm=true` → 200 且 `audit_log id=27 DISH_UPDATE`（before/after 含 `LocalDateTime` 字段）。 | **CLOSED** |
| G4A-B2 = PA-D-001 部署态 | 8083 加载旧 jar，Console 写 500 | 8083 PID **1385859** 启动于 **22:51:54**，jar mtime **22:51:39**（jar 早于进程 → 加载修复后 jar），JDK17 绝对路径 + `-Duser.timezone=Asia/Shanghai`；`/health` = 200（db/redis/cache UP）。同一进程实测：`PUT /admin/dishes/1` 200 + 审计、`PATCH /admin/dishes/1/status` 200 + `DISH_STATUS` 审计、`PUT /admin/daily-menu` 200 + `DAILY_MENU_UPDATE` 审计。 | **CLOSED** |

> 两条 Blocker 均已由第三方（BR/S5b-BE）修复，本次由 Architecture 独立复测关闭，符合作者≠评审者。

## 2. Major 关闭

| ID | 级别 | 修复点 | 复核证据 | 结论 |
|---|---|---|---|---|
| DEF-002 | P1 | 下单 5/min/用户 | `OrderService.java:102` `rateLimiter.check("order:user:"+id,5,60_000)`；干净新用户第 1–5 次 409（占配额）、**第 6/7 次 429 `RATE_LIMITED`**；admin 不受影响 | **CLOSED** |
| DEF-003 | P1 | 备份/恢复 + 告警阈值 | `backend/scripts/backup.sh`、`restore.sh`（拒绝演示库覆盖）、`docs/observability.md`（5xx>1%、P95>1s、drift>0、Redis 降级）；`artifacts/s5b-backup-restore.log`：恢复库 17 表、8 张核心表行数全 MATCH | **CLOSED** |
| DEF-004 | P1 | 管理端改库存/菜单 → SSE + Redis | `AdminService.java:47-52` `Util.afterCommit(sseHub.publishStock + redisStock.sync)`；实连 8083 SSE：PUT stock 45→收到 `event:stock available=45`，46→`available=46`；`redis GET webox:stock:2026-11-16:20` = 46 = DB available | **CLOSED** |
| DEF-005 | P1 | Confirmed 自动完成 | `ScheduledJobs.autoCompleteOrders`（60s tick，`delivery_date < today` → Completed + SYSTEM 审计）。构造 `Confirmed/delivery_date=2026-11-13` 订单：t+40s 变 `Completed`，审计 `ORDER_AUTO_COMPLETE/SYSTEM`；探针数据已清理 | **CLOSED**（跨日路径实测；同日 23:59 分支见 R-09） |
| DEF-006 | P1 | 卡片快捷加购过敏原确认 | `useAddToCart.tsx` 为唯一加购入口，命中偏好过敏原即弹 `allergen-modal`；`DishCard.tsx:20,42-51`（先取快照 allergens）、Detail、AI 三入口共用；截图 `artifacts/s5b-fe-allergen-card.png` 显示卡片加购弹窗 | **CLOSED**（Cancel 不入车的 E2E 断言交 Stage 6 回归） |
| DEF-007 | P1 | 缓存失效改 afterCommit | `AdminService.java:115/133/148/170/295/320/372` 7 处全部 `Util.afterCommit(menuService::invalidate)`；`createDish`、`publishStockAfterCommit` 同样 afterCommit；无事务路径直接执行（单测覆盖） | **CLOSED** |
| D-BE-12（DEF-008） | P1 | 重复单 Redis 二次补偿 | `OrderService` `DuplicateKeyException` 分支 `compensate` 后 `prealloc=null`，外层 catch 不再 INCRBY | **CLOSED** |

## 3. 残余偏差登记（不阻断，需 Owner/SLA）

| ID | 级别 | 内容 | 判定 | Owner / SLA |
|---|---|---|---|---|
| R-01 = DEF-009 | P2 | 包结构较 backend-design §1.2 合并（10 包），依赖方向正确、无功能缺失 | 可接受；需在 backend-design/README 增“实现偏差”段 | S5 文档节点 / 23:45 |
| R-02 = DEF-010 | P2 | Redis 预占位于 T1 事务内 | 可接受；architecture §4 现表述“禁止 Redis 写**作为正确性前提**”语义自洽，建议补一句“允许整单补偿的预占” | S2-Architecture / 23:45 |
| R-03 = DEF-011 | P2 | AI 异步线程未传播 RequestContext（MDC requestId） | 不影响交易正确性 | S5b-BE / 23:45 |
| R-04 = DEF-013 | P2 | 根 README 已写标准 8080/5173 + 实际 8083/5175；`backend/README.md:16/45/48/91` 仍写 8090 | 文档不一致，需统一 | S5 文档节点 / 23:45 |
| R-05 = DEF-014 | P2 | `JWT_SECRET` 未做 ≥32 字节启动校验 | 安全加固项 | S5b-BE / 23:45 |
| R-06 = DEF-015 | P2 | ticket 第 4 次兑换证据与 `TicketStore` 行为不一致，需重跑 TC-059b | 测试证据完整性 | S5-Test / 23:35 |
| R-07 = DEF-016 | P2 | CHECK 3819 未映射 409（当前条件 UPDATE 已规避） | 兜底映射 | S5b-BE / 23:45 |
| R-08（新） | P3 | 限流计数器在业务校验前扣减：业务 4xx（如 409 餐次不可用）也占 5/min 配额 | 可接受的防刷语义；文档注明即可，不建议冻结期改代码 | S5b-BE / 2026-11-15 |
| R-09（新） | P3 | `autoCompleteOrders` 仅判 `delivery_date < today`，未实现“同日 ≥23:59”分支；同日单在次日首个 tick 完成（≤60s 延迟） | 行为等价，文档注明 | S5b-BE / 2026-11-15 |
| R-10 | — | `frontend/src/api/client.ts` 204 死分支已删除（grep 无命中） | DEF-012 关闭 | — |
| PA-D-003 | P2 | 启动脚本已固化 JDK17 绝对路径 + 60s health 探测（`backend/scripts/start.sh`），本次 8083 即按该方式启动 | 关闭 | — |

## 4. NFR / 运行态复核

| 项 | 结果 |
|---|---|
| 健康检查 | `/api/v1/health` 200，db/redis/cache 均 UP |
| 审计链路 | confirm=true 写审计含 before/after（时间字段序列化正常）；confirm=false 零审计 |
| SSE | snapshot + `event:stock` 双事件；心跳 `:ping` 存在；Redis 与 DB 一致 |
| 数据正确性 | 探针后 `orders=11` 行、无残留测试单；`audit_log` 仅新增合法操作行 |
| 限流 | 6th=429，跨用户隔离 |

## 5. Stage 6 建议（非门禁）

1. 用 `backend/scripts/start.sh` 固定启动 8083，避免再次加载旧 jar；交付前再跑一次 `/health`。
2. 终态回归：`mvn test` + `tests/api` smoke + 50/10 并发（证据已有）+ 备份恢复脚本重跑一次（种子可能变动）。
3. 前端由 Test 执行 DEF-006 的 Cancel 不入车 E2E 断言，以及 D-FE-01/03 复评。
4. 文档同步 R-01/R-02/R-04 三处，避免契约/实现长期漂移。

## 6. G4 自检

| 项 | 结论 | 证据 |
|---|---|---|
| Blocker 逐条可复现关闭 | PASS | §1 全路径实调 + PID/jar/health |
| Major 全部复核（代码+运行） | PASS | §2 |
| 残余项有级别/Owner/SLA | PASS | §3 |
| 无 P1 未闭 | PASS | 7 项 P1 全 CLOSED |
| 证据可复核 | PASS | `artifacts/s5c-architecture-closure-evidence.txt`、`artifacts/s5c-def005-autocomplete.log`、`artifacts/s5b-*` |
| 未改业务代码 | PASS | 本次仅新增评审文档/证据 + 清理自有探针数据 |

## 7. Scenario checks

| Profile | 检查 | 结论 |
|---|---|---|
| transaction-order | confirm 门禁、幂等、唯一单、条件扣减、ledger、自动完成、SSE | PASS：7/7 高风险写被 confirm 拦截；auto-complete 实测；SSE/Redis 一致 |
| identity-access | ADMIN 路由 RBAC + 审计 | PASS：员工访问 `/admin` 403（沿用 BR 证据）；确认写审计 before/after |
| general-engineering | 构建/启动/健康/备份/文档 | PASS：health 200；backup→restore 行数 MATCH；端口偏差已文档化 |
| ai-llm | AI 降级与候选过滤 | PASS（沿用 G4 抽检）；残余 R-03 仅为 requestId 传播 |