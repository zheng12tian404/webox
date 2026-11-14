# RUNBOOK — WeBox 员工餐食订购平台（2 小时自主交付）

## 0. 时间盒

| 项 | 值 |
|---|---|
| 主 Issue | `6343a752-e110-407c-8dfb-a5873425d917` |
| T0 | **2026-11-14 21:45:00 CST** |
| 硬截止 T+120 | **2026-11-14 23:45:00 CST** |
| 代码软冻结 T+95 | 23:20（停止新增功能） |
| 代码硬冻结 T+100 | 23:25（只允许修 P0/P1） |
| 测试冻结 T+110 | 23:35（只允许重跑与补证据） |
| 交付 T+120 | 23:45（必须交付可运行部分 + NOT TESTED 清单） |

## 1. 共享根与目录

```text
/home/gem/code/req-squad/workspace/6343a752-e110-407c-8dfb-a5873425d917/
├── RUNBOOK.md
├── docs/                 # PRD、分析、架构、契约、方案、测试、评审、缺陷、报告
│   ├── PRD.md / PRD.html
│   ├── product_images/   # 20 张菜品图（PRD 附件原始资源）
│   └── scenario-profile.md
├── backend/              # Spring Boot 3 + JDK17 工程
├── frontend/             # React 18 + TS + Vite 工程
├── tests/                # 接口/E2E/并发测试脚本
├── artifacts/            # 截图、日志、测试输出、最终 zip
└── ai-conversations/     # 原始 AI 对话导出
```

**所有节点必须把产物写入共享根，不得只写在自己 cwd。**

## 2. 环境与端口

| 资源 | 值 |
|---|---|
| JDK | `JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64` |
| Maven | `/opt/maven/bin/mvn` |
| Node | `/opt/nvm/versions/node/v22.22.3/bin` |
| MySQL | `127.0.0.1:3306`，user `test`，password `test123456` |
| 数据库名 | **`req_6343a752e110`**（小写字母数字） |
| Redis | `127.0.0.1:6379`（可选；本项目用于库存热点加速，必须真实可启动） |
| 后端端口 | **8080** |
| 前端端口 | **5173**（dev server，proxy `/api` → 8080） |
| 基础路径 | API 统一 `/api/v1` |

**实际运行端口（2026-11-14 22:38 探测）**：8080 被系统 nginx 占用、5173 被其他工作区占用。本项目实际使用 **后端 8083 / 前端 5175**；交付 README 必须同时说明标准端口（`SERVER_PORT=8080`、`VITE_DEV_PORT=5173`）与本次实际端口。

```bash
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export PATH=/opt/gem/bin:/opt/nvm/versions/node/v22.22.3/bin:$JAVA_HOME/bin:/opt/maven/bin:$PATH
export MYSQL_HOST=127.0.0.1 MYSQL_PORT=3306 MYSQL_USER=test MYSQL_PASSWORD=test123456 MYSQL_DATABASE=req_6343a752e110
export REDIS_HOST=127.0.0.1 REDIS_PORT=6379
```

## 3. 技术基线与范围

- **强制**：前端 SPA → 后端 Java 17 + Spring Boot → 独立 MySQL 进程；禁止 H2/SQLite/嵌入式库。
- 前端：React 18 + TypeScript + Vite + React Router；状态用轻量 Context/Zustand；图表用 Recharts（看板 Tier 3）。
- 后端：Spring Boot 3.x + Spring Security(JWT) + MyBatis-Plus/JdbcTemplate + Flyway（或 schema.sql）+ 统一响应/错误码 + 参数化查询。
- Redis：菜品库存热点加速 + 幂等辅助；**DB 永远是库存账本**。
- 语言：所有用户可见文案 **英文**；代码注释可中文。
- 金额：**整数分**（BIGINT），服务端重算总价，展示格式 `¥22.50`。
- 功能分层：Tier 1（注册登录/菜单/购物车/下单）与 Tier 2（偏好+订餐规则/Console 菜品管理）为必做；Tier 3（库存实时+扣减、AI 推荐、看板）在 Tier1/2 端到端可用后尽力做，计 +10。
- **补充说明 12 条为强制工程要求**（幂等、唯一有效单、原子扣减、取消只回补一次、服务端截单、订单快照、库存流水与对账、RBAC+审计、高风险操作可控、画像软排序+硬过滤、AI 可配置可降级、统一错误码/分页/鉴权/幂等/版本、稳定性与恢复、账本与告警）。

## 4. 初始分型

**标准（交易核心按高风险子域对待）**。理由：业务规模小（200 人/50 菜品），但下单、库存、取消回补、幂等、权限与审计属于资损/一致性敏感路径，必须按交易正确性标准实现；其余展示类功能按标准交付。**不做超出 2 小时的多站点/微服务/消息队列等过度设计**，只保留可扩展边界（模块化单体、策略配置、唯一约束、账本表）。

## 5. 场景 profile

见 `docs/scenario-profile.md`。active_profiles：

- `general-engineering`（默认）
- `transaction-order`（主）
- `identity-access`（次，Console RBAC/审计）
- `ai-llm`（次，Tier 3，ASSUMED 可选）

每个节点交付评论必须含 `## Scenario checks`，逐项 `PASS / N/A / FAIL + 证据`；`N/A` 必须写理由。

## 6. 默认决策（需求模糊时的最小风险默认值）

| # | 决策 | 说明 |
|---|---|---|
| D1 | 管理员种子账号 | `admin@webox.com` / `Admin12345`（BCrypt 入库；仅 README 演示说明，不写日志）。员工可自行注册；可选种子员工 `employee@webox.com` / `Employee123` |
| D2 | 时区 | 截单与日期判定统一 `Asia/Shanghai`，以服务端时钟为准；界面上显示日期 |
| D3 | 截单规则 | 午餐 10:00、晚餐 15:00；过点自动切最近可订餐次：当日晚餐未过 15:00→当日晚餐；否则→次日午餐。结算页展示实际将下单的餐次并允许用户确认 |
| D4 | 订单状态机 | `Pending → Confirmed → Completed`；`Pending → Cancelled`。仅 Pending 可由员工取消；管理员可 Confirmed/Completed。取消/超时释放库存**仅一次**（ledger 唯一约束保证） |
| D5 | 唯一有效单 | 同一用户 + 同一配送日 + 同一餐次只能有一个 `Pending/Confirmed` 订单；用生成列 `active_key`（有效时=业务键，无效时=NULL）+ 唯一索引实现，冲突返回已有订单（HTTP 409 + orderId） |
| D6 | 幂等 | `Idempotency-Key` 请求头 + 用户维度唯一约束；同键同体返回首次结果，同键异体返回 409 `IDEMPOTENCY_CONFLICT`；前端提交按钮防抖 + 同一 key 重试 |
| D7 | 库存模型 | `dish_daily_stock`：`total_qty / sold_qty / reserved_qty`，可售=`total-reserved-sold`；菜品级 `inventory_mode` = `DB_ATOMIC`（默认）或 `REDIS_PREALLOC`（热点）。两种模式都通过统一 `InventoryService`；DB 扣减使用 `UPDATE ... WHERE available >= n` 原子条件；Redis 仅预占/加速，最终以 DB 为准并异步/同步对账 |
| D8 | 库存占用时点 | **提交订单时占用**；加入购物车不占库存；取消/超时释放；每次变更写 `inventory_ledger`（唯一业务键防重复回补） |
| D9 | 订单快照 | 订单明细保存菜品名、单价（分）、选项名与加价（分）、数量、小计；另存 `snapshot_json` 供追溯；后续菜品改价不影响历史订单 |
| D10 | 自定义选项 | 选项组 + 选项表（group required/optional、多选上限）；服务端校验必选组与选项归属，并按 DB 价格重算 |
| D11 | 过敏原提醒 | 加购时前端弹窗确认；后端下单不阻断（PRD 要求提醒而非过滤）。AI 推荐候选集**硬过滤**过敏原 |
| D12 | 偏好与画像 | 显式偏好（过敏原/菜系/辣度/口味/预算）是事实源；`user_profile` 为派生上下文；画像只做软排序；售罄/过敏原/近 7 天为确定性硬过滤 |
| D13 | 「为我推荐」 | 开启后按偏好菜系/辣度软排序并高亮；关闭恢复默认排序（上架时间/名称稳定排序） |
| D14 | 预算提示 | 购物车总价 > 单餐预算上限时结算页提示，不阻断下单 |
| D15 | Console 权限 | 角色 `EMPLOYEE` / `ADMIN`；JWT + 方法级授权；员工访问 `/api/v1/admin/**` 返回 403；功能权限 + 数据范围（全站/本站预留 site_id）+ 字段权限（敏感字段脱敏）+ 审计日志 `audit_log`（谁/何时/什么/前后值/IP） |
| D16 | 高风险操作 | 改价、上下架、改库存、取消/退款类操作：二次确认 + 必填原因 + 审计；审批流在时间盒内最小化为 `confirm + reason + audit`（P2 可留接口） |
| D17 | 实时库存 | 优先 SSE `/api/v1/menu/stream` 推送库存变化；失败降级 5s 轮询；前端断线重连；事件只带 dishId/available |
| D18 | AI 推荐 | 后端 `/api/v1/ai/recommend` SSE 流式；**候选集先由确定性代码过滤**（上架、当日有库存、过敏原、近 7 天已点），LLM 只做排序与理由生成；LLM Key 通过环境变量 `LLM_API_KEY`/`LLM_BASE_URL`/`LLM_MODEL` 配置；无 Key 时降级为规则推荐并明确标注 `rule-based fallback`；规则配置表可调、支持回滚；多轮会话存 `ai_conversation` |
| D19 | 分页/错误码 | 统一 `page,size`（默认 1/20，size≤100），响应 `{code,message,data,requestId}`；错误码分段：`AUTH_* / VALIDATION_* / ORDER_* / STOCK_* / IDEMPOTENCY_* / FORBIDDEN / INTERNAL` |
| D20 | 图片 | 使用 `docs/product_images/` 20 张图；前端 `public/images/` 或后端静态 `/images/**`；种子数据绑定图片文件名；图片缺失时显示占位图 |
| D21 | 演示数据 | 必须预置**当日**菜单与库存（9 道菜全部上架、库存 20~50 份），保证当天可直接下单/扣减/看板；另预置未来 1~2 天菜单 |
| D22 | 退款/支付 | PRD 无支付资金流，不实现真实支付；订单取消只做库存回补与状态变更；「退款」作为审计预留不实现 |
| D23 | **代码推送（用户 22:22 追加）** | 任务完成后将全部代码提交到 `https://github.com/zheng12tian404/webox.git`（默认 `main`）；由 Stage 5 文档节点执行 `git init → commit → remote add → push`，Stage 6 验证 remote 提交哈希与 README。仓库当前为空（`git ls-remote --heads` 无 refs）。**若环境无推送凭据，必须产出本地 git bundle 并明确报告“未推送”及原因，不得声称已推送** |
| D24 | **README 内容（用户 22:22 追加）** | 仓库根 `README.md` 必须同时包含：①项目说明（WeBox 介绍/功能/架构/技术栈/从零启动/账号/测试/API/AI 降级/目录）；②飞书 wiki 全文或等价完整章节 + 原文链接 `https://mi.feishu.cn/wiki/Kv6nwNzRBikNBgkpwKMcZt7hnAg`。wiki 已抓取并落盘 `docs/reference/feishu-wiki.md`（标题《「需求开发小队」Agent 设计与 PRD 全流程》，113 行），文档节点不得使用截图或摘要替代 |
| D25 | 推送安全 | `.gitignore` 必须排除 `node_modules/`、`target/`、`.env`、日志、IDE 文件；不得提交任何密钥/Token/密码；提供 `.env.example`；README 中演示账号仅用种子默认值 |
| D26 | **文档目录（用户 22:24 追加）** | 仓库根必须建立 **`doc/`** 目录，至少包含：`doc/README.md`（索引）、`00-prd.md`、`01-architecture.md`（架构设计）、`02-detailed-design.md`（后端+前端详细设计）、`03-api.md`（API 文档）、`04-data-model.md`（数据库设计）、`05-testing.md`（测试方案/用例/报告）、`06-deployment.md`（从零部署：JDK17/Maven/MySQL/Redis/前后端/种子/排障）、`07-delivery.md`（交付范围、AC 覆盖、证据索引、已知限制、演示脚本）、`08-team-process.md`（小队流程 + 飞书 wiki 原文）。README 必须链接 `doc/` 各文档；文档不得含密钥/PII；不得用截图替代正文 |

## 7. Stage 计划（实际时钟）

| Stage | 节点 | 窗口 | 截止 |
|---|---|---|---|
| 1 | 产品工程师（PRD/场景/验收矩阵） | 21:45–21:55 | 21:55 |
| 2 | Architecture；测试方案设计师（先 G1 互评） | 21:55–22:15 | 22:15 |
| 3 | 后端方案；前端方案（先 G2 互评） | 22:15–22:30 | 22:30 |
| 3b | 方案交叉评审（G3） | 22:30–22:35 | 22:35 |
| 4 | 后端开发；前端开发 | 22:35–23:25 | 23:25 |
| 5 | 后端评审；前端评审；架构抽检；产品验收；测试执行；文档/AI 导出 | 23:25–23:40 | 23:40 |
| 5b | P0/P1 修复 + 复评 + 回归（按需） | +8 分钟 | — |
| 6 | Quality Checker + 打包 | 23:40–23:45 | 23:45 |

## 8. 门禁（Leader 自动检查）

- G1：`docs/prd-analysis.md` + `docs/acceptance-matrix.md` + `docs/scenario-profile.md`，含 Tier 分层、GWT 验收、NFR、假设/默认决策、评分卡映射、场景 required_checks。
- G2：`docs/architecture.md`、`api-contract.md`、`data-model.md`、`test-plan.md`、`test-cases.md`、`cross-review-g1.md`。
- G3：`docs/backend-design.md`、`frontend-design.md`、`cross-review-g2.md`、`cross-review-g3.md`。
- G4：`backend-review.md`、`frontend-review.md`、`architecture-review.md`、`product-acceptance.md`、`test-report.md`、README/API/架构/测试文档、`ai-conversations/`；`review-findings.md` 与 `defect-log.md` 无 open P0/P1。
- G5：`docs/quality-report.md` GO + `artifacts/6343a752-delivery.zip` 并附加主 Issue。

## 9. 交付与停止

- 每个节点只发一条结构化评论（结论/产物/证据/假设/风险/Scenario checks/门禁自检/下一步），**发评论前先 `mico issue status <本节点> done`**，然后停止。
- 不等待人工；缺证据、路径不存在、未写 Scenario checks 视为未通过。
- 不评审自己的产出；发现写 `docs/review-findings.md`，缺陷写 `docs/defect-log.md`。
- Tier 1/2 目标 ≥45/50；Tier 3 加分项不得挤占 Tier 1/2。

## 10. 执行记录与 Leader 决策

| 时间 | 事件 | 处理 |
|---|---|---|
| 22:00 | Stage 2 完成 | WS-57 Architecture PASS（含 `docs/schema.sql` 实跑证据）；WS-58 Test Designer 状态 done 但未留结构化交付评论 |
| 22:00 | WS-58 评论缺失 | **按产物优先放行 G2**：已核验 `test-plan.md`(320 行)、`test-cases.md`(139 行)、`cross-review-g1-test.md`(44 行)、`tests/` 10 个 `.mjs` 语法通过；流程缺陷记 P2，Stage 5 测试报告必须补证据，不得以“无评论”作为 PASS 依据 |
| 22:00 | G1A-05（50 并发用户夹具）OPEN | 转 Stage 4/5 实现（SQL 直插 BCrypt 或 test fixtures），不阻塞 G2 |
| 22:00 | G1T-M8（注册提权向量） | 架构侧已强制忽略 `role` 并强制 EMPLOYEE；不新增 AC，Stage 5 以接口/代码证据覆盖 |
| 22:00 | 测试钩子 | `X-Test-Clock` 仅 test profile；生产必须忽略，Stage 5 验证 |

**G2 判定：PASS（附条件）**。条件：Stage 4 必须落地并发夹具、Redis 降级、SSE 契约；Stage 5 必须用真实命令输出补齐证据。

| 22:07 | Stage 3 完成 | WS-59 后端方案 PASS（`backend-design.md` 719 行，39/39 端点映射，G2-BE-B1 幂等三段式事务已闭合）；WS-60 前端方案 done 但**无交付评论**，产物已核验：`frontend-design.md` 691 行、`cross-review-g2-frontend.md` 83 行（2B+9M） |
| 22:08 | WS-60 评论缺失 | 同 WS-58 处理：产物优先放行 G3 输入，流程缺陷 P2；Stage 5 以测试报告与实际页面证据为准 |
| 22:08 | G2 评审结论 | 后端视角 CHANGES（1B+8M，全部在设计内给默认决策）；前端视角 CHANGES（2B+9M，契约补字段/定义可闭环） |
| 22:08 | Stage 3b 启动 | 3 个并行 G3 评审节点（Architecture/产品/测试），22:14 截止；Architecture 回写 `api-contract.md`，Test 回写 `test-plan.md`/`test-cases.md` |
| 22:10 | Stage 3b 完成 | Architecture **PASS**（0 blocker，G3A-M1 Redis 整单补偿转 Stage 4）；产品 **CHANGES 0 blocker/5 major**（口径类，不阻断）；测试 **CHANGES 3 blocker**：B1 钩子路径已回写 CLOSED、B2 30 分钟超时可测性 OPEN 转 Stage 4、B3 测试库隔离文档 CLOSED 待 Stage 5 验证 |
| 22:10 | 契约 v1.1 | `api-contract.md` 214 行；`test-plan.md` 340 行；`test-cases.md` 152 行（85 用例）；`review-findings.md` 151 行 |
| 22:10 | WS-62 评论缺失 | 产品 G3 评审仅落文件 `cross-review-g3-product.md`（148 行），未发评论；与 WS-58/WS-60 同类 P2 流程缺陷，按产物放行 |
| 22:12 | Stage 4 启动 | WS-64 后端开发 + WS-65 前端开发，截止 23:25；软冻结 23:20、硬冻结 23:25；G3 强制项（G3A-M1、G3T-B2、G2-BE-B1、契约 v1.1）已写入节点描述 |
| 22:22 | 用户追加交付要求 | ①推送 GitHub `zheng12tian404/webox`；②README 写入项目说明 + 飞书 wiki。已抓取 wiki → `docs/reference/feishu-wiki.md`（113 行）；已检查仓库为空、`gh` 未登录、无 Token/凭据、SSH 22 超时；Stage 5 文档节点执行推送并留证据，Stage 6 验证；推送失败必须报告，不得虚报 |
| 22:24 | 用户追加文档要求 | 仓库根 `doc/` 目录（架构/详细设计/API/数据/测试/部署/交付/团队流程 + 索引），README 链接；已写入 D26，Stage 5 文档节点执行，Stage 6 校验目录与关键文件非空 |
| 22:38 | Stage 4 完成 | 后端：jar 29.9MB、`mvn test` 10/10 通过（WeBoxApiIT 5 + UtilTest 5）、两个 DB 已建；前端：55 源文件、TS strict 0 error、build 通过、20 张截图、真实 API 联调日志。**WS-64 无交付评论、backend/artifacts 为空**（P2 流程缺陷，证据由 target/surefire 与 jar 独立核验） |
| 22:38 | 已知 P1 | `POST /auth/refresh` 500：`AuthService.java:98` 将 LocalDateTime 强转 java.sql.Timestamp；影响 AC-004。已建 WS-66 修复（22:55） |
| 22:42 | Stage 5 启动 | 7 节点：WS-66 P1 修复（22:55）、WS-67 后端评审 / WS-68 前端评审 / WS-69 架构抽检 / WS-70 产品验收（23:05）、WS-71 测试执行（23:20）、WS-72 文档/README/doc/AI 导出/Git 推送（23:25）；实际端口 8083/5175 |
| 22:49 | Stage 5 完成 | **G4 FAIL（有 open P0/P1）**。后端评审 CHANGES（P0 confirm 未校验、P1 Redis 二次补偿、P2 AI 规则 NPE）；前端评审 CHANGES（P0 偏好保存失败、P1 卡片加购绕过过敏原、P1 提交无 in-flight 闩锁）；架构抽检 2 blocker（confirm P0、8083 旧进程）；产品验收 16/19 PASS、2 FAIL（Console 写 500）、1 NOT TESTED；测试 101 PASS/9 FAIL/1 SKIP（无本节点 P0，50 并发 10 成功/40 409）；文档 PASS；**Git push 失败（无写权限凭据，bundle 12MB 已留）** |
| 22:51 | Stage 5b 启动 | WS-73 后端修复（confirm/部署重启/并发补偿/限流/SSE/自动完成/缓存/备份，23:10）、WS-74 前端修复（偏好/过敏原/提交闩锁，23:10）；修完后进入 5c 复评+回归+文档同步，再进 Quality |
| 22:57 | Stage 5b 完成 | 后端 PASS：confirm 6+1 处校验、8083 新 PID 1385859 + jar 22:51、17 测试全绿、限流 429、SSE/Redis 一致、backup/restore 8 表 MATCH、AI 规则 200、偏好兼容；前端产物 PASS（无评论）：偏好保存截图、卡片过敏原弹窗、同 tick 双击仅 1 个 POST；PA-D-001 台账仍 OPEN 待复评关闭 |
| 22:58 | Stage 5c 启动 | 5 节点：WS-75 后端复评、WS-76 产品复验、WS-77 架构 blocker 关闭复核、WS-78 测试回归/test-report v2、WS-79 文档同步+Git 推送重试；截止 23:12–23:18 |
| 23:11 | Stage 5c 完成 | 后端复评 PASS（17/17、confirm 7/7、8083 新 jar、限流/SSE/备份/自动完成实测）；架构 closure PASS（2 blocker+7 major 关闭）；测试回归核心 24/24 PASS、50 并发 10/40；产品单账号 19/19 PASS；**新增 P1 S5C-D-001 跨账号偏好/购物车残留（登出未清 localStorage）**；文档提交 83a531f、bundle 31M，Git push 仍无凭据失败 |
| 23:12 | Stage 5d 启动 | WS-80 前端修复 S5C-D-001（清 prefs/cart + userId 归属校验），截止 23:18；随后产品复验+测试快回归+文档同步，再进 Quality |
| 23:15 | Stage 5d 完成 | WS-80 产物 PASS（无评论）：`s5d-cross-account.log` 显示 A 登出后 storage prefs/cart=null；B 登录加购 Kung Pao 不弹窗；A 重新登录加购弹 Peanuts；build 通过（721KB chunk 告警）。S5C-D-001 标 FIXED 待复验 |
| 23:17 | Stage 5e 启动 | WS-81 产品定向复验、WS-82 测试快回归/test-report v3、WS-83 文档终版同步+Git 推送重试；截止 23:22–23:28，随后 Quality |
| 23:23 | Stage 5e 完成 | S5C-D-001 **CLOSED**（产品独立 A→B 不弹 / B→A 弹；测试 15/15 复验）；无 open P0/P1；product-acceptance-v3 / test-report-v3 已生成；终版 commit `ebb8f5f`，bundle 53MB，push 仍失败（无凭据）；doc/10 份、README wiki、链接 0 缺失 |
| 23:25 | Stage 6 启动 | WS-84 Quality Checker：G5 终审、GO/NO-GO、`quality-report.md`、最终包 `artifacts/6343a752-delivery.zip` 并附加主 Issue；截止 23:40，23:45 硬交付 |
| 23:33 | **最终交付** | **G5 GO**；Tier1 28.6/30 + Tier2 18.7/20 = **47.3/50**；前端 P6+ 20/20、后端 20/20；无 open P0/P1；zip 67MB + quality-report + bundle(53MB) 已附加主 Issue；主 Issue 状态 **done**。Git push 因无凭据失败，已提供可 clone bundle 与恢复命令，不伪报 |
| 23:20 | Stage 5e 完成 | 测试 v3：S5C-D-001 定向 6 检查 + 冒烟 9/9 PASS（15/15）；产品 v3：AC-021/022/023 跨账号隔离 PASS、AC-030/032/014/015/053 回归 PASS，S5C-D-001 **CLOSED**；P0=0、open P1=0，门禁满足；文档 `doc/05-testing.md` §5.7、`doc/07-delivery.md`、README 已同步，doc/ 10 份齐全、本地链接 0 缺失；**Git push 重试仍失败（128，No anonymous write access，无写权限凭据）**，本地 commit `caf7143`、bundle 已重新生成，详见 `artifacts/s5e-git-push.log` |