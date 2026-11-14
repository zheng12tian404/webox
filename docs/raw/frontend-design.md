# 前端技术方案 — WeBox 员工餐食订购平台

- 版本：v1.0（Stage 3 前端技术方案设计师，2026-11-14 22:18 CST）
- 输入：`docs/architecture.md`、`docs/api-contract.md`、`docs/data-model.md`、`docs/test-plan.md`、`docs/test-cases.md`、`docs/prd-analysis.md`、`docs/acceptance-matrix.md`、`docs/scenario-profile.md` v2、`docs/assumptions.md`、`RUNBOOK.md`
- 评审：`docs/cross-review-g2-frontend.md`（CHANGES，2B+9M）；发现台账：`docs/review-findings.md`（G2FE-*）
- 结论：**PASS（设计完成，可进入 Stage 4）**；契约缺口以前端防御性实现兜底，不虚报。
- 目标工程：`/home/gem/code/req-squad/workspace/6343a752-e110-407c-8dfb-a5873425d917/frontend/`

## 1. 技术选型与工程结构

### 1.1 选型与理由

| 项 | 选型 | 理由 / 失效条件 |
|---|---|---|
| 框架 | React 18 + TypeScript（strict） | 生态稳、团队熟悉；列表/表单/流式 UI 组件化成本低 |
| 构建 | Vite 5 | 启动 <1s，`/api` proxy 免 CORS；生产 `dist/` 可由后端静态托管 |
| 路由 | React Router 6（`createBrowserRouter`） | 嵌套路由 + 守卫 + 深链；刷新不 404 需后端 SPA fallback（README 写明） |
| 状态 | Zustand 4（auth / cart / stock / ui）+ React Context（Toast） | 比 Redux 轻；persist 中间件直接满足 localStorage；50 道菜规模无需 RTK Query |
| 服务端数据 | 自研 `useApiQuery`（AbortController + 内存 cache + 失效） | **不引入 TanStack Query**：50 分钟窗口减少依赖与配置风险；缓存语义只需“菜单写后刷新” |
| 样式 | CSS Variables + CSS Modules | 无 Tailwind 构建配置成本；三档断点用 media query 明写 |
| 图表 | Recharts（仅 Console 看板，`React.lazy` 分包） | PRD 指定柱状/折线；懒加载避免拖慢员工端首屏 |
| 图标 | 内联 SVG（12 个） | 无额外依赖、可 `currentColor` 换色 |
| 测试钩子 | `data-testid` + `VITE_API_BASE_URL` | 配合 `tests/e2e/checklist.md` |

### 1.2 目录结构（Stage 4 按此创建）

```text
frontend/
├── index.html
├── package.json                 # scripts: dev/build/lint/typecheck
├── tsconfig.json                # strict:true, noUncheckedIndexedAccess:true
├── vite.config.ts               # server.port=5173, proxy /api,/images -> 127.0.0.1:8080
├── .env.example                 # VITE_API_BASE_URL=/api/v1
├── public/
│   ├── images/image_01.jpg … image_20.jpg   # 由 docs/product_images 复制重命名
│   └── images/placeholder.svg
└── src/
    ├── main.tsx                 # createRoot + RouterProvider
    ├── App.tsx                  # 全局布局 + ToastProvider + ErrorBoundary
    ├── api/
    │   ├── client.ts            # fetch 封装、Bearer、超时、401 单飞刷新、错误映射
    │   ├── errors.ts            # ERROR_MESSAGES + mapApiError
    │   ├── sse.ts               # fetch+ReadableStream 解析 event/data
    │   ├── endpoints.ts         # 38 端点常量（见 §2.3）
    │   └── types.ts             # 契约 DTO（含 G2FE-B1/B2 预留字段）
    ├── components/
    │   ├── layout/ AppLayout.tsx ConsoleLayout.tsx Header.tsx BottomBar.tsx
    │   ├── ui/ Button.tsx Input.tsx Select.tsx Checkbox.tsx Modal.tsx Drawer.tsx
    │   │      Toast.tsx Skeleton.tsx EmptyState.tsx ErrorState.tsx Pagination.tsx Badge.tsx
    │   ├── dish/ DishCard.tsx DishGrid.tsx FilterBar.tsx SearchBox.tsx StockBadge.tsx
    │   ├── dish/ OptionGroup.tsx PriceSummary.tsx AllergenModal.tsx
    │   ├── cart/ CartLine.tsx CartSummary.tsx CartDrawer.tsx
    │   ├── order/ OrderCard.tsx OrderTable.tsx OrderItems.tsx CancelOrderModal.tsx
    │   ├── console/ DishForm.tsx ConfirmReasonModal.tsx DailyMenuTable.tsx
    │   │           InventoryReconcile.tsx AuditTable.tsx DashboardCharts.tsx
    │   └── ai/ AiAssistant.tsx AiDishCard.tsx FallbackBadge.tsx
    ├── pages/
    │   ├── auth/ LoginPage.tsx RegisterPage.tsx
    │   ├── employee/ MenuPage.tsx DishDetailPage.tsx CartPage.tsx CheckoutPage.tsx
    │   │            OrderSuccessPage.tsx OrdersPage.tsx OrderDetailPage.tsx PreferencesPage.tsx
    │   ├── console/ DashboardPage.tsx DishesPage.tsx DailyMenuPage.tsx ConsoleOrdersPage.tsx
    │   │            InventoryPage.tsx AuditPage.tsx AiRulesPage.tsx
    │   └── system/ ForbiddenPage.tsx NotFoundPage.tsx
    ├── routes/ router.tsx RequireAuth.tsx RequireAdmin.tsx
    ├── store/ authStore.ts cartStore.ts stockStore.ts uiStore.ts
    ├── hooks/ useApiQuery.ts useDebounce.ts useMenuStream.ts useIdempotencyKey.ts
    │         usePreferences.ts useMediaQuery.ts useDocumentTitle.ts
    ├── i18n/ en.ts              # 全部用户可见文案（英文），key 清单见 §8
    ├── styles/ tokens.css global.css
    ├── types/ api.ts domain.ts
    └── utils/ money.ts validation.ts datetime.ts cart.ts
```

### 1.3 环境变量 / 代理 / 命令

```bash
# environment
VITE_API_BASE_URL=/api/v1          # 可注入（E2E 指向 mock/其他端口）
VITE_APP_NAME=WeBox
VITE_SSE_POLL_MS=5000              # SSE 降级轮询间隔
VITE_REQUEST_TIMEOUT_MS=15000
VITE_AI_TIMEOUT_MS=25000

# vite.config.ts
server: { port: 5173, proxy: {
  '/api':    { target: 'http://127.0.0.1:8080', changeOrigin: true },
  '/images': { target: 'http://127.0.0.1:8080', changeOrigin: true } } }

# commands
npm ci
npm run dev -- --port 5173        # 开发（proxy /api → 8080）
npm run typecheck                 # tsc --noEmit（strict）
npm run build                     # tsc -b && vite build，产物 dist/
npm run preview -- --port 5173
```

- ESLint：`eslint:recommended` + `@typescript-eslint` + `react-hooks`；CI 门禁 `npm run typecheck && npm run build` 必须 0 error。
- 图片：复制并重命名 20 张 `docs/product_images/image_NN_*.jpg → frontend/public/images/image_NN.jpg`，校验 `ls public/images/*.jpg | wc -l == 20`；`imageUrl` 缺失或 404 时用 `placeholder.svg`（`onError` 兜底，不裂图）。

## 2. 路由与页面

### 2.1 路由清单（19 条：员工 10 + Console 7 + 系统 2）

| # | 路径 | 页面 | Tier | 守卫 | 主要 API | 关键 testid |
|---|---|---|---|---|---|---|
| R01 | `/login` | LoginPage | T1 | 公开（已登录→按角色跳转） | `POST /auth/login` | `login-email` `login-password` `login-submit` `login-error` |
| R02 | `/register` | RegisterPage | T1 | 公开 | `POST /auth/register` → 自动登录 | `register-email` `register-password` `register-submit` |
| R03 | `/menu` | MenuPage（默认首页） | T1 | 登录 | `GET /menu`、`/menu/filters`、SSE `/menu/stream` | `menu-grid` `menu-card-{dishId}` `add-to-cart-{dishId}` `stock-badge-{dishId}` |
| R04 | `/menu/:dishId` | DishDetailPage | T1 | 登录 | `GET /menu/{dishId}` | `dish-detail` `dish-price` `option-{optionId}` `detail-add-to-cart` |
| R05 | `/cart` | CartPage | T1 | 登录 | 无（本地）→ 结算前 preview | `cart-page` `cart-line-{lineId}` `cart-qty-plus` `cart-total` `cart-empty` |
| R06 | `/checkout` | CheckoutPage | T1 | 登录 | `POST /orders/preview`、`POST /orders`、`/me/addresses` | `checkout-total` `checkout-submit` `checkout-existing-order` `budget-warning` `auto-switch-banner` |
| R07 | `/orders/:orderId/success` | OrderSuccessPage | T1 | 登录 | `GET /orders/{orderId}`（刷新兜底） | `order-success` `order-no` `order-delivery` |
| R08 | `/orders` | OrdersPage | T1 | 登录 | `GET /orders?page&size&status` | `orders-list` `order-row-{orderNo}` `orders-empty` |
| R09 | `/orders/:orderId` | OrderDetailPage | T1 | 登录（本人；ADMIN 可读） | `GET /orders/{orderId}`、`POST /orders/{id}/cancel` | `order-detail` `order-status` `order-cancel` |
| R10 | `/preferences` | PreferencesPage | T2 | 登录 | `GET/PUT /me/preferences`、`GET /menu/filters` | `pref-allergen-{name}` `pref-budget-max` `pref-save` `pref-recommend-toggle` |
| R11 | `/console` | DashboardPage | T3 | ADMIN | `GET /admin/dashboard` | `dashboard-tiles` `dashboard-top10` `dashboard-trend` `dashboard-lowstock` |
| R12 | `/console/dishes` | DishesPage | T2 | ADMIN | `GET/POST/PUT /admin/dishes`、`PATCH .../status`、`POST .../image` | `console-dishes` `dish-create` `dish-edit-{id}` `dish-status-{id}` `confirm-reason` |
| R13 | `/console/daily-menu` | DailyMenuPage | T2 | ADMIN | `GET/PUT /admin/daily-menu`、`PUT .../stock` | `daily-menu-date` `daily-menu-row-{dishId}` `daily-menu-publish` `daily-menu-qty` |
| R14 | `/console/orders` | ConsoleOrdersPage | T2（P2 子项） | ADMIN | `GET /admin/orders`、`PATCH /admin/orders/{id}/status` | `console-orders` `admin-order-status-{id}` |
| R15 | `/console/inventory` | InventoryPage | T3 | ADMIN | `GET /admin/inventory/reconcile`、`POST .../adjust` | `inventory-drift` `inventory-adjust` |
| R16 | `/console/audit` | AuditPage | T2 | ADMIN | `GET /admin/audit-logs` | `audit-table` `audit-filter-action` |
| R17 | `/console/ai-rules` | AiRulesPage | T3（P2） | ADMIN | `GET/PUT /admin/ai-rules` | `ai-rules-config` `ai-rules-save` |
| R18 | `/403` | ForbiddenPage | — | 登录 | — | `forbidden-page` |
| R19 | `*` | NotFoundPage | — | 公开 | — | `not-found-page` |

> AI 助手不是独立路由，而是 MenuPage 内的 Drawer（`AiAssistant`），保留 `?ai=1` 深链打开（E2E 稳定）。

### 2.2 守卫与跳转

```text
未登录访问受保护路由 → /login?next=<encoded>  （登录成功后按 next 回跳，缺省按角色）
EMPLOYEE 访问 /console/** → /403（不渲染任何 Console 组件；API 403 由 client 兜底）
ADMIN 登录成功 → /console（可从 Header 回 /menu）
token 过期：client 单飞 refresh 成功→重放原请求；失败→清 store→/login
404：未知路径 → NotFoundPage（含 Back to Menu）
```

- `RequireAuth`：`authStore.status === 'loading'` 时渲染全屏 Skeleton（避免刷新闪登录页）；`anonymous` → 跳转；`authenticated` 渲染 `<Outlet/>`。
- `RequireAdmin`：角色不是 `ADMIN` → `<Navigate to="/403" replace/>`；不做“隐藏菜单按钮”式假权限（AC-028 要求后端 403 + 前端不渲染）。

### 2.3 API 端点常量（与 api-contract 38 个一一对应）

`src/api/endpoints.ts` 按契约编号导出，禁止页面内拼字符串：

```ts
export const EP = {
  register:'/auth/register', login:'/auth/login', refresh:'/auth/refresh',
  logout:'/auth/logout', me:'/auth/me',
  prefs:'/me/preferences', addresses:'/me/addresses',
  menu:'/menu', dish:(id:number)=>`/menu/${id}`, filters:'/menu/filters',
  stream:'/menu/stream', streamTicket:'/menu/stream-ticket',
  preview:'/orders/preview', orders:'/orders', order:(id:number)=>`/orders/${id}`,
  activeOrder:'/orders/active', cancel:(id:number)=>`/orders/${id}/cancel`,
  adminOrders:'/admin/orders', adminOrderStatus:(id:number)=>`/admin/orders/${id}/status`,
  adminDishes:'/admin/dishes', adminDish:(id:number)=>`/admin/dishes/${id}`,
  adminDishStatus:(id:number)=>`/admin/dishes/${id}/status`,
  adminDishImage:(id:number)=>`/admin/dishes/${id}/image`,
  dailyMenu:'/admin/daily-menu',
  dailyMenuStock:(d:string,id:number)=>`/admin/daily-menu/${d}/${id}/stock`,
  reconcile:'/admin/inventory/reconcile', adjust:'/admin/inventory/adjust',
  dashboard:'/admin/dashboard', audit:'/admin/audit-logs',
  aiRules:'/admin/ai-rules', aiRecommend:'/ai/recommend', health:'/health',
} as const;
```

## 3. 组件与交互

### 3.1 菜单页（R03）

- **DishCard**：`<article>` 图片（`loading="lazy"`、4:3、`onError` 占位）、名称（2 行截断）、`formatMoney(priceCents)`、菜系 chip、辣度 chip、`StockBadge`；`For You` 开启且 `item.forYou` → 高亮描边 + `For you` 徽标（AC-022）。
- **StockBadge**：`soldOut` → 灰度蒙层 + `Sold out`（Add 禁用）；`lowStock` → 橙色 `Low stock`；否则 `Available`。**数量展示仅来自 SSE `available`（整数）**：未收到 SSE 计数前不虚构 `Only N left`；收到后显示 `Only N left`（1–3）/`N available`。契约若补菜单 `availableQty:int`（见 §10 缺口-14 / G2-BE-M2），直接改用该字段。
- **Add 行为**（契约缺口 B1 的防御实现）：
  - `item.hasRequiredOptions === true`（字段未上线前用 `item.hasOptions !== false && item.hasOptions !== undefined` 无法判定 → 统一打开详情 Drawer/跳详情）；
  - 无必选项 → 直接 `cartStore.add(dish, [])`，并做 300ms 节流 + 在途禁用（FE-3）；
  - 购物车总份数 ≥5 → 禁用并显示 `Order limit reached: max 5 items per order.`；售罄禁用。
- **FilterBar**：6 个菜系多选（`aria-pressed`），选择后以 `category=Chinese,Japanese` 请求（OR 并集，AC-007）；清空按钮。
- **SearchBox**：受控输入，`maxLength=50`，300ms 防抖后写 URL `?search=`；粘贴 >50 截断并提示；命中数显示 `N dishes found`；空结果 EmptyState（含 Clear filters）。
- **排序开关**：`For You` toggle → `sort=for-you`；关闭 → `sort=default`；刷新保留（URL `?sort=` + 偏好同步）。
- **分页**：`page/size` 写 URL；默认 `size=20`；上一页/下一页 + 页码；`page*size >= total` 时禁用；切换筛选/搜索重置 `page=1`。20→50+ 菜品：服务端分页 + 单页 ≤20 卡片 + `React.memo(DishCard)`，不做虚拟列表（单页 20 行无需；避免复杂度）。
- **URL 即状态**：`/menu?page=1&size=20&category=Chinese,Japanese&search=chicken&sort=default`，刷新/深链/E2E 可复现。

### 3.2 菜品详情与选项（R04）

- 布局：桌面左图右信息；移动单列，底部固定 `PriceSummary`（价格 + Add to Cart，≥44px）。
- 选项组：`minSelect===maxSelect===1` 用 radio；多选且 `maxSelect>1` 用 checkbox（达到上限禁用其余并提示 `Up to N selections`）；`required` 组标 `Required`。
- 实时加价：`unitPriceCents = priceCents + Σ selected.priceDeltaCents`；`formatMoney` 展示；不做任何 float 运算（选项加价均为整数分）。
- 必选校验：未满足时 Add 禁用并提示 `Please select: Bun, Sauce`；maxSelect 超出不可点（UI 层）+ 服务端 400 兜底。
- 过敏原（T2）：`prefs.allergens ∩ dish.allergens` 非空 → `AllergenModal`：`This dish contains an allergen you flagged: Egg. Add anyway?`；`Add anyway` → 加购；`Cancel` → 关闭（不过滤该菜，AC-021）。
- Add 成功：Toast `Added to cart` + 购物车角标 + 不自动跳转；同配置再次 Add 合并数量（AC-011）。

### 3.3 购物车（R05）

- 数据模型（§5.2）按 `dishId + sorted(optionIds)` 分行；同菜不同配置不同行；行内展示选项名（如 `Whole Wheat · Mustard · Cheese (+¥3.00)`）。
- `+`：总份数 5 时禁用；`−`：降到 0 删除该行；删除按钮；清空按钮（二次确认）。
- 总价：`cartStore.totalCents()` 用整数分累加；空态 `Your cart is empty` + `Browse menu`，总价 `¥0.00`。
- 刷新持久化：Zustand `persist` 写 `localStorage['webox.cart.v1']`（`version` 字段 + 迁移函数，脏数据丢弃）。
- `Proceed to Checkout` → `/checkout`；空车禁用。
- 价格快照仅用于展示：结算 preview 返回服务端价；若 `preview.totalCents !== cart.totalCents` → 顶部横幅 `Prices were updated. New total: ¥xx.xx.` 并用 preview 明细覆盖显示（提交仍以服务端为准）。

### 3.4 结算与提交（R06，交易主路径）

1. 进入即 `POST /orders/preview`（`items:[{dishId,qty,optionIds}]`，`deliveryDate`/`mealType`/`address` 可选）：渲染明细/`totalCents`/`effectiveDate`/`effectiveMeal`/`cutoffAt`/`budgetExceeded`/`addresses`/`existingOrderId`。
2. **截单自动切换**：`autoSwitched=true` → 横幅 `Lunch has closed. Your order will be placed for Dinner on 2026-11-14 (cutoff 15:00).`；`effectiveMeal` 按契约枚举 `Lunch|Dinner` 映射文案（不直接大写拼接，规避 G2FE-M6）。
3. **唯一有效单**：`preview.existingOrderId` 存在 → 主按钮变 `View Existing Order` → 跳 `/orders/{id}`；用户改餐次/日期后重新 preview。
4. **预算**：`budgetExceeded=true` → 黄色提示 `This order exceeds your meal budget (¥15.00). You can still place it.`，不阻断（AC-023）。
5. **地址**：下拉历史地址（`GET /me/addresses`）+ `New address` 输入（≤200，超长前端提示；后端 400 同文案）；新地址提交订单前 `POST /me/addresses`（409 已存在则忽略），再下单。
6. **日期/餐次**：默认 today + Lunch（A-09/PRD）；日期选项 today/+1/+2（D21 种子），空菜单日期由 preview 409 处理并提示切换（缺口 M2）；餐次 Lunch/Dinner。
7. **提交防抖 + 幂等**：
   - 按钮 `disabled + loading`（`Placing order…`），提交期间不可再点；
   - `Idempotency-Key = crypto.randomUUID()`，按“规范化请求体 hash”存入 `sessionStorage['webox.idem.v1']`；同 body 重试复用同一 key，body 变化或成功后清除；
   - 超时/5xx 允许同一 key 重试 1 次（同键重放安全）；4xx 不自动重试；
   - 成功后 `cartStore.clear()` → `/orders/{id}/success`。
8. **错误分支**：`STOCK_INSUFFICIENT` → 行内标红 + `Only N left for {dish}` + `Adjust cart`；`ORDER_DUPLICATE` → 按钮切 `View Existing Order`；`ORDER_MEAL_UNAVAILABLE` → 提示改日期/餐次；`ORDER_LIMIT_EXCEEDED` → 回购物车；`RATE_LIMITED` → 禁用 30s 倒计时；`IDEMPOTENCY_CONFLICT` → 提示刷新购物车（body 已变化）。
9. **成功页**：`orderNo`、`deliveryDate`、`mealType`、`address`、`estimatedDelivery`、`totalCents`；`View order` / `Back to menu`。

### 3.5 我的订单 / 详情 / 取消（R08/R09）

- 列表：状态 Tabs（All/Pending/Confirmed/Completed/Cancelled）+ 分页；桌面表格、移动卡片；字段 `orderNo/status/totalCents/itemCount/deliveryDate/mealType/createdAt`；空态 `No orders yet`。
- 详情：`orderNo` + 状态 Badge + 配送信息 + 明细（名称/选项/单价/数量/小计，服务端快照）+ 总价；`Pending` 且本人 → `Cancel order`；`Confirmed/Completed` 不显示取消按钮（AC-019）。
- 取消：Modal 填写原因（可选，≤200）→ `POST /orders/{id}/cancel`；成功 Toast `Order cancelled` + 状态刷新；409 `ORDER_STATE_INVALID` → Toast + 刷新详情。
- 订单号等文案使用 `font-variant-numeric: tabular-nums`，便于 E2E 读取。

### 3.6 偏好设置（R10）

- 过敏原多选（7 枚举）、偏好菜系多选（6）、辣度单选（None/Mild/Medium/Hot）、口味单选（Light/Balanced/Rich，契约未定义枚举 → 前端默认，见 §10）、预算 min/max（元输入，转分提交）、`For You` 开关。
- 预算校验：`0 < min <= max`，元→分用字符串解析（`"15.5" → 1550`），禁止 `parseFloat*100`；超限英文提示。
- 保存：`PUT /me/preferences` 全量；成功后更新 `prefsStore`（过敏原立即用于加购弹窗）并 Toast；失败保留输入 + 错误提示。
- 服务端不可用时：显示上次成功值（localStorage 镜像），保存按钮可用但提示重试；不阻断浏览。

### 3.7 Console（R11–R17）

- **布局**：左侧 Sidebar（Dashboard/Dishes/Daily Menu/Orders/Inventory/Audit/AI Rules），顶部用户邮箱 + `Back to store`；移动端 Sidebar 折叠为 Drawer。
- **Dishes（R12）**：表格列（图/名/分类/价/辣度/状态/操作）；搜索 300ms 防抖、分类/状态筛选、分页（与服务端 `page/size` 对齐）。新增/编辑用 Drawer 表单：名称 ≤100、描述 ≤1000、价格元→分、分类下拉、蛋白 ≤50、过敏原多选、辣度、图片（jpg/png/webp ≤5MB，本地预览 + 尺寸/类型校验）。新增：`POST /admin/dishes` → 有图再 `POST /admin/dishes/{id}/image`。编辑：`PUT` 必带 `confirm+reason`（高风险弹窗）。上下架：`ConfirmReasonModal`（`I understand` 勾选 + 原因 1–200 + 影响说明 `This dish will be hidden from employees.`）→ `PATCH .../status`。
- **Daily Menu（R13）**：日期选择（默认次日，可切当日）；表格列出菜品 + `published` 开关 + `totalQty`（≥0）+ 展示 `reserved/sold/available` + `inventoryMode`（DB_ATOMIC/REDIS_PREALLOC）；单行保存 `PUT .../stock`（confirm+reason），批量发布 `PUT /admin/daily-menu`（confirm+reason）；`totalQty=0` 行标 `Sold out`；保存后提示 `Menu published`，员工端 ≤1s 可见（前端不做强缓存）。
- **Orders（R14）**：状态/日期筛选 + 分页；地址列脱敏原样展示（后端已 `***`）；详情 Drawer（`GET /orders/{id}`，ADMIN 可见完整）；状态操作 Confirm/Complete/Cancel 均弹 `ConfirmReasonModal` → `PATCH /admin/orders/{id}/status`；状态机非法操作禁用（Pending 才能 Confirm/Cancel；Confirmed 才能 Complete）。
- **Inventory（R15）**：日期 + `Reconcile` 按钮 → 展示 `checked`、`drift[]`；`Adjust` 填写 `delta`（整数，可为负）+ reason → `POST /admin/inventory/adjust`；drift>0 红色告警条。
- **Audit（R16）**：action/objectType 筛选 + 分页；表格列 时间/操作者/动作/对象/前后值/原因/IP；before/after 用可折叠 `<pre>` 渲染 JSON（不注入 HTML）。
- **AI Rules（R17，P2）**：读取配置 JSON → 表单编辑权重 → `PUT /admin/ai-rules`（confirm+reason）；版本与更新时间展示；无回滚端点时显示 `Previous values are kept locally`（见 §10 缺口-09）。
- **Dashboard（R11）**：6 块——今日概览 5 个 tile（订单/收入/Completed/Pending/Cancelled）、Top10 柱状图（Recharts `BarChart`）、午晚对比（`BarChart` 双柱）、7 日趋势（`LineChart` 双 Y 轴：订单数、收入元）、低库存列表（`available ≤3`）；`Refresh` 按钮 + 60s 自动刷新（页面可见时）；空数据各图表显示 `No data for today`；加载 Skeleton；错误 ErrorState + Retry。
- **高风险统一**：所有写操作弹窗含“影响说明 + 必填原因（1–200）+ 勾选确认”，按钮 loading/disabled，成功 Toast 带对象名，失败展示 `code + message + requestId`。

### 3.8 AI 助手（T3，R03 Drawer）

- 入口：菜单页悬浮按钮 `Ask AI` + 空结果时的推荐入口；`?ai=1` 可深链。
- 输入 ≤500 字符 + 4 个快捷 prompt（`Something light` / `High protein` / `Not what I had yesterday` / `Spicy`）。
- 流式：`POST /ai/recommend`（`Accept: text/event-stream`，fetch+ReadableStream）；按事件渲染：
  - `meta` → `fallback:true` 显示 `Rule-based fallback` 徽标（AC-040）；
  - `dish` → 追加 `AiDishCard`（图/名/价/分类/库存；`available=0` 禁用 Add）；
  - `reason` → 对应卡片下追加理由（`aria-live="polite"`）；
  - `done` → 停止 loading，显示 `Add to cart` 可用；无结果 → 空态。
- 超时 25s（客户端 AbortController）→ 错误 `AI is taking too long. Please try again.`；429 → `Too many requests. Try again in a minute.`；断网 → `Connection lost. Check your network.` + Retry。
- 加购：AI 卡片与菜单卡片同规则（有必选项 → 打开详情；过敏原 → 弹窗）；AI 不决定价格/库存，价格用事件 `priceCents`，加购后以服务端 preview 为准。
- 多轮：前端生成/保存 `sessionId`（`sessionStorage`），请求携带；若 `meta` 未回传则本轮结束重置（缺口 M5）。

## 4. API 客户端

### 4.1 统一封装（`src/api/client.ts`）

```ts
type RequestOptions = { method?: HttpMethod; body?: unknown; headers?: Record<string,string>;
  signal?: AbortSignal; auth?: boolean; timeoutMs?: number; retry?: 0|1 };

async function request<T>(path: string, o: RequestOptions = {}): Promise<ApiEnvelope<T>>
```

- URL：`${import.meta.env.VITE_API_BASE_URL ?? '/api/v1'}${path}`；`Content-Type: application/json`（图片上传用 FormData，不设该头）。
- 鉴权：`Authorization: Bearer <accessToken>`（来自 `authStore`，内存）；`auth:false` 仅 login/register/refresh。
- 超时：AbortController + `setTimeout(timeoutMs ?? 15000)`；AI 25s；超时映射 `NETWORK_TIMEOUT`。
- 错误映射：非 2xx 解析 envelope；`401` 触发单飞 refresh（见 4.2）；`403` → `uiStore.toast(t('error.forbidden'))`；`429` → 限流文案；`5xx` → 通用文案 + requestId；网络错误 → 离线横幅。
- **204 短路**（G2FE-M1）：`if (res.status === 204) return {code:'OK',message:'',data:{} as T,requestId:res.headers.get('X-Request-Id') ?? ''}``。
- requestId：优先 body `requestId`，否则 `X-Request-Id`；错误 Toast 附 `Request ID: xxx`（便于排障，不含敏感信息）。
- 分页：`pageQuery({page,size=20,status?,category?,search?,sort?,date?})` 过滤空值；`size` 前端限制 1..100（`size>100` 不发请求，直接提示）。
- 重试边界：仅 `GET` 在网络错误/502/503 重试 1 次（指数退避 300ms）；`POST /orders` 仅在超时/5xx 时以**同一幂等键**重试 1 次；`POST /ai/recommend`、`/auth/login` 不自动重试。
- 幂等键：`useIdempotencyKey(body)` → `crypto.randomUUID()`（8–64），存 `sessionStorage`；键与 canonical body（`JSON.stringify` 排序后的 items/date/meal/address）绑定。

### 4.2 401 刷新（单飞）

```text
401 AUTH_TOKEN_INVALID
  ├─ 无 refreshToken → 清 auth → /login?next=...
  ├─ 已有 refresh 在途 → 挂起当前请求，等待同一 Promise
  └─ 发起 POST /auth/refresh {refreshToken}
       ├─ 200 → 写新 token 对 → 重放原请求（每个请求最多重放 1 次）
       └─ 401 → 清 auth → /login
refresh 失败/过期（7d）→ 同一路径登出；登出调用 POST /auth/logout（失败忽略）并清本地
```

- 启动恢复：内存无 accessToken 时，若 localStorage 有 refreshToken → 静默 refresh → `GET /auth/me` 校准角色；失败视为未登录（不白屏，显示登录页）。
- 存储：`accessToken` 仅内存；`refreshToken`+`user` 存 localStorage（键 `webox.auth.v1`）。风险：localStorage 可被 XSS 读取 → 前端不使用 `dangerouslySetInnerHTML`、CSP 预留、审计日志不打印 token（写入 §10 风险）。

### 4.3 SSE 消费（`src/api/sse.ts`）

```ts
export async function openSse(path: string, h: {onEvent:(e:string,d:string)=>void;
  signal: AbortSignal}): Promise<void>   // fetch + res.body.getReader()
// 解析：TextDecoder 累积 buffer；按 \n\n 分帧；逐行识别 event:/data:/retry:/: ping
// 只处理单行 JSON（契约固定）；JSON.parse 失败 → 忽略该帧并计数
```

- 库存流 `useMenuStream`：菜单页挂载连接 `/menu/stream`；`snapshot`（数组）与 `stock`（`{dishId,available}`）写入 `stockStore`；卡片用 `useStock(dishId)` 选择器订阅 → **只重渲染受影响卡片**（避免全量重渲染）。
- 断线：按 `retry:3000` 重连，连续失败 3 次 → 切 5s 轮询（`GET /menu` 当前查询，只取 `dishId/available` 合并）；恢复后停轮询并重连；UI 显示 `Live` / `Live updates paused — refreshing every 5s`（不阻断操作）。
- AI 流：同一解析器；事件名 `meta|dish|reason|done`；不自动重连，用户可 Retry；支持 `AbortController` 取消。
- 降级触发条件：`EventSource`/stream 不支持、401、连续 3 次网络错误、30s 无任何事件（含心跳）。

## 5. 状态与数据

### 5.1 authStore

```ts
{ status: 'loading'|'anonymous'|'authenticated'; user?: {id,email,role,displayName?};
  accessToken?: string; login(email,pw); register(...); logout(); bootstrap(); }
```

- `bootstrap()` 在 `main.tsx` 首帧调用（refresh + me）；`loading` 期间路由守卫渲染 Skeleton。
- 角色派生 `isAdmin = user.role === 'ADMIN'`；登录后跳转：`next` 优先，否则 ADMIN→`/console`、EMPLOYEE→`/menu`。

### 5.2 cartStore（localStorage）

```ts
type CartLine = { lineId:string; dishId:number; name:string; imageUrl?:string;
  basePriceCents:number; options:{optionId:number;name:string;priceDeltaCents:number}[];
  unitPriceCents:number; qty:number; addedAt:number };
type CartState = { lines:CartLine[]; totalQty():number; totalCents():number;
  add(dish, options): 'added'|'limit'|'soldout'; inc(lineId); dec(lineId);
  remove(lineId); clear(); replaceFromPreview(items,totalCents): void }
```

- 行键：`dishId + '|' + optionIds.sort((a,b)=>a-b).join(',')`；同键合并 `qty`（AC-011）。
- `unitPriceCents` 为整数分：`basePriceCents + Σ priceDeltaCents`；`qty` 上限受总份数 ≤5 约束；`dec` 到 0 删行。
- `persist`：`name:'webox.cart.v1'`，`partialize` 只存 `lines`；`version:1` + `migrate`；读取时校验字段（非法行丢弃）。
- 价格快照仅展示；**提交永远只用 `dishId/qty/optionIds`**（AC-016）。

### 5.3 服务端数据与失效

| 数据 | 位置 | 失效/刷新 |
|---|---|---|
| 菜单列表 | `useApiQuery(['menu', params])` 内存缓存 30s | 筛选/搜索/分页变化重取；Console 任何写操作后 `invalidate('menu*')`；SSE 只改库存 map 不改列表 |
| 菜品详情 | `useApiQuery(['dish', id])` | 进入详情必取；管理端改菜后不缓存 |
| 偏好 | `usePreferences` + `prefsStore`（localStorage 镜像） | 保存后更新 store；加购弹窗即时生效 |
| 地址簿 | `useApiQuery(['addresses'])` | 结算页进入取；新增地址后 invalidate |
| 订单列表/详情 | `useApiQuery(['orders', params])` | 取消/状态变更后 invalidate 对应 key |
| 看板 | 手动/60s 刷新 | 每次 `GET /admin/dashboard`；不做本地缓存 |
| 库存 | `stockStore`（SSE map） | snapshot/stock 覆盖；轮询每 5s 合并 |

- 所有请求 `AbortController` 在组件卸载/参数变化时取消，避免竞态覆盖（搜索快速输入）。
- 加载态：Skeleton 卡片（列表 6 个）/ 详情骨架 / 表格 5 行；空态：EmptyState（图标 + 文案 + 主操作）；错误态：ErrorState（英文 + Retry）；403/404 专用页。

### 5.4 列表性能

- 服务端分页默认 20，前端单页最多 100；`React.memo(DishCard)` + 稳定 key（dishId）→ 翻页/筛选只替换数据。
- 搜索 300ms 防抖 + 请求取消；筛选变更合并为一次请求（不逐项请求）。
- SSE 库存更新用选择器，仅重渲染库存变化的卡片（20–50 菜品流畅；无需虚拟列表）。
- 看板图表懒加载；Recharts 只在 `/console` 路由 chunk 中。

## 6. 5 项前端质量锚点（评分卡落点）

| 锚点 | 实现点（文件/组件） | 具体方案 | 验收 |
|---|---|---|---|
| FE-1 响应式 | `styles/tokens.css` + `DishGrid.tsx` + `AppLayout.tsx` | 断点 `≤767`（375/768 单列/双列）、`768–1199` 双列、`≥1200` 三列；`grid-template-columns: repeat(auto-fill, minmax(260px,1fr))`；移动端底部操作栏（购物车总价 + Checkout）；Header 折叠为汉堡；表格在移动端转卡片（Console Dishes/Orders）；触控目标 ≥44px；`body{overflow-x:hidden}` 不作为唯一手段，必须实测 `scrollWidth ≤ innerWidth+1` | AC-052 / TC-075 三档截图 |
| FE-2 分页/长列表 | `useApiQuery` + `Pagination.tsx` + `MenuPage` URL 参数 | 服务端 `page/size`（默认 1/20，≤100）；筛选/搜索服务端执行；单页 ≤20 卡片；`memo` + 稳定 key；请求去重/取消；20→50+ 翻页无卡顿 | AC-006/007/045、TC-010/011 |
| FE-3 防抖/节流 | `useDebounce.ts`、`DishCard`、`CheckoutPage` | 搜索 300ms 防抖；加购 300ms 节流 + 在途 `disabled`（500ms 内 10 连点 ≤2 请求）；Place Order `disabled+loading` + 幂等键；`+` 连点串行更新本地状态（无网络） | AC-053、TC-076 |
| FE-4 价格精度 | `utils/money.ts` `formatMoney/parseYuanToCents` | 全链路整数分；`formatMoney(7760)==='¥77.60'`（整数除法 + 补零，禁止 `toFixed` 于浮点中间值）；选项加价整数求和；元输入用字符串分割转分；无 `parseFloat*100`；全页面只通过 `formatMoney` 输出金额 | AC-010/011/016/054、TC-077 正则 `^¥\d+\.\d{2}$` |
| FE-5 输入校验 | `utils/validation.ts` + 各表单 | 邮箱 ≤200 + 正则、密码 8–64 且含字母数字、地址 ≤200、搜索 ≤50（`maxLength` + 提交前拦截）、菜名 ≤100、描述 ≤1000、原因 1–200、预算 `0<min≤max`；错误文案与后端错误码一一映射；边界值 200/50/64 通过 | AC-003/008/029/048、TC-003/071 |

### 6.1 金额工具（必须逐字实现）

```ts
export const formatMoney = (cents: number): string => {
  const n = Math.trunc(cents); const sign = n < 0 ? '-' : ''; const abs = Math.abs(n);
  return `${sign}¥${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};
export const parseYuanToCents = (input: string): number | null => {
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  const yuan = Number(m[1]); const frac = (m[2] ?? '').padEnd(2, '0');
  return yuan * 100 + Number(frac);
};
```

## 7. 异常态、可访问性与文案

### 7.1 状态矩阵

| 场景 | UI | 文案 key |
|---|---|---|
| 页面加载 | Skeleton（列表 6 卡/详情 1/表格 5 行） | `common.loading` |
| 空列表/空购物车/无订单/无搜索结果 | EmptyState + 主操作 | `menu.empty` `cart.empty` `orders.empty` `menu.noResults` |
| 网络/5xx | ErrorState + Retry + Request ID | `error.network` `error.server` `common.retry` |
| 401 | 跳登录（保留 next） | `error.sessionExpired` |
| 403 | `/403` 页 + `Back to menu` | `error.forbidden` |
| 404 | NotFoundPage；订单他人 404 → `Order not found` | `error.notFound` |
| 429 | Toast + 30s 倒计时/禁用 | `error.rateLimited` |
| 库存不足 409 | 行内标红 + `Only N left` + Adjust cart | `error.stockInsufficient` |
| 售罄 | 卡片灰度 + Add 禁用 | `menu.soldOut` |
| 低库存 1–3 | 橙色徽标 | `menu.onlyLeft` |
| 过敏原 | 弹窗确认，可继续 | `allergen.title` `allergen.addAnyway` |
| 预算超限 | 结算页黄色提示，不阻断 | `checkout.budgetExceeded` |
| 截单切换 | 横幅说明生效餐次/日期 | `checkout.autoSwitched` |
| 重复有效单 | 按钮 `View Existing Order` | `checkout.viewExistingOrder` |
| SSE 断开/降级 | 顶部细条 `Live updates paused…` | `stock.polling` |
| AI 降级 | 徽标 `Rule-based fallback` | `ai.fallback` |
| AI 超时/断网 | 卡片内错误 + Retry | `ai.timeout` `ai.offline` |
| 图片缺失 | 占位图 | `common.imageUnavailable` |

### 7.2 可访问性

- 所有表单 `<label htmlFor>` + `aria-invalid` + `aria-describedby` 指向错误文本；错误用 `role="alert"`。
- Modal/Drawer：`role="dialog" aria-modal="true"`、焦点陷阱、Esc 关闭、打开时锁 body 滚动、关闭后焦点回到触发按钮。
- Toast：`aria-live="polite"`，3s 自动消失，可手动关闭；错误 Toast 5s。
- 键盘：筛选 chips 用 `<button aria-pressed>`；数量 `+/-` 为按钮；卡片标题是链接；可见 `:focus-visible` 2px 描边。
- 对比度：正文 `#1f2937` on `#ffffff` ≥ 7:1；橙色低库存徽标配深色文字 ≥ 4.5:1；不仅靠颜色传达状态（同时有文本）。
- 触控目标 ≥44×44px；移动端底部栏不遮挡内容（`padding-bottom: 88px`）。

## 8. 文案 key 清单（英文，`src/i18n/en.ts`）

> 全部用户可见文案走 `t(key)`；禁止在 JSX 写死中文；E2E 通过 `data-testid` + 英文确定性文案断言。以下为**完整 key 集合**（值即英文文案）。

```ts
export const en = {
  'app.name': 'WeBox', 'common.loading': 'Loading…', 'common.retry': 'Retry',
  'common.cancel': 'Cancel', 'common.confirm': 'Confirm', 'common.save': 'Save',
  'common.close': 'Close', 'common.back': 'Back', 'common.next': 'Next',
  'common.previous': 'Previous', 'common.page': 'Page {page} of {total}',
  'common.imageUnavailable': 'Image unavailable',
  'nav.menu': 'Menu', 'nav.cart': 'Cart', 'nav.orders': 'My Orders',
  'nav.preferences': 'Preferences', 'nav.console': 'Console', 'nav.logout': 'Sign out',
  'nav.backToStore': 'Back to store',
  'auth.login.title': 'Sign in to WeBox', 'auth.login.submit': 'Sign in',
  'auth.register.title': 'Create your account', 'auth.register.submit': 'Create account',
  'auth.email': 'Email', 'auth.password': 'Password', 'auth.displayName': 'Display name (optional)',
  'auth.toRegister': 'New here? Create an account', 'auth.toLogin': 'Already have an account? Sign in',
  'auth.login.failed': 'Incorrect email or password.',
  'auth.emailExists': 'This email is already registered.',
  'auth.emailFormat': 'Enter a valid email address.',
  'auth.passwordPolicy': 'Password must be 8–64 characters and include letters and numbers.',
  'auth.sessionExpired': 'Your session expired. Please sign in again.',
  'menu.title': 'Today’s Menu', 'menu.searchPlaceholder': 'Search dishes…',
  'menu.searchTooLong': 'Search is limited to 50 characters.',
  'menu.filters': 'Filters', 'menu.clearFilters': 'Clear filters',
  'menu.forYou': 'For You', 'menu.forYouBadge': 'For you',
  'menu.noResults': 'No dishes match your search.', 'menu.empty': 'No dishes are available today.',
  'menu.available': '{count} available', 'menu.onlyLeft': 'Only {count} left', 'menu.soldOut': 'Sold out',
  'menu.addToCart': 'Add to cart', 'menu.added': 'Added to cart',
  'menu.viewDetails': 'View details', 'menu.found': '{count} dishes found',
  'menu.orderLimit': 'Order limit reached: max 5 items per order.',
  'detail.required': 'Required', 'detail.optional': 'Optional', 'detail.selectUpTo': 'Select up to {count}',
  'detail.pleaseSelect': 'Please select: {groups}', 'detail.allergens': 'Allergens', 'detail.protein': 'Protein',
  'detail.spice': 'Spice level', 'detail.description': 'Description', 'detail.addToCart': 'Add to cart',
  'allergen.title': 'Allergen warning',
  'allergen.message': 'This dish contains an allergen you flagged: {allergens}. Add anyway?',
  'allergen.addAnyway': 'Add anyway',
  'cart.title': 'Your Cart', 'cart.empty': 'Your cart is empty.', 'cart.browseMenu': 'Browse menu',
  'cart.subtotal': 'Subtotal', 'cart.total': 'Total', 'cart.checkout': 'Proceed to checkout',
  'cart.remove': 'Remove', 'cart.clear': 'Clear cart', 'cart.qty': 'Quantity',
  'cart.priceUpdated': 'Prices were updated. New total: {total}.',
  'checkout.title': 'Checkout', 'checkout.items': 'Order items', 'checkout.deliveryDate': 'Delivery date',
  'checkout.mealType': 'Meal', 'checkout.lunch': 'Lunch', 'checkout.dinner': 'Dinner',
  'checkout.address': 'Delivery address', 'checkout.newAddress': 'New address', 'checkout.saveAddress': 'Save this address',
  'checkout.placeOrder': 'Place Order', 'checkout.placing': 'Placing order…',
  'checkout.viewExistingOrder': 'View Existing Order',
  'checkout.budgetExceeded': 'This order exceeds your meal budget ({budget}). You can still place it.',
  'checkout.autoSwitched': '{meal} has closed. Your order will be placed for {effectiveMeal} on {date} (cutoff {cutoff}).',
  'checkout.cutoff': 'Order by {time}', 'checkout.empty': 'Your cart is empty. Add dishes before checking out.',
  'checkout.stockInsufficient': 'Only {available} left for {dish}. Please adjust your cart.',
  'checkout.adjustCart': 'Adjust cart', 'checkout.dateUnavailable': 'No menu is published for this date. Choose another date.',
  'checkout.confirmSwitch': 'Continue with {effectiveMeal} on {date}',
  'orders.title': 'My Orders', 'orders.empty': 'No orders yet.', 'orders.orderNo': 'Order number',
  'orders.status': 'Status', 'orders.total': 'Total', 'orders.items': 'Items', 'orders.delivery': 'Delivery',
  'orders.createdAt': 'Placed at', 'orders.detail': 'Order details', 'orders.cancel': 'Cancel order',
  'orders.cancelReason': 'Reason (optional)', 'orders.cancelled': 'Order cancelled.',
  'orders.notFound': 'Order not found.', 'orders.view': 'View order',
  'order.status.Pending': 'Pending', 'order.status.Confirmed': 'Confirmed',
  'order.status.Completed': 'Completed', 'order.status.Cancelled': 'Cancelled',
  'success.title': 'Order placed!', 'success.message': 'Your order has been received.',
  'success.orderNo': 'Order number', 'success.viewOrder': 'View order', 'success.backToMenu': 'Back to menu',
  'prefs.title': 'Dietary Preferences', 'prefs.allergens': 'Allergens to avoid',
  'prefs.categories': 'Preferred cuisines', 'prefs.spice': 'Spice preference', 'prefs.taste': 'Taste preference',
  'prefs.taste.Light': 'Light', 'prefs.taste.Balanced': 'Balanced', 'prefs.taste.Rich': 'Rich',
  'prefs.budget': 'Meal budget', 'prefs.budgetMin': 'Minimum', 'prefs.budgetMax': 'Maximum',
  'prefs.budgetInvalid': 'Minimum must be greater than 0 and no more than maximum.',
  'prefs.recommendEnabled': 'Enable “For You” recommendations', 'prefs.saved': 'Preferences saved.',
  'console.title': 'Console', 'console.dashboard': 'Dashboard', 'console.dishes': 'Dishes',
  'console.dailyMenu': 'Daily Menu', 'console.orders': 'Orders', 'console.inventory': 'Inventory',
  'console.audit': 'Audit Log', 'console.aiRules': 'AI Rules',
  'console.todayOrders': 'Orders today', 'console.todayRevenue': 'Revenue today',
  'console.completed': 'Completed', 'console.pending': 'Pending', 'console.cancelled': 'Cancelled',
  'console.topDishes': 'Top 10 dishes', 'console.mealSplit': 'Lunch vs Dinner',
  'console.trend': 'Last 7 days', 'console.lowStock': 'Low stock (≤ 3)',
  'console.noData': 'No data for this period.', 'console.refresh': 'Refresh',
  'console.newDish': 'New dish', 'console.editDish': 'Edit dish', 'console.name': 'Name',
  'console.description': 'Description', 'console.price': 'Price (¥)', 'console.category': 'Category',
  'console.protein': 'Protein source', 'console.allergens': 'Allergens', 'console.spice': 'Spice level',
  'console.image': 'Image', 'console.imageHint': 'JPG, PNG or WebP, up to 5 MB.',
  'console.imageTooLarge': 'Image must be 5 MB or smaller.', 'console.imageType': 'Only JPG, PNG or WebP images are allowed.',
  'console.status': 'Status', 'console.onShelf': 'On shelf', 'console.offShelf': 'Off shelf',
  'console.publish': 'Publish', 'console.unpublish': 'Unpublish', 'console.totalQty': 'Total quantity',
  'console.inventoryMode': 'Inventory mode', 'console.serveDate': 'Serve date',
  'console.menuPublished': 'Menu published.', 'console.stockUpdated': 'Stock updated.',
  'console.reasonRequired': 'A reason is required.', 'console.reason': 'Reason',
  'console.confirmRisk': 'I understand this action affects employees and is audited.',
  'console.confirmOffShelf': 'This dish will be hidden from employees.',
  'console.adminOrderStatus': 'Update status', 'console.maskedAddress': 'Address is masked in the list.',
  'console.reconcile': 'Reconcile', 'console.drift': 'Drift', 'console.adjust': 'Adjust stock',
  'console.delta': 'Adjustment', 'console.driftZero': 'Inventory is reconciled.',
  'console.auditAction': 'Action', 'console.auditObject': 'Object', 'console.before': 'Before', 'console.after': 'After',
  'ai.title': 'AI Meal Assistant', 'ai.placeholder': 'Tell me what you feel like eating…',
  'ai.send': 'Ask AI', 'ai.thinking': 'Finding dishes for you…', 'ai.fallback': 'Rule-based fallback',
  'ai.quick.light': 'Something light', 'ai.quick.protein': 'High protein',
  'ai.quick.notYesterday': 'Not what I had yesterday', 'ai.quick.spicy': 'Something spicy',
  'ai.empty': 'No recommendations matched. Try another description.', 'ai.retry': 'Try again',
  'ai.timeout': 'AI is taking too long. Please try again.', 'ai.offline': 'Connection lost. Check your network.',
  'ai.rateLimited': 'Too many AI requests. Try again in a minute.', 'ai.addToCart': 'Add to cart',
  'error.network': 'Network error. Check your connection and try again.',
  'error.server': 'Something went wrong on our side. Please try again.',
  'error.forbidden': 'You do not have permission to view this page.',
  'error.notFound': 'Page not found.', 'error.rateLimited': 'Too many requests. Please wait a moment.',
  'error.validation': 'Please check the highlighted fields.', 'error.requestId': 'Request ID: {id}',
  'error.offline': 'You are offline. Some actions are unavailable.',
  'stock.live': 'Live stock', 'stock.polling': 'Live updates paused — refreshing every 5s',
} as const;
```

## 9. 测试钩子（E2E 契约）

### 9.1 `data-testid` 约定（稳定、语义化、不复用）

| 区域 | testid |
|---|---|
| 认证 | `login-email` `login-password` `login-submit` `login-error` `register-email` `register-password` `register-submit` |
| 菜单 | `menu-grid` `menu-card-{dishId}` `dish-name-{dishId}` `dish-price-{dishId}` `add-to-cart-{dishId}` `stock-badge-{dishId}` `filter-category-{Category}` `search-input` `sort-for-you` `pagination-next` |
| 详情 | `dish-detail` `dish-price` `option-{optionId}` `option-group-{groupId}` `detail-add-to-cart` `allergen-modal` `allergen-add-anyway` |
| 购物车 | `cart-page` `cart-line-{lineId}` `cart-qty-plus` `cart-qty-minus` `cart-remove` `cart-total` `cart-empty` `cart-checkout` |
| 结算 | `checkout-total` `checkout-date` `checkout-meal` `checkout-address` `checkout-submit` `checkout-existing-order` `budget-warning` `auto-switch-banner` `checkout-error` |
| 订单 | `order-success` `order-no` `order-delivery` `orders-list` `order-row-{orderNo}` `order-detail` `order-status` `order-cancel` `cancel-confirm` |
| 偏好 | `pref-allergen-{Allergen}` `pref-category-{Category}` `pref-budget-max` `pref-save` `pref-recommend-toggle` `pref-saved-toast` |
| Console | `console-dishes` `dish-create` `dish-edit-{id}` `dish-status-{id}` `confirm-reason` `confirm-risk-check` `confirm-submit` `daily-menu-date` `daily-menu-row-{dishId}` `daily-menu-qty` `daily-menu-publish` `console-orders` `admin-order-status-{id}` `inventory-drift` `inventory-adjust` `audit-table` `dashboard-tiles` `dashboard-refresh` |
| AI | `ai-open` `ai-input` `ai-send` `ai-fallback-badge` `ai-card-{dishId}` `ai-reason-{dishId}` `ai-error` |
| 全局 | `toast` `toast-error` `app-loading` `not-found-page` `forbidden-page` |

- 错误 Toast 必带 `data-error-code="{code}"`（如 `STOCK_INSUFFICIENT`）与 `data-request-id`，E2E 不解析自然语言。
- 所有可交互控件附 `aria-label`（英文）；金额文本只由 `formatMoney` 生成（正则可断言）。
- 确定性：不使用 `Date.now()`/随机数渲染文本；日期文案来自服务端 `effectiveDate/deliveryDate`；分页/筛选状态在 URL，E2E 可直接深链。
- 可注入 API base：`VITE_API_BASE_URL`；E2E 可用 `?e2e=1` 关闭非必要动画（`prefers-reduced-motion` 同等处理）。

### 9.2 与 tests/e2e/checklist.md 的对齐

- 登录：`input[type=email]` / `input[type=password]` 仍可用，同时推荐 `data-testid` 选择器；
- 加购连点：`[data-testid=add-to-cart]` 已存在（checklist 已使用该选择器）；
- 三档 viewport：375×812 / 768×1024 / 1440×900 的 `scrollWidth` 断言由 `run_e2e.sh` 执行，页面根节点 `#root` 不得设置固定宽度。

## 10. 契约缺口与前端处理（与 api-contract 对照）

| # | 缺口 | 影响页面 | 前端处理 | 状态 |
|---|---|---|---|---|
| 01 | 菜单项无 `hasOptions/hasRequiredOptions`（G2FE-B1） | Menu/AI | 过渡：Add 一律进详情；契约补字段后直接加购 | OPEN→Blocker |
| 02 | 订单详情无字段级 JSON（G2FE-B2） | OrderDetail/Success | 按 `data-model.md` `order_items` 列推断类型；`types.ts` 预留；E2E 断言改用可确定字段 | OPEN→Blocker |
| 03 | `DELETE /me/addresses` 204 无包络（M1） | Preferences/Cart | client 204 短路，返回空 envelope | 已兜底 |
| 04 | 无“已发布菜单日期”端点（M2） | Checkout | 日期仅 today/+1/+2；preview 409 提示切换；空态文案 | 已兜底 |
| 05 | 缺 `GET /admin/dishes/{id}`（M3） | Console Dishes | 编辑用列表行数据（契约若不含全字段，保存时只提交已知字段；缺字段提示） | 已兜底 |
| 06 | `expiresIn` 单位/refresh 轮换未定义（M4） | Auth | 按“秒”处理；每次 refresh 用返回的新 refreshToken（若未返回则保留旧值）；401 统一登出 | 已兜底 |
| 07 | AI `sessionId` 不回传（M5） | AI | 前端本地保存 sessionId；无回传则单轮 | 已兜底 |
| 08 | 看板 `mealSplit/trend` 口径未定义（M8） | Dashboard | 按“订单数、不含 Cancelled”展示，并在图表副标题标注口径；契约回写后对齐 | 已兜底 |
| 09 | AI 规则无回滚端点 | Console AI Rules | 不做“一键回滚”；仅展示当前版本 + 编辑保存；回滚记 `NOT TESTED` | 降级 |
| 10 | 口味枚举未定义（`tastePreference`） | Preferences | 前端固定 `Light/Balanced/Rich`（PRD 语义），提交字符串；后端若校验不同值则提示 | 假设 |
| 11 | 结算新地址无“下单时保存”标志 | Checkout | 下单前调用 `POST /me/addresses`（409 忽略），再提交订单 | 已兜底 |
| 12 | `ORDER_LIMIT_EXCEEDED` 为 400 而非 409 | Cart/Checkout | 错误映射按 code，不按 HTTP 猜 | 已对齐 |
| 13 | SSE 事件名在 §1/#14 与 §3.3 表述不完全一致 | Menu | 按端点消费：menu 流只处理 `snapshot/stock`；AI 流只处理 `meta/dish/reason/done`；未知事件忽略 | 已兜底 |
| 14 | 菜单 `available` 为 boolean，SSE/Console 为 int（BTL 已登记 `G2-BE-M2`）；`Only 3 left` 缺数量来源 | Menu/DishCard | 初始用 `lowStock` 显示 `Low stock`（不虚构数字）；SSE snapshot/stock 到达后用精确 `available` 显示 `Only N left`/`N available`；preview/下单以服务端为准 | 已兜底（建议契约增 `availableQty:int`） |

> 缺口 01/02 为 blocker，已登记 `G2FE-B1/B2`；其余为 major/降级，前端均有确定性兜底，不影响 Stage 4 开工。

## 11. Stage 4 实施拆解（50 分钟，22:35–23:25）

### 11.1 优先级与文件清单

| 优先级 | 里程碑 | 文件（新建） | 分钟 | 验收 |
|---|---|---|---|---|
| P0-M0 | 脚手架 + token + client | `package.json` `vite.config.ts` `tsconfig.json` `index.html` `src/main.tsx` `src/App.tsx` `styles/*` `api/client.ts` `api/errors.ts` `api/types.ts` `api/endpoints.ts` `utils/money.ts` `utils/validation.ts` | 6 | `npm run typecheck` 0 error；5173 打开 |
| P0-M1 | 认证与守卫 | `store/authStore.ts` `routes/*` `pages/auth/*` `components/layout/AppLayout.tsx` | 5 | 登录→刷新仍登录（AC-004）；员工进 `/console`→403（AC-028） |
| P0-M2 | 菜单列表 | `pages/employee/MenuPage.tsx` `components/dish/*` `components/ui/Pagination.tsx` `hooks/useDebounce.ts` | 8 | 20 卡 + 多选筛选 + 300ms 搜索 + 分页（AC-006/007/008） |
| P0-M3 | 详情与选项 | `pages/employee/DishDetailPage.tsx` `components/dish/OptionGroup.tsx` `PriceSummary.tsx` | 5 | Burger ¥38→¥41 实时（AC-010） |
| P0-M4 | 购物车 | `store/cartStore.ts` `pages/employee/CartPage.tsx` `components/cart/*` `components/dish/AllergenModal.tsx` | 5 | 同行合并/分行/总价/空态/刷新持久化（AC-011/012） |
| P0-M5 | 结算 + 幂等提交 | `pages/employee/CheckoutPage.tsx` `pages/employee/OrderSuccessPage.tsx` `hooks/useIdempotencyKey.ts` | 8 | 连点 10 次仅 1 单；自动切换横幅；预算提示（AC-015/023/024/025/053） |
| P0-M6 | 订单列表/详情/取消 | `pages/employee/OrdersPage.tsx` `OrderDetailPage.tsx` `components/order/*` | 4 | 取消 Pending→Cancelled；Confirmed 无取消（AC-017/018/019） |
| P0-M7 | 偏好 + For You | `pages/employee/PreferencesPage.tsx` `hooks/usePreferences.ts` `store/prefsStore.ts` | 3 | 过敏原弹窗 + 预算提示 + 软排序开关（AC-021/022/023） |
| P1-M8 | Console 菜品 + 每日菜单 | `routes/RequireAdmin.tsx` `components/layout/ConsoleLayout.tsx` `pages/console/DishesPage.tsx` `DailyMenuPage.tsx` `components/console/*` | 6 | 建菜→员工可见；下架 404；设当日库存（AC-029/030/031/032） |
| P1-M9 | Console 订单/审计 | `pages/console/ConsoleOrdersPage.tsx` `AuditPage.tsx` | 3 | 状态流转 + 审计查询（AC-019/032/042 前置） |
| P2-M10 | SSE 实时库存 | `api/sse.ts` `store/stockStore.ts` `hooks/useMenuStream.ts` | 4 | 两客户端 ≤2s 库存变化；断线轮询（AC-036/037） |
| P2-M11 | 看板 | `pages/console/DashboardPage.tsx` `components/console/DashboardCharts.tsx` | 5 | 6 块数据 + 刷新（AC-042） |
| P2-M12 | AI 助手 | `components/ai/*` | 5 | 流式卡片 + 理由 + 降级徽标（AC-038/039/040） |
| P2-M13 | 对账/规则/收尾 | `pages/console/InventoryPage.tsx` `AiRulesPage.tsx` | 3 | 对账 drift + 调整（AC-044） |

> P0 合计 44 分钟，P1 9 分钟，P2 17 分钟。硬门槛：**P0 全部完成后再动 P1/P2**。

### 11.2 时间盒内的裁剪线（明确“砍哪个”）

| 时点 | 若未完成 | 裁剪动作 |
|---|---|---|
| T+20（22:55） | 未完成 M4 | 跳过筛选多选，仅保留搜索；购物车保留核心加/减/删 |
| T+30（23:05） | 未完成 M5 | 结算页去掉历史地址下拉（仅输入）；保留幂等提交与错误分支 |
| T+40（23:15） | 未完成 M8 | Console 只做 Dishes 列表 + 上下架 + 当日库存表；Orders/Audit 标 `NOT TESTED` |
| T+45（23:20） | 未完成 P2 | 全部 P2 停止；SSE 保留 5s 轮询替代；AI/看板标 `N/A（Tier 3 未实现）` |

### 11.3 自测命令（开发每完成一个里程碑执行）

```bash
cd frontend
npm run typecheck                 # 必须 0 error（strict）
npm run build                     # 必须成功，无 TS/ESLint 阻断
npm run dev -- --port 5173        # 手测入口
curl -s http://127.0.0.1:8080/api/v1/health   # 依赖后端
bash ../tests/e2e/run_e2e.sh      # 三档 viewport 截图（Stage 5）
```

### 11.4 Definition of Done（前端）

- 19 条路由可达；员工端 10 页 + Console 7 页全部有加载/空/错误态。
- `npm run typecheck && npm run build` 通过；无 `any` 滥用（API DTO 除外）。
- 5 项锚点均有可运行证据：三档截图、分页、防抖网络日志、`¥77.60`、边界校验提示。
- E2E checklist 的 `data-testid` 全部存在；错误 Toast 带 `data-error-code`。
- 所有可见文案来自 `en.ts`；`grep -rP '[\x{4e00}-\x{9fa5}]' src/pages src/components` 仅注释命中。

## 12. 风险与降级

| # | 风险 | 影响 | 缓解 / 降级 |
|---|---|---|---|
| FR-1 | 契约 B1/B2 未在 Stage 4 前补齐 | 菜单加购入口、订单详情字段 | 过渡实现（Add→详情；类型按 data-model 推断）；E2E 用可确定字段；不虚报 |
| FR-2 | 50 分钟做不完 Console | Tier2 扣分 | 严格 P0 优先；Console 保 Dishes/Daily Menu 最小闭环，Orders/Audit 明示 NOT TESTED |
| FR-3 | SSE 不可用/被代理缓冲 | 实时库存失效 | 3 次失败切 5s 轮询；UI 明示；轮询只合并库存字段 |
| FR-4 | 图片路径/命名不一致 | 裂图 | 启动脚本复制 20 张为 `image_NN.jpg`；`onError` 占位；E2E 断言 `<img>` 自然宽度>0 |
| FR-5 | 时区/截单展示错误 | 用户误解餐次 | 结算页只展示服务端 `effectiveDate/effectiveMeal/cutoffAt`；前端不用本地时钟判定；日期按 `YYYY-MM-DD` 原样显示 |
| FR-6 | token 过期恰逢提交 | 下单失败/重复 | 单飞 refresh + 同幂等键重试；刷新失败跳登录并保留购物车（localStorage） |
| FR-7 | 5 份上限仅前端拦截 | 用户绕过 | 前端禁用 + API 400 双保险；错误映射 `ORDER_LIMIT_EXCEEDED` |
| FR-8 | 无 LLM Key | AI 空白/500 观感 | 契约保证 `fallback:true`；前端显示 `Rule-based fallback` 徽标；无 Key 不阻断 |
| FR-9 | CORS/代理（127.0.0.1 vs localhost） | 请求被拦 | 一律走 Vite 同源 `/api` proxy；不直连 8080；生产由后端同源托管 `dist` |
| FR-10 | localStorage 购物车脏数据/版本升级 | 页面崩溃 | `persist` version + `migrate` + 读取校验；异常清空并提示 |
| FR-11 | Console 表格在 375 宽度横向滚动 | AC-052 失败 | 移动端切换卡片列表；表格容器 `overflow:auto` 不作用于 `body`；实测 `scrollWidth` |
| FR-12 | 看板数字口径与 DB 不一致 | AC-042 争议 | 文案标注口径；以服务端聚合为唯一来源，前端不二次计算 |

## 13. G3 自检（前端部分）

| # | 检查项 | 结论 | 证据 |
|---|---|---|---|
| 1 | 全部员工端/Console 页面与路由有设计 | PASS | §2.1 R01–R19（员工 10 + Console 7 + 系统 2），含 Tier 标注与 API/testid |
| 2 | API 客户端/SSE/错误码/分页/金额/幂等键一致 | PASS | §4.1–4.3、§10 缺口表；错误码按 api-contract §1.1 映射，幂等键 8–64 UUID |
| 3 | 响应式、分页性能、防抖、价格精度、输入校验 5 项有实现点 | PASS | §6 表 + §6.1 代码；每条含文件/组件与验收 AC |
| 4 | 权限路由与 403/401 处理明确 | PASS | §2.2、§4.2；`RequireAuth/RequireAdmin`、单飞 refresh、/403 页 |
| 5 | 加载/空/错误态与英文文案明确 | PASS | §7.1 状态矩阵 + §8 `en.ts` 全量 key |
| 6 | 测试钩子可支撑 E2E | PASS | §9 `data-testid` 全表 + 错误码属性 + URL 状态 + `VITE_API_BASE_URL` |
| 7 | 与 api-contract 无冲突（有冲突登记） | PASS | §10 14 项缺口逐条登记；B1/B2 入 `review-findings.md` |
| 8 | 金额/校验规则与后端一致 | PASS | §6.1 `formatMoney/parseYuanToCents`；长度/密码/预算与 AC-003/048 一致 |

## 14. Scenario checks（设计阶段）

> 口径：本阶段只证明“方案覆盖 required_check”；运行时证据由 Stage 5 采集。`PASS` 指设计已给出可执行落点。

| Profile / check | 结论 | 设计证据 |
|---|---|---|
| transaction-order TO-1 金额整数分/服务端重算 | PASS | §6.1；提交只发送 `dishId/qty/optionIds`（§3.4-7）；`priceDisplay` 仅校验 |
| TO-2 不超卖（前端配合） | PASS | 库存徽标 + 售罄禁用 + 409 `STOCK_INSUFFICIENT` 明细映射（§3.4-8、§7.1） |
| TO-3 提交才占用/取消只回补一次（前端配合） | PASS | 加购仅本地（§5.2）；取消仅 Pending 显示（§3.5）；重复取消 409 提示 |
| TO-4 幂等 | PASS | §3.4-7 幂等键与同键重试；`useIdempotencyKey` |
| TO-5 唯一有效单 | PASS | `existingOrderId` → `View Existing Order`（§3.4-3） |
| TO-6 状态机 | PASS | §3.5/§3.7 按钮可用性映射状态；非法迁移依赖服务端 409 |
| TO-7 截单/自动切换 | PASS | §3.4-2 横幅 + 生效餐次回显；不使用客户端时钟 |
| TO-8 订单快照 | PASS | 订单详情只读渲染服务端快照（§3.5）；前端不改价 |
| TO-9 5 份上限 | PASS | 加购/`+` 禁用 + 文案（§3.1/§3.3）+ 400 映射 |
| TO-10 仅 Pending 可取消 | PASS | §3.5 取消按钮条件 |
| identity-access IA-1 密码/无明文 | PASS | 前端不存储密码；token 不打印/不入日志（§4.2） |
| IA-2 Console 403 | PASS | `RequireAdmin` → /403；API 403 兜底（§2.2） |
| IA-3 角色矩阵 | PASS | 员工 10 路由 / Console 7 路由分离（§2.1） |
| IA-4 输入校验 | PASS | §6 FE-5；前端提示与后端错误码一致 |
| IA-5 限流/401/403 | PASS | 429 倒计时（§3.4-8）；401 单飞刷新；403 页面 |
| IA-6 审计 | PASS | Console 高风险操作 confirm+reason（§3.7）；Audit 查询页（R16） |
| IA-7 横向越权 | PASS | 订单详情仅本人/管理员；404 统一文案（§7.1） |
| ai-llm AI-1 候选硬过滤 | PASS（前端消费侧） | AI 卡片只渲染服务端 `dish` 事件；前端不自行扩候选（§3.8） |
| AI-2 模型不决定价格/库存 | PASS | 价格用服务端事件/DB；加购走 preview 重算（§3.8） |
| AI-3 无 Key 降级 | PASS | `fallback:true` → `Rule-based fallback` 徽标（§3.8） |
| AI-4 SSE 流式/超时 | PASS | §4.3 事件顺序消费；25s 客户端超时 + Retry |
| AI-5 规则可配置/回滚 | N/A（Tier 3，回滚端点缺失） | 理由：契约无回滚端点，Console 仅做读取/保存；回滚记 `NOT TESTED`（§10 缺口-09） |
| AI-6 Key 不入前端 | PASS | Key 仅后端环境变量；`VITE_*` 不含 LLM Key；构建产物无 Key |
| general-engineering GE-1 可构建启动 | PASS | 命令与代理见 §1.3；`npm run build` 门禁 |
| GE-2 种子可下单 | PASS | 前端依赖当日 20 卡 + 图片 20 张；空态兜底（§7.1） |
| GE-3 统一错误码/分页 | PASS | §4.1 `mapApiError`/`pageQuery` |
| GE-5 英文/金额格式 | PASS | §8 全量英文 key；`formatMoney` 单点（§6.1） |
| GE-7 证据可追溯 | PASS | §9 testid + Stage 5 截图/网络日志路径（§11.3） |

> N/A 仅 AI-5（契约无回滚端点）；其余未测项在 Stage 5 按实际证据判定，本文件不预判运行时 PASS。

## 15. 下一步

`前端开发工程师`（Stage 4，22:35–23:25）按 §11 顺序实施：**M0→M1→M2→M3→M4→M5→M6→M7（P0）→ M8/M9（P1）→ M10/M11/M12/M13（P2）**；每个里程碑执行 §11.3 自测命令；契约缺口按 §10 兜底，B1/B2 待 Architecture 回写。