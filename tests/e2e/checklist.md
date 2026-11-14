# E2E 检查组（agent-browser）— WeBox

- 工具：`/opt/gem/bin/agent-browser`；前端 `http://127.0.0.1:5173`；证据目录 `$EVIDENCE_DIR`。
- 每步截图命名 `<TC>-<step>.png`；断言失败立即记 FAIL 并保留 `snapshot` 输出。
- 种子账号：`employee@webox.com / Employee123`、`admin@webox.com / Admin12345`。

## 0. 启动与登录

```bash
export APP=http://127.0.0.1:5173
agent-browser open "$APP/login"
agent-browser snapshot
agent-browser fill 'input[type=email]' 'employee@webox.com'
agent-browser fill 'input[type=password]' 'Employee123'
agent-browser click 'button[type=submit]'
agent-browser wait 1500
agent-browser screenshot "$EVIDENCE_DIR/TC-004-login.png"
```

## 1. 菜单 / 筛选 / 搜索（TC-010/012/013/016）

1. 打开菜单页；`snapshot` 确认卡片 ≥20。
2. 勾选 `Chinese` + `Japanese`；断言所有卡片分类属于并集。
3. 搜索 `CHICKEN` 与 `chicken`；断言结果数一致。
4. 打开 `Classic Beef Burger` 详情；断言显示 Bun/Sauce 必选、价格 `¥38.00`。
5. 选 Whole Wheat + Mustard + Cheese；断言价格变 `¥41.00`（TC-017）。

```bash
agent-browser click 'text=Classic Beef Burger'
agent-browser wait 800
agent-browser screenshot "$EVIDENCE_DIR/TC-016-detail.png"
agent-browser get text 'body' > "$EVIDENCE_DIR/TC-016-body.txt"
```

## 2. 购物车与防抖（TC-023~025、TC-076）

1. 同配置连点 Add 2 次 → 购物车 1 行 ×2。
2. 切换配置（Whole Wheat）再 Add 1 次 → 2 行。
3. 500ms 内连点 Add 10 次（可用 `agent-browser eval` 循环 `.click()`）；`agent-browser network requests --filter /cart|/orders` 断言加购请求 ≤2。
4. 调整数量、删除、清空；断言空态与 `¥0.00`。
5. 刷新页面；断言购物车仍在。

```bash
agent-browser eval "const b=document.querySelector('[data-testid=add-to-cart]'); for(let i=0;i<10;i++) b.click(); 'done'"
agent-browser network requests --filter orders > "$EVIDENCE_DIR/TC-076-network.txt"
```

## 3. 结算与下单（TC-029/030/038/043/044）

1. 购物车 2 份 → Checkout；断言明细/小计/总价、默认日期今日、Lunch/Dinner。
2. 设置预算低于总价（先用员工偏好接口/页面）→ 断言预算提示且按钮可点。
3. 加至 5 份 → 断言 Add/`+` 禁用；尝试第 6 份被拦。
4. 连点 Place Order 10 次 → 仅 1 单（页面跳成功页，含 orderNo 与配送信息）。
5. 返回结算页 → 按钮显示 `View Existing Order`。
6. 我的订单 → 详情 → 取消 → 状态 `Cancelled`。

```bash
agent-browser click 'text=Place Order'
agent-browser wait 1200
agent-browser screenshot "$EVIDENCE_DIR/TC-030-success.png"
agent-browser get text 'body' > "$EVIDENCE_DIR/TC-030-body.txt"
```

## 4. Console 与权限（TC-047/048/049/050/051/052）

1. 员工登录访问 `/console` → 重定向/无管理功能（TC-048 截图）。
2. 管理员登录 → 菜品表格；新增菜（上传 1MB jpg）→ 员工端可见。
3. 下架 → 员工列表消失、详情 404；上架恢复（≤1s）。
4. 设当日菜单 `totalQty=3` → 员工端显示 `Only 3 left`；设 0 → `Sold out`。
5. 改价缺原因 → 前端英文提示；补原因后成功；审计页可见。

## 5. 响应式（TC-075）

```bash
for vp in "375 812" "768 1024" "1440 900"; do
  set -- $vp
  agent-browser set viewport $1 $2
  agent-browser open "$APP/menu"
  agent-browser wait 800
  agent-browser eval "({w:innerWidth, sw:document.scrollingElement.scrollWidth, cols:getComputedStyle(document.querySelector('[data-testid=dish-grid]')||document.body).gridTemplateColumns})" \
    > "$EVIDENCE_DIR/TC-075-$1x$2.json"
  agent-browser screenshot "$EVIDENCE_DIR/TC-075-$1x$2.png"
done
```
断言 `sw <= w+1`；列数 375→1、768→2、1440→3。

## 6. SSE 与 AI（TC-059/062/063）

1. 两个浏览器上下文打开菜单；A 下单；B 不刷新，≤2s 库存减 1（TC-059）。
2. 打开 AI 助手，输入 `I want something light today`；观察卡片先出、理由后出；截图（TC-062）。
3. 未配置 `LLM_API_KEY` 时重试；断言标注 `rule-based fallback` 且候选非空（TC-063）。
4. 标记过敏原 Egg 后请 AI 推荐；断言无含 Egg 菜（TC-061）。

## 7. 英文与金额（TC-077/080）

```bash
agent-browser eval "document.body.innerText" > "$EVIDENCE_DIR/TC-080-text.txt"
grep -nP '[一-龥]' "$EVIDENCE_DIR/TC-080-text.txt" && echo 'FAIL: 中文可见文案' || echo 'PASS: no CJK'
grep -oE '¥[0-9]+(\.[0-9]{1,3})?' "$EVIDENCE_DIR/TC-080-text.txt" | grep -vE '¥[0-9]+\.[0-9]{2}$' && echo 'FAIL: 金额格式' || echo 'PASS: currency format'
```

## 8. 证据清单

- 每个 TC 至少 1 张截图 + 1 份 `get text`/`eval` 输出。
- 失败时保存 `agent-browser snapshot`（无障碍树）与 console 日志。
- 未执行项在 `test-report.md` 标 `NOT TESTED`，不得以截图缺失口头 PASS。