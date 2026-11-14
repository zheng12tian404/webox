# 产品验收报告（G4 业务抽查）— WeBox 员工餐食订购平台

- 验收人：产品工程师（作者≠开发者）
- 时间：2026-11-14 23:06 CST
- 输入：`docs/prd-analysis.md`、`docs/acceptance-matrix.md`（AC-001~061）、`docs/scenario-profile.md` v2、`docs/PRD.md`
- 环境：后端 `http://127.0.0.1:8083/api/v1`（JDK17，`artifacts/backend-8083-pa.log`）；前端 `http://127.0.0.1:5175`；MySQL `req_6343a752e110`；账号 `admin@webox.com/Admin12345`、`employee@webox.com/Employee123`
- 原始证据：`artifacts/product-acceptance/evidence.log`（本次全部 curl 输出与 SQL 断言）、`artifacts/evidence/frontend/*.png`、`artifacts/backend-testclock.txt`
- 判定口径：只有本次实际执行的命令输出/DB 结果或可核验的既有产物才可 PASS；未执行一律 `NOT TESTED`，不得以设计或口头结论代替。

## 0. 结论

**CHANGES（不通过 G4，进入 Stage 5b 修复）**

- Tier 1 抽查全部 PASS（AC-001/004/006/008/013/014/015/018/019/024/026/056/057）。
- Tier 2 抽查：5 份上限、唯一有效单、权限隔离、For You、预算提示 PASS；**Console 改价/上下架因审计序列化异常返回 500（AC-030/AC-032 FAIL，PA-D-001，P0）**，属 Tier 2 核心功能不可用，必须修复并回归。
- 阻断项仅 1 个：`PA-D-001`。修复后预计可转 PASS。
- 环境事件：22:39 有人用 Java 8 启动导致 8083 无监听；产品验收于 22:40 用 JDK17 重启恢复（PA-D-003，P2）。

## 1. 抽查结果总表（必查 19 条 + 重点规则）

| AC | Tier | 验收点 | 结果 | 证据（命令/DB/截图） |
|---|---|---|---|---|
| AC-001 | T1 | 注册成功、role=EMPLOYEE、密码 BCrypt 非明文 | **PASS** | 注册 201 返回 `{id:110,email:pa_1794667287_a@test.com,role:"EMPLOYEE"}`；DB `role=EMPLOYEE,password_hash` 前缀 `$2a$`，长度 60（evidence.log） |
| AC-004 | T1 | 登录发 JWT；`/auth/me` 保持身份；admin 为 ADMIN | **PASS** | admin 登录 `user.role=ADMIN`；employee 登录 `EMPLOYEE`；`GET /auth/me` 200 返回 id/email/role（evidence.log） |
| AC-006 | T1 | 菜单分页/字段/金额展示；size=101 拒绝 | **PASS** | `GET /menu?page=1&size=20` → `total=20,page=1,size=20`，卡片含 dishId/name/priceCents=2800/priceDisplay=`¥28.00`/category/spiceLevel/availableQty；`size=101` → 400 `VALIDATION_PAGINATION` |
| AC-008 | T1 | 搜索大小写不敏感；注入安全；51 字符拒绝 | **PASS** | `search=CHICKEN` 命中 5 道（Kung Pao/Chicken Quinoa/…）；`' OR 1=1--` → 200 空列表；51 字符 → 400 `VALIDATION_SEARCH_LENGTH` |
| AC-013 | T1 | 结算预览字段完整；地址 >200 拒绝 | **PASS** | `POST /orders/preview` 返回明细/选项/小计/totalCents=4100/effectiveDate=2026-11-15/effectiveMeal=Lunch/cutoffAt/autoSwitched/budgetExceeded/地址簿；新增地址 201 字符 → 400 `VALIDATION_ADDRESS_LENGTH`（POST /orders 同） |
| AC-014 | T1 | 下单成功、状态/单号/服务端计价/快照/库存流水 | **PASS** | 订单 9：`orderNo=WB20261115-0009,status=Pending,totalCents=8200,itemCount=2`；DB `snapshot_json` 非空；`inventory_ledger` 恰 1 条 `RESERVE qty=2 ORD:9:D:9:RESERVE` |
| AC-015 | T1 | 同幂等键只 1 单；异体 409；缺头 400 | **PASS** | 同 key 串行 3 次均返回 `orderId=9`；DB `count(*)=1`；异体 409 `IDEMPOTENCY_CONFLICT`；缺头 400 `IDEMPOTENCY_KEY_REQUIRED`；并发 7 次同 key 仅 1 单见 `artifacts/evidence/backend/concurrency/idempotency_race.log`（6/6 PASS） |
| AC-018 | T1 | 取消回补一次；二次取消 409；流水唯一 | **PASS** | 取消 200 → `Cancelled`；二次 409 `ORDER_STATE_INVALID`；ledger 仅 `RESERVE 2` + `RELEASE 2`；11-15 库存 `total=30,reserved=0,sold=0`（回补后） |
| AC-019 | T1 | Confirmed 不可取消 | **PASS** | 订单 10 管理员确认 → 200 `Confirmed`；员工取消 → 409 `ORDER_STATE_INVALID`，状态/库存不变 |
| AC-020 | T2 | 每单总份数 ≤5（含 3+3） | **PASS** | 3+3 → 400 `ORDER_LIMIT_EXCEEDED`；3+2 → 201 `itemCount=5`；前端按钮文案 `Order limit reached: max 5 items`，见 `artifacts/evidence/frontend/frontend-5-item-limit.png` |
| AC-024 | T2 | 截单服务端判定、六边界、过点自动切换 | **PASS** | `artifacts/backend-testclock.txt`（test profile，DB `_test`）：09:59:59→当日 Lunch；10:00:00/10:00:01→当日 Dinner（autoSwitched=true）；14:59:59→当日 Dinner；15:00:00/15:00:01→次日 Lunch；生产 profile 传 `X-Test-Clock` → 400 `VALIDATION_TEST_CLOCK_FORBIDDEN` |
| AC-026 | T2 | 同日同餐次唯一有效单 | **PASS** | 再次提交 → 409 `ORDER_DUPLICATE`，`data.existingOrderId=9`；preview 返回 `existingOrderId=9`；订单数不变 |
| AC-028 | T2 | 员工不可访问 Console；未登录 401；管理员 200 | **PASS** | 员工 token `GET /admin/dishes` → 403 `FORBIDDEN`；匿名 → 401 `AUTH_UNAUTHORIZED`；管理员 → 200 |
| AC-030 | T2 | 上下架即时生效 | **FAIL** | `PATCH /admin/dishes/20/status` → **500 `INTERNAL`**；菜品仍在员工菜单（`menu` 中 dishId=20 数量=1），未下架。根因见 PA-D-001 |
| AC-032 | T2 | 改价必须 confirm+reason、写审计、可回滚 | **FAIL** | 缺 reason → 400 `VALIDATION_REASON_REQUIRED`（部分通过）；携带 confirm+reason → **500 `INTERNAL`**，价格仍 3800，`audit_log` 无对应记录。根因见 PA-D-001 |
| AC-035 | T3 | 50 并发抢 10 份不超卖 | **NOT TESTED（50）** | 环境登录限流 20/min/IP，`RACE_N=50` 夹具仅 18 用户就绪；既有 15 用户/5 库存用例 PASS（`artifacts/evidence/backend/concurrency/order_race.log`：成功 5、409 10、available=0、ledger 守恒）。不得以 15/5 记 AC-035 PASS；PA-D-002 |
| AC-042 | T3 | 看板与 DB 聚合一致 | **PASS** | `GET /admin/dashboard?date=2026-11-15`：orders=2、revenueCents=17100、completed=1/pending=0/cancelled=6、lunch=2/dinner=0、trend=7；DB `status<>Cancelled` 计 2 单/17100 分，状态计数一致 |
| AC-056 | T1/T2 | 种子：当日菜品/库存/图片/账号/可下单 | **PASS（附观察）** | DB：20 道菜全部 `ON_SHELF`；`dish_daily_stock` 覆盖 2026-11-14/15/16，当日 total 20~45；`static/images` 20 个文件；admin/employee 登录成功；当天可完成下单（自动切至 11-15 Lunch）。观察：部分菜品图片与菜品语义不匹配（如 Beef Noodle Soup 显示橙子图），P2 体验项，见 §4 |
| AC-057 | T1/T2 | 全英文文案、金额 `¥xx.xx` | **PASS** | 前端 `src/**/*.ts(x)` 可见中文 0 处；菜单 20 条 `priceDisplay` 全部匹配 `^¥[0-9]+\.[0-9]{2}$`；截图导航/按钮/弹窗为英文 |

### 1.1 重点业务规则补充抽查

| 规则 | AC | 结果 | 证据 |
|---|---|---|---|
| 过敏原提醒（提醒而非过滤） | AC-021 | **PASS** | `artifacts/evidence/frontend/frontend-allergen-modal.png`：弹窗 `This dish contains an allergen you flagged: Egg. Add anyway?`，含 `Cancel / Add anyway`；菜品仍可浏览 |
| 预算提示不阻断 | AC-023 | **PASS** | 预算上限 1500 分、购物车 2800 分 → preview `budgetExceeded=true`；接口仍可下单（不返回阻断错误） |
| For You 软排序/高亮 | AC-022 | **PASS** | 偏好 Japanese+Mild 后 `sort=for-you`：Japanese/Mild 菜品 `forYou=true` 并被标记（California Roll、Chicken Teriyaki Bento、Salmon Sashimi），非匹配菜仍展示 |
| 注册提权向量 | AC-061 | **PASS** | 注册体携带 `role:"ADMIN"` → 201 且 `role="EMPLOYEE"`，DB ADMIN 数不变 |
| 金额服务端重算 | AC-014/016 | **PASS** | Burger 3800 + Cheese 300 → preview/订单均 4100；2 份 → 8200；客户端不参与结算 |

## 2. 失败项与缺陷

| 缺陷 | 级别 | 影响 | 证据 |
|---|---|---|---|
| **PA-D-001** Console 菜品写操作 500：`Util.MAPPER = new ObjectMapper()` 未注册 `JavaTimeModule`，`AuditService` 序列化 DB 行 `LocalDateTime created_at` 抛 `InvalidDefinitionException`，事务回滚 | **P0** | AC-030、AC-032、AC-031（每日菜单/改库存同审计路径）不可用；Tier 2 Console 核心功能失败 | 后端日志 `artifacts/backend-8083-pa.log:458–472`；响应 `{"code":"INTERNAL"}`；DB 价仍 3800、无审计行 |
| PA-D-002 50 并发夹具受登录限流 | P2 | AC-035 未能按 50/10 执行 | `ready=18/50`；限流 20/min/IP（`AuthService.java:61`） |
| PA-D-003 8083 曾因 Java 8 启动不可用 | P2 | 环境可用性 | 22:39 启动日志 `UnsupportedClassVersionError`；22:40 JDK17 重启后 health 200 |

## 3. Scenario checks

| Profile | 检查 | 结果 | 证据 |
|---|---|---|---|
| general-engineering | 前后端可运行、健康检查、种子、英文、金额格式 | **PASS** | health 200（db/redis/cache UP）；AC-056/057 |
| transaction-order | 金额整数分/服务端重算、库存守恒、幂等、唯一有效单、取消回补、截单、5 份上限 | **PASS** | AC-014/015/018/019/020/024/026；ledger 与库存断言 |
| transaction-order | 50 并发不超卖 | **FAIL（未测足）** | PA-D-002；仅 15/5 通过 |
| identity-access | 双角色隔离、Console 403、审计、密码哈希 | **FAIL** | 403/401/BCrypt PASS；**Console 写审计 500 → PA-D-001** |
| ai-llm | 候选过滤/降级/SSE | **N/A** | 本节点未抽查 Tier 3 AI；不改变 Tier1/2 结论（Tier 3 仍按测试报告判定） |

## 4. 非阻断观察（P2）

1. 菜品图片与菜名语义不匹配（示例：Beef Noodle Soup 卡片显示橙子图、Classic Beef Burger 显示绿色沙拉图）。文件存在且可访问，但与 PRD §6 菜名不符，建议按 `product_images` 原始映射校正。
2. 我的订单/地址等页面的演示数据中地址字段较短，不影响下单与验收。
3. 看板“今日”按 `delivery_date` 聚合；演示时若当前时间已过晚餐截单，下单落到次日，需在演示脚本中说明，避免误判看板为 0。

## 5. Stage 5b 修复指令（最小闭环）

1. **必修 P0（PA-D-001）**：`backend/src/main/java/com/webox/common/Util.java:21` 为 `ObjectMapper` 注册 `JavaTimeModule` 并 `disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)`；或让 `AuditService` 仅序列化 before/after 显式字段。回归命令：
   ```bash
   curl -X PUT $B/admin/dishes/9 -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
     -d '{"name":"Classic Beef Burger","description":"...","priceCents":3900,"category":"Western","protein":"Beef","allergens":["Gluten","Dairy"],"spiceLevel":"None","confirm":true,"reason":"price adjustment"}'
   # 期望 200；随后 SELECT before_json,after_json,reason,ip FROM audit_log WHERE object_id='9';
   curl -X PATCH $B/admin/dishes/20/status -d '{"status":"OFF_SHELF","confirm":true,"reason":"..."}'  # 期望 200 且员工菜单不可见
   ```
2. **必修回归**：AC-030、AC-032 重跑并附证据；顺带验证 `PUT /admin/daily-menu`、`PUT /admin/daily-menu/{date}/{dishId}/stock` 不再 500（同审计路径）。
3. **建议**：PA-D-002 夹具改为 SQL 直插 + 复用 token/测试环境放宽 IP 限流，补 50/10 证据；PA-D-003 固定 JDK17 启动脚本。
4. 修复后由测试执行复评 + 回归；GO 前确认 `defect-log.md` 无 open P0/P1。

## 6. 证据索引

| 证据 | 路径 |
|---|---|
| 本次 curl/DB 原始输出 | `artifacts/product-acceptance/evidence.log` |
| 后端运行日志（含 500 根因） | `artifacts/backend-8083-pa.log`（458–472、597–598 行） |
| 截单六边界 | `artifacts/backend-testclock.txt` |
| 幂等并发（7 次 1 单） | `artifacts/evidence/backend/concurrency/idempotency_race.log` |
| 库存并发（15 用户/5 份） | `artifacts/evidence/backend/concurrency/order_race.log` |
| 过敏原弹窗 | `artifacts/evidence/frontend/frontend-allergen-modal.png` |
| 5 份上限 | `artifacts/evidence/frontend/frontend-5-item-limit.png` |
| 菜单/结算/Console/看板截图 | `artifacts/evidence/frontend/frontend-*.png` |

## 7. G4 自检

| 检查项 | 结果 |
|---|---|
| 必查 19 条逐条给 PASS/FAIL/NOT TESTED | PASS（§1） |
| 失败项登记 defect-log（级别/复现/期望/实际/根因） | PASS（`docs/defect-log.md` PA-D-001/002/003） |
| 未测项未写 PASS | PASS（AC-035 标 NOT TESTED） |
| 核心业务规则覆盖（截单/5 份/唯一单/幂等/回补/过敏原/预算/排序/权限审计/英文/金额） | PASS（§1.1） |
| 每个 PASS 有命令/DB/截图证据 | PASS（§6） |
| 结论与 Stage 5b 指令 | PASS（§0/§5） |