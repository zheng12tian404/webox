# WeBox 测试报告 v3 — Stage 5e P1 快回归

- 主 Issue：`6343a752-e110-407c-8dfb-a5873425d917`
- 节点：WS [Stage 5e] 测试执行工程师（P1 快回归 + test-report v3）
- 执行时间：2026-11-14 23:17–23:19 CST
- 结论：**S5C-D-001（P1）独立复验 PASS；冒烟回归 9/9 PASS；P0=0，open P1=0（测试侧）。**

## 1. 环境与版本

| 项 | 值 |
|---|---|
| 后端 | `backend/target/webox-backend.jar`，PID **1385859**，JDK17，端口 **8083**，DB `req_6343a752e110` |
| 健康检查 | `GET /api/v1/health` → 200 `{status:UP,db:UP,redis:UP,cache:UP}` |
| 前端 | Vite dev `127.0.0.1:5175`（PID 1321104，Node 22.22.3），HMR 最新修复代码 |
| 浏览器 | 本节点自建 headless Chrome 146（CDP **9446**，`/tmp/s5e-chrome`，全新 profile）；测试后停止 |
| MySQL / Redis | `127.0.0.1:3306` / `127.0.0.1:6379` |
| 测试账号 | A=`s5c_pa_225849@test.com`（id=116，服务端过敏原 `["Peanuts"]`）；B=`s5c_clean_230749@test.com`（id=120，`[]`） |

命令：

```bash
/opt/browser/chrome --headless=new --disable-gpu --no-sandbox --disable-dev-shm-usage \
  --remote-debugging-port=9446 --user-data-dir=/tmp/s5e-chrome --window-size=1440,900 about:blank
python3 artifacts/s5e_cross.py      # S5C-D-001 跨账号复验
python3 artifacts/s5e_smoke.py      # 冒烟回归 9 项
```

## 2. S5C-D-001 定向复验（跨账号偏好/购物车隔离）

场景（全新浏览器 profile，无任何历史 localStorage，排除“上一账号残留于本 profile”干扰）：

1. A 登录（服务端偏好 Peanuts 已由接口复核）→ 菜单卡片加购 Kung Pao Chicken → **弹窗**（显示 `This dish contains an allergen you flagged: Peanuts. Add anyway?`）→ Add anyway → 购物车 1 件。
2. A 登出 → `localStorage` 三键全为 `null`。
3. B 登录（服务端偏好 `[]`）→ 直接加购 Kung Pao → **无弹窗**，直接入车。
4. B 登出 → 三键全为 `null`。
5. A 重新登录 → 加购 Kung Pao → **再次弹窗**（Peanuts）。
6. 最终登出 → `{auth:null,prefs:null,cart:null}`。

| 检查 | 期望 | 实际 | 结果 |
|---|---|---|---|
| A 首次加购 | 弹窗 | `modal=True`，文案含 Peanuts | PASS |
| A 登出清理 | auth/prefs/cart 均 null | `{"auth":null,"prefs":null,"cart":null}` | PASS |
| B 加购（无过敏原） | 无弹窗 | `modal=False`，直接入车 | PASS |
| B 登出清理 | 均 null | `{"auth":null,"prefs":null,"cart":null}` | PASS |
| A 二次登录加购 | 弹窗 | `modal=True`，文案含 Peanuts | PASS |
| 最终 storage | 均 null | `{"auth":null,"prefs":null,"cart":null}` | PASS |

服务端偏好复核（`artifacts/s5e-prefs-server.log`）：

```
23:18:08 s5c_pa_225849@test.com    login=200 user=116 prefs=200 ["Peanuts"]
23:18:08 s5c_clean_230749@test.com login=200 user=120 prefs=200 []
```

**S5C-D-001 判定：PASS。** 原始日志 `artifacts/s5e-cross-account.log`、`s5e-cross-account-raw.log`；截图 `artifacts/s5e-a-peanuts-modal.png`、`s5e-b-no-modal.png`、`s5e-a-modal-again.png`。

> 备注（诚实披露）：脚本内在页面上下文用 `fetch(credentials:'include')` 调 PUT/GET prefs 返回 401（本项目为 Bearer Token，非 Cookie 会话），因此本轮未通过浏览器改写偏好；改为**测试前用接口独立确认 A/B 服务端偏好分别为 `["Peanuts"]`/`[]`**，浏览器仅执行真实登录态下的加购路径。该方式不影响判定，且全程无人工改库。

## 3. 冒烟回归（9/9 PASS）

证据：`artifacts/s5e-smoke.log`

| # | 检查 | 状态 | 证据（原始输出摘要） |
|---|---|---|---|
| 1 | health 200（db/redis/cache UP） | PASS | `status=200 ... "db":"UP","redis":"UP","cache":"UP"` |
| 2 | 注册 | PASS | `201 id=123 role=EMPLOYEE` |
| 3 | 登录 | PASS | `200 role=EMPLOYEE` |
| 4 | 菜单 | PASS | `200 total=20 first=Beef Noodle Soup` |
| 5 | 偏好保存/回读 | PASS | `put=200 get=200 allergens=['Peanuts']` |
| 6 | 下单 | PASS | `201 orderId=18` |
| 7 | 幂等键重放 | PASS | 同键第二次 `201 orderId=18`（同单） |
| 8 | 订单列表 | PASS | `200 total=1 first=WB20261115-0018` |
| 9 | 员工访问 `/admin` | PASS | `403 FORBIDDEN` |

## 4. 未测项与剩余风险

| 项 | 原因 | 风险 |
|---|---|---|
| 服务端偏好 PUT 经浏览器 UI 保存后跨账号复验 | 本轮聚焦 S5C-D-001 读路径；UI 保存已在 Stage 5c/产品 `b7-preferences-saved.png` 覆盖 | 低 |
| Tier 3（AI SSE、看板、Redis 降级） | 快回归范围外，沿用 v2 结论 | 低 |
| S5C-D-002（同键第 6 次重试 429） | P2，未在本轮复验，仍 OPEN（设计确认） | 低 |
| S5C-D-003（共享 `_test` 库干扰） | P3 测试基建，本轮仅用演示库 8083，未触发 | 低 |
| 产品侧 CLOSED 签核 | 产品工程师负责；本报告仅给测试侧验证结论 | 门禁需产品复验后关闭 |

## 5. Scenario checks

| Profile | 检查 | 结果 | 证据 |
|---|---|---|---|
| identity-access | 账号切换后不继承上一账号偏好/购物车 | **PASS** | `s5e-cross-account.log` 全链路 |
| identity-access | 登出清理内存与 localStorage（prefs/cart/auth） | **PASS** | 三次登出均 `{auth:null,prefs:null,cart:null}` |
| transaction-order | 下单 + 同键幂等重放 | **PASS** | `s5e-smoke.log` orderId=18 两次一致 |
| general-engineering | health/菜单/订单列表可用性 | **PASS** | `s5e-smoke.log` |
| identity-access | 员工访问 Console → 403 | **PASS** | `s5e-smoke.log` `403 FORBIDDEN` |
| ui-safe | 过敏原提醒不阻断、可 Add anyway | **PASS** | `s5e-a-peanuts-modal.png` |

## 6. 结论

- **S5C-D-001：PASS**（测试侧独立复验，彻底排除上一账号偏好与购物车）。
- 冒烟回归 **9/9 PASS**（health、认证、菜单、偏好、下单+幂等、订单列表、RBAC）。
- 通过率（本轮检查点）：**15/15 = 100%**；P0 **0**；open P1（测试侧）**0**。
- 缺陷台账已更新：S5C-D-001 记为 **TEST VERIFIED（S5e）**，产品定向复验通过后由产品侧改 CLOSED。
- 下一步：`Quality Checker`（产品定向复验可并行收口 S5C-D-001）。