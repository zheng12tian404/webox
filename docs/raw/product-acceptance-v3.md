# 产品验收复验报告 v3（Stage 5e）— 跨账号 P1 定向复验

- 验收人：产品工程师（复验者 ≠ Stage 5d 修复者）
- 时间：2026-11-14 23:40 CST
- 范围：`S5C-D-001`（P1，跨账号偏好/购物车残留）定向复验；AC-021/022/023；顺带回归 AC-030/032/014/015/053
- 环境：后端 `http://127.0.0.1:8083/api/v1`（JDK17，PID 1385859，22:51 修复后 jar）；前端 `http://127.0.0.1:5175`；MySQL `req_6343a752e110`
- 本轮账号（独立新建，不复用开发/上一轮账号）：
  - A = `s5e_prod_a_2318@test.com`（userId=121，过敏原 Peanuts）
  - B = `s5e_prod_b_2318@test.com`（userId=122，无过敏原）
- 证据目录：`artifacts/s5e-product/`（浏览器操作日志、截图、curl/DB 回归日志）
- 判定口径：仅以本轮实际浏览器状态、localStorage 快照、API 响应、DB 行记 PASS；未执行记 `NOT TESTED`。

## 0. 结论

**PASS — `S5C-D-001` 定向复验通过，AC-021/022/023 跨账号隔离 PASS；本轮无新增 P0/P1，无 open P0/P1。**

- A（Peanuts）加购 Kung Pao Chicken → 弹 Peanuts 确认；登出后 `webox.prefs.v1`/`webox.cart.v1` 均为 `null`。
- B（无过敏原）登录后**不访问 Preferences**，直接菜单卡片加购同一菜 → 不弹窗，按 B 的偏好判定并入车。
- 再切回 A → 重新弹 Peanuts 确认，偏好按 A 重新拉取（`ownerUserId=121`）。
- 回归：AC-030/032/014/015/053 本轮冒烟全部 PASS，未见回归。

## 1. 跨账号定向复验（AC-021/022/023 / S5C-D-001）

前端 URL 全程 `http://127.0.0.1:5175`；菜单页 `/menu`，偏好页 `/preferences`，登录页 `/login`。

### 1.1 A：设置过敏原并保存

| 步骤 | 实际结果 | 证据 |
|---|---|---|
| A 登录（`/login` → `/menu`） | 顶栏 `s5e_prod_a_2318@test.com` | `artifacts/s5e-product/run-a-login.log` |
| 打开 `/preferences`，勾选 `Peanuts`，点 Save | 出现 `pref-saved-toast`（Preferences saved） | `a1-prefs-saved.png` |
| 读取 `localStorage['webox.prefs.v1']` | `{"state":{"prefs":{"allergens":["Peanuts"],...},"ownerUserId":121},"version":1}` | `run-a-flow.log` |

### 1.2 A：菜单卡片加购 Kung Pao Chicken → 弹 Peanuts

| 步骤 | 实际结果 | 证据 |
|---|---|---|
| `/menu` 卡片 `menu-card-1`（Kung Pao Chicken，dishId=1）点 Add | 弹窗出现（`[data-testid=allergen-modal]` count=1） | `run-a-retry.log`、`a2-modal-peanuts.png` |
| 弹窗文案 | **`This dish contains an allergen you flagged: Peanuts. Add anyway?`** | 同上 |
| 确认前购物车 | `webox.cart.v1` = `null`（未确认不入车） | 同上 |
| 点 `Add anyway` | 购物车 1 行：`dishId=1, name=Kung Pao Chicken, qty=1, unitPriceCents=2200` | `run-b-flow.log` |

### 1.3 A 登出 → 本地缓存清空

| 检查项 | 实际结果（登出后 URL=`/login`） | 证据 |
|---|---|---|
| `webox.prefs.v1` | **`null`** | `run-b-flow.log`、`a3-after-logout.png` |
| `webox.cart.v1` | **`null`** | 同上 |
| `webox.auth.v1` | `null` | 同上 |

### 1.4 B 登录（不访问 Preferences）→ 加购同菜 → 不弹 A 的过敏原窗

| 步骤 | 实际结果 | 证据 |
|---|---|---|
| B 登录后顶栏 | `s5e_prod_b_2318@test.com` | `run-b-flow.log` |
| 登录后（尚未访问 Preferences）`webox.prefs.v1` | `allergens=[]`，**`ownerUserId=122`**（已是 B 的偏好，不是 A 的） | 同上 |
| 直接打开 `/menu` 并点 `add-to-cart-1` | `[data-testid=allergen-modal]` **count=0**，无弹窗 | `b1-no-modal.png` |
| 购物车 | 1 行 `dishId=1, qty=1`（按 B 的偏好直接入车） | `run-b-flow.log` |

### 1.5 B 登出 → A 再登录 → 加购同菜 → 重新弹 Peanuts

| 步骤 | 实际结果 | 证据 |
|---|---|---|
| B 登出后 `prefs/cart/auth` | 三项均 `null` | `run-a-return.log`、`b2-after-logout.png` |
| A 再登录后 `webox.prefs.v1` | `allergens=["Peanuts"]`，`ownerUserId=121` | 同上 |
| `/menu` 点 `add-to-cart-1` | `allergen-modal` count=1，文案同上 `...flagged: Peanuts. Add anyway?` | `a4-return-modal.png`、`run-a-return.log` |
| 本轮结束登出后 | `prefs/cart/auth` 均 `null` | 同上 |

**判定：AC-021/022/023 跨账号隔离 PASS；`S5C-D-001` 复验通过。**

## 2. 回归冒烟（复用上一轮全量证据 + 本轮 1 次冒烟）

| AC | 场景 | 本轮结果 | 证据 |
|---|---|---|---|
| AC-030 | 下架 dishId=1 → 员工菜单 20→19、dish=1 不可见；恢复上架 → 20、可见 | **PASS** | `regression-smoke.log`（`PATCH /admin/dishes/1/status` 均 200） |
| AC-032 | 改价 `confirm=false` → 400 `VALIDATION_CONFIRM_REQUIRED`，DB 2200 不变；`confirm=true`+reason（完整字段）→ 200，DB 2500，`audit_log` `DISH_UPDATE/DISH/1` 含 before/after、reason、ip；回滚 → 200，DB 2200 且新增审计 | **PASS** | `regression-smoke.log`；审计行 before `price_cents=2500` → after `2200`（snake_case 列） |
| AC-014 | `POST /orders`（Idempotency-Key）→ 201，`orderNo=WB20261115-0019`（匹配 `^WB\d{8}-\d{4,}$`），status=Pending，`totalCents=2200` 服务端重算；`snapshot_json` 非空；`order_items` 1 行 2200/1/2200；`inventory_ledger` RESERVE 恰 1 条（before 36→after 35） | **PASS** | `regression-smoke.log` + DB 查询输出 |
| AC-015 | 同键同体重放 → 同 `orderId=19`（DB 仅 1 单）；同键改 qty → 409 `IDEMPOTENCY_CONFLICT`；缺头 → 400 `IDEMPOTENCY_KEY_REQUIRED` | **PASS** | `regression-smoke.log` |
| AC-053 | 500ms 内对 `add-to-cart-1` 连点 10 次 → 购物车仅 1 行 qty=1（无重复加购），无弹窗 | **PASS** | `run-ac053.log`、`ac053-doubleclick.png` |

> AC-053 的结算页 10 连点仅 1 单沿用 Stage 5c 证据：`artifacts/s5c-product/b5-double-submit-success.png`、`browser-cdp.log`（本轮未重复 UI 下单，记 `PASS（复用）`）。AC-014/015 本轮以 API+DB 独立冒烟复验。

## 3. 缺陷台账

| ID | 级别 | 本轮结论 | 证据 |
|---|---|---|---|
| S5C-D-001 | P1 | **CLOSED**：独立复现 A→B 不弹、B→A 弹、登出本地缓存为 null、B 未访问 Preferences 也按 B 判定 | 本报告 §1；`artifacts/s5e-product/` |

`docs/defect-log.md` 已同步为 CLOSED；GO 前无 open P0/P1（残余 P2/P3 见台账，均有 Owner/SLA）。

## 4. Scenario checks

| Profile / 检查 | 结论 | 证据 |
|---|---|---|
| `identity-access`：同浏览器跨账号偏好/购物车隔离 | **PASS** | §1（登出后两 key null；B `ownerUserId=122`；A 回归 `ownerUserId=121`） |
| `identity-access`：过敏原提示按当前账号判定 | **PASS** | §1.2/§1.4/§1.5（弹/不弹/再弹） |
| `transaction-order`：下单幂等与账本 | **PASS** | §2 AC-014/015（1 单、1 条 RESERVE、重放同 orderId、异体 409） |
| `general-engineering`：高风险写操作 confirm + 审计 | **PASS** | §2 AC-032 |
| 前端防抖/重复加购 | **PASS** | §2 AC-053 |

## 5. 证据清单（`artifacts/s5e-product/`）

| 文件 | 内容 |
|---|---|
| `a1-prefs-saved.png` | A 保存 Peanuts 成功 |
| `a2-modal-peanuts.png` | A 加购 Kung Pao 弹 Peanuts 确认 |
| `a3-after-logout.png` | A 登出后回到 `/login` |
| `b1-no-modal.png` | B 登录后加购同菜无弹窗 |
| `b2-after-logout.png` | B 登出后回到 `/login` |
| `a4-return-modal.png` | A 再次登录加购同菜重新弹 Peanuts |
| `ac053-doubleclick.png` | 连点 10 次后购物车 qty=1 |
| `run-a-login.log` / `run-a-flow.log` / `run-a-retry.log` / `run-b-flow.log` / `run-a-return.log` / `run-ac053.log` | 每步 URL、localStorage、弹窗 count/文案的原始输出 |
| `regression-smoke.log` | AC-030/032/014/015 curl + DB 证据 |

## 6. 说明与残余风险

1. **测试工具说明**：首轮使用 agent-browser 原生坐标点击时，dish 1 卡片位于视口下方未滚动到点击点，点击未生效（无弹窗、无入车）。改用 `element.click()` 后稳定复现；属测试驱动方式问题，非产品缺陷。复验结论以 `element.click()` 结果为准。
2. **环境副作用（如实披露）**：首次尝试时共享 agent-browser 会话仍登录着历史测试账号 `s5c_e2e2@webox.com`（userId=119），在清空会话前于 `/preferences` 保存过一次 Peanuts，影响该测试账号的偏好；与本次验收账号 A/B 无关，未改动任何业务数据（菜品/订单/库存）。对应日志见 `run-a-prefs.log`。
3. **残留 P2/P3**：沿用 `docs/defect-log.md`（TE-D-001/002、S5C-D-002、PA-D-004 等），本轮未处理，不阻断 GO。
4. 本轮未验证：跨设备/多标签页同时登录不同账号（PRD 未要求，属多会话边界，记为 `NOT TESTED`）。