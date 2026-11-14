# G2 交叉评审（前端视角）— WeBox

- 评审人：前端技术方案设计师（FTL，d224ce10），2026-11-14 22:08 CST
- 评审对象：`docs/architecture.md`、`docs/api-contract.md`、`docs/data-model.md`、`docs/test-plan.md`、`docs/test-cases.md`
- 评审维度：前端可落地性 / 契约一致性 / 交互与 E2E 可测性
- 口径：只登记 blocker / major；minor 不入账；作者≠评审者（本节点评审 Architecture/Test 产物）
- 结论：**CHANGES**（2 blocker + 9 major；均可通过“契约补字段/补定义 + 前端防御性实现”闭环，不阻塞 Stage 4 启动）

## 1. 结论摘要

| 维度 | 结论 | 说明 |
|---|---|---|
| 认证/刷新/角色守卫 | PASS | `Bearer + refresh 7d + 401/403 分段` 可直接驱动前端守卫（api-contract L11、L27–29） |
| 菜单列表/筛选/搜索/分页/For You | PASS | 字段与排序参数足以实现卡片、筛选、300ms 搜索、软排序高亮（L56） |
| 菜品详情与选项加价 | PASS | `optionGroups{required,minSelect,maxSelect,options[].priceDeltaCents}` 完整（L57） |
| 购物车 | PASS（前端本地态） | 无服务端购物车端点，与 A-10 一致；preview 承担服务端校验（L67） |
| 下单/幂等/唯一单/截单 | PASS | `Idempotency-Key`、`effectiveDate/effectiveMeal/cutoffAt/autoSwitched`、`existingOrderId` 可驱动结算页（L67–68、L109–134） |
| 订单详情页字段 | **CHANGES** | #20 仅写“含 items 快照 + snapshot_json”，无字段级 JSON（L70） |
| “加入购物车”入口 | **CHANGES** | 列表项无选项元数据，卡片无法判断是否必须进详情选必选项（L56 vs L57） |
| Console | CHANGES | 缺 `GET /admin/dishes/{dishId}`；列表行字段未定义是否含编辑所需全字段（L80） |
| 看板/AI SSE | PASS | 看板 6 块数据结构齐全（L90）；AI 事件 `meta→dish→reason→done` 可流式消费（L99、L142–161） |
| 错误码/包络 | CHANGES | #10 `204 + {}` 与“所有响应含 envelope”冲突（L12 vs L50） |
| 测试口径一致性 | CHANGES | TC-039 用 `DINNER` 大写，契约枚举为 `Dinner`（test-cases L62 vs api-contract L16） |
| 测试钩子路径 | CHANGES | test-plan §7 表内 H3/H4/H5/H10 仍为旧路径（L190–197），与 api-contract #24/#32/#33/#36 漂移 |

## 2. Blocker（必须闭环后才能按契约编码，否则 T1 页面无法验收）

### G2FE-B1 菜单列表缺少 `hasOptions / hasRequiredOptions`，卡片“Add to Cart”无法判定入口

- 证据：`docs/api-contract.md` L56（#11 菜单项字段：dishId,name,description,priceCents,priceDisplay,category,spiceLevel,imageUrl,available,lowStock,soldOut,forYou）；详情端点 L57 才返回 `optionGroups`。
- 影响：Burger/Pasta/Quinoa Bowl/Bibimbap/Caesar 等含必选组（Bun、Sauce、Pasta Type、Base）。列表卡片若直接加购，会缺少必选项 → `400 VALIDATION_OPTION_REQUIRED`（AC-010）；若所有卡片一律跳详情，则简单菜品失去“一键加购”，TC-076 的 500ms 连点加购场景无法成立。
- 建议（向后兼容加字段）：`GET /menu` 每项增加 `hasOptions:boolean`、`hasRequiredOptions:boolean`。
- 前端过渡方案（契约不改也可交付）：列表卡片“Add”统一打开详情抽屉；仅当详情无选项组时显示直接 Add。作为降级实现，登记为风险而非静默绕过。
- 责任：S2-Architecture（契约）；S4-FE（过渡实现）。级别：Blocker。

### G2FE-B2 订单详情响应无字段级结构，T1 订单详情页/AC-017/E2E 不可实现

- 证据：`docs/api-contract.md` L70（#20 仅“订单详情含 items 快照 + snapshot_json”）；对比 #18 下单响应 L68、#19 列表 L69 均有明确字段；`docs/data-model.md` L43 定义 `order_items` 列。
- 影响：订单详情页（菜品名/选项名/加价/数量/小计/总价/状态/时间/地址/取消）与 `data-testid` 断言无锚点；AC-017、AC-055（快照冻结）无法在前端验收。
- 建议：在 api-contract #20 固化 JSON：
  `{orderId,orderNo,status,deliveryDate,mealType,address,totalCents,itemCount,createdAt,cancelledAt?,cancelReason?,items:[{dishId,dishName,unitPriceCents,options:[{name,priceDeltaCents}],qty,subtotalCents}]}`
- 责任：S2-Architecture。级别：Blocker。

## 3. Major（不阻塞开工，但需在设计/实现中显式处理并登记）

| ID | 位置 | 问题 | 建议 | 责任 |
|---|---|---|---|---|
| G2FE-M1 | api-contract L12 vs L50 | 统一包络承诺“所有响应 `{code,message,data,requestId}`”，但 #10 删除地址为 `204` 空体；前端 client 若统一 `res.json()` 会在 204 抛错 | 统一为 `200 {code:"OK",data:{}}`；若保留 204，前端 client 必须 `status===204` 短路 | S2-Architecture / S4-FE |
| G2FE-M2 | api-contract L56；L67 | 无“可订日期/已发布菜单日期”端点；结算页配送日期选择只能盲选，错误要等 preview 409 `ORDER_MEAL_UNAVAILABLE` | 增加 `GET /menu/dates`（返回 `[{date,published}]`）；或文档明确仅允许 today/today+1/today+2 且空菜单显示空态 | S2-Architecture / S4-FE |
| G2FE-M3 | api-contract L80 | 缺 `GET /admin/dishes/{dishId}`，编辑页只能复用列表行；未定义列表行是否含 description/protein/allergens/imageUrl | 明确 #25 列表项含全部可编辑字段；或补详情端点 | S2-Architecture |
| G2FE-M4 | api-contract L41–43 | 登录/刷新响应 `expiresIn` 未写单位；refresh 是否轮换旧 refresh token 未写；前端无法确定定时刷新与并发刷新策略 | 明确 `expiresIn` 为秒、refresh 轮换（旧 token 失效）、失败统一 401 | S2-Architecture / S4-FE |
| G2FE-M5 | api-contract L99 | AI 请求可选 `sessionId`，但响应/事件不回传 `sessionId`，多轮会话无法关联 | `meta` 事件回传 `sessionId`（或 `done` 回传） | S2-Architecture |
| G2FE-M6 | test-cases L62/L64/L66 vs api-contract L16 | 枚举大小写冲突：测试写 `effectiveMeal=DINNER`，契约枚举为 `Lunch/Dinner`；前端展示若直接渲染会不一致 | 测试用例改 `Dinner`；前端统一用契约枚举 + i18n 映射 | S2-Test / S4-FE |
| G2FE-M7 | test-plan L190–197 vs api-contract L74/L87/L88/L92 | 测试钩子表仍写旧路径（`/admin/menu/{date}/dishes/{id}/stock`、`POST /admin/orders/{id}/confirm`、`/admin/ai/rules`），与契约 #32/#24/#33b/#37 不一致，E2E/测试脚本会 404 | 以 api-contract 为准回写 test-plan §7；Stage 5 只按契约路径执行 | S2-Test |
| G2FE-M8 | api-contract L90 | 看板 `mealSplit:{lunch,dinner}` 未定义数值语义（订单数还是份数）；趋势 `trend[].orders` 未定义是否含 Cancelled | 明确：mealSplit=订单数（不含 Cancelled）；trend.orders=有效订单数，Cancelled 单列 | S2-Architecture |
| G2FE-M9 | api-contract #11 vs #14/#30/#32 | 与 BTL `G2-BE-M2` 交叉确认：`available` 在菜单项为 boolean，在 SSE/Console 为 int；前端 `Only N left` 缺数量来源 | 统一为 `available:boolean` + `availableQty:int`（菜单直接给数量更佳） | S2-Architecture / S4-FE |

> M8 影响看板数字与 DB 聚合一致性（AC-042），前端无法自行定义口径，故登记；M9 与后端评审交叉确认（BTL `G2-BE-M2`），前端兜底为“无计数只显示 Low stock”，不虚构数字。

## 4. 前端可直接依赖的已确认项（PASS 证据）

| 项 | 证据 | 前端落点 |
|---|---|---|
| 统一错误码 8 段 + HTTP 映射 | api-contract L24–33 | `src/api/errors.ts` 全量映射英文文案 |
| 分页 `page/size` 默认 1/20、≤100、越界 400 | L13 | `src/api/client.ts` 参数构造 + 前端分页器禁用越界 |
| 金额整数分 + `priceDisplay` | L14 | `formatMoney(cents)` 单点；`priceDisplay` 仅作校验 |
| 幂等键 8–64、同键同体重放、异体 409 | L17、L136–140 | 结算按钮同一 key 重试；`sessionStorage` 保存 key |
| 唯一有效单 409 + `existingOrderId` | L125–129 | 结算页按钮切换 `View Existing Order` |
| 截单 `effectiveDate/effectiveMeal/cutoffAt/autoSwitched` | L67、L105–124 | 结算页自动切换横幅；日期/餐次以服务端回显为准 |
| 库存不足 409 + `details[{dishId,requested,available}]` | L130–134 | 购物车行内错误 + 一键调整 |
| SSE 固定事件/单行 JSON/`retry:3000`/15s 心跳/3 次失败轮询 | L142–161 | `src/api/sse.ts` fetch+ReadableStream |
| `X-Test-Clock` 测试钩子 | L20 | E2E 用 API 注入；前端不暴露该头 |
| 路由鉴权 401/403 区分 | L27–29 | `RequireAuth` / `RequireAdmin` / 403 页 |

## 5. 前端对评审结论的处理承诺

1. B1/B2 未闭环前，前端按“过渡方案 + `types.ts` 预留字段”实现，测试钩子与页面结构不受影响；
2. M1/M4/M6 由前端 client 层兜底（204 短路、expiresIn 秒、枚举映射），不向下游传递歧义；
3. M2/M3/M5/M7/M8/M9 写入 `docs/review-findings.md`，由 Architecture/Test 在 Stage 3b 前闭环；
4. 上述任一项若在 Stage 4 结束仍未闭环，对应 AC 在测试报告中标注 `NOT TESTED` 或“契约缺口”，不虚报 PASS。

## 6. 结论

**CHANGES**：B1/B2 需契约补充字段级定义；M1–M9 需在设计文档中显式防御。前端方案（`docs/frontend-design.md`）已按“契约优先 + 防御性客户端”落地，不等待人工确认，可立即进入 Stage 4。