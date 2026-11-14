# 00 · 需求与 PRD 分析（WeBox）

> 来源：`docs/raw/PRD.md`（PRD V3.0 全栈合并版）、`docs/raw/prd-analysis.md`（产品工程师 G1）、`docs/raw/acceptance-matrix.md`（AC-001…AC-060）。以下为已评审原文整合，未改业务口径。

---

# AI Vibe Coding V3.0

## WeBox — 企业员工餐食订购平台（全栈合并版 PRD）

### 产品需求文档 (PRD)

| 项目     | 内容                     |
| -------- | ------------------------ |
| 文档版本 | V3.0（前后端合并）        |
| 创建日期 | 2026-03-24               |
| 场景     | 1.5 小时 AI 全栈开发挑战 |
| 适用岗位 | 前端 / 后端（同一份 PRD，均要求完整前后端交付；评分侧重按岗位区分，详见附录 A） |

---

## 1. 产品背景

WeBox 是一个企业内部的员工餐食订购平台。公司约 200 名员工，食堂每日提供菜品供员工选择，菜品库会持续扩充，当前约 50 个菜品。**员工通过手机和电脑两种设备访问平台**，提前选餐下单，食堂据此备餐。

**每天上午 9:30-10:00 是订餐高峰期**，大部分员工会在这个时段集中下单午餐，菜单数据在此期间被高频访问。

平台有两类用户，**使用同一套系统，但拥有不同的功能权限**：
- **员工**：浏览菜单、搜索菜品、下单订餐
- **管理员**：通过 **Console 后台管理模块**管理菜品、处理订单、了解平台经营情况

> **系统语言要求（强制）**：本系统面向用户的**所有内容一律使用英文**，包括但不限于——界面文案与按钮、导航与页面标题、菜单数据（菜品名称/描述/分类/过敏原/辣度/选项）、表单标签与占位符、提示与错误信息（toast / 弹窗 / 校验提示）、AI 推荐理由、数据看板文案等。本 PRD 中出现的中文示例字符串仅用于说明语义，实现时须以对应英文呈现。

---

## 2. 需求分层

本项目需求分为三层，候选人按顺序完成。**核心功能为必须完成项，进阶功能为主要考察项，挑战功能为可选加分项**——请优先保证核心与进阶功能完整可用，行有余力再挑战 Tier 3。**注意：无论选择完成到哪一层，都必须交付完整可运行的前后端（全栈交付为强制要求）。**

| 层级       | 范围                                       | 是否必做 |
| ---------- | ------------------------------------------ | -------- |
| 核心功能（Tier 1） | 员工端：注册登录、菜单浏览与搜索、购物车、下单 | ✅ 必做 |
| 进阶功能（Tier 2） | 员工端：偏好设置 + 订餐规则；Console 后台：菜品管理  | ✅ 主要考察项 |
| 挑战功能（Tier 3） | 库存实时展示与扣减、AI 智能推荐、经营数据看板  | ⭐ 可选加分项 |

---

## 3. 核心功能

### 3.1 员工注册 / 登录

员工使用企业邮箱注册账号（需通过邮箱格式校验；**不强制校验特定公司域名**，同一邮箱不可重复注册）。注册后可登录系统。刷新页面不应丢失登录状态。注册、登录过程中的异常情况（如邮箱已被注册、密码不正确等）需要给予用户明确的反馈。

密码需满足基本安全要求（**至少 8 位，且同时包含字母与数字**），且**不得以明文形式存储**。注册和登录表单需对用户输入做校验与长度限制（邮箱格式校验；各文本输入设合理长度上限——如邮箱/地址 ≤ 200 字符、搜索关键词 ≤ 50 字符），并对特殊字符做安全处理。系统需要区分员工和管理员两种角色，不同角色可访问的功能不同。

### 3.2 每日菜单

员工进入系统后看到的主页面是当日菜单。菜单以卡片形式展示菜品，每个卡片包含菜品图片、名称、价格（精确到分，如 ¥22.50）和菜系标签。

点击卡片可查看菜品详情，详情页包含：
- 菜品描述
- 成分信息：蛋白质来源（如鸡肉、牛肉、鱼肉、豆制品等）、过敏原、辣度等级（不辣/微辣/中辣/重辣）
- 自定义选项（如有）：部分菜品支持加料或配置选择。例如汉堡可选择酱料（番茄酱/芥末酱/蛋黄酱/BBQ酱）和面胚（普通/全麦），意面可选择面型和加料（培根 +¥5/芝士 +¥3）。每个选项组可能是必选（如面胚）或可选（如加料），部分选项有额外费用。员工选择后，菜品价格需实时更新。

员工可以按菜系筛选菜品（分类以英文展示：`Chinese`、`Western`、`Japanese`、`Light Meal`、`Korean`、`Southeast Asian` 等）。筛选时支持多选，例如同时查看 `Chinese` 和 `Japanese`。

员工可以通过搜索框搜索菜品，输入菜品名称或描述中的关键词查找菜品。

**注意**：菜品数量会持续增长，菜单数据在高峰期被高频访问，页面需要在菜品数量较多、访问量较高时仍能流畅使用。

### 3.3 购物车

员工在菜单页可以将菜品加入购物车。同一菜品可重复添加，每次点击数量加一。购物车内可以调整每个菜品的数量，也可以移除菜品。购物车需实时显示当前总价。

如果菜品有自定义选项，购物车中需展示员工已选择的配置（如"全麦面胚 + 芥末酱"）。同一菜品不同配置视为不同条目（例如一个全麦汉堡和一个普通汉堡分别显示）。

**注意**：早高峰时段（9:30-10:00）是订餐高峰，大量员工会频繁点击"加入购物车"按钮。

### 3.4 下单

员工从购物车进入结算页面。结算页展示订单明细（菜品、自定义选项、数量、小计含加料费用、总价），员工需要选择配送日期（默认当天）、用餐时段（`Lunch` 或 `Dinner`）、配送地址（可从历史地址选择或输入新地址）。

确认无误后提交订单。**订单提交必须保证每次请求只会创建一个订单**，即使员工因网络延迟连续点击了多次"提交"按钮。提交成功后展示订单成功页面，包含订单编号和预计配送信息（配送日期、用餐时段、配送地址）。

员工可以在"我的订单"页面查看所有历史订单，点击可查看订单详情（含每个菜品的所选自定义选项、数量、小计与总价）。订单支持取消操作（仅限状态为 `Pending` 的订单）。订单状态英文枚举：`Pending`、`Confirmed`、`Completed`、`Cancelled`。

---

## 4. 进阶功能

### 4.1 饮食偏好设置

员工可以在个人设置中配置饮食偏好：

- **过敏原标记**：标记自己的过敏原（枚举与菜品过敏原字段一致：`Peanuts`、`Dairy`、`Egg`、`Gluten`、`Soy`、`Fish`、`Shellfish`）。当员工将含有已标记过敏原的菜品加入购物车时，系统需弹窗提醒（英文，例如 `This dish contains an allergen you flagged: [Egg]. Add anyway?`），由员工自行决定是否继续。注意：**不是过滤掉含过敏原的菜品**，而是在加入时提醒。
- **菜系偏好**：选择偏好的菜系；当开启下文的「为我推荐」开关时，菜单页优先展示偏好菜系的菜品（关闭时按默认顺序展示）。
- **口味偏好**：辣度偏好（不辣/微辣/中辣/重辣，与菜品辣度枚举 `None/Mild/Medium/Hot` 一一对应，用于菜单排序/高亮）、口味浓淡偏好（清淡/适中/重口，主要作为 AI 推荐 §5.2 的个性化参考，不强制驱动菜单硬排序）。
- **单餐预算**：设置每餐的预算范围，如 ¥15-¥30。当购物车总价超出预算上限时，在结算页给予提示（但不阻止下单）。

菜单页提供"为我推荐"开关，开启后根据偏好自动排序和高亮匹配菜品。

### 4.2 订餐规则

食堂运营有以下规则，系统需要严格执行：

- **每单数量上限**：每个订单最多包含 5 份餐品（注意是总份数，不是品种数。比如 3 份宫保鸡丁 + 3 份麻婆豆腐 = 6 份，超限）。达到上限后，菜单页的"加入购物车"按钮和购物车内的"+"按钮都应该不可用，并说明原因。
- **截单时间**：午餐订单须在当日上午 10:00 前提交，晚餐订单须在当日下午 15:00 前提交。过了某餐次的截单时间，系统应**自动切换到时间上最近的可订餐次**，判定规则为：**当日晚餐若未过 15:00 → 切换为当日晚餐；当日晚餐也已截单 → 切换为次日午餐**。例如上午 10:30 提交午餐订单（午餐已截单、晚餐未截单）→ 自动切换为当日晚餐。
- **不可重复下单**：同一天同一餐次（如周三午餐），每位员工只能有一个有效订单（`Pending` 或 `Confirmed` 状态）。如果已有有效订单，结算页的 `Place Order` 按钮应变为 `View Existing Order` 并跳转。

### 4.3 Console 后台管理模块 — 菜品管理

管理员登录后进入 **Console 后台管理模块**（英文 UI 名 `Console`，与员工端使用不同的导航布局）。**普通员工不可访问 Console 后台功能。**

**菜品管理页面**：
- 以表格形式展示所有菜品，支持搜索和按分类筛选
- 可新增菜品：填写名称、描述、价格、分类、过敏原标签，上传图片
- 可编辑已有菜品信息
- 可设置菜品的"上架/下架"状态，下架的菜品员工端不可见
- 可设置每日菜单：选择哪些菜品出现在指定日期（默认次日）的菜单中，并为每个菜品设置该日供应数量

> **数据初始化说明**：系统须预置**当日可下单的菜单与库存种子数据**，供演示当天直接完成下单、库存扣减、看板统计；「设置每日菜单」既可面向次日、也可用于初始化或调整当日菜单。评分演示以「当日可下单菜单」为准。

---

## 5. 挑战功能（可选加分项）

> 本层为**可选加分项，不计入功能完成度门槛**。未完成不影响基础评级，完成则作为加分与技术亮点。建议在核心 + 进阶功能完整可用后再投入。

### 5.1 库存、实时展示与扣减

每个菜品每日有限量供应。菜单页需展示每个菜品的剩余数量。当剩余数量较少时（≤ 3 份），需要有视觉提示。售罄的菜品不可下单。

**关键要求**：
- **多个员工可能同时下单同一个菜品，库存扣减不能出现超卖。**
- 当一位员工下单后，其他正在浏览菜单的员工应当能够**实时看到库存变化，而不需要手动刷新页面**。
- 提交订单时需要再次确认库存充足，如果提交时发现库存不足，需要告知员工具体哪些菜品库存不足，并允许调整后重新提交。
- 订单取消后，对应库存应恢复。

### 5.2 AI 智能推荐

在菜单页面提供一个 AI 选餐助手入口。员工可以用自然语言（英文）描述想吃什么（例如 `I want something light today` / `A high-protein low-fat lunch` / `Nothing I ate yesterday`），AI 助手根据以下信息给出个性化推荐：

- 员工的饮食偏好设置（如已配置）
- 当日可用的菜品（排除已售罄的）
- 员工的过敏原（含过敏原的菜品不应出现在推荐中）
- 员工近期（**近 7 天**）订餐记录（避免重复推荐近期已点过的菜品）

推荐结果以菜品卡片形式展示（不是纯文字），每个推荐附带个性化的推荐理由，员工可直接将推荐菜品加入购物车。推荐过程应有流式的响应体验，而非长时间等待后一次性展示。

**注意**：本功能需要实际接入 LLM 服务，候选人需自行准备 LLM API Key 或本地模型，面试现场不提供。该功能必须实际可运行。

### 5.3 Console 后台管理模块 — 经营数据看板

Console 后台管理模块增加一个数据看板页面，展示食堂的经营状况：

- **今日概览**：今日订单数、总收入、已完成/待处理/已取消订单数
- **菜品排行**：按销量排序的菜品 Top 10，展示为柱状图
- **时段分布**：午餐 vs 晚餐的订单量对比
- **趋势图**：最近 7 天的订单量和收入趋势折线图
- **库存预警**：当前库存 ≤ 3 份的菜品列表（低库存阈值与 §5.1 一致：售罄 = 0，低库存 = 1~3）

看板数据应能实时刷新（或提供手动刷新按钮），且数据须来自真实订单。

---

## 6. 菜品数据

候选人可使用以下菜品信息或自行补充。**入库与展示均须使用英文**（下表即为系统中应存储/展示的英文内容）：

| Name | Description | Price | Category | Protein | Allergens | Spice Level | Customization Options |
|------|-------------|-------|----------|---------|-----------|-------------|-----------------------|
| Kung Pao Chicken | Classic Sichuan dish, chicken stir-fried with peanuts and dried chili | ¥22.00 | Chinese | Chicken | Peanuts | Medium | — |
| Caesar Salad | Fresh romaine lettuce with Parmesan and Caesar dressing | ¥28.50 | Light Meal | None | Dairy, Egg | None | Add-ons: Grilled Chicken (+¥6) / Bacon (+¥5) / Avocado (+¥4) |
| Salmon Sashimi Set | Fresh salmon sashimi with rice and miso soup | ¥45.00 | Japanese | Fish | Fish | None | — |
| Tomato Pasta | Classic Italian tomato pasta with fresh basil | ¥26.50 | Western | None | Gluten | None | Pasta Type (required): Spaghetti / Fusilli / Penne; Add-ons: Bacon (+¥5) / Cheese (+¥3) |
| Tom Yum Soup | Thai hot & sour shrimp soup with lemongrass, galangal, lime leaves | ¥32.00 | Southeast Asian | Shrimp | Shellfish | Hot | — |
| Chicken Quinoa Bowl | Low-fat high-protein grilled chicken with quinoa, avocado, veggies | ¥35.80 | Light Meal | Chicken | None | None | Base (required): Quinoa / Brown Rice / Mixed Grains |
| Mapo Tofu | Sichuan classic, soft tofu with spicy minced meat | ¥18.00 | Chinese | Tofu, Pork | Soy | Medium | — |
| Korean Bibimbap | Stone-pot mixed rice with veggies, fried egg, and chili sauce | ¥30.00 | Korean | Egg | Egg, Soy | Mild | Add-ons: Cheese (+¥3) / Fried Egg (+¥2) / Beef Slices (+¥8) |
| Classic Beef Burger | Angus beef patty with lettuce, tomato, onion | ¥38.00 | Western | Beef | Gluten, Dairy | None | Bun (required): Plain / Whole Wheat; Sauce (required): Ketchup / Mustard / Mayo / BBQ; Add-ons: Cheese (+¥3) / Bacon (+¥5) / Fried Egg (+¥2) |

> 分类枚举（英文）：`Chinese`、`Western`、`Japanese`、`Light Meal`、`Korean`、`Southeast Asian`。
> 辣度枚举（英文）：`None`、`Mild`、`Medium`、`Hot`。
> 过敏原枚举（英文，固定全集）：`Peanuts`、`Dairy`、`Egg`、`Gluten`、`Soy`、`Fish`、`Shellfish`（海鲜类统一用 `Fish` / `Shellfish`，不单列 `Seafood`，以免偏好标记与菜品标签不匹配）。
> 货币：价格统一使用人民币、精确到分，货币符号保留 `¥`（如 `¥22.50`）；金额展示与计算须避免浮点精度问题。

菜品图片资源见附件 `webox_product_images.zip`。

---

## 7. 交付标准

本项目定位为企业级应用，不是演示 Demo。技术选型和实现质量需要满足生产环境运行标准。

### 7.1 技术选型要求

- **本项目要求完整实现前后端**，不能只做前端或只做后端，必须是可完整运行的前后端项目
- 前端技术栈不限，需说明选型理由
- 后端使用 **Java（JDK 17）+ Spring Boot** 框架
- 数据持久化使用 **独立部署的 MySQL 服务**，**不接受嵌入式 / 内存数据库**（如 H2、SQLite、HSQLDB、Derby、嵌入式 MySQL 等一律不可）；MySQL 须作为独立进程真实运行，并可按 README 步骤连接
- **缓存方案不限，Redis 为可选项**：菜单等高频数据缓存、会话/令牌、库存与幂等控制等，可选用 Redis，也可用进程内缓存或其他方案，**不强制使用 Redis**。若引入 Redis，需在 README 给出启动步骤
- AI 推荐功能需要实际接入 LLM 服务（候选人自行准备，面试现场不提供 API Key），该功能必须可实际运行
- **系统语言**：所有面向用户的内容（界面文案、菜单数据、错误/提示信息、AI 推荐理由等）**一律使用英文**（参见 §1 系统语言要求）
- 可使用任意 AI 编码工具辅助开发

**目标架构**：`前端 SPA → 后端服务（JDK 17 + Spring Boot）→ 独立 MySQL 服务（持久化）` 为**强制**基础设施；缓存层（如 Redis）为**可选增强**，用与不用不影响功能门槛。README 须给出 JDK + Spring Boot 应用 + MySQL 的完整本地启动步骤（若引入 Redis 等额外服务，一并说明）。

### 7.2 交付物清单

候选人需要交付以下完整内容：

| 交付物 | 要求 |
|--------|------|
| 可运行代码 | 项目可在本地完整启动和运行 |
| README | 项目介绍、技术栈说明、本地启动步骤（确保他人能从零开始启动项目） |
| API 文档 | 接口清单、请求/响应格式说明（格式不限） |
| 架构说明 | 系统架构图或文字说明，包含核心模块划分和数据流 |
| 测试 | 核心业务逻辑的测试用例，可运行并通过 |
| **AI 编程对话记录** | **从项目开始到结束的完整原始对话导出**（Cursor / Claude Code / ChatGPT / Copilot Chat / Windsurf / Cline 等任意工具的原生导出文件均可）。**不接受截图、节选、片段或事后整理摘要**。多个工具混用时全部提交。存放于项目根目录 `ai-conversations/` 子目录，或在 README 中明确指出存放路径。**该项缺失或不达标将直接影响最终评级，请务必妥善保存。** |

### 7.3 项目定位

**这是一个长期运行的项目，你是这个项目的 Owner。** 请从项目长期稳定运行的角度考虑你的设计和实现，确保项目具备可维护性和可靠性。

### 7.4 演示要求

1.5 小时后，候选人需要：
- 演示已完成的功能
- 展示交付文档（含 AI 编程对话记录）
- 简要说明技术选型理由
- 说明遇到的问题和解决方式

---

## 附录 A：岗位评分侧重（面试官内部使用，不对候选人公开）

> 本 PRD 为前端 / 后端候选人共用同一份，业务内容一致，**均要求完整前后端交付**（JDK 17 + Spring Boot + 独立 MySQL 架构，Redis 等缓存层为可选增强；全栈交付为强制要求，不因岗位或完成层级豁免）。产品优化（10）维度前后端评分标准相同；**主要差异在「技术方案 P6+（20 分）」的考察侧重，以及后端架构相关评分对前端岗位的放宽**——面试官按候选人**实际报考岗位**选择对应的 P6+ 考察表与架构评分口径。AI 对话记录门槛、下单级联归零等铁律对两类岗位一视同仁（详见评分指南 §1.3）。

### A.0 功能完成度口径（Tier 3 加分化后）

> 挑战功能（Tier 3）已调整为**可选加分项**，不再计入功能完成度基数与门槛。功能完成度重新以 **Tier 1 + Tier 2 = 50 分** 为基数：

| 项目 | 分值 | 说明 |
|------|------|------|
| Tier 1 核心功能 | 30 | 必做，端到端可用才计分 |
| Tier 2 进阶功能 | 20 | 主要考察项，端到端可用才计分 |
| **功能完成度基数** | **50** | 门槛与评级按此基数计算 |
| Tier 3 挑战功能 | **+10（加分）** | 可选，做了加分、不做不扣；加分后功能维度上限仍以 60 封顶 |

**功能完成度门槛（90%）随基数调整为 ≥ 45 / 50**：

| 功能完成度（基数 50） | 最高可达评级 |
|----------------------|------------|
| ≥ 45 分（90%） | 按总分正常评级 |
| 40–44 分（80–89%） | 最高「不推荐」，无论总分多高 |
| < 40 分（< 80%） | 直接「不通过」 |

> 说明一：Tier 3 中依赖下单的项（实时同步、库存扣减、看板真实数据、并发安全等）**级联归零规则依旧适用**——只是这些项现在归在「加分」而非「门槛」，下单不通仅使对应加分/ P6+ 项归零，不再直接拉低功能门槛基数。
>
> 说明二：P6+（20 分）中的「并发安全」「下单幂等」等仍照常考察，其业务锚点（同时下单不超卖、幂等提交）在 Tier 1「下单」与 Tier 3「库存」中均有体现；即使候选人未做 Tier 3 的实时/看板，只要下单与库存扣减可用，仍可验证这些 P6+ 项。

### A.1 前端候选人 · P6+ 考察侧重（20 分）

| 考察点 | 分值 | PRD 中的业务锚点 |
|--------|------|-----------------|
| 多屏幕适配 / 响应式 | 4 | §1「员工通过手机和电脑两种设备访问」 |
| 分页 / 列表性能 | 4 | §3.2「菜品约 50 个且持续增长，数量较多时仍能流畅使用」 |
| 按钮防抖 / 节流 | 4 | §3.3「早高峰频繁点击加入购物车」 |
| 价格精度处理 | 4 | §3.2「价格精确到分，如 ¥22.50」 |
| 输入校验与限制 | 4 | §3.1 注册/地址、§3.2 搜索框 |

### A.2 后端候选人 · P6+ 考察侧重（20 分）

| 考察点 | 分值 | PRD 中的业务锚点 |
|--------|------|-----------------|
| 缓存策略 | 4 | §1「9:30-10:00 高峰集中下单」+ §3.2「菜单高频访问」；对菜单等热点数据做缓存并有合理的更新/失效策略（Redis 或进程内缓存等方案均可，不限定 Redis） |
| 下单幂等 | 4 | §3.4「每次请求只会创建一个订单，即使连续点击多次提交」 |
| SQL 注入防护 | 4 | §3.2「员工可搜索菜品」 |
| 用户权限校验 | 4 | §1 / §3.1 / §4.3「两类用户不同权限，员工不可访问 Console 后台」 |
| 并发安全（防超卖） | 4 | §5.1「多个员工同时下单同一菜品，不能超卖」 |

> 说明：合并版 PRD 已同时包含前后端两套业务锚点（高峰并发 + 多端访问、幂等提交 + 价格精度等），因此**同一份文档发给任一岗位都能完整承载其 P6+ 考察点**，无需再区分发放。评分时仅需按岗位切换附录 A.1 / A.2 对应的 P6+ 表格即可。

### A.3 前端候选人 · 后端架构评分放宽

> 前端岗位的核心考察在前端工程能力（A.1），后端架构不作为其能力评判重点。因此对前端候选人，**后端架构相关项按「能合理接入并端到端跑通即可」的标准评分，不做深度/最优性考察**：

| 架构相关项 | 后端候选人口径 | **前端候选人（放宽）口径** |
|-----------|--------------|--------------------------|
| 缓存方案（含可选 Redis） | 若做缓存，考察更新与失效策略、命中率、一致性；Redis 为可选方案之一 | **是否做缓存/是否用 Redis 均不作为前端评分点，不考察策略优劣** |
| 缓存策略（P6+ 4 分） | 后端 P6+ 项，占 4 分 | **不在前端 P6+ 考察范围**（前端 P6+ 用 A.1 表，20 分全部为前端项） |
| 下单幂等 / 并发安全 | 后端 P6+ 各 4 分，端到端验证 | **不计入前端 P6+**；仅要求下单结果正确、不重复、不超卖（属功能正确性），不深究后端实现方案 |
| 架构说明文档（稳定性 3 分之一） | 需体现 MySQL 分层、数据流、并发决策（若用缓存/Redis 一并说明） | **只需说明整体前后端架构与数据流即可，后端内部架构深度不扣分** |
| 后端代码质量 / 分层设计 | 纳入观察 | **不作为前端评分依据** |

> **底线不变**：前端候选人仍须交付**完整可运行的全栈项目**（JDK 17 + Spring Boot + 独立 MySQL 齐全并能启动；**Redis 为可选项，用与不用均可**）。放宽的是「后端架构的深度与最优性」，不是「是否需要后端」。若前端候选人后端完全跑不起来、或核心流程因后端不可用而中断，仍按对应功能项归零处理；若候选人声明使用 Redis，则不可用内存 Map 假替。

---

— 文档结束 —


---

# PRD 分析 — WeBox 企业员工餐食订购平台（V3.0 全栈合并版）

- 版本：v1.0（Stage 1 产品工程师，2026-11-14 21:52 CST）
- 输入：`docs/raw/PRD.md`（294 行）、`RUNBOOK.md`（132 行，D1–D22）、`docs/raw/scenario-profile.md` v2
- 配套：`docs/raw/acceptance-matrix.md`（AC-001…AC-060）、`docs/raw/assumptions.md`
- 结论：**PASS（分析完成）**；Tier 1/2 为必做门槛（≥45/50），Tier 3 为 +10 加分

## 1. 背景、目标与非目标

### 1.1 背景（PRD §1）
- 公司约 200 名员工、菜品约 50 个且持续增长；每天 09:30–10:00 为订餐高峰，菜单被高频访问。
- 员工用手机与电脑访问；员工下单、管理员通过 Console 管菜品/订单/看经营。
- 两类用户同一系统、不同权限；用户可见内容**全英文**；价格人民币精确到分。

### 1.2 产品目标（可判定）
| 目标 | 判定口径 |
|---|---|
| 员工 3 分钟内完成“登录→选餐→下单” | 新用户注册登录后，从菜单到提交 ≤3 分钟；订单成功页含订单号与配送信息 |
| 高峰不超卖、不重复下单、不重复回补 | 并发抢购成功数=库存数；幂等键只建 1 单；取消只回补 1 次 |
| 规则由服务端强制执行 | 5 份上限、截单切换、唯一有效单、仅 Pending 可取消均在 API 层生效（非仅前端） |
| Console 可运营当日菜单 | 管理员增改/上下架/设当日与次日菜单及库存，员工端即时反映 |
| 经营数据可信 | 看板数字与真实订单/DB 聚合一致 |

### 1.3 非目标（明确不做）
- 真实支付、退款资金流、发票（RUNBOOK D22：取消只回补库存与状态；退款仅审计预留）。
- 多租户/多站点运营（仅保留 `site_id='HQ'` 字段边界）。
- 微服务、消息队列、多机房、审批流引擎（RUNBOOK §4：2 小时不做过度设计）。
- 站外通知（短信/邮件/推送）、第三方配送轨迹。
- 完整菜品营养库/审计报表导出平台。

## 2. 用户角色与权限矩阵

角色枚举：`EMPLOYEE`（默认注册角色）、`ADMIN`（种子账号，禁止自助注册为 ADMIN）。

| 能力 | 员工 EMPLOYEE | 管理员 ADMIN | 约束 |
|---|---|---|---|
| 注册/登录/刷新保持会话 | ✅（仅 EMPLOYEE） | ✅（种子） | 注册请求携带 role=ADMIN → 400 或强制 EMPLOYEE |
| 菜单列表/详情/筛选/搜索 | ✅ | ✅ | 未登录 401 |
| 购物车/结算/下单 | ✅ | ✅ | 仅本人订单 |
| 查看订单 | ✅ 仅本人 | ✅ 全部 | 他人订单 403/404 |
| 取消订单 | ✅ 仅本人 Pending | ✅ 仅 Pending（需原因） | Confirmed/Completed 不可取消 |
| Console 页面与 `/api/v1/admin/**` | ❌ 403 | ✅ | 后端强制，非前端隐藏 |
| 菜品增改/上下架/图片 | ❌ | ✅ | 高风险操作需 confirm+reason+审计 |
| 设置每日菜单与库存 | ❌ | ✅ | 当日与次日可设 |
| 经营看板 | ❌ | ✅ | 数据来自真实订单 |
| 审计日志查询 | ❌ | ✅ | 不可改/不可删 |
| 数据范围 | SELF（本人订单/地址/偏好） | ALL（HQ 全站） | 横向越权 403/404 |
| 字段权限 | 仅本人地址/邮箱可见 | 订单列表地址脱敏，详情可见 | 密码哈希永不返回 |

> 说明：PRD 未设“站点管理员”；`site_id` 仅作为数据范围预留字段，默认 `HQ`，不实现多站点切换（ASSUMED A-22）。

## 3. 需求分层与端到端定义

### 3.1 Tier 1 核心（30 分，必做）

| 功能组 | 功能点 | 分值 | “端到端可用”定义 | AC |
|---|---|---|---|---|
| T1-AUTH 注册登录 | 邮箱注册（格式/去重/密码≥8 含字母数字/BCrypt）、登录、JWT 会话、刷新不丢、错误反馈 | 6 | 新邮箱注册→登录→刷新仍登录→登出后受保护页 401 | AC-001~005 |
| T1-MENU 菜单 | 当日菜单卡片（图/名/价/菜系）、菜系多选筛选、名称+描述关键词搜索、详情（描述/蛋白/过敏原/辣度）、自定义选项与实时加价 | 9 | 登录→列表→筛选 Chinese+Japanese→搜索→详情选 Whole Wheat+Cheese 价格实时 +¥3.00→加入购物车 | AC-006~010 |
| T1-CART 购物车 | 加购（每次 +1）、同菜同配置合并、不同配置分行、调量/删除、实时总价、空态 | 7 | 同菜同配置点 2 次=1 行×2；换配置=2 行；调量/删除总价即时正确 | AC-011~012 |
| T1-ORDER 下单 | 结算页（明细/选项/小计/总价/日期默认当天/餐次/地址）、提交成功页（订单号+配送信息）、我的订单+详情、取消 Pending | 8 | 结算→提交→成功页→我的订单→详情→取消 Pending→状态 Cancelled 且库存恢复 | AC-013~019 |

**Tier1 门槛**：以上四组全部端到端可用（非仅接口 200）；任一主链路断（登录/菜单/加购/提交）对应组 0 分。

### 3.2 Tier 2 进阶（20 分，主要考察项）

| 功能组 | 功能点 | 分值 | “端到端可用”定义 | AC |
|---|---|---|---|---|
| T2-PREF 偏好 | 过敏原标记+加购弹窗（不过滤）、菜系/辣度/口味偏好、“为我推荐”开关软排序与高亮、单餐预算超限提示不阻断 | 8 | 标记 Egg→加购含蛋菜弹窗可继续；开推荐偏好菜系靠前高亮，关闭恢复默认；预算超限有提示仍可下单 | AC-021~023 |
| T2-RULE 订餐规则 | 每单总份数≤5（按钮禁用+API 拒绝）、截单 10:00/15:00 服务端判定与自动切最近餐次、同日同餐次唯一有效单（View Existing Order） | 6 | 第 6 份被拦；10:01 午餐→晚餐；重复单 409 且按钮变 View Existing Order | AC-020、AC-024~027 |
| T2-CONSOLE 菜品管理 | 管理员表格+搜索/分类筛选、新增/编辑（图≤5MB）、上下架、设置指定日期菜单与当日供应量 | 6 | 管理员建菜→员工可见；下架→员工不可见；设当日菜单+库存→员工可下单并在看板/库存体现 | AC-028~033 |

### 3.3 Tier 3 挑战（+10，可选；不挤占 Tier1/2）

| 功能组 | 功能点 | 分值 | “端到端可用”定义 | AC |
|---|---|---|---|---|
| T3-STOCK 库存 | 剩余量展示、≤3 低库存提示、售罄禁购、提交二次校验、并发不超卖、SSE 实时更新（失败 5s 轮询）、取消恢复、两种库存模式、流水对账 | 4 | 并发 50 抢 10 只成功 10；他人下单 2s 内看到库存变化；取消后恢复；DB 为最终账本 | AC-034~037、AC-043~044 |
| T3-AI 推荐 | 自然语言选餐、候选硬过滤（上架/库存/过敏原/近 7 天）、卡片+理由、SSE、可加购、无 Key 规则降级、规则可配置回滚 | 3 | 输入 `I want something light today`→先出卡后出理由→可加购；过敏/售罄/近 7 天不出现；无 Key 显示 rule-based fallback | AC-038~041 |
| T3-DASH 看板 | 今日订单/收入/各状态数、Top10 柱状、午晚对比、7 天趋势、低库存列表、手动/自动刷新 | 3 | 下单后看板数字与 DB 一致；多下 1 单刷新后订单数+1 | AC-042 |

> Tier3 级联：依赖下单的项在“下单不可用”时对应加分归零；Tier3 未实现不影响 Tier1/2 门槛判定，但所有项必须标 `N/A（Tier 3 未实现）`。

## 4. 业务规则精确化（可执行判定）

### 4.1 每单数量上限（PRD §4.2）
- 规则：单个订单内所有明细 `qty` 之和 ≤ 5；按**总份数**，非品种数（3+3=6 超限）。
- 前端：购物车合计达 5 后，菜单“Add to Cart”与购物车“+”禁用；提示英文 `Order limit reached: max 5 items per order.`（文案可微调，须英文）。
- 后端：`POST /orders` 与 `POST /orders/preview` 均校验，超限返回 400 `ORDER_LIMIT_EXCEEDED`。
- 边界：5 份允许、6 份拒绝；单份 qty 也必须 ≥1 且为整数（0/-1/1.5 → 400 `VALIDATION_QUANTITY`）。

### 4.2 截单时间与自动切换（PRD §4.2 + RUNBOOK D2/D3）
- 时区：`Asia/Shanghai`，以**服务端时钟**为准；客户端时间不参与判定。
- 截单点：Lunch 10:00:00、Dinner 15:00:00；**等于截单点即视为已截单**（`now < cutoff` 才可订）。
- 自动切换表（请求餐次已截单时）：

| 请求 | 当前时间（上海） | 实际下单餐次 | 响应 |
|---|---|---|---|
| 当日 Lunch | < 10:00:00 | 当日 Lunch | 正常 |
| 当日 Lunch | ≥10:00:00 且 <15:00:00 | 当日 Dinner | 200 + `autoSwitched=true` |
| 当日 Lunch | ≥15:00:00 | 次日 Lunch | 200 + `autoSwitched=true` |
| 当日 Dinner | <15:00:00 | 当日 Dinner | 正常 |
| 当日 Dinner | ≥15:00:00 | 次日 Lunch | 200 + `autoSwitched=true` |
| 未来日期 Lunch/Dinner | 任意（且该日菜单已发布） | 请求值 | 正常，不触发当日截单 |
| 过去日期 | 任意 | 拒绝 400 `VALIDATION_DATE_PAST` | — |

- 结算页 `preview` 返回 `effectiveDate/effectiveMeal/cutoffAt/autoSwitched`，用户确认后提交；提交时服务端**重新计算**，响应返回最终生效值（不信任客户端缓存的餐次）。
- 自动切换后的餐次参与唯一有效单判定；若该餐次已有有效单 → 409 `ORDER_DUPLICATE` + `existingOrderId`。
- 次日无菜单/未发布 → 409 `ORDER_MEAL_UNAVAILABLE`（不落单）。
- 验收边界：09:59:59 / 10:00:00 / 10:01 / 14:59:59 / 15:00:00 / 15:01 六点 + 跨日（AC-024/025）。

### 4.3 同日同餐次唯一有效单（PRD §4.2 + D5）
- 业务键：`(user_id, delivery_date, meal_type)`，仅 `status ∈ {Pending, Confirmed}` 有效；Cancelled/Completed 不占用。
- 实现约束：生成列 `active_key`（有效时=`user:date:meal`，无效=NULL）+ 唯一索引；冲突返回 **409 `ORDER_DUPLICATE`**，`data.existingOrderId`。
- 前端：结算页若已有有效单，主按钮变 `View Existing Order` 并跳转该单详情；重复提交时按 409 处理。
- 允许：同日不同餐次（午餐+晚餐）、不同日同餐次。

### 4.4 过敏原提醒（PRD §4.1 + D11）
- 用户过敏原集合与菜品过敏原集合交集非空 → 加购时前端弹窗 `This dish contains an allergen you flagged: [Egg]. Add anyway?`，确认后正常加入。
- **不过滤**：菜单仍展示、搜索仍可搜到；后端加购/下单不因过敏原阻断。
- 唯一硬过滤场景：AI 推荐候选集（D12/AI-1）。
- 过敏原枚举固定：`Peanuts, Dairy, Egg, Gluten, Soy, Fish, Shellfish`；不在枚举内输入 → 400。

### 4.5 预算提示（PRD §4.1 + D14）
- 偏好字段：`budgetMinCents`、`budgetMaxCents`（整数分）；校验 `0 < min ≤ max`，超范围 400。
- 购物车总价（服务端重算）> `budgetMaxCents` → 结算页展示提示（英文，含金额），`budgetExceeded=true`；**不阻断**下单（仍 201）。
- 未设置预算 → 不提示；预算只影响提示，不影响价格与库存。

### 4.6 取消规则（PRD §3.4 + D4）
- 员工：仅本人 **Pending** 可取消；Confined/Completed → 409 `ORDER_STATE_INVALID`。
- 管理员：可取消 Pending（必填原因 ≤200，写审计）；Confirmed 取消 → 409（ASSUMED A-02）。
- 取消成功：状态 Cancelled、记录 `cancelledAt/cancelReason`、库存 `reserved -= qty`、写 1 条 `inventory_ledger(RELEASE)`；重复取消 409 且**不再回补**。
- 超时：Pending 创建 30 分钟后由任务置 Cancelled（`reason=TIMEOUT`）并释放一次（ASSUMED A-03，P2；未实现标 NOT TESTED）。

### 4.7 搜索与筛选（PRD §3.2）
- 搜索：对 `name`、`description` 做大小写不敏感子串匹配；关键词 trim 后长度 1~50；>50 → 400 `VALIDATION_SEARCH_LENGTH`；`%`/`_` 转义。
- 筛选：`category` 多值（逗号分隔或重复参数），取 OR；非法分类 → 400 `VALIDATION_CATEGORY`。
- 排序：默认稳定排序（上架时间倒序 + id 升序）；“为我推荐”开启时按偏好软排序，不删除任何菜。
- 分页：`page≥1`（默认 1）、`1≤size≤100`（默认 20）；越界 400 `VALIDATION_PAGINATION`；响应含 `total/page/size`。

### 4.8 Console 菜品与每日菜单（PRD §4.3 + D20/D21）
- 菜品字段：name(≤100)、description(≤1000)、priceCents(>0)、category(枚举)、allergens(枚举多选)、spiceLevel(枚举)、protein(≤50)、image(≤5MB, jpg/png/webp)。
- 上下架：`status=ON_SHELF/OFF_SHELF`；下架后员工列表/详情不可见（详情 404）。
- 每日菜单：`(dish_id, serve_date)` 设 `total_qty`；默认次日，可设当日；`total_qty=0` 视为当日售罄；未配置的菜当日不可下单。
- 高风险操作（改价/上下架/改库存/取消订单）：`confirm=true` + `reason`（1~200）+ 审计（前后值、操作者、IP、时间）；缺 reason → 400 `VALIDATION_REASON_REQUIRED`。
- 图片：20 张 `docs/raw/product_images/image_01..20.jpg` 映射到 20 道种子菜；缺失显示占位图，不得裂图。

## 5. 交易不变量（Tier1/2 强制）

| # | 不变量 | 实现口径 | 验收 |
|---|---|---|---|
| INV-1 | 金额整数分 | DB `BIGINT`；API 只传/回 `*Cents`；展示层格式 `¥xx.xx`；无 float/double | AC-054 |
| INV-2 | 服务端重算 | 请求只含 dishId/qty/optionIds；单价取自 DB；总价=Σ(unit+ΣoptionΔ)×qty | AC-016、AC-014 |
| INV-3 | 不超卖 | `UPDATE dish_daily_stock SET reserved=reserved+n WHERE serve_date=? AND dish_id=? AND total_qty-reserved-sold>=n`；影响行数=0 → 409 `STOCK_INSUFFICIENT` | AC-035 |
| INV-4 | 提交才占用 | 加购不写库存；`POST /orders` 事务内占用；失败整体回滚 | AC-014、AC-035 |
| INV-5 | 只回补一次 | `inventory_ledger` 唯一键 `(order_id, entry_type)`；重复释放冲突即忽略 | AC-019、AC-044 |
| INV-6 | 幂等 | `Idempotency-Key`（8~64，建议 UUID）+ 用户维度唯一；同键同体返回首次结果，同键异体 409 `IDEMPOTENCY_CONFLICT`；缺失 400 `IDEMPOTENCY_KEY_REQUIRED`；保留 24h | AC-015 |
| INV-7 | 唯一有效单 | 生成列+唯一索引，见 §4.3 | AC-026 |
| INV-8 | 订单快照 | 明细存 dishName/unitPriceCents/options[{name,priceDeltaCents}]/qty/subtotalCents + `snapshot_json`；历史单不随改价变化 | AC-055 |
| INV-9 | 状态机 | 仅 `Pending→Confirmed`、`Pending→Cancelled`、`Confirmed→Completed`、`Pending→Cancelled(TIMEOUT)`；其余 409 `ORDER_STATE_INVALID` | AC-019/060 |
| INV-10 | 事务边界 | 下单事务内不调用 LLM/外部 HTTP；Redis 操作在 DB 事务外且失败可回退 | 代码审查 AC-043 |

### 5.1 库存模型（RUNBOOK D7/D8）
- 表 `dish_daily_stock(dish_id, serve_date, total_qty, reserved_qty, sold_qty, inventory_mode)`；`available = total - reserved - sold`。
- 提交：`reserved += qty`（原子条件）；取消/超时：`reserved -= qty`；管理员确认：`reserved -= qty, sold += qty`；完成：不变。
- 流水 `inventory_ledger(id, order_id, dish_id, serve_date, entry_type RESERVE/RELEASE/CONFIRM/ADJUST, qty, before_available, after_available, business_key UNIQUE, created_at, operator)`。
- 模式：`DB_ATOMIC`（默认）/ `REDIS_PREALLOC`（热点菜预占，Redis 失联降级 DB，DB 为最终账本，异步对账）；两模式均经 `InventoryService`。

### 5.2 订单状态机

```text
Pending ──(admin confirm)──> Confirmed ──(admin complete)──> Completed(terminal)
   │
   ├──(employee/admin cancel, reason)──> Cancelled(terminal)
   └──(timeout 30min, system)──────────> Cancelled(terminal, reason=TIMEOUT)
```

## 6. 数据与种子（D1/D20/D21）

| 数据 | 要求 | 验收 |
|---|---|---|
| 账号 | `admin@webox.com / Admin12345`（ADMIN）、`employee@webox.com / Employee123`（EMPLOYEE），BCrypt | AC-004、AC-056 |
| 菜品 | 9 道 PRD 菜（英文名/描述/价格/分类/蛋白/过敏原/辣度/选项）全部入库并上架 | AC-056、AC-009 |
| 扩展菜 | 另 11 道英文菜（凑 20 道，用于分页/列表性能与 20 张图映射） | AC-006、AC-056 |
| 图片 | 20 张 `image_01..20.jpg` 映射种子菜；缺失占位 | AC-029、AC-056 |
| 当日菜单/库存 | 9 道 PRD 菜当日可下单，`total_qty 20~50`；扩展菜按需 | AC-056 |
| 未来菜单 | 次日 + 后天各一批，支撑截单切次日与日期选择 | AC-025、AC-058 |
| 历史订单 | 可选：预置近 7 天样本用于看板趋势与 AI 近 7 天过滤 | AC-042、AC-038 |
| 地址簿 | 员工可保存历史地址（≤200），结算页可选/新增 | AC-013 |

## 7. 非功能要求（数字锚点）

| 维度 | 指标 | 锚点/口径 |
|---|---|---|
| 规模 | 员工 200、菜品 50（种子 20）、订单历史 30 天≈6000 | 容量假设 |
| 峰值 | 70% 午餐订单集中在 09:30–10:00 ≈ 4.7 单/分；按 **10× 预留** 设计 ≈ 1 单/秒，压测 5/10 QPS | RUNBOOK 峰值 + 10x |
| 菜单列表 | P95 ≤200ms（未命中缓存）/ ≤100ms（命中）@50 QPS，50 道菜 | AC-045 |
| 搜索/筛选 | P95 ≤250ms @20 QPS | AC-045 |
| 菜品详情 | P95 ≤150ms @20 QPS | AC-045 |
| 下单提交 | P95 ≤500ms @10 QPS | AC-046 |
| 登录 | P95 ≤300ms @10 QPS | AC-005 |
| 实时库存 | SSE 变化推送 ≤2s；断线 5s 重连/轮询 | AC-036 |
| AI | 首 token ≤3s、总 ≤20s；无 Key 降级 ≤1s 出结果 | AC-039/040 |
| 可用性 | 演示窗口核心路径 5xx=0，SLO 99.5%/月（演示折算）；降级不 500 | AC-058 |
| 并发正确性 | 50 并发抢 10 份 → 成功 10、40 个 409，`available=0` 不为负 | AC-035 |
| 缓存 | 菜单列表/详情 TTL 60s，管理端写操作后 ≤1s 失效；库存不缓存超过 1s | AC-045、AC-030 |
| 分页 | 默认 1/20，`size≤100`；越界 400 | AC-006、AC-048 |
| 输入长度 | 邮箱≤200、地址≤200、搜索≤50、密码 8~64、菜名≤100、描述≤1000、原因≤200 | AC-048 |
| 上传 | 图片 ≤5MB，jpg/png/webp；请求体 ≤1MB（非图片） | AC-029 |
| 限流 | 登录 10 次/分/IP+邮箱；下单 5 次/分/用户；AI 10 次/分/用户；超限 429 `RATE_LIMITED` | AC-049 |
| 多实例 | JWT 无状态、无本地内存正确性依赖、幂等靠 DB 唯一键；演示单实例，设计兼容 | AC-059 |
| 备份恢复 | `scripts/backup.sh`（mysqldump）每日；恢复演练 1 次；RPO≤24h、RTO≤30min | AC-058 |
| 图文/语言 | 用户可见全英文；`¥xx.xx`；375/768/1440 无横向滚动 | AC-052、AC-057 |

## 8. 补充说明 16 条落地（任务清单逐项；RUNBOOK 称“12 条”，以枚举为准全部覆盖）

| # | 要求 | 可验收口径 | AC |
|---|---|---|---|
| S1 | 幂等 | 同 Key 重试 1 单；异体 409；缺失 400；DB 唯一约束 | AC-015 |
| S2 | 唯一有效单 | 生成列唯一索引；重复 409+已有单 ID | AC-026、AC-027 |
| S3 | 原子扣减 | 条件 UPDATE/Redis 预占；影响行数 0 即失败；不为负 | AC-035、AC-043 |
| S4 | 取消只回补一次 | ledger 唯一业务键；重复取消 409 且无二次回补 | AC-019、AC-037 |
| S5 | 截单服务端判定 | 服务端时钟 Asia/Shanghai；六边界；等于即关闭 | AC-024、AC-025 |
| S6 | 金额分 | BIGINT cents；服务端重算；显示两位小数 | AC-016、AC-054 |
| S7 | 订单快照 | 名称/单价/选项/加价/小计冻结 + snapshot_json | AC-055 |
| S8 | 库存策略可配置 | 菜品级 `DB_ATOMIC`/`REDIS_PREALLOC`；统一服务；DB 最终账本 | AC-043 |
| S9 | 库存流水与对账 | ledger 全量流水；对账接口/脚本零漂移；异常告警 | AC-044 |
| S10 | RBAC+数据范围+字段权限+审计 | 角色矩阵、SELF/ALL、敏感字段脱敏、audit_log 可查 | AC-028、AC-032、AC-033、AC-051 |
| S11 | 高风险操作可控 | 二次确认+必填原因+审计+可回滚（改价回滚到前值并再审计） | AC-032 |
| S12 | 偏好事实源与画像软排序/硬过滤 | 显式偏好为准；画像只排序；售罄/过敏原/近 7 天硬过滤 | AC-021、AC-022、AC-038 |
| S13 | AI 实时可配置可交互，先结果后解释 | SSE 事件 `meta→dish→reason→done`；规则热更新/回滚；多轮会话落库 | AC-039、AC-041 |
| S14 | 统一错误码/分页/鉴权/幂等/版本 | `/api/v1`；`{code,message,data,requestId}`；错误码分段；page/size | AC-047、AC-048 |
| S15 | 多实例/限流降级/备份恢复/SLO 告警 | 无状态+唯一约束；429 限流；备份恢复演练；告警阈值文档+health | AC-049、AC-058、AC-059 |
| S16 | 账本对账、限额、审计、告警、补偿 | 对账漂移检测；超卖/超限拦截；审计不可改；ADJUST 补偿流水+原因 | AC-044、AC-032、AC-035 |

## 9. 交付评分卡映射

### 9.1 功能完成度（Tier1 30 + Tier2 20，门槛 45/50；Tier3 +10，封顶 60）
见 §3.1–3.3。扣分口径：非端到端可用该项 0 分；半可用按 50% 上限；Tier3 加分不得用于弥补 Tier1/2 门槛。

### 9.2 前端 5 项（各 4 分）

| 项 | 业务锚点 | 实现要求 | 证据 AC |
|---|---|---|---|
| FE-1 响应式 | PRD §1 手机+电脑 | 375/768/1440 三档：菜单 1/2/3 列、导航可折叠、结算可用、无横向滚动 | AC-052 |
| FE-2 分页/长列表性能 | PRD §3.2 菜品增长/高峰 | 服务端分页（默认 1/20，≤100）；50 道菜滚动无卡顿；筛选/搜索服务端执行；请求去重 | AC-006、AC-045 |
| FE-3 防抖/节流 | PRD §3.3 高峰频繁加购 | 加购 300ms 节流+在途禁用；提交按钮禁用+同一幂等键；连点不重复 | AC-053、AC-015 |
| FE-4 价格精度 | PRD §3.2 精确到分 | 全链路整数分；展示 `¥xx.xx`；选项加价实时；无浮点误差 | AC-010、AC-054 |
| FE-5 输入校验 | PRD §3.1/§3.2 | 注册邮箱/密码、地址≤200、搜索≤50、原因≤200 前后端一致 | AC-003、AC-008、AC-048 |

### 9.3 后端 5 项（各 4 分）

| 项 | 业务锚点 | 实现要求 | 证据 AC |
|---|---|---|---|
| BE-1 缓存 | 09:30–10:00 高峰+菜单高频 | 菜单列表/详情缓存 TTL 60s；管理端写后 ≤1s 失效；库存 1s 内一致；无脏读 | AC-045、AC-030 |
| BE-2 幂等 | PRD §3.4 连续点击只 1 单 | Idempotency-Key+用户唯一约束；同体重放、异体 409；并发安全 | AC-015 |
| BE-3 SQL 注入防护 | PRD §3.2 搜索 | 全参数化/预编译；LIKE 转义；注入串 200 空结果不 500 | AC-008 |
| BE-4 权限 | PRD §1/§3.1/§4.3 | JWT+URL/方法级授权；员工 Console 403；本人订单隔离；401/403 区分 | AC-028、AC-051 |
| BE-5 并发/防超卖 | PRD §5.1 | 条件 UPDATE；50 并发抢 10 成功 10；库存不为负；取消只回补一次 | AC-035、AC-019 |

## 10. 假设与默认决策（完整表见 `docs/raw/assumptions.md`）

**D1–D22 全部采纳，无修改**；以下补充可执行口径（不改变决策方向）：

| 决策 | 补充口径 | 影响 |
|---|---|---|
| D1 种子账号 | 注册接口忽略/拒绝 role=ADMIN；管理员仅种子 | 安全 |
| D2 时区 | 服务端强制 Asia/Shanghai；DB/连接时区一致 | 截单 |
| D3 截单 | 等于截单点即关闭；未来日期不触发当日截单；切次日须有菜单 | AC-024/025 |
| D4 状态机 | 增加 Pending 30 分钟超时（A-03，P2）；Confirmed 不可取消 | AC-060 |
| D5 唯一单 | 409 `ORDER_DUPLICATE` + `existingOrderId`；仅 Pending/Confirmed 占用 | AC-026 |
| D6 幂等 | 必填头，缺失 400；保留 24h；并发用唯一约束 | AC-015 |
| D7 库存 | `available=total-reserved-sold`；两模式均经 InventoryService | AC-043 |
| D8 占用时点 | 提交占用、取消释放、确认转 sold | AC-014/019 |
| D9 快照 | 明细字段 + snapshot_json | AC-055 |
| D10 选项 | 必选组校验、选项归属校验、DB 价重算 | AC-010 |
| D11 过敏原 | 前端提醒、后端不阻断、AI 硬过滤 | AC-021/038 |
| D12 偏好 | 显式偏好事实源；画像仅软排序；硬过滤=售罄/过敏/近 7 天 | AC-022/038 |
| D13 为我推荐 | 软排序+高亮；关闭恢复稳定默认序 | AC-022 |
| D14 预算 | 仅提示、不阻断 | AC-023 |
| D15 权限 | EMPLOYEE/ADMIN；`/admin/**` 403；audit_log | AC-028/032/033 |
| D16 高风险 | confirm+reason+audit；改价可回滚 | AC-032 |
| D17 实时库存 | SSE `/api/v1/menu/stream`；失败 5s 轮询；事件仅 dishId/available | AC-036 |
| D18 AI | 确定性候选过滤；SSE；无 Key 降级；规则表可调/回滚 | AC-038~041 |
| D19 分页/错误码 | 统一 envelope 与错误码分段 | AC-047/048 |
| D20 图片 | 20 张映射；缺失占位 | AC-029/056 |
| D21 种子 | 当日 9 菜上架、库存 20~50；未来 1~2 天 | AC-056 |
| D22 支付 | 不实现支付/退款；取消仅库存+状态 | AC-019/020 |

## 11. 待确认项与风险（详见 assumptions §5）

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | 2 小时时间盒下 Tier3 存在未完成风险（概率高） | 加分少 | 先保 Tier1/2 端到端；Tier3 按 4/3/3 增量做 |
| R2 | 现场无 LLM Key | AI 真实效果无法验证 | 规则降级可演示；真实模型标 NOT TESTED |
| R3 | Redis 不可用 | 热点预占失效 | 自动降级 DB_ATOMIC，禁止 500 |
| R4 | 截单边界难以在真实时钟精确触发 | 边界漏测 | 服务注入 Clock，JUnit 固定时间；E2E 用未来菜单 |
| R5 | 低库存/售罄演示与 D21“库存 20~50”冲突 | 演示状态缺失 | 用管理员改库存到 3/0 后演示，再恢复 |
| R6 | 管理员订单处理范围未在 PRD 明确 | 范围多做/少做 | 仅实现 Confirm/Complete/Cancel(Pending)，P2 |
| R7 | “12 条补充说明”与实际枚举 16 项不一致 | 漏项 | 按 16 项全部覆盖（§8） |

## 12. 语言 / 货币 / 时区
- 用户可见文案：**英文**（界面/按钮/菜单数据/错误/Toast/AI 理由/看板）；代码注释可用中文。
- 货币：人民币，符号 `¥`，展示 `¥22.50`；存储整数分（BIGINT）。
- 时区：`Asia/Shanghai`；日期展示 `YYYY-MM-DD`；服务端时钟为唯一判据。
- 设备：手机 + 桌面响应式；API 前缀 `/api/v1`。

## 13. G1 自检（本节点）

| 检查项 | 结论 | 证据 |
|---|---|---|
| Tier1/2/3 分层完整且可映射评分卡 | PASS | §3 + §9，分值 30/20/+10 |
| GWT 覆盖核心规则与失败模式（并发/幂等/截单边界） | PASS | acceptance-matrix AC-001~060；§4/§5 |
| NFR 有数字锚点 | PASS | §7（P95/QPS/上限/限流） |
| 假设/默认决策齐全且与 RUNBOOK 一致 | PASS | §10 + assumptions.md（D1–D22） |
| 场景 required_checks 已映射 | PASS | scenario-profile v2 §2–§5 |
| 补充说明全部落地 | PASS | §8（S1–S16，16/16） |
| 语言英文 / 金额整数分口径 | PASS | §12、INV-1、AC-054/057 |
| 每条规则有可执行判定（数值/状态/错误码） | PASS | §4 全量含错误码与边界 |

---

# 验收矩阵 — WeBox 员工餐食订购平台

- 版本：v1.0（Stage 1 产品工程师，2026-11-14 21:53 CST）
- 上游：`docs/raw/prd-analysis.md`、`docs/raw/scenario-profile.md` v2、`RUNBOOK.md` D1–D22
- 编号：**AC-001 … AC-060**（Tier1 19 条 / Tier2 14 条 / Tier3 11 条 / NFR+不变量 16 条）
- 口径：每条 AC 必须可按“验证方式”复现；PASS 必须附证据路径；未执行标 `NOT TESTED`；Tier3 未实现标 `N/A（Tier 3 未实现）`。

## 0. 使用说明

| 字段 | 取值 |
|---|---|
| 优先级 | P0=主链路/资损/安全；P1=规则/权限；P2=增强；P3=Tier3 加分 |
| 验证方式 | `API`（curl/接口测试）、`E2E`（agent-browser）、`DB`（SQL 断言）、`CONC`（并发脚本）、`SHOT`（截图）、`REV`（代码/配置/日志审查）、`DOC`（文档/文件核对） |
| 阶段 | `S4-BE` 后端开发、`S4-FE` 前端开发、`S5-Test` 测试执行、`S5-产品` 产品验收抽查 |
| 评分卡锚点 | `T1-*`/`T2-*`/`T3-*` 功能分；`FE-1..5` 前端 5 项；`BE-1..5` 后端 5 项 |

## 1. Tier 1 核心（必做，30 分）

| ID | P | 角色 | Given-When-Then（可执行判定） | 验证 | 评分卡 | 阶段 |
|---|---|---|---|---|---|---|
| AC-001 | P0 | 访客 | **Given** 新邮箱 `u001@test.com` 未注册；**When** POST `/api/v1/auth/register`（email、password=`Abc12345`）；**Then** 201，返回用户 id/role=`EMPLOYEE`，DB `password_hash` 以 `$2` 开头且无明文，响应不含密码 | API+DB | T1-AUTH/FE-5 | S4-BE/S4-FE/S5-Test |
| AC-002 | P0 | 访客 | **Given** `u001@test.com` 已注册；**When** 同邮箱（含大小写变体 `U001@test.com`）再注册；**Then** 409 `AUTH_EMAIL_EXISTS`，用户数不变 | API+DB | T1-AUTH | S4-BE/S5-Test |
| AC-003 | P0 | 访客 | **Given** 注册表单；**When** 分别提交 非法邮箱、7 位密码、纯字母密码、201 字符邮箱；**Then** 均 400 `VALIDATION_EMAIL_FORMAT`/`VALIDATION_PASSWORD_POLICY`/`VALIDATION_EMAIL_LENGTH`；**且** 8 位含字母数字通过 201 | API | T1-AUTH/FE-5 | S4-BE/S4-FE/S5-Test |
| AC-004 | P0 | 员工/管理员 | **Given** 已注册；**When** 正确密码登录；**Then** 200 返回 JWT（`EMPLOYEE`）；浏览器刷新后 `/api/v1/auth/me` 仍 200；**And** 种子 `admin@webox.com/Admin12345` 登录 role=`ADMIN` | API+E2E | T1-AUTH | S4-BE/S4-FE/S5-Test |
| AC-005 | P0 | 员工 | **Given** 账号存在；**When** 连续 10 次错误密码后第 11 次尝试；**Then** 前 10 次 401 `AUTH_INVALID_CREDENTIALS`，第 11 次 429 `RATE_LIMITED`；正确密码登录 P95≤300ms | API | T1-AUTH/BE-4 | S4-BE/S5-Test |
| AC-006 | P0 | 员工 | **Given** 当日 20 道菜上架；**When** GET `/api/v1/menu?page=1&size=20`；**Then** 200，20 条卡片含 id/name/imageUrl/priceCents(整数)/priceDisplay(`^¥\d+\.\d{2}$`)/category/spiceLevel，`total≥9`，`page=1,size=20`；**And** `size=101` → 400 `VALIDATION_PAGINATION`；P95≤200ms | API+E2E | T1-MENU/FE-2/FE-4/BE-1 | S4-BE/S4-FE/S5-Test |
| AC-007 | P0 | 员工 | **Given** 菜品含 Chinese/Japanese/Western；**When** `category=Chinese,Japanese` 且 `category=Japanese,Western` 分别请求；**Then** 仅返回所选分类并集，数量等于 DB `IN` 计数；非法分类 → 400 `VALIDATION_CATEGORY` | API+DB | T1-MENU/FE-2 | S4-BE/S4-FE/S5-Test |
| AC-008 | P0 | 员工 | **Given** 菜品 Kung Pao Chicken 描述含 chicken；**When** 搜索 `CHICKEN`；**Then** 命中名称或描述（大小写不敏感）；**And** 搜索 `' OR 1=1--` 返回 200 空/正常结果、非 500 且无 SQL 报错；**And** 51 字符关键词 → 400 `VALIDATION_SEARCH_LENGTH` | API+DB | T1-MENU/FE-5/BE-3 | S4-BE/S4-FE/S5-Test |
| AC-009 | P0 | 员工 | **Given** 菜品 Classic Beef Burger；**When** GET 详情；**Then** 返回 description/protein/allergens（枚举内）/spiceLevel∈{None,Mild,Medium,Hot}；选项组 Bun(required, Plain/Whole Wheat)、Sauce(required)、Add-ons(optional, Cheese+¥3/Bacon+¥5/Egg+¥2)；价格均整数分 | API | T1-MENU/FE-4 | S4-BE/S5-Test |
| AC-010 | P0 | 员工 | **Given** Burger 基础价 ¥38.00；**When** 选 Whole Wheat+Sauce=Mustard+Cheese(+¥3)；**Then** 前端显示 ¥41.00 且 API 价格同；**And** 提交其他菜品的 optionId → 400 `VALIDATION_OPTION_INVALID`；必选组缺失 → 400 `VALIDATION_OPTION_REQUIRED` | API+E2E | T1-MENU/FE-4 | S4-BE/S4-FE/S5-Test |
| AC-011 | P0 | 员工 | **Given** 空购物车；**When** 同菜同配置加购 2 次，再加同菜不同配置 1 次；**Then** 购物车 2 行（配置 A×2、配置 B×1），每行展示选项名，总价=Σ(单价+加价)×数量（分），无浮点尾差 | E2E+API | T1-CART/FE-4 | S4-FE/S5-Test |
| AC-012 | P0 | 员工 | **Given** 购物车 2 行；**When** 第 1 行 +、−、删除第 2 行；**Then** 数量与总价实时正确；减到 0 该行移除；全空显示空态且总价 ¥0.00；刷新后购物车仍存在（本地持久化） | E2E | T1-CART | S4-FE/S5-Test |
| AC-013 | P1 | 员工 | **Given** 购物车有 2 份；**When** GET `/api/v1/orders/preview`；**Then** 返回明细（名/选项/数量/小计/总价 cents）、`effectiveDate`（默认今日）、`effectiveMeal`、`cutoffAt`、`autoSwitched`、`budgetExceeded`、地址簿列表；地址新增 >200 字符 → 400 `VALIDATION_ADDRESS_LENGTH` | API+E2E | T1-ORDER/T2-RULE | S4-BE/S4-FE/S5-Test |
| AC-014 | P0 | 员工 | **Given** 有效购物车与地址；**When** POST `/api/v1/orders`（Idempotency-Key）；**Then** 201，`orderNo` 匹配 `^WB\d{8}-\d{4,}$`，status=`Pending`，`totalCents`=服务端重算，快照含每行 dishName/unitPriceCents/options/qty/subtotal，`snapshot_json` 非空；DB 库存 `reserved+qty`；`inventory_ledger` 恰 1 条 `RESERVE` | API+DB | T1-ORDER/BE-2 | S4-BE/S5-Test |
| AC-015 | P0 | 员工 | **Given** 同一 `Idempotency-Key=K1` 与同一请求体；**When** 并发 5 次 + 串行再 2 次提交；**Then** DB 仅 1 个订单，7 次响应 `orderId` 相同；**And** 同 K1 改数量 → 409 `IDEMPOTENCY_CONFLICT`；**And** 缺头 → 400 `IDEMPOTENCY_KEY_REQUIRED`；库存只扣 1 次 | CONC+DB | T1-ORDER/BE-2 | S4-BE/S5-Test |
| AC-016 | P0 | 员工 | **Given** DB 单价 ¥22.00；**When** 请求体附带伪造 `priceCents=1`（或下单前管理员改价 ¥25.00）；**Then** 订单 `totalCents` 以 DB 实时单价重算（¥25.00×qty），伪造字段被忽略/400，客户端 total 不参与结算 | API+DB | T1-ORDER/FE-4 | S4-BE/S5-Test |
| AC-017 | P0 | 员工 | **Given** 员工 A 有 2 单、员工 B 有 1 单；**When** A GET `/api/v1/orders` 与 B 的订单 id；**Then** 列表仅 A 的 2 单（倒序）；B 的单 → 404 `ORDER_NOT_FOUND`（或 403 `FORBIDDEN`）；详情含选项/数量/小计/总价/状态 | API+DB | T1-ORDER/BE-4 | S4-BE/S5-Test |
| AC-018 | P0 | 员工 | **Given** Pending 订单含 2 份菜、库存 available=10；**When** 取消一次；**Then** 200，status=`Cancelled`、`cancelledAt` 非空，available=12，ledger 仅 1 条 `RELEASE`；**When** 再取消；**Then** 409 `ORDER_STATE_INVALID`，available 仍 12、无第 2 条 RELEASE | API+DB | T1-ORDER/BE-5/T3-STOCK | S4-BE/S5-Test |
| AC-019 | P0 | 员工/管理员 | **Given** 订单 status=`Confirmed`；**When** 员工取消 / 管理员取消；**Then** 均 409 `ORDER_STATE_INVALID`，状态与库存不变（ASSUMED A-02） | API | T1-ORDER | S4-BE/S5-Test |

## 2. Tier 2 进阶（20 分）

| ID | P | 角色 | Given-When-Then（可执行判定） | 验证 | 评分卡 | 阶段 |
|---|---|---|---|---|---|---|
| AC-020 | P0 | 员工 | **Given** 购物车已有 4 份；**When** 再加 1 份后尝试第 6 份；**Then** 第 6 次 Add/`+` 禁用并提示英文上限原因；直接 API 提交 6 份 → 400 `ORDER_LIMIT_EXCEEDED`；3+3 组合同样拒绝；5 份允许提交 | E2E+API | T2-RULE | S4-BE/S4-FE/S5-Test |
| AC-021 | P1 | 员工 | **Given** 员工过敏原=`Egg`；**When** 加购 Korean Bibimbap（Egg,Soy）；**Then** 弹窗含 `allergen` 与 `Egg`，确认后菜品进入购物车；菜单/搜索仍可见该菜；API 加购/下单不因过敏原阻断；未标记过敏原用户无弹窗 | E2E+API | T2-PREF | S4-FE/S5-Test |
| AC-022 | P1 | 员工 | **Given** 偏好菜系=`Japanese`、辣度=`Mild`；**When** 开启 `For You`；**Then** 匹配菜排序靠前且有高亮标记，非匹配菜仍展示；**When** 关闭；**Then** 恢复稳定默认序（上架时间倒序+id）；两次结果集合相同，仅顺序/样式不同 | API+E2E+DB | T2-PREF/FE-2 | S4-BE/S4-FE/S5-Test |
| AC-023 | P1 | 员工 | **Given** 单餐预算上限 ¥15.00；**When** 购物车总额 ¥22.00 进入结算；**Then** `budgetExceeded=true` 且页面展示提示；**And** Place Order 仍 201（不阻断）；未设预算/未超限无提示 | API+E2E | T2-PREF | S4-BE/S4-FE/S5-Test |
| AC-024 | P0 | 员工 | **Given** 服务端时钟 Asia/Shanghai 固定；**When** 分别于 09:59:59 / 10:00:00 / 10:01:00 提交“当日 Lunch”；**Then** 09:59:59→Lunch；10:00:00 与 10:01→Dinner（`autoSwitched=true`，响应回有效餐次）；库存/唯一单按生效餐次判定 | API+DB | T2-RULE | S4-BE/S5-Test |
| AC-025 | P0 | 员工 | **Given** 同上；**When** 14:59:59 / 15:00:00 / 15:01 提交“当日 Dinner”，以及 16:00 提交“次日 Lunch”；**Then** 14:59:59→当日 Dinner；15:00:00/15:01→次日 Lunch（autoSwitched）；16:00 次日 Lunch 正常；过去日期 → 400 `VALIDATION_DATE_PAST` | API+DB | T2-RULE | S4-BE/S5-Test |
| AC-026 | P0 | 员工 | **Given** 员工已有当日 Lunch 的 Pending 单；**When** 结算页加载并再次提交同日同餐次；**Then** 主按钮显示 `View Existing Order` 并跳转；直接 POST → 409 `ORDER_DUPLICATE` 且 `data.existingOrderId` 为已有单；订单数不变、库存不再扣减 | API+E2E+DB | T2-RULE/BE-5 | S4-BE/S4-FE/S5-Test |
| AC-027 | P1 | 员工 | **Given** 已有当日 Lunch 有效单；**When** 下当日 Dinner、次日 Lunch；**Then** 均 201；**When** 取消 Lunch 单后再下同日 Lunch；**Then** 201（Cancelled 不占用唯一键） | API+DB | T2-RULE | S4-BE/S5-Test |
| AC-028 | P0 | 员工/管理员 | **Given** 员工 JWT；**When** GET `/api/v1/admin/dishes`、访问 `/console`；**Then** API 403 `FORBIDDEN`，Console 路由不渲染管理功能；管理员同请求 200；未登录 → 401 `AUTH_UNAUTHORIZED` | API+E2E | T2-CONSOLE/BE-4 | S4-BE/S4-FE/S5-Test |
| AC-029 | P1 | 管理员 | **Given** 管理员已登录；**When** 新增菜品（含 jpg≤5MB）、按名称搜索、按分类筛选、编辑描述/过敏原；**Then** 列表与员工端同步；上传 >5MB/非图片 → 400 `VALIDATION_IMAGE`；无图显示占位图不裂图 | API+E2E | T2-CONSOLE/FE-5 | S4-BE/S4-FE/S5-Test |
| AC-030 | P0 | 管理员 | **Given** 菜品 ON_SHELF；**When** 下架；**Then** 员工列表不含、详情 404；**When** 上架；**Then** 恢复可见；管理端写后 ≤1s 前端可见（缓存失效） | API+DB+E2E | T2-CONSOLE/BE-1 | S4-BE/S5-Test |
| AC-031 | P1 | 管理员 | **Given** 菜品 X；**When** 设置当日菜单且 `total_qty=30`，设置次日菜单；**Then** 员工当日/次日菜单出现该菜且剩余 30；未配置日期不出现；`total_qty=0` 显示 `Sold out` 且不可下单；管理端修改后员工端反映 | API+DB+E2E | T2-CONSOLE/T3-STOCK | S4-BE/S4-FE/S5-Test |
| AC-032 | P0 | 管理员 | **Given** 菜品价 ¥22.00；**When** 改价 ¥25.00 但缺 reason/confirm；**Then** 400 `VALIDATION_REASON_REQUIRED`；**When** 携带 confirm+reason=`price adjustment`；**Then** 200，`audit_log` 有 actor/action/object/before=2200/after=2500/reason/ip/time；**When** 回滚到 ¥22.00；**Then** 产生第 2 条审计且当前价为 2200 | API+DB | T2-CONSOLE/BE-4 | S4-BE/S5-Test |
| AC-033 | P1 | 管理员/员工 | **Given** 管理员查看订单列表；**When** 列表与详情对比；**Then** 列表地址脱敏、详情完整；员工仅见本人完整地址；任何响应/审计/日志不含 password_hash 或 token；员工访问 `/admin/orders` → 403 | API+REV | T2-CONSOLE/BE-4 | S4-BE/S5-Test |

## 3. Tier 3 挑战（+10，可选）

| ID | P | 角色 | Given-When-Then（可执行判定） | 验证 | 评分卡 | 阶段 |
|---|---|---|---|---|---|---|
| AC-034 | P2 | 员工 | **Given** 菜品剩 3 份/0 份；**When** 查看菜单；**Then** 分别显示 `Only 3 left` 视觉强调 / `Sold out` 且 Add 禁用；0 份直接提交 → 409 `STOCK_INSUFFICIENT` 且返回 dishId/requested/available | API+E2E+SHOT | T3-STOCK | S4-BE/S4-FE/S5-Test |
| AC-035 | P0 | 50 并发员工 | **Given** 菜品 available=10；**When** 50 个不同用户并发提交各 1 份；**Then** 恰 10 个 201、40 个 409 `STOCK_INSUFFICIENT`；DB `available=0` 且 `reserved+sold≤total`，无负值；ledger 汇总与库存一致 | CONC+DB | T3-STOCK/BE-5 | S4-BE/S5-Test |
| AC-036 | P2 | 员工 | **Given** 两名员工同时打开菜单；**When** A 下单 1 份；**Then** B 页面 ≤2s 内库存减 1（SSE `/api/v1/menu/stream`，事件含 dishId/available），无需刷新；断线 5s 内重连；SSE 不可用时 5s 轮询仍更新 | API+E2E | T3-STOCK/BE-1 | S4-BE/S4-FE/S5-Test |
| AC-037 | P2 | 员工 | **Given** 菜品取消前 available=7；**When** 取消含 1 份的 Pending 单；**Then** available=8，其他客户端 ≤2s 看到；售罄菜恢复为 1 后 Add 可用 | API+E2E+DB | T3-STOCK | S4-BE/S5-Test |
| AC-038 | P2 | 员工 | **Given** 用户过敏原 Egg、昨日已点 Bibimbap、菜 X 售罄；**When** 调 AI 推荐；**Then** 响应 dishIds 不含含 Egg 菜、Bibimbap、售罄菜；模型返回候选集外 dishId 被服务端丢弃；所有推荐菜均在候选集且价格取 DB | API+DB | T3-AI | S4-BE/S5-Test |
| AC-039 | P2 | 员工 | **Given** 已配置 Key；**When** 输入 `I want something light today`；**Then** SSE 事件顺序 `meta→dish(卡片)→reason(理由)→done`，首事件 ≤3s、总 ≤20s；卡片可直接加购成功 201；关闭网络后重试有明确错误/降级 | API+E2E | T3-AI | S4-BE/S4-FE/S5-Test |
| AC-040 | P2 | 员工 | **Given** 未设置 `LLM_API_KEY`；**When** 请求 AI 推荐；**Then** 200 SSE（`fallback:true`）且页面标注 `rule-based fallback`，仍返回过滤后的候选菜；无 500/白屏 | API+E2E | T3-AI | S4-BE/S4-FE/S5-Test |
| AC-041 | P2 | 管理员/员工 | **Given** 规则表权重 `spice=1`；**When** 改为 3 并保存；**Then** ≤60s 生效无需重启；**When** 回滚；**Then** 恢复旧版本；`ai_conversation` 记录 user/prompt/response/dishes；DB/日志/前端包 grep 无 API Key | API+DB+REV | T3-AI/BE-4 | S4-BE/S5-Test |
| AC-042 | P2 | 管理员 | **Given** DB 有今日订单；**When** 打开看板并刷新；**Then** 今日订单数/收入/Completed/Pending/Cancelled 与 DB 聚合一致；Top10 按销量降序；Lunch/Dinner 对比；近 7 天趋势点数=7；低库存 ≤3 列表与库存一致；新增 1 单后刷新 +1 | API+DB+E2E+SHOT | T3-DASH | S4-BE/S4-FE/S5-Test |
| AC-043 | P2 | 员工 | **Given** 菜 A=`DB_ATOMIC`、菜 B=`REDIS_PREALLOC`；**When** 分别并发下单；**Then** 两者成功数=库存数；停掉 Redis 后 B 仍可正确下单（降级 DB），无 500/超卖；DB 为最终账本 | API+CONC+REV | T3-STOCK/BE-1/BE-5 | S4-BE/S5-Test |
| AC-044 | P2 | 管理员 | **Given** 完成下单/取消/确认/调整；**When** 运行对账接口/脚本；**Then** `available` 与 ledger 推导值零漂移；人工制造 1 份差异 → 对账返回 `drift=1` 并告警/审计，补偿写 `ADJUST` 流水（含原因）后归零 | API+DB | T3-STOCK | S4-BE/S5-Test |

## 4. NFR、安全与不变量（16 条）

| ID | Tier | P | 角色 | Given-When-Then（可执行判定） | 验证 | 评分卡 | 阶段 |
|---|---|---|---|---|---|---|---|
| AC-045 | T1/T2 | P0 | 系统 | **Given** 50 道菜与预热缓存；**When** 50 QPS 持续 60s 查菜单/筛选/搜索；**Then** 列表 P95≤200ms（缓存命中≤100ms）、搜索 P95≤250ms、详情≤150ms，5xx=0；管理端改菜后 ≤1s 读到新数据 | CONC+API | BE-1/FE-2 | S5-Test |
| AC-046 | T1 | P0 | 系统 | **Given** 200 用户与当日库存充足；**When** 10 QPS 提交订单 60s（不同用户/幂等键）；**Then** P95≤500ms，5xx=0，订单数=成功响应数，库存守恒 | CONC+DB | T1-ORDER/BE-2/BE-5 | S5-Test |
| AC-047 | 全部 | P0 | 系统 | **Given** 触发 400/401/403/404/409/429/500；**When** 检查响应；**Then** 统一 `{code,message,data,requestId}`，HTTP 状态与 code 段匹配，无堆栈/SQL/密钥泄漏 | API | BE-3/BE-4 | S4-BE/S5-Test |
| AC-048 | T1/T2 | P0 | 系统 | **Given** 超长输入；**When** email=201、address=201、search=51、reason=201、password=65；**Then** 均 400 且 `data.field` 指向字段；边界值 200/200/50/200/64 通过 | API | FE-5/BE-4 | S4-BE/S5-Test |
| AC-049 | T1/T2 | P1 | 系统 | **Given** 限流阈值；**When** 登录 11 次/分、下单 6 次/分/用户、AI 11 次/分/用户；**Then** 超限 429 `RATE_LIMITED`，未超限正常 | API | BE-4 | S4-BE/S5-Test |
| AC-050 | 全部 | P0 | 系统 | **Given** 源码/日志/响应/文档；**When** 执行 grep 明文密码、`Authorization` 日志、Key；**Then** 无命中；DB 密码 `$2` 开头；前端构建产物无 API Key | REV+DB | BE-3/BE-4 | S4-BE/S5-Test |
| AC-051 | T1/T2 | P0 | 员工 | **Given** 员工 A/B；**When** A 读/取消 B 的订单、改 B 地址、篡改 JWT；**Then** 前两者 404/403 且数据不变，篡改 token 401 `AUTH_TOKEN_INVALID` | API+DB | BE-4 | S4-BE/S5-Test |
| AC-052 | 全部 | P1 | 员工 | **Given** 375×812 / 768×1024 / 1440×900；**When** 打开菜单、详情、购物车、结算、我的订单；**Then** 无横向滚动，菜单 1/2/3 列，操作可达，截图留证 | SHOT | FE-1 | S4-FE/S5-产品 |
| AC-053 | T1 | P1 | 员工 | **Given** 菜单页；**When** 500ms 内连点 Add 10 次；**Then** 加购请求 ≤2 且购物车数量=成功请求数（无重复加购）；**When** 间隔 1s 点击 5 次；**Then** 数量=5；**And** 结算页连点提交 10 次仅 1 单（按钮禁用+幂等） | E2E+DB | FE-3/BE-2 | S4-FE/S5-Test |
| AC-054 | T1/T2 | P0 | 系统 | **Given** 订单含 ¥35.80 主菜 + ¥3.00 加料 ×2；**When** 计算并展示；**Then** API `totalCents=7760`（整数），页面 `¥77.60`，DB 为 BIGINT，全链路无 float/double；所有金额正则 `^¥\d+\.\d{2}$` | API+DB+REV | FE-4 | S4-BE/S4-FE/S5-Test |
| AC-055 | T1 | P0 | 员工 | **Given** 订单已创建（Kung Pao ¥22.00）；**When** 管理员改名为 `Kung Pao Chicken Deluxe`、改价 ¥25.00；**Then** 历史订单详情仍显示原名/¥22.00/原子项；新订单显示新值；DB 快照字段与 snapshot_json 均冻结 | API+DB | T1-ORDER | S4-BE/S5-Test |
| AC-056 | 全部 | P0 | 系统 | **Given** 全新环境按 README 启动；**When** 检查种子；**Then** 当日 ≥9 道 PRD 菜上架、库存 20~50、未来 1~2 天菜单存在；20 张图片文件映射且可访问；`admin@webox.com`/`employee@webox.com` 可登录；当天可直接完成 1 单 | API+DB+DOC | T1/T2 | S4-BE/S5-Test |
| AC-057 | 全部 | P1 | 员工/管理员 | **Given** 全部页面；**When** 扫描用户可见文案；**Then** 均为英文（无中文可见字符，菜单/错误/Toast/AI/看板一致），金额 `¥xx.xx` | E2E+REV | FE-4 | S4-FE/S5-产品 |
| AC-058 | 全部 | P1 | 运维 | **Given** 运行中系统；**When** GET `/api/v1/health`；**Then** 200 含 db（+redis 可选）状态；执行 `scripts/backup.sh` 后用备份恢复到临时库，核心表行数一致；告警阈值文档含 5xx>1%/5min、P95>1s、库存漂移>0 | API+DB+DOC | T1/T2 | S4-BE/S5-Test |
| AC-059 | 全部 | P2 | 架构 | **Given** 代码与配置；**When** 审查多实例兼容；**Then** JWT 无状态、无本地内存正确性依赖、幂等/限流/唯一性依赖 DB 唯一键或 Redis；双实例实跑记为 `N/A（时间盒，设计兼容）`，不得虚报 PASS | REV | BE-2/BE-4 | S5-产品/S5-Test |
| AC-060 | T2 | P2 | 系统 | **Given** Pending 单创建；**When** 30 分钟未确认（测试可注入时钟）；**Then** 定时任务置 Cancelled（reason=`TIMEOUT`），库存释放 1 次且仅 1 条 RELEASE；重复任务执行无二次回补；未实现则标 `NOT TESTED` | API+DB | T2-RULE | S4-BE/S5-Test |

### 4.1 G3 追加（2026-11-14 22:10 CST，产品工程师）

> 仅追加，**不改变 AC-001~060 任何语义**。来源：G1 测试评审 M8（`docs/raw/review-findings.md`）+ `cross-review-g3-product.md`。

| ID | Tier | P | 角色 | Given-When-Then（可执行判定） | 验证 | 评分卡 | 阶段 |
|---|---|---|---|---|---|---|---|
| AC-061 | T1 | P0 | 访客 | **Given** 新邮箱未注册且系统仅 1 个种子 ADMIN；**When** POST `/api/v1/auth/register`，请求体额外携带 `role:"ADMIN"`（或 `"roles":["ADMIN"]`）；**Then** 二选一且仅需满足其一：① 400 `VALIDATION_ROLE`（严格拒绝未知/禁止字段），或 ② 201 但响应 `role="EMPLOYEE"`（字段被忽略）；**And** 两种情况 DB 中 ADMIN 用户数均不变，新用户角色必为 `EMPLOYEE`；**And** 响应/日志不含密码 | API+DB | T1-AUTH/BE-4 | S4-BE/S5-Test |

## 5. 覆盖统计与追溯

| 层级 | 条数 | 编号 | 门槛 |
|---|---|---|---|
| Tier 1 | 19 | AC-001~019 | 全部 P0/P1 端到端 |
| Tier 2 | 14 | AC-020~033 | 全部 P0/P1 端到端 |
| Tier 3 | 11 | AC-034~044 | 可选；未实现标 N/A |
| NFR/安全/不变量 | 16 | AC-045~060 | P0 必须 PASS（AC-059/060 可 N/A/NOT TESTED） |
| **合计** | **60** | AC-001~060 | Tier1/2 ≥45/50 |
| G3 追加 | 1 | AC-061（Tier1 P0，注册提权向量） | P0 必须 PASS；计入 Tier1（现 20 条） |

### 5.1 场景 required_check → AC

| 场景检查 | AC |
|---|---|
| TO-1 金额整数分/服务端重算 | AC-014、AC-016、AC-054 |
| TO-2 不超卖 | AC-035、AC-043 |
| TO-3 提交占用/只回补一次 | AC-014、AC-018、AC-019、AC-037、AC-060 |
| TO-4 幂等 | AC-015 |
| TO-5 唯一有效单 | AC-026、AC-027 |
| TO-6 状态机 | AC-019、AC-020、AC-060 |
| TO-7 截单/自动切换 | AC-024、AC-025 |
| TO-8 订单快照 | AC-055 |
| IA-1 密码哈希/无明文 | AC-001、AC-050 |
| IA-2 Console 403 | AC-028 |
| IA-3 角色矩阵 | AC-017、AC-028~033、AC-042 |
| IA-4 输入校验 | AC-003、AC-008、AC-048 |
| IA-5 限流/401/403 | AC-005、AC-049 |
| IA-6 审计 | AC-032、AC-018 |
| IA-7 横向越权 | AC-017、AC-051 |
| AI-1~6 | AC-038~041、AC-050 |
| GE-1~7 | AC-045~060、AC-056~058 |

### 5.2 评分卡 → AC

| 评分项 | AC |
|---|---|
| T1-AUTH / T1-MENU / T1-CART / T1-ORDER | AC-001~019 |
| T2-PREF / T2-RULE / T2-CONSOLE | AC-020~033 |
| T3-STOCK / T3-AI / T3-DASH | AC-034~044 |
| FE-1 响应式 | AC-052 |
| FE-2 分页/列表性能 | AC-006、AC-007、AC-022、AC-045 |
| FE-3 防抖/节流 | AC-053、AC-015 |
| FE-4 价格精度 | AC-006、AC-010、AC-011、AC-016、AC-054、AC-057 |
| FE-5 输入校验 | AC-003、AC-008、AC-029、AC-048 |
| BE-1 缓存 | AC-006、AC-030、AC-036、AC-043、AC-045 |
| BE-2 幂等 | AC-014、AC-015、AC-046、AC-053 |
| BE-3 SQL 注入防护 | AC-008、AC-047、AC-050 |
| BE-4 权限 | AC-005、AC-017、AC-028、AC-032、AC-033、AC-047、AC-049~051 |
| BE-5 并发/防超卖 | AC-018、AC-026、AC-035、AC-043、AC-046 |

## 6. 执行约定

1. 测试按 AC 编号建用例，结果回填 `PASS/FAIL/N/A/NOT TESTED` + 证据路径（`artifacts/` 下）。
2. P0 FAIL 直接进 `docs/raw/defect-log.md`，按缺陷闭环回到 Stage 4 修复；GO 前无 open P0/P1。
3. 并发类 AC（015/035/043/046）必须保留原始输出与 DB 前后快照。
4. 截单类 AC（024/025/060）必须说明时钟注入方式；无固定时钟证据不得判 PASS。
5. Tier3 未实现：AC-034~044 一律 `N/A（Tier 3 未实现）`，不计分、不占门槛。