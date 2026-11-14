# WeBox PRD 全量功能验证报告（Stage 5e 追加）

- 验证人：产品工程师
- 时间：2026-11-14 23:59 CST
- 触发：用户要求“把前后端服务启动起来，验证 PRD 相关功能是否都实现了”
- 结论：**Tier 1 PASS、Tier 2 PASS、Tier 3 PASS（1 项 PARTIAL：AI 未配置 LLM Key，走规则降级）；无 P0/P1。**
- 方法：本轮实跑 API 106 项检查 + 浏览器 UI 走查截图 + DB 核对；并发/每日菜单全量写入沿用历史证据并明确标注。

## 1. 服务状态（已启动并验证）

| 服务 | 地址 | 进程 | 状态 |
|---|---|---|---|
| 后端 | `http://127.0.0.1:8083/api/v1` | PID 1385859，JDK17，jar 22:51 修复版 | `GET /health` → 200 `{status:UP, db:UP, redis:UP, cache:UP}` |
| 前端 | `http://127.0.0.1:5175` | PID 1321104，Vite dev（Node 22.22.3） | 页面 200；`/api` 代理到后端 → 200 |
| MySQL | `127.0.0.1:3306`，库 `req_6343a752e110` | 独立进程 | 种子菜品 20 道、当日菜单/库存已就绪 |
| Redis | `127.0.0.1:6379` | 独立进程 | health `redis:UP`，DB 仍为库存唯一账本 |

> 标准端口 8080/5173 被系统 nginx 与其他工作区占用，RUNBOOK 与根 README 已注明实际端口 8083/5175；启动脚本 `backend/scripts/start.sh` 固定 JDK17 绝对路径并带 60s health 探测。

## 2. 覆盖结论（对照 PRD 章节）

| PRD 章节 | 功能 | 结论 | 关键证据 |
|---|---|---|---|
| §3.1 注册/登录 | 邮箱格式/长度校验、弱密码拒绝、重复邮箱 409、登录/刷新/`me`、刷新页面保持登录、角色区分 | **PASS** | 弱密码 400、重复邮箱 409、refresh 轮换且旧 refresh 401；浏览器 reload 后仍在 `/admin/inventory` 且仍为 admin |
| §3.2 每日菜单 | 20 张卡片（图片/名称/价格/菜系）、菜品详情（蛋白/过敏原/辣度）、自定义选项与实时价格、菜系多选、搜索、参数边界 | **PASS** | 详情 dish1 `Peanuts/Chicken/Medium/¥22.00`；dish4 必选 Pasta Type 3 项、加料 2 项；勾选后价格 `¥26.50`、加购成功；`search=chicken` 6 条；`Chinese,Japanese` 8 条；搜索 51 字符与非法分类均 400 |
| §3.3 购物车 | 加购/加减/移除、总价实时、同菜不同配置分行、展示所选配置 | **PASS** | `/cart` 显示 Caesar Salad `¥28.50` + Tomato Pasta（Spaghetti）`¥26.50`，合计 **¥55.00**；5 份上限文案存在 |
| §3.4 下单 | 结算明细、配送日期/餐次/地址（含历史地址）、服务端算价、幂等仅 1 单、成功页、订单列表/详情、Pending 可取消 | **PASS** | 订单 20：201、`WB20261115-0020`、total 2200、autoSwitched=true；同键同体重放同 `orderId`；同键异体 409；缺头 400；重复有效单 409+existingOrderId；取消 200 且 ledger RELEASE 恰 1 条，二次取消 409；订单详情含快照 `Kung Pao Chicken/2200/1/2200` |
| §4.1 偏好 | 过敏原/菜系/辣度/口味/预算保存与回读、过敏原加购弹窗、For You 排序高亮、预算超限提示不阻断 | **PASS** | 偏好保存后回读 `Egg/Chinese,Japanese/Mild/Medium/1500/3000/true`；加购 Caesar Salad 弹 `This dish contains an allergen you flagged: Egg. Add anyway?`；菜单页 `For you` 徽标按偏好高亮；结算页 `This order exceeds your meal budget (¥30.00). You can still place it.` |
| §4.2 订餐规则 | 单餐 ≤5 份、截单自动切换、同日同餐次唯一有效单 | **PASS** | 单行 qty=6 → 400 `VALIDATION_QUANTITY`；跨行 3+3 → 400 `ORDER_LIMIT_EXCEEDED`；23:5x 提交自动切到 **2026-11-15 Lunch**；重复有效单 409 并返回已有单 |
| §4.3 Console 菜品管理 | 列表搜索/筛选、新增、编辑、上下架、上传图片、每日菜单与供应数量、员工不可访问 | **PASS** | 新增 dish 21 → 201；编辑 200（价格 2099）；`confirm=false` → 400；上下架各 200；`POST /admin/dishes/21/image` → 200 返回图片 URL；每日菜单 20 行；改库存 200；员工 `/admin/dishes` 403，UI 打开 `/admin` 跳 `/403` |
| §5.1 库存 | 剩余数量展示、低库存 ≤3 提示、售罄不可下单、SSE 实时推送、取消回补、防超卖 | **PASS** | dish5 设 0 → 菜单 `available=0, soldOut=true`，恢复 20；SSE 实连收到 `event:stock`；取消订单产生 1 条 RELEASE；50 并发抢 10 → 10/40、available=0（沿用 Stage 5c 证据 `artifacts/s5c-test-regress4.log`） |
| §5.2 AI 推荐 | 入口、自然语言、偏好/库存/过敏原/近 7 天过滤、卡片+理由、可加购、流式 | **PARTIAL** | SSE 完整收到 `meta → dish×N → reason×N → done`，卡片含 dishId/name/price/category/available，每条有理由；但 `meta.fallback=true`、`model=rule-based`——**当前未配置 LLM Key，走规则降级**，未满足 PRD“必须实际接入 LLM” |
| §5.3 看板 | 今日概览、Top10、午晚分布、7 天趋势、低库存 | **PASS** | `GET /admin/dashboard?date=2026-11-15` → orders=8、revenue=35480 分、Top5 含销量、mealSplit lunch=8、7 天趋势、lowStock；UI 看板四区块 + Refresh 渲染正常 |
| 全局 | 全英文 UI、金额整数分、响应式 | **PASS** | 截图均为英文；价格 `¥22.00` 格式；375px 视口菜单正常排版 |

## 3. 自动化检查统计

- `artifacts/prd-verify/prd-verify.log`：**104/106** 直接断言通过。
- 2 条初判失败经复核为**测试断言口径问题，非产品缺陷**（`artifacts/prd-verify/fix-checks.log`）：
  1. refresh 轮换：契约要求 **refreshToken** 轮换（实测旧 refresh 复用 401）；accessToken 同秒同 claims 可字节相同 → **PASS**。
  2. 单行 `qty=6` 返回 `VALIDATION_QUANTITY`（qty 1–5），跨行合计超 5 返回 `ORDER_LIMIT_EXCEEDED`；两者均 400，UI 也限制 5 份 → **PASS**。
- 修正后有效断言 **106/106 PASS**。

## 4. 发现（新增，不阻断）

| ID | 级别 | 内容 | 影响 | 建议 |
|---|---|---|---|---|
| PRD-GAP-001 | P2 | AI 推荐未配置 LLM Key，`/ai/recommend` 返回 `fallback=true / model=rule-based` | Tier 3 加分项未满足“必须实际接入 LLM”；Tier 1/2 不受影响 | 配置 `LLM_API_KEY`（及可选 `LLM_BASE_URL/LLM_MODEL`）重启后端，复验 `meta.fallback=false` 且推荐理由来自模型 |
| OBS-001 | P3（观察项） | 看板默认“今日”按配送日口径，晚间创建、次日配送的订单不计入今日 | 行为符合“今日经营”语义，非缺陷；按 `?date=2026-11-15` 可见真实订单 | 文档注明口径即可 |

## 5. 未重跑 / 复用 / 未验证

| 项 | 说明 |
|---|---|
| 50 并发抢 10 防超卖 | 本轮未重跑，沿用 Stage 5c 独立证据：`artifacts/s5c-test-regress4.log`（201=10、409=40、available=0、ledger=10、drift=[]） |
| 每日菜单整表 `PUT /admin/daily-menu` | 本轮验证了 GET 20 行与单品库存 PUT；整表保存在 Stage 5c 已验证（`artifacts/s5c-product/ac030-032-curl.log`） |
| AI 实际 LLM 调用 | 未配置 Key，无法验证真实模型输出（见 PRD-GAP-001） |
| 多设备/多标签页同时登录 | PRD 未要求，`NOT TESTED` |

## 6. 证据清单（`artifacts/prd-verify/`）

| 文件 | 内容 |
|---|---|
| `prd-verify.log` / `results.json` | 106 项 API 检查逐条结果 |
| `fix-checks.log` | 2 条断言口径复核 |
| `ai-and-upload.log` | 图片上传 200、AI SSE 事件与候选菜品 |
| `stock-soldout.log` | 售罄标记与库存恢复 |
| `ui-menu.png` / `ui-menu-mobile-375.png` | 菜单桌面/移动端（For You 高亮） |
| `ui-allergen-modal.png` | Egg 过敏原弹窗 |
| `ui-dish-detail.png` / `ui-detail-options.log` | 详情页选项与价格、加购 |
| `ui-cart.png` / `ui-checkout.png` | 购物车配置与总价、结算页截单/预算提示 |
| `ui-orders.png` / `ui-preferences.png` | 我的订单、偏好页 |
| `ui-console-dashboard.png` / `ui-console-dishes.png` / `ui-console-orders.png` / `ui-console-audit.png` / `ui-console-inventory.png` | Console 各页 |
| `ui-employee-forbidden.png` | 员工访问 Console → Access denied |
| `ui-employee.log` / `ui-admin.log` / `ui-session-rbac2.log` / `ui-budget.log` | 浏览器操作原始日志 |

## 7. 总判定

- Tier 1（注册登录/菜单/购物车/下单）：**完整实现且实测通过**。
- Tier 2（偏好+订餐规则/Console 菜品管理）：**完整实现且实测通过**。
- Tier 3（库存/实时/防超卖、看板、AI）：库存与看板 **PASS**；AI 协议、流式、过滤与卡片 **PASS**，**LLM 实际接入 PARTIAL（P2 配置项）**。
- 无 open P0/P1；GO 结论不受 `PRD-GAP-001` 影响（Tier 3 可选加分项）。