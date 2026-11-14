# 产品验收复验报告 v2（Stage 5c）— WeBox

- 验收人：产品工程师（复验者 ≠ Stage 5b 修复者）
- 时间：2026-11-14 23:08 CST
- 输入：`docs/product-acceptance.md`（G4 v1）、`docs/defect-log.md`、`docs/frontend-review.md`、`artifacts/s5b-*`
- 环境：后端 `http://127.0.0.1:8083/api/v1`（JDK17，PID 1385859，jar 22:51）；前端 `http://127.0.0.1:5175`；MySQL `req_6343a752e110`；账号 admin/employee + 新建 `s5c_pa_225849@test.com`
- 证据目录：`artifacts/s5c-product/`（curl/DB 日志、隔离 Chrome CDP 截图）
- 判定口径：只有本轮实际命令输出、DB 结果或可复核截图才记 PASS；未执行记 `NOT TESTED`。

## 0. 结论

**CHANGES（存在 1 个 open P1，暂不能 GO；进入 Stage 5d 定向修复）**

- AC-030/031/032（Console 改价/上下架/每日菜单/改库存 + confirm/审计）：**PASS**。
- AC-014/015/053（同 tick 双击仅 1 单、成功页、购物车清空、重复单已有订单入口）：**PASS**。
- AC-021/022/023 **单账号路径 PASS**（默认保存、刷新持久、卡片过敏原弹窗、For You、预算提示均实测通过）；但**跨账号隔离 FAIL**：`S5C-D-001`（P1）登出未清 `webox.prefs.v1` 与购物车，下一账号继承上一账号偏好，过敏原提示会误判。本轮已独立复现（§1.5）。
- 19 条 G4 抽查中 AC-030/032（原 FAIL）与 AC-035（原 NOT TESTED）已转 PASS；其余 16 条保持 PASS。
- P0 `PA-D-001`、P1 `D-FE-01/02/03`、`DEF-006` 本轮关闭；`PA-D-002/003` 关闭。
- **唯一阻断项：`S5C-D-001`（P1，前端状态隔离）。** 修复并定向复验后本报告可转 PASS。

## 1. 定向复验结果

### 1.1 AC-030 / AC-031 / AC-032 — Console 写操作与审计

| 场景 | 结果 | 证据（`artifacts/s5c-product/ac030-032-curl.log`） |
|---|---|---|
| 改价 `confirm=false` | **PASS** | `PUT /admin/dishes/20` → **400** `VALIDATION_CONFIRM_REQUIRED`；DB price 仍 1880；`audit_log` 计数 21→21 |
| 改价 `confirm=true` + reason | **PASS** | → **200**；DB price **1900**；审计 `DISH_UPDATE / DISH / 20`，before.price_cents=1880、after=1900、reason=`s5c price 1880->1900`、ip=127.0.0.1 |
| 改价回滚 | **PASS** | 再次 200，DB 恢复 1880 |
| 上下架 `confirm=false` | **PASS** | `PATCH /admin/dishes/20/status` → **400**，DB 仍 `ON_SHELF` |
| 上下架 `confirm=true` | **PASS** | → **200**，DB `OFF_SHELF`；员工菜单 20→19 条、dishId=20 计数 0；审计 before `ON_SHELF`→after `OFF_SHELF` |
| 恢复上架 | **PASS** | → **200**，菜单恢复 20 条、dishId=20 可见 |
| 每日菜单 `confirm=false` | **PASS** | `PUT /admin/daily-menu` → **400**，未落库 |
| 每日菜单 `confirm=true` | **PASS** | → **200**；DB `daily_menu(1, 2026-11-17)=PUBLISHED`、库存 30；审计 `DAILY_MENU_UPDATE` |
| 改库存 `confirm=false` | **PASS** | `PUT /admin/daily-menu/2026-11-17/1/stock` → **400**，DB 仍 30 |
| 改库存 `confirm=true` | **PASS** | → **200**；DB `total_qty=35`；审计 `STOCK_UPDATE / STOCK / 1:2026-11-17`，before 30 → after 35 |
| 缺 reason | **PASS** | `confirm=true` 无 reason → **400** `VALIDATION_REASON_REQUIRED`，价格不变 |
| 员工访问 `/admin` | **PASS** | **403** `FORBIDDEN` |

### 1.2 AC-021 / AC-022 / AC-023 — 偏好、过敏原、For You、预算

| 场景 | 结果 | 证据 |
|---|---|---|
| 偏好保存（默认值，预算 null） | **PASS** | `PUT /me/preferences` → **200**；DB `["Peanuts"] / ["Japanese"] / Mild / Medium / NULL / NULL / 1`（`ac021-023-api.log`） |
| 刷新后持久 | **PASS** | `GET /me/preferences` 与保存值一致；浏览器 Preferences 页刷新后 Peanuts/Japanese/Mild/Rich/10.00/15.00/For You 勾选全部保留（`b8-preferences-after-refresh.png`） |
| 兼容旧值 `Balanced + 0/0` | **PASS** | → **200**，返回 `tastePreference=Medium`、预算 null |
| 偏好页整页保存 | **PASS** | 点击 Save → 绿色横幅 + toast `Preferences saved.`；DB `["Chinese","Japanese"], Mild, Rich, 1000, 1500, recommend=1`（`b7-preferences-saved.png`） |
| 菜单卡片加购过敏原弹窗 | **PASS** | 含 Peanuts 用户点 Kung Pao（dishId=1）卡片 Add：弹窗 `This dish contains an allergen you flagged: Peanuts. Add anyway?`；此时购物车 0 行（`b2-allergen-modal.png`） |
| 弹窗 Cancel 不入车 | **PASS** | 关闭后购物车仍 0 行 |
| Add anyway 入车 | **PASS** | 确认后购物车 1 行 `dishId=1,qty=1`（`b3-cart-after-allergen.png`） |
| For You 软排序/高亮 | **PASS** | `/menu?sort=for-you`：10 个 `for-you-*` 徽标、20 张卡片仍全部展示（非硬过滤），命中的 dishId=1/3/7/8/10/11/14/15/19/20（`b4-for-you.png`） |
| 预算超限不阻断 | **PASS** | 预算上限 1500 分、商品 2200 分：`POST /orders/preview` → **200** 且 `budgetExceeded=true` |

### 1.3 AC-014 / AC-015 / AC-053 — 双击下单与重复单恢复

| 场景 | 结果 | 证据 |
|---|---|---|
| 同一 tick 双击 Place Order | **PASS** | 隔离 Chrome 中 `b.click(); b.click()`：网络仅 **1 个** `POST /api/v1/orders`，响应 **201**（`browser-cdp.log`） |
| 成功页 | **PASS** | 跳转 `/order-success/16`，页面 `Order placed!`、单号 `WB20261115-0016`（`b5-double-submit-success.png`） |
| 购物车清空 | **PASS** | 成功后 `webox.cart.v1.lines=[]` |
| 订单/库存流水 | **PASS** | DB 订单 16：`Pending, total_cents=2200, item_count=1, snapshot_json 283 字节`；`inventory_ledger` 1 条 `RESERVE qty=1 before=32 after=31 ORD:16:D:1:RESERVE` |
| 重复单 API | **PASS** | 新幂等键再次提交 → **409** `ORDER_DUPLICATE`，`data.existingOrderId=16`；有效单仍 1 |
| 前端已有订单入口 | **PASS** | 结算页显示 `An active order already exists for this meal.` + `View Existing Order`（链接 `/orders/16`），不再展示 Place Order（`b6-duplicate-recovery.png`） |

### 1.4 跨账号偏好隔离（AC-021/022/023）— **FAIL（P1，S5C-D-001）**

| 步骤 | 结果 | 证据 |
|---|---|---|
| 账号 A（`s5c_pa_225849@test.com`，过敏原 Peanuts）登录并触发 ensurePrefs | 偏好缓存 `allergens=["Peanuts"]` | `artifacts/s5c-product/cross-account.log` |
| 点击 Sign out | 跳转 `/login`，但 `localStorage['webox.prefs.v1']` **仍为 A 的偏好**；购物车 `webox.cart.v1` 亦未清 | 同上 |
| 账号 B（`s5c_clean_230749@test.com`，无过敏原）登录，直接加购 Kung Pao（含 Peanuts） | **仍弹出 A 的过敏原弹窗**（B 无过敏原，属误报；反向场景 A 无过敏原 / B 过敏原则会漏报，安全影响更大） | `b9-cross-account-residue.png` |
| 根因 | `authStore.logout()` 只 `session.clear()`，未 `setPrefs(null)`/未清 cart；`ensurePrefs()` 命中缓存即返回不重新拉取 | `frontend/src/store/authStore.ts:38-49`、`frontend/src/store/prefsStore.ts:30-34` |

**判定：AC-021/022/023 整体 FAIL（P1）。** 单账号演示路径虽通过，但共享设备/多账号切换下过敏原提示对象错误，属业务正确性缺陷，必须修复后再验收。

### 1.5 AC-035 — 50 并发抢 10 份

**PASS（采用 S5-Test 证据，测试库隔离）**：`artifacts/test-conc-order.log` 显示 `ready=50/50`、201=10、409_STOCK=40、`available=0`、`reserved=10`、`ledger RESERVE=10`，8 项断言 0 失败。v1 因登录限流 `ready=18/50` 记 NOT TESTED；本轮夹具已用逐请求 `X-Forwarded-For` 解决，满足 50/10 口径。

## 2. 19 条抽查复验增量

| AC | v1 结论 | v2 结论 | 说明 |
|---|---|---|---|
| AC-030 | FAIL | **PASS** | §1.1 改价/上下架 200 + DB + 审计 |
| AC-032 | FAIL | **PASS** | §1.1 confirm/reason/审计；confirm=false 400 无变更 |
| AC-035 | NOT TESTED | **PASS** | §1.5 50/10 证据 |
| 其余 16 条（001/004/006/008/013/014/015/018/019/020/024/026/028/042/056/057） | PASS | **PASS（保持）** | 本轮回归抽查：订单快照 283B、重复单 409、审计接口 200（total=40）、员工 `/admin` 403、20 条菜单金额全部 `^¥\d+\.\d{2}$`；未见 S5b 改动引入回归 |

**结论：19 条抽查 19/19 PASS。** 注意：AC-021/022/023 不在该 19 条清单内，其跨账号隔离另见 §1.4，整体判 FAIL（P1）。

## 3. Scenario checks

| Profile / 检查 | 结果 | 证据 |
|---|---|---|
| `general-engineering`：前后端可运行、health、种子、英文、金额格式 | **PASS** | health `db/redis/cache=UP`；20 菜品可查；菜单金额格式全通过（`ac035-regression.log`） |
| `transaction-order`：服务端计价/快照、幂等、唯一有效单、库存守恒、50 并发不超卖 | **PASS** | 订单 16 快照 + ledger 守恒；双击仅 1 POST；重复单 409 existingOrderId；AC-035 50/10 |
| `identity-access`：双角色隔离、Console 写审计、敏感操作 confirm | **PASS** | 员工 `/admin` 403；`GET /admin/audit-logs` 200；改价/上下架/库存/每日菜单均落 before/after/reason |
| `identity-access`：同浏览器跨账号偏好/购物车隔离 | **FAIL（P1）** | 登出后 `webox.prefs.v1`/`webox.cart.v1` 未清，账号 B 继承 A 过敏原 → S5C-D-001（§1.4） |
| `ai-llm`：候选过滤/降级/SSE | **N/A** | 本轮复验范围为 P0/P1 业务面；Tier3 AI 结论沿用 `test-report.md`，真实 LLM 质量仍 NOT TESTED（无 Key） |

## 4. 缺陷状态更新（详见 `docs/defect-log.md`）

| ID | 级别 | v2 状态 | 依据 |
|---|---|---|---|
| PA-D-001 | P0 | **CLOSED** | 8083 新进程实测改价/上下架/每日菜单/库存全部 200，审计含 before/after/reason |
| PA-D-002 | P2 | **CLOSED** | 50/50 用户、10 成功/40 409、库存与 ledger 守恒 |
| PA-D-003 | P2 | **CLOSED** | 8083 由 JDK17 启动（PID 1385859）稳定运行；`scripts/start.sh` 固定 JDK17 + health 探测 |
| D-FE-01 | P0/blocker | **CLOSED** | 偏好默认/整页保存 200，刷新后全字段保留 |
| D-FE-02 / DEF-006 | P1 | **CLOSED** | 卡片快捷加购弹过敏原窗，Cancel 不入车、Add anyway +1 |
| D-FE-03 | P1 | **CLOSED** | 同 tick 双击仅 1 POST；重复单展示已有订单入口 |
| **S5C-D-001** | **P1** | **OPEN（阻断 GO）** | 跨账号偏好/购物车缓存未清，AC-021/022/023 整体 FAIL（§1.4，已独立复现） |

## 5. 残留风险与 NOT TESTED

1. **S5C-D-001（P1，阻断）**：跨账号偏好/购物车残留，见 §1.4；修复后需定向复验。
2. 菜品图片与菜名语义不匹配（Beef Noodle Soup 显示橙子图等），P2 体验项。
3. `GET /api/v1/admin/dishes/{id}` 未定义路由经统一异常处理返回 **500**（应 404/405），P2 API 一致性（PA-D-004）。
4. 共享 `agent-browser` daemon 被多个工作区会话共用同一标签页，复验期间出现跨会话跳转；本轮改用隔离 Chrome（CDP 9444）完成浏览器证据，建议测试基建记录（TE-D-005，P2）。
5. 真实 LLM 输出质量、图片上传 UI 全流程、双客户端 SSE 时序：**NOT TESTED**（沿用 v1/FR 结论，Tier 3 / P2）。
6. `TE-D-001/002`、`DEF-009/010/011/013/014/015/016`、`D-FE-04` 仍为 P2 OPEN，Owner/截止见 defect-log。

## 6. Stage 5d 指令（必须执行）

1. **修复 S5C-D-001（P1，前端）**：在 `authStore.logout()` 中清空用户态缓存：`usePrefsStore.getState().setPrefs(null)`、清空 `localStorage['webox.prefs.v1']` 与 `webox.cart.v1`（含 zustand 内存 cart），并重置 `prefsStore` 的单飞 `loadPromise`；登录成功时同样强制失效旧缓存或按新 userId 重新拉取。避免仅清 localStorage 而内存 store 仍持有旧值。
2. **回归（定向）**：
   - A（Peanuts）登录 → 加购含 Peanuts 菜出现弹窗 → 登出 → B（无过敏原）登录 → 直接加购同菜 **不得弹窗**、购物车为空；
   - 反向：A（无过敏原）→ 登出 → B（Peanuts）→ 加购 **必须弹窗**；
   - 刷新/重新登录后偏好与购物车仍正确（不误伤单账号持久化）。
3. **修复后由产品工程师定向复验 §1.4 + 前端评审复评**；在 `defect-log.md` 记 CLOSED 后方可进入 Stage 6。
4. 不得以“单账号演示通过”替代跨账号隔离证据；未复验前保持 `S5C-D-001 OPEN`、GO 阻断。

## 7. 证据索引

| 证据 | 路径 |
|---|---|
| AC-030/031/032 curl + DB | `artifacts/s5c-product/ac030-032-curl.log` |
| 偏好 API + For You + 预算 | `artifacts/s5c-product/ac021-023-api.log` |
| 浏览器全流程（CDP） | `artifacts/s5c-product/browser-cdp.log`、`browser-cdp2.log`、`browser-cdp3.log` |
| 过敏原弹窗 / 购物车 | `artifacts/s5c-product/b2-allergen-modal.png`、`b3-cart-after-allergen.png` |
| For You | `artifacts/s5c-product/b4-for-you.png` |
| 双击成功页 | `artifacts/s5c-product/b5-double-submit-success.png` |
| 重复单已有订单入口 | `artifacts/s5c-product/b6-duplicate-recovery.png` |
| 偏好保存 / 刷新 | `artifacts/s5c-product/b7-preferences-saved.png`、`b8-preferences-after-refresh.png` |
| 回归抽查 | `artifacts/s5c-product/ac035-regression.log` |
| AC-035 50/10 | `artifacts/test-conc-order.log` |

## 8. G4 复验自检

| 检查项 | 结果 |
|---|---|
| 逐条给 PASS/FAIL/NOT TESTED | PASS（§1/§2） |
| 未测不写 PASS | PASS（§5 明确 NOT TESTED） |
| 每个 PASS 有命令/DB/截图 | PASS（§7） |
| P0/P1 状态更新并写入 defect-log | PASS（§4；PA-D-001/D-FE-01/02/03 CLOSED，S5C-D-001 OPEN） |
| GO 前无 open P0/P1 | **FAIL（S5C-D-001 P1 OPEN）→ 结论 CHANGES** |
| Scenario checks 逐项结论 | PASS（§3；identity-access 跨账号项 FAIL 已计入 S5C-D-001） |
| 5d 指令 | PASS（§6，含定向修复与回归门槛） |