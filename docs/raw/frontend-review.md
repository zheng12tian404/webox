# 前端代码评审报告 — WeBox（Stage 5 / FR）

- 评审人：前端代码评审员（FR，作者≠评审者）
- 时间：2026-11-14 22:48 CST
- 评审对象：`frontend/` 全部代码（49 个源文件，5970 行）、`docs/api-contract.md` v1.1、`docs/frontend-design.md`、`docs/acceptance-matrix.md`、`docs/scenario-profile.md`、`docs/test-cases.md`、`tests/e2e/*`
- 实测环境：Vite dev `127.0.0.1:5176`（proxy → 后端 `127.0.0.1:8083`，后端 PID 1355523，`/api/v1/health` 200），agent-browser 1440×900 / 375×812
- 结论：**CHANGES**

## 1. 结论摘要

前端整体工程质量高于平均水平：路由守卫、统一 API 客户端、SSE 降级、整数分金额、服务端分页、错误/空/加载态、`data-testid`（115 处）、英文文案与 RBAC 隔离均落地，构建通过，关键页面桌面/移动均无横向溢出。

但存在 **1 个阻断级契约不一致** 与 **2 个 major 业务缺口**：

1. **偏好页默认保存 100% 失败**：前端传 `tastePreference=Balanced`、`budgetMinCents=0/budgetMaxCents=0`，后端分别以 `VALIDATION_CATEGORY`、`VALIDATION_INVALID` 拒绝；员工无法保存过敏原/菜系/预算 → AC-021/022/023 不可达。
2. **菜单卡片快捷加购绕过过敏原弹窗**（G3P-M4 仍 OPEN）：过敏原判断只存在于详情页，`DishCard` 直接写购物车；实测已标记 Peanuts 用户点卡片加购 Kung Pao Chicken 无弹窗、直接入车。
3. **提交订单缺少同步 in-flight 闩锁**：同一事件循环内两次触发会发 2 个 `POST /orders`（同幂等键），实测后端返回 500 + 409，订单已创建但页面停留结算页并显示通用错误、购物车未清空。

按判定规则：存在 blocker 且 FE-5 FAIL → **CHANGES**。

## 2. 问题列表

> 位置为 `文件:行号`；修复建议按 8 分钟内可完成排序。P0/P1 交 Stage 5b 复评。

| ID | 级别 | 位置 | 失败场景 | 修复建议 | Owner |
|---|---|---|---|---|---|
| FR-B1 | **blocker** | `src/pages/employee/PreferencesPage.tsx:14,19-24,56-65,70`；后端 `backend/src/main/java/com/webox/auth/MeController.java:67-73` | 新用户进入 Preferences，不改任何项点 Save：payload `{tastePreference:"Balanced",budgetMinCents:0,budgetMaxCents:0}` → 后端 400 `VALIDATION_INVALID`（预算必须 0<min≤max）；选 `Balanced` 且填合法预算 → 400 `VALIDATION_CATEGORY`（后端只接受 Light/Medium/Rich）。实测两次均失败：`toast data-error-code=VALIDATION_INVALID` / `VALIDATION_CATEGORY`，无保存成功。结果：过敏原/菜系/预算/推荐开关全部无法落库，AC-021/022/023 无法通过 | ① 未使用预算时发送 `budgetMinCents:null,budgetMaxCents:null`（或后端接受 0/0）；② `TASTE` 与后端/PRD 对齐为 `Light/Medium/Rich`（如需“Balanced”语义则映射为 `Medium`）；③ 保存前按后端规则做前端校验并给出字段级提示。建议同步回写 `docs/frontend-design.md §10 #10` 假设为契约事实 | FE + BE 契约 |
| FR-M1 | **major** | `src/components/dish/DishCard.tsx:24-45`；对照 `src/pages/employee/DishDetailPage.tsx:96-113` | 员工偏好过敏原 `Peanuts`，在菜单卡片点 Kung Pao Chicken（无选项菜）的 Add to cart：不入详情、不读 `prefsStore`、无 `allergen-modal`，菜品直接进入购物车（实测 cart line qty=1，`allergen-modal=false`）。详情页同菜则正确弹窗。违反 D11/AC-021 与 G3P-M4 的“三入口统一判定” | 将“过敏原判定 + 弹窗”下沉到唯一加购入口（`cartStore.add` 之前或封装 `useAddToCart`），菜单卡片/详情/AI 三入口共用；补 data-testid 断言（卡片加购 Egg 菜 → 弹窗 → 确认后 +1） | FE Stage 5b |
| FR-M2 | **major** | `src/pages/employee/CheckoutPage.tsx:127-183,395-410` | 同一 tick 内两次触发 `checkout-submit`：发出 2 个 `POST /api/v1/orders`（同 Idempotency-Key）。实测网络 `500` + `409`，DB 新增 1 单（WB20261115-0011 Pending），页面仍停留 `/checkout`，显示 `IDEMPOTENCY_CONFLICT` 映射的通用文案 “Please check the highlighted fields.”，购物车未清空、无 “View Existing Order”。用户会误以为下单失败并重复操作 | ① `const inFlight=useRef(false)` 同步闩锁，进函数即置 true、finally 释放；② `IDEMPOTENCY_CONFLICT`/`ORDER_DUPLICATE` 时 GET `/orders/active` 或展示已有单入口；③ 对 `INTERNAL` 增加“订单可能已创建，请到我的订单确认”的恢复文案。后端并发同键返回 500 另见后端评审 | FE（后端 500 联动 BE） |
| FR-M3 | **major（测试代码）** | `tests/e2e/run_e2e.sh:18-37`；`tests/e2e/checklist.md:31-38` | TC-075 三档截图脚本未登录就遍历 `/menu /cart /checkout /orders`，实际会截到 `/login`，响应式证据可能“假 PASS”；防抖用例选择器 `[data-testid=add-to-cart]` 在实现中不存在（实际为 `add-to-cart-<dishId>`），且加购是本地操作，用 `/cart|/orders` 网络过滤断言请求数无意义，用例会空跑通过 | 脚本先完成登录并按 viewport 复用 storage；选择器改 `[data-testid^="add-to-cart-"]`；防抖断言改为购物车行数/数量与点击次数对比，或对结算 `POST /orders` 单独计数 | Test |
| FR-m1 | minor | `src/pages/employee/CheckoutPage.tsx:381-383` | 结算摘要出现重复截单时间：“Order by 10:00 \| 10:00”（label 已含时间，value 再显示一次） | label 改 `Cut-off time`，value 只显示时间 | FE |
| FR-m2 | minor | `src/pages/employee/DishDetailPage.tsx:106-112,217` | 打开过敏原弹窗期间主按钮显示 “Loading…”，用户尚未确认即呈现加载态 | `busy` 只在真正请求/写购物车时置位，或弹窗打开时恢复 `Add to cart` 文案 | FE |
| FR-m3 | minor | `src/pages/console/AuditPage.tsx:12-16,36-48` | action/objectType 输入每敲一个字符即改变 path 并触发一次请求，无 300ms 防抖 | 复用 `useDebounce`，Apply 按钮显式触发一次 | FE |
| FR-m4 | minor | `src/pages/console/DishesPage.tsx:89` | 编辑菜品兜底查询固定 `page=1&size=100`；菜品 >100 时列表外的菜品无法编辑（弹窗一直 Skeleton/空表单） | 用 `dishId` 过滤查询或补 `GET /admin/dishes/{id}` | FE/BE |
| FR-m5 | minor | `src/pages/console/InventoryPage.tsx:105-117` | Dish ID 输入 `abc` 时按钮仍可点（仅判空），`Number('abc')=NaN` 以 `null` 提交；delta 无上限校验 | `isIntInRange` 校验正整数，delta 限制 ±9999，非法时禁用并提示 | FE |
| FR-m6 | minor | `frontend/vite.config.ts:15`；构建产物 | 单 chunk 716.47 kB（gzip 207.34 kB），Recharts 全量进入首屏 | 路由级 `React.lazy` + `manualChunks` 拆分 console/Recharts | FE（P2） |
| FR-m7 | minor | `src/components/ui/Modal.tsx:14-49` | 无焦点陷阱、打开时未聚焦首个可操作元素，键盘/读屏可 Tab 到背景 | 打开时 focus 首按钮，Tab 循环限制在 dialog 内 | FE（P2） |
| FR-m8 | minor | `src/pages/employee/CheckoutPage.tsx:346-352` | 直接深链进入结算页时 `prefsStore` 未加载，预算提示显示 “your budget” 而非 `¥15.00` | 结算页主动 GET `/me/preferences`（或 preview 返回 budgetMaxCents） | FE |
| FR-m9 | nit | `src/api/client.ts:78-80` | 保留 204 分支，与契约“全部 200 包络”不一致（无害） | 契约稳定后删除，避免后续误用 | FE |

> 观察（非前端代码缺陷）：种子 `image_url` 按位置绑定（dish 1→image_01.jpg），运行截图出现“Beef Noodle Soup 配橙子、Caesar Salad 配芒果汽水”等图文不符。前端 `ImageWithFallback` 逻辑正确；建议数据/Owner 复核 PRD 附件与菜名映射，避免演示与 AC-029 视觉验收风险。

## 3. 前端 P6+ 五项

| 项 | 结论 | 分 | 代码位置 | 实测证据 |
|---|---|---|---|---|
| FE-1 响应式 | **PASS** | 4/4 | `styles/global.css:336-394`（1023/767 断点、表格转卡片、汉堡菜单、底部购物车栏）；`AppLayout.tsx:61-69` | 375×812 `/menu`：`scrollWidth=360 ≤ innerWidth=375`，截图 `artifacts/evidence/frontend-review/fr-menu-mobile-375.png`；375 `/cart`：`375≤375`，`fr-cart-mobile-375.png`；375 `/admin/dishes`：`360≤375`，表格转卡片 `fr-admin-dishes-mobile-375.png`；1440 `/menu`、`/admin/dashboard`、`/checkout` 截图无溢出 |
| FE-2 分页/长列表 | **PASS** | 4/4 | `MenuPage.tsx:55-67,189`、`OrdersPage.tsx:17-21`、`Pagination.tsx`、`DishCard` 为 `memo`；服务端 `page/size`；搜索 300ms 防抖 | `GET /menu?page=1&size=5` → `page=1,size=5,total=20,items=5`；页面显示 `Page 1 of 4 · 20`（`fr-pagination-size5.png`）；菜单网络证据显示仅 `page,size,search,category,sort` 参数；无全量重算/无虚拟列表（单页 20 合理） |
| FE-3 防抖/节流 | **PASS（带风险）** | 3/4 | `useDebounce.ts`；`MenuPage.tsx:29-53`；`DishCard.tsx:24-45`（busy 350ms + disabled）；`CheckoutPage.tsx:139,405`（submitting + disabled + 幂等键） | 搜索输入 300ms 后仅一次 path 变更（代码+设计 FE-3）；加购为本地状态、注意卡片连点被 busy/limit 拦截；5 连点后按钮文案 `Order limit reached: max 5 items per order.` 且 disabled（`fr-5-item-cap.png`）。风险：同 tick 程序化双触发可绕过 state 闩锁，见 FR-M2 |
| FE-4 价格精度 | **PASS** | 4/4 | `utils/money.ts`（整数分、`formatMoney` 整除+补零、`parseYuanToCents` 字符串解析）；`cartStore.ts:88` 选项整数求和；`CheckoutPage.tsx:70` | 5×Kung Pao Chicken 2200 分：购物车/结算均显示 `¥110.00`（`fr-cart-5-items.png`、`fr-checkout-desktop.png`）；选项加价按 `priceDeltaCents` 整数累加；全页面金额正则 `^¥\d+\.\d{2}$` 未见尾差。仅 `DishesPage.tsx:110` 用 `priceCents/100.toFixed(2)` 做输入回显（无算术累加，可接受） |
| FE-5 输入校验 | **FAIL** | 1/4 | `utils/validation.ts` 覆盖邮箱/密码/搜索/地址/名称/描述/原因/AI prompt；`DishDetailPage` 必选组拦截；`ConfirmReasonModal` 原因+勾选 | 前端边界校验本身完整，但**与后端不一致**：`Balanced` 是前端合法枚举却被后端拒绝；未设预算发送 `0/0` 被后端拒绝（见 FR-B1）。实测 `VALIDATION_CATEGORY` / `VALIDATION_INVALID`，偏好无法保存；“前后端一致”不成立 |

**合计：16/20。**

## 4. Scenario checks

| Profile / 检查项 | 结论 | 证据 |
|---|---|---|
| `general-engineering` GE-1 构建启动 | **PASS** | `npm run build` exit 0：`tsc --noEmit` + `vite build`，693 modules，4.21s（`/tmp/fr-build.log`）；dev `5176` 200，proxy health 200 |
| GE-3 统一错误码/分页 | **PASS** | 错误 Toast 携带 `data-error-code`/`data-request-id`（`ToastHost.tsx:13-15`），实测 `VALIDATION_INVALID`；分页 `page/size` 服务端生效 |
| GE-5 英文文案 + `¥xx.xx` | **PASS** | `grep -P '[\x{4e00}-\x{9fff}]' src` 无结果；截图所有页面为英文；金额 `¥28.00/¥110.00` |
| GE-7 证据可追溯 | **PASS** | 115 处 `data-testid`；本报告截图与命令输出可复核 |
| `transaction-order` TO-1 金额整数分 | **PASS** | 见 FE-4；下单只发送 `dishId/qty/optionIds`（`CheckoutPage.tsx:49-53`） |
| TO-3 加购不占库存 | **PASS** | 加购仅写 Zustand/localStorage（`cartStore.ts`），无网络请求 |
| TO-4 下单幂等（前端） | **PASS（带风险）** | `useIdempotencyKey` 绑定 canonical body，`CheckoutPage.tsx:154` 发送 `Idempotency-Key`；双击并发场景见 FR-M2 |
| TO-9 总份数 ≤5 | **PASS** | 5 次加购合并 1 行 qty=5，第 6 次按钮 disabled 且文案英文（`fr-5-item-cap.png`）；`cartStore.MAX_TOTAL_QTY=5`，`inc` 同样拦截 |
| TO-8/TO-2 订单快照/库存展示 | **PASS（前端渲染）** | 订单详情按 `unitPriceCents/options/subtotalCents` 渲染，不实时查价（`OrderDetailPage.tsx:67-86`）；库存 SSE `Live stock` 实测 |
| AC-011 购物车行身份 | **PASS** | `cartStore.ts:43-44,79-100` 以 `dishId|sorted(optionIds)` 合并同配置、区分不同配置；单价=base+Σdelta（整数） |
| AC-020 5 份上限 | **PASS** | 同上；API 侧 400 `ORDER_LIMIT_EXCEEDED` 由后端评审覆盖 |
| AC-021 过敏原提醒 | **FAIL** | 详情页 PASS（`fr-detail-allergen-modal.png`，文案含 Peanuts）；菜单卡片 FAIL（`fr-card-add-no-allergen-modal.png`，无弹窗直接入车）→ FR-M1 |
| AC-022/023 偏好/预算 | **FAIL**（保存）/ PASS（提示） | 偏好保存失败 FR-B1（`fr-prefs-save-error.png`、`fr-prefs-balanced-error.png`）；预算提示实测出现（`fr-budget-warning.png`），但金额因 store 未加载显示 “your budget”（FR-m8） |
| AC-036 SSE 实时库存 | **PASS** | 菜单页实测 `Live stock`（`fr-menu-desktop.png`）；`useMenuStream` 3 次失败切 5s 轮询 |
| AC-038~040 AI | **PASS（降级）** | 未配 Key：5 张推荐卡 + `Rule-based fallback` 徽标（`fr-ai-fallback.png`）；SSE 事件 `meta/dish/reason/done` 由 `AiAssistant.tsx:93-115` 消费；真实模型质量 **NOT TESTED** |
| AC-054/057 金额/英文 | **PASS** | 见 FE-4/GE-5 |
| `identity-access` IA-2 Console 隔离 | **PASS** | 员工访问 `/admin` → `/403`（`fr-employee-admin-guard.png`）；员工 token 调 `/api/v1/admin/dishes` → 403 `FORBIDDEN`（curl 实测） |
| IA-4 输入校验前后端一致 | **FAIL** | 见 FE-5/FR-B1 |
| `ai-llm` AI-3 无 Key 降级 | **PASS** | 上表；AI-1/2/5 为后端职责，前端 N/A |

## 5. 实际执行命令与输出摘录

```bash
# 构建（Node v22.22.3 / npm 10.9.8）
cd frontend && npm run build
> tsc --noEmit && vite build
✓ 693 modules transformed.
dist/assets/index-DN50mWz6.js   716.47 kB │ gzip: 207.34 kB
✓ built in 4.21s            # exit 0

# 后端健康（8083）
curl -s http://127.0.0.1:8083/api/v1/health
{"code":"OK","message":"OK","data":{"status":"UP","db":"UP","redis":"UP","cache":"UP"},...}

# 前端 dev + 代理
VITE_PROXY_TARGET=http://127.0.0.1:8083 VITE_DEV_PORT=5176 npm run dev
curl http://127.0.0.1:5176/api/v1/health → 200

# 偏好保存实测（管理员/评审账号）
PUT /api/v1/me/preferences {"tastePreference":"Balanced","budgetMinCents":0,"budgetMaxCents":0,...}
→ 400 VALIDATION_INVALID / VALIDATION_CATEGORY
浏览器点击 Save → toast data-error-code=VALIDATION_INVALID，无成功横幅

# 过敏原卡片加购实测
prefs={allergens:["Peanuts"]} → /menu 点 add-to-cart-1
→ allergen-modal=false, cart line {dishId:1,qty:1}; 详情页同菜 → allergen-modal=true

# 5 份上限
连续加购 5 次 → cart lines [5]，按钮文案 "Order limit reached: max 5 items per order." 且 disabled

# 分页
GET /menu?page=1&size=5 → page=1,size=5,total=20,items=5；UI "Page 1 of 4 · 20"

# 双击结算（同一 tick）
2×POST /api/v1/orders (same Idempotency-Key) → HTTP 500 + 409；DB +1 单 WB20261115-0011；
页面停留 /checkout，error-code=IDEMPOTENCY_CONFLICT，cart 未清空

# RBAC
employee token GET /api/v1/admin/dishes → 403 FORBIDDEN
```

## 6. 截图路径

均位于 `artifacts/evidence/frontend-review/`：

- `fr-menu-desktop.png`、`fr-menu-mobile-375.png`、`fr-pagination-size5.png`
- `fr-cart-5-items.png`、`fr-cart-mobile-375.png`、`fr-checkout-desktop.png`
- `fr-card-add-no-allergen-modal.png`、`fr-detail-allergen-modal.png`
- `fr-prefs-save-error.png`、`fr-prefs-balanced-error.png`、`fr-budget-warning.png`
- `fr-5-item-cap.png`、`fr-ai-fallback.png`
- `fr-admin-dashboard-desktop.png`、`fr-admin-dishes-desktop.png`、`fr-admin-dishes-mobile-375.png`
- `fr-employee-admin-guard.png`、`fr-console-confirm-reason-mobile.png`

## 7. Stage 5b 最小修复项（8 分钟）

1. **FR-B1（必修，blocker）**：`PreferencesPage` 未用预算发送 `null`；`TASTE` 改 `Light/Medium/Rich`（与后端 `MeController:68` 对齐）。回归：默认值 Save 200；选 Balanced/Medium 保存成功；过敏原刷新后仍在。
2. **FR-M1（必修，major）**：把过敏原判定抽到统一加购函数，`DishCard` 调用；回归：含 Peanuts 用户卡片加购 Kung Pao → 弹窗 → Cancel 不入车 / Add anyway 入车。
3. **FR-M2（必修，major）**：`CheckoutPage.submit` 加 `useRef` in-flight 闩锁；`IDEMPOTENCY_CONFLICT` 时展示已有单/提示去订单页核对。回归：同一 tick 双触发仅 1 个 POST；异常后页面可恢复。
4. **FR-M3（建议，测试）**：E2E 脚本先登录再截图；修正加购选择器与断言。
5. **FR-m1/m2/m3（可延后 P2）**：重复截单时间、详情按钮 Loading 文案、Audit 防抖。

## 8. NOT TESTED

- 真实 LLM 输出质量与首 token ≤3s/总 ≤20s（无 `LLM_API_KEY`，仅验证 `fallback:true` 规则降级）。
- 图片上传（≤5MB/jpg/png/webp）与上传后列表同步的 UI 全流程（Console 写操作本轮以后端评审证据为准）。
- 768×1024 平板三档全页面截图（本轮抽测 375/1440；768 复用既有 `frontend-menu-tablet-768.png`）。
- 多用户并发 SSE 库存联动（AC-036 的 ≤2s 传播）——单客户端 `Live stock` 已验证，双客户端时序未测。
- 浏览器控制台无错误断言（agent-browser 共享 daemon 存在跨工作区会话串扰，未作为结论依据）。