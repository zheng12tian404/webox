# 后端 P0/P1 修复复评报告（Stage 5c / 后端代码评审员 BR）

- 复评时间：2026-11-14 22:57–23:06 CST（SLA 15 分钟，按期）
- 复评对象：`backend/` 最新代码（`target/webox-backend.jar` 22:51:39 构建）、8083 部署态、`docs/backend-review.md`、`docs/architecture-review.md`、`docs/defect-log.md`
- 角色约束：BR 独立复评，作者≠评审者；未修改任何产品代码。复评期间的临时写操作（价格/状态/库存/AI 规则）均已恢复；新增审计行属复评证据，不回滚。
- 结论：**PASS** — 后端无未闭合 P0/P1、无 blocker；P6+ 五项保持 PASS。
- 证据文件：`artifacts/s5c-backend-rereview-evidence.log`（命令/curl/DB 输出）、`artifacts/backend-8083-s5b.log`（运行日志）

## 0. 复评结论摘要

| 复评项 | 结论 | 证据摘要 |
|---|---|---|
| 1. D-BE-11 confirm 校验 | **PASS** | 4 个端点 `confirm=false` → 400 `VALIDATION_CONFIRM_REQUIRED`，DB 与审计行数不变；`confirm=true` → 200 且审计 before/after |
| 2. PA-D-001 部署态 | **PASS** | PID 1385859（22:51:54 启动）> jar 22:51:39；health 200；`PUT /admin/dishes/20`、`PATCH /admin/dishes/20/status`、每日菜单改库存均 200 + 审计 |
| 3. D-BE-12 二次补偿 | **PASS（代码路径）** | `OrderService.java:130-132` 内层补偿后 `prealloc=null`；外层 `:141/:145` 均判空，每份预占只 INCRBY 一次 |
| 4. DEF-002 下单限流 | **PASS** | 同一用户第 1–5 次 400，第 6 次 429 `RATE_LIMITED`；另一用户首次请求 400（未限流） |
| 5. DEF-004/007 SSE + Redis + afterCommit | **PASS** | SSE 事件 28ms 到达；Redis=49=DB available；写后 Redis=46=DB；`AdminService` 7 处失效 + 库存发布全部 `Util.afterCommit` |
| 6. D-BE-10 AI 规则更新 | **PASS** | `PUT /admin/ai-rules`（confirm=true）→ 200，version 4，审计 `AI_RULE_UPDATE` 落库 |
| 7. DEF-003 备份/恢复/告警文档 | **PASS** | `backup.sh`/`restore.sh`/`docs/observability.md` 存在；备份→临时库 17 表，8 张核心表行数全部 MATCH |
| 8. DEF-005 自动完成 | **PASS（运行实测）** | 23:00:16 日志 `Auto-completed 1 confirmed orders past delivery day`；代码路径 `ScheduledJobs.java:46-60`；该订单/审计随后被并行验收清理脚本删除，故以日志为证据 |

可运行性复验：`mvn -q test` 17/17 PASS（UtilTest 6、WeBoxApiIT 7、S5bFixTest 4），`mvn -q -DskipTests package` exit 0，与开发证据一致。

## 1. 逐项复验

### 1.1 D-BE-11：高风险操作 `confirm` 门禁（P0 / G4-BE-B1 / G4A-B1 / G3P-M3）

代码：`common/Util.java:45-49` `requireConfirm`；接入点 `AdminService.java:123`（updateDish）、`:139`（updateDishStatus）、`:254`（saveDailyMenu）、`:304`（updateStock）、`:359`（adjust）、`:550`（putAiRules）、`OrderService.java:335`（adminPatchStatus）。全部位于写库/审计之前。

实测（管理员 token，见证据日志 §1）：

| 端点 | 请求 | 结果 |
|---|---|---|
| `PUT /api/v1/admin/dishes/20` | `confirm:false`，price 1999 | **400** `VALIDATION_CONFIRM_REQUIRED` |
| `PATCH /api/v1/admin/dishes/20/status` | `confirm:false`，OFF_SHELF | **400** `VALIDATION_CONFIRM_REQUIRED` |
| `PUT /api/v1/admin/daily-menu/2026-11-16/20/stock` | `confirm:false`，totalQty 40 | **400** `VALIDATION_CONFIRM_REQUIRED` |
| `PUT /api/v1/admin/ai-rules` | `confirm:false`，常规 config | **400** `VALIDATION_CONFIRM_REQUIRED` |

副作用核验：4 个 400 后 `dishes.price_cents=1880`、`status=ON_SHELF`、`dish_daily_stock.total_qty=46`、`audit_log` 计数 27→27（max_id 33→33）、`ai_rule_config` active 版本数 1→1。**DB 不变、无审计**，AC-032 满足。

`confirm=true` 回归：
- `PUT /admin/dishes/20` 1880→1999：200，审计 `34|DISH_UPDATE|20|...1880...→...1999...|S5c rereview dish update`；随后恢复 1880（200）。
- `PATCH /admin/dishes/20/status` ON_SHELF→OFF_SHELF：200，审计 `36|DISH_STATUS|20|"ON_SHELF"->"OFF_SHELF"`；随后恢复 ON_SHELF（200）。
- `PUT /admin/daily-menu/2026-11-16/20/stock` 46→49：200，审计 `43|STOCK_UPDATE|20:2026-11-16|total 46→49|S5c DEF-004 clean probe`；随后恢复 46（200）。

### 1.2 PA-D-001 部署态（P0）

| 检查 | 实测 |
|---|---|
| 8083 监听进程 | PID **1385859**，`lstart = Sat Nov 14 22:51:54 2026` |
| jar 构建时间 | `target/webox-backend.jar` **22:51:39.243**（晚于 22:51） |
| JDK | `/usr/lib/jvm/java-17-openjdk-amd64/bin/java -Duser.timezone=Asia/Shanghai` |
| health | `GET /api/v1/health` → **200** `{"status":"UP","db":"UP","redis":"UP","cache":"UP"}` |
| Console 写操作 | 改价/上下架/改库存均 **200 + `audit_log` before/after**（见 1.1） |

结论：修复 jar 已真实加载，产品验收登记的 500 不再出现；PA-D-001 部署态 **CLOSED**。

### 1.3 D-BE-12：重复有效单分支二次补偿（P1 / G4-BE-M1 / G4A-M8）

`order/OrderService.java:109-146`：

```java
RedisStockService.Preallocation prealloc = null;
...
} catch (DuplicateKeyException dup) {
    redisStock.compensate(prealloc);
    prealloc = null; // already compensated; outer catch must not INCRBY twice
    ...
}
...
} catch (ApiException e) {
    if (prealloc != null) redisStock.compensate(prealloc);   // :141
    ...
} catch (RuntimeException e) {
    if (prealloc != null) redisStock.compensate(prealloc);   // :145
```

内层补偿后置空，外层两个 catch 均判空 → DuplicateKey 路径只补偿一次。死锁重试路径先补偿再新建预占，语义同样正确。结论 **PASS（代码路径）**；本轮未重复制造"预占后重复单"的 Redis 运行时断言（`mvn test` 全绿），列为残余测试缺口。

### 1.4 DEF-002：下单 5/min/用户限流（P1 / G4A-M2）

`OrderService.java:102` `rateLimiter.check("order:user:"+user.id(), 5, 60_000L)`，位于幂等/业务校验之前；`RateLimiter` 滑动窗口按 key 隔离。

实测（员工 id=2，连续 6 次 `POST /orders`，每次唯一 `Idempotency-Key`）：
- 第 1–5 次：**400** `VALIDATION_OPTION_REQUIRED`（请求已进入业务层，说明限流计数生效）
- 第 6 次：**429** `RATE_LIMITED`
- 另一用户（admin id=1）首次请求：**400** `VALIDATION_OPTION_REQUIRED`（未误伤）

结论 **PASS**。残余风险：内存限流为单实例语义，多实例部署需下沉 Redis（P2，非本轮阻塞）。

### 1.5 DEF-004 / DEF-007：SSE、Redis 同步与 afterCommit（P1 / G4A-M4 / G4A-M7）

代码：
- `AdminService.java:47-52` `publishStockAfterCommit` = `Util.afterCommit(sseHub.publishStock + redisStock.sync)`；`updateStock:319`、`saveDailyMenu:292`、`adjust:371` 调用。
- `Util.afterCommit`（`Util.java:52-60`）有事务时注册 `afterCommit` 回调，无事务直接执行。
- 缓存失效 7 处全部包装：`AdminService.java:115,133,148,170,295,320,372`（create/update/status/image/saveDailyMenu/updateStock/adjust）。

实测（干净探针，排除并行验收写入干扰）：
- 订阅 `GET /menu/stream?date=2026-11-16`（员工 token），管理员改库存 46→49；
- **28ms** 收到 `event:stock data:{"dishId":20,"available":49}`；
- 同时刻 `redis-cli GET webox:stock:2026-11-16:20 = 49`，DB `available=49`；
- 审计 `43|STOCK_UPDATE|20:2026-11-16|total 46→49`；
- 恢复 46 后 Redis=46、DB=46。

结论 **PASS**。说明：复评期间并行节点（架构抽检）也在写同一库存键，首轮采样出现 48→45 的交叉写入；已用独立探针在 28ms 内完成原子采样，排除干扰。

### 1.6 D-BE-10：AI 规则常规更新（P2 / G4-BE-M2）

`AdminService.putAiRules`（`:547-580`）审计 after 改为可空 `LinkedHashMap`，`getAiRules` 查询列改为 `created_at`。实测 `PUT /admin/ai-rules`（confirm=true、无 rollbackToVersion）→ **200**，`version=4`、`active=1`，审计 `41|AI_RULE_UPDATE|recommend_weights:v4|{"version":4,"rollbackToVersion":null}`。结论 **PASS**。

### 1.7 DEF-003：备份/恢复脚本与可观测性文档（P1 / G4A-M3）

- `backend/scripts/backup.sh`：mysqldump `--single-transaction --routines --triggers` + gzip + sha256。
- `backend/scripts/restore.sh`：恢复前 `CREATE DATABASE IF NOT EXISTS`，默认拒绝覆盖演示库（`ALLOW_DEMO_RESTORE=1` 才放行）。
- `docs/observability.md`：5xx>1%（P1）、P95>1s（P1）、drift>0（P0）、Redis 降级（P2）、日志字段与端点。

活体复验：`backup.sh req_6343a752e110 /tmp/s5c-backup.sql.gz` → 24,148 bytes；`restore.sh` → 临时库 17 表；核心表行数 source/restored：users 116/116、dishes 20/20、daily_menu 61/61、dish_daily_stock 61/61、orders 11/11、order_items 13/13、inventory_ledger 23/23、audit_log 40/40，全部 **MATCH**；临时库已删除。结论 **PASS**。

### 1.8 DEF-005：Confirmed 过期自动完成（P1 / G4A-M5）

代码：`ScheduledJobs.java:46-60`，每分钟扫描 `status='Confirmed' AND delivery_date < today`，CAS `UPDATE ... WHERE status='Confirmed'` 后写 `ORDER_AUTO_COMPLETE` 系统审计；`@EnableScheduling` 在 `WeBoxApplication.java:8`。

运行实测：`artifacts/backend-8083-s5b.log:6418` `2026-11-14T23:00:16.855 ... Auto-completed 1 confirmed orders past delivery day`（订单 14，delivery_date 2026-11-13）。该订单及审计行随后被并行验收的演示数据清理脚本删除，DB 行已不存在，故以运行日志 + 代码路径为证据。结论 **PASS（运行实测）**；跨日自然边界（23:59 后首个 tick）仍建议由测试节点观察一次。

## 2. 实际执行命令与输出摘录

```bash
# 部署态
ps -eo pid,lstart,cmd | grep webox-backend
# 1385859 Sat Nov 14 22:51:54 2026 /usr/lib/jvm/java-17-openjdk-amd64/bin/java -jar target/webox-backend.jar
ls -l --time-style=full-iso backend/target/webox-backend.jar
# 29970878  2026-11-14 22:51:39.243185372 +0800
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8083/api/v1/health   # 200

# confirm=false（4 端点）→ 400；DB/审计不变
curl -s -X PUT .../admin/dishes/20 -d '{...,"confirm":false,...}'
# {"code":"VALIDATION_CONFIRM_REQUIRED",...} HTTP 400

# confirm=true → 200 + audit before/after
curl -s -X PATCH .../admin/dishes/20/status -d '{"status":"OFF_SHELF","confirm":true,"reason":"S5c rereview status"}'
# HTTP 200; audit_log 36|DISH_STATUS|20|"ON_SHELF"->"OFF_SHELF"

# SSE/Redis/DB 原子采样
curl -sN .../menu/stream?date=2026-11-16 &   # event:stock 28ms 到达
curl -X PUT .../admin/daily-menu/2026-11-16/20/stock -d '{"totalQty":49,"confirm":true,...}'
redis-cli GET webox:stock:2026-11-16:20      # 49
SELECT total_qty-reserved_qty-sold_qty ...    # 49

# 限流
6× POST /orders (same user)  → 1-5: 400, 6: 429 RATE_LIMITED
1× POST /orders (other user) → 400 (not 429)

# AI 规则
PUT /admin/ai-rules {"confirm":true,"config":{...}} → HTTP 200, version=4

# 备份/恢复
backend/scripts/backup.sh req_6343a752e110 /tmp/s5c-backup.sql.gz
backend/scripts/restore.sh /tmp/s5c-backup.sql.gz req_6343a752e110_s5c_restore
# 8 张核心表行数全部 MATCH

# 构建/测试
JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 /opt/maven/bin/mvn -q test
# UtilTest 6/6, WeBoxApiIT 7/7, S5bFixTest 4/4 — 17/17 PASS
JAVA_HOME=... /opt/maven/bin/mvn -q -DskipTests package   # exit 0

# 自动完成运行日志
grep "Auto-completed" artifacts/backend-8083-s5b.log
# 2026-11-14T23:00:16.855 ... Auto-completed 1 confirmed orders past delivery day
```

完整输出：`artifacts/s5c-backend-rereview-evidence.log`。

## 3. 残余风险（不阻塞 G4，按 P2/P3 跟踪）

| # | 风险 | 级别 | 建议 Owner |
|---|---|---|---|
| R-1 | `RateLimiter` 为 JVM 内存实现，多实例部署下 5/min 可被放大到 N×5 | P2 | 后端（后续版本下沉 Redis） |
| R-2 | `autoCompleteOrders` 的 UPDATE 与审计 INSERT 非同一事务；两次语句间进程崩溃会留下"已完成无审计" | P3 | 后端（包事务或改为一次性 SQL + 审计补偿） |
| R-3 | `S5bFixTest` 仅单测 `Util.requireConfirm`/`RateLimiter`，无 `confirm=false → 400` 的端点级自动化；本轮以 curl 实测覆盖，建议补 IT 防回归 | P2 | Test / 后端 |
| R-4 | D-BE-12 仅有代码路径确认，无重复单后 Redis==DB 的运行时断言 | P2 | Test |
| R-5 | 复评期间多节点并发写演示库（库存/审计/订单），证据采样存在交叉干扰；已用独立探针规避，后续验收应避免共享库并发写 | P3 | Dispatcher / Test |
| R-6 | `GET /menu/stream?date=abc` 仍 500（G4-BE-m2 未修，P2，非本轮 P0/P1） | P2 | 后端 |

## 4. 缺陷台账更新（本节点复验范围）

| 原 ID | 复评结论 | 证据 |
|---|---|---|
| D-BE-11 / G4-BE-B1 / G4A-B1 / G3P-M3（P0） | **CLOSED** | 4 端点 `confirm=false`→400、DB/审计不变；`confirm=true`→200+审计（1.1） |
| PA-D-001（P0） | **CLOSED** | 8083 新 PID/jar、health 200、三类写操作 200+审计（1.2） |
| D-BE-12 / G4-BE-M1 / G4A-M8（P1） | **CLOSED** | `OrderService.java:130-132/141/145` 预占只补偿一次（1.3） |
| DEF-002 / G4A-M2（P1） | **CLOSED** | 第 6 次 429、其他用户不受影响（1.4） |
| DEF-004 / G4A-M4（P1） | **CLOSED** | SSE 28ms、Redis==DB（1.5） |
| DEF-007 / G4A-M7（P1） | **CLOSED** | 7 处失效 + 库存发布全部 afterCommit（1.5） |
| DEF-003 / G4A-M3（P1） | **CLOSED** | 脚本/告警文档 + 恢复 8 表 MATCH（1.7） |
| DEF-005 / G4A-M5（P1） | **CLOSED** | 23:00:16 自动完成 1 单运行日志（1.8） |
| D-BE-10 / G4-BE-M2（P2） | **CLOSED** | `PUT /admin/ai-rules` 200 + 审计（1.6） |

## 5. Scenario checks（active_profiles：transaction-order / identity-access / general-engineering）

| 场景项 | 结论 | 证据 / 理由 |
|---|---|---|
| TO-2 库存不为负、DB 为最终账本 | **PASS** | 改库存原子条件 `?>=reserved_qty+sold_qty`；Redis==DB 采样 49==49（1.5）；并发防超卖沿用 `WeBoxApiIT#concurrentDifferentUsersNeverOversell` |
| TO-3 取消/超时只释放一次 | **PASS（沿用）** | `InventoryService` ledger 唯一键 + 幂等补偿代码路径；本轮无回归改动 |
| TO-4 下单幂等 | **PASS（沿用）** | `mvn test` 幂等用例全绿；限流在幂等 claim 之前，不改变幂等语义 |
| TO-5 同用户同日同餐次唯一 | **PASS（代码）** | `uk_orders_active` 生成列唯一键未变；D-BE-12 仅调整补偿，不改变 409 `ORDER_DUPLICATE` 映射 |
| TO-6 状态机/终态 | **PASS** | 自动完成任务实测（1.8）；非法迁移沿用 `UtilTest`/IT |
| IA-2 员工访问 Console 403 | **PASS** | 员工 token `GET /admin/dishes` → **403**（证据日志 §6） |
| IA-5 登录/下单限流、401/403 区分 | **PASS** | 下单第 6 次 429；员工 403（1.4、§6） |
| IA-6 高风险操作审计 before/after/reason/IP | **PASS** | 改价/上下架/改库存/AI 规则审计均含 before/after+reason；`ip`/`request_id` 由 `AuditService` 落库 |
| GE-1 构建/启动/health | **PASS** | `mvn test` 17/17、`package` exit 0、health 200（§2） |
| GE-3 统一错误码 | **PASS** | 400 `VALIDATION_CONFIRM_REQUIRED`、429 `RATE_LIMITED`、403 `FORBIDDEN` 均为 `{code,message,data,requestId}` |
| GE-4 参数化 SQL | **PASS（沿用 G4）** | 本轮改动无新增 SQL 拼接；`requireConfirm` 不涉及 SQL |
| AI-5 规则热更新/回滚 | **PASS** | `PUT /admin/ai-rules` 200、version+1、审计（1.6）；回滚路径未在本轮复测（Tier 3） |
| AI-6 Key 不入库/日志 | **N/A（未变更）** | 本轮无 AI Key 相关改动 |

## 6. G4 自检与下一步

- **G4-后端自检**：PASS（后端 P0/P1 全部 CLOSED；P6+ 五项 PASS；构建/测试 17/17 PASS）
- **Stage 5d 指令**：后端**不需要**。前置条件：前端 FR/Test 须在本轮将 D-FE-01/02/03 复评 CLOSED（FR-B1/D-FE-02/D-FE-03）；若 G4 汇总时仍有任一 P0/P1 未 CLOSED，Dispatcher 派 **Stage 5d** 对未闭合项定向复评，不重跑已闭合的后端项。
- **下一步**：Quality Checker（前端评审与测试回归完成后进入）。