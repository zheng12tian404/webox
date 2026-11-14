# WeBox 最终质量报告（G5 终审）

- 主 Issue：`6343a752-e110-407c-8dfb-a5873425d917`
- 节点：Stage 6 Quality Checker（作者≠开发/评审；本报告不修改业务代码）
- 时间：2026-11-14 23:25–23:45 CST
- 共享根：`/home/gem/code/req-squad/workspace/6343a752-e110-407c-8dfb-a5873425d917`
- 输入：`docs/test-report*.md`、`docs/product-acceptance*.md`、`docs/{backend-review,backend-rereview,frontend-review,architecture-review,architecture-review-closure}.md`、`docs/{defect-log,review-findings,acceptance-matrix,scenario-profile}.md`、根 `README.md`、`doc/`、`ai-conversations/`、`artifacts/`
- 证据日志：`artifacts/g5-quality-check.log`

## 0. 结论

**GO（有条件接受，附残余风险）**

| GO 条件 | 结果 | 证据 |
|---|---|---|
| 无 open P0/P1 | **PASS**（P0=0、P1=0） | `docs/defect-log.md`：S5C-D-001 已于 Stage 5e 产品定向复验 **CLOSED**；PA-D-001、D-BE-11、D-BE-12、DEF-002~008 均 CLOSED |
| Tier1/2 ≥45/50 | **PASS — 47.3/50**（Tier1 28.6/30、Tier2 18.7/20） | 评分方法与逐项证据见 §2 |
| README/doc/AI 导出齐全 | **PASS** | `doc/` 10 份共 379,587 bytes；`ai-conversations/` 85 文件（comments 18、runs 27、claude-code 18、main/children/INDEX/README）；README 含飞书 wiki 全文+原文链接 |
| 代码可运行 | **PASS** | 8083 `/health` 200（db/redis/cache UP）；5175 200；jar 30.0 MB（22:51）+ dist 1.1 MB（23:13）；G5 独立冒烟 9/9 |
| zip 已附加 | **PASS** | `artifacts/6343a752-delivery.zip`（见 §8，附回执） |

**一句话结论**：核心交易链路（认证/菜单/购物车/下单/幂等/取消/库存/RBAC/审计）在 8083 实机端到端可用，Tier1/2 47.3/50，无 open P0/P1，交付物齐全，判定 **GO**；剩余风险集中在“证据深度”与 Tier3/跨日/真实 LLM 未测，不影响本次交付可用性。

## 1. G5 七项核对（逐项 PASS/FAIL + 证据）

| # | 检查项 | 结果 | 证据与说明 |
|---|---|---|---|
| 1 | 缺陷关闭 | **PASS** | `docs/defect-log.md`：open P0=0、open P1=0；S5C-D-001 经 `product-acceptance-v3.md` §1（A→B→A 三轮回切、localStorage 全 null）与 `test-report-v3.md` §2（15/15）双复验 CLOSED。P2/P3 见 §5。 |
| 2 | Tier1 30 + Tier2 20 端到端 | **PASS（47.3/50）** | Tier1 19 条 AC：16 PASS + 3 PARTIAL；Tier2 14 条 AC：11 PASS + 3 PARTIAL；NOT TESTED=0。按 PASS=100%、PARTIAL=70%（功能可用、边界/UI 断言证据不足）计分，见 §2。 |
| 3 | 工程 P6+ 10 项 | **PASS（前端 20/20、后端 20/20）** | 逐项见 §3；每项均有代码位置 + 运行/测试/截图证据。 |
| 4 | 交付物与文档 | **PASS** | `doc/` 00–08 + README 共 10 份非空；根 README 26,255 bytes 含项目说明/技术栈/目录/从零启动/账号/种子/测试/API/AI 降级/已知限制/**飞书 wiki 全文（与 `docs/reference/feishu-wiki.md` 逐行 diff 仅尾部换行）+ 原文链接**；`ai-conversations/` 为原始 JSON/JSONL（非截图/摘要），含主 Issue、18 个评论导出、27 个 run-messages、runs-meta、18 个 claude-code transcript、INDEX/README。 |
| 5 | 用户追加要求（Git/链接/密钥） | **PASS（附 2 项披露）** | HEAD `575ea6bce1976dd72c356dd3acc5eeb91772c06f`；远端 `https://github.com/zheng12tian404/webox.git`；**未推送**（`git push` 128，`No anonymous write access`/`Authentication failed`，无写权限凭据，未索取任何凭据）；bundle `artifacts/webox-repo.bundle` 54,643,221 bytes，**G5 实测 `git clone` 成功**（至 `ae9587c`）。链接检查 46 文件/32 本地链接/**0 缺失**（`artifacts/s5e-doc-check.txt`）。密钥扫描 0 命中；仅 `.env.example` 入库。披露：① bundle 生成于 `ae9587c`，其后 `ebb8f5f/575ea6b` 为 bundle/doc-check/截图收尾提交，不含业务变更；② 工作树在 G5 时仍有 6 项未提交变更（`RUNBOOK.md` + 5 张 `artifacts/prd-verify/*.png`），不影响代码与交付包。 |
| 6 | 运行态与冒烟 | **PASS** | 8083 `/api/v1/health` → 200 `{"status":"UP","db":"UP","redis":"UP","cache":"UP"}`；5175 → 200（Vite dev）；8080 为系统 nginx、5173 为其他工作区进程（README 已说明标准 8080/5173 与实测 8083/5175）。G5 独立冒烟：注册 201、登录 200、菜单 20 条（首条 Beef Noodle Soup）、preview 200（totalCents=2200）、下单 201（`WB20261115-0021`）、员工访问 `/admin/dishes` 403、管理员 200、未登录 401。 |
| 7 | 证据完整性与 NOT TESTED | **PASS（已如实列明）** | 测试/验收 PASS 均附路径（§3、§7）；NOT TESTED 见 §6，未被伪装为 PASS。 |

### 1.1 本节点独立抽查（原始输出见 `artifacts/g5-quality-check.log`）

```text
health 200 {"status":"UP","db":"UP","redis":"UP","cache":"UP"}
5175 HTTP 200 (Vite dev)
register 201 id=128 role=EMPLOYEE
login 200
menu total=20 items=20 first=Beef Noodle Soup
preview 200 totalCents=2200 effectiveDate=2026-11-15 Lunch
order 201 orderId=21 WB20261115-0021 Pending totalCents=2200
employee -> /admin/dishes 403
admin -> /admin/dishes 200
unauth -> /orders 401
admin -> /admin/orders 200，address="***"（脱敏）
```

## 2. 功能完成度评分（Tier1 30 + Tier2 20）

**计分方法**：每条 AC 在层内等权；PASS=1.0、PARTIAL=0.7（功能主路径已实测可用，但边界/UI 断言或部署态证据不完整）、NOT TESTED=0。数据源：`doc/07-delivery.md` §7.2 + `docs/test-report-v2/v3.md` + `docs/product-acceptance-v2/v3.md`。

| Tier | AC 数 | PASS | PARTIAL | NOT TESTED | 得分 |
|---|---|---|---|---|---|
| Tier 1（30 分） | 19（AC-001–019） | 16 | 3 | 0 | **28.6/30** |
| Tier 2（20 分） | 14（AC-020–033） | 11 | 3 | 0 | **18.7/20** |
| **合计** | 33 | 27 | 6 | 0 | **47.3/50** |

**Tier1 PARTIAL（3）**

| AC | 缺口 | 已证部分 | 证据 |
|---|---|---|---|
| AC-005 登录失败限流 | 契约“前 10 次 401、第 11 次 429”的精确边界未在隔离 IP 下签收；G5 共享 IP 复测第 10 次即 429（受此前成功登录占用窗口干扰，不能判定 off-by-one，见 §6 R-01） | 限流真实生效、429 `RATE_LIMITED`、正确密码不再放行 | `docs/test-report.md` §未测项；G5 复测序列 `1..9:401, 10:429, 11:429` |
| AC-011 购物车行身份/合计 | 无专用 E2E 断言脚本；以代码+页面截图+加购合并行为证明 | 同菜同配置合并、异配置分行、整数分合计、选项名展示 | `frontend-review.md` FE-2/FE-4、`cartStore.ts:43-44,79-100`、`artifacts/s5c-product/b3-cart-after-allergen.png`、AC-053 十连点仅 1 行 |
| AC-012 购物车增减/删除/持久化 | 减到 0 移除、删除行、刷新持久化无逐项脚本断言 | +/−/删除/总价实时、空态、localStorage 持久化 | `frontend-review.md` 前端 5 项、`cartStore.ts`、`artifacts/s5c-product/` 购物车截图 |

**Tier2 PARTIAL（3）**

| AC | 缺口 | 已证部分 | 证据 |
|---|---|---|---|
| AC-027 跨餐次/跨日并行下单 | “取消后再下同日同餐次 201”未单独脚本化 | 唯一单 409+existingOrderId、取消 200 且回补、跨日/跨餐次接口规则实现 | `test-report-v2.md` §2 AC-026/018；`uk_orders_active` 生成列唯一键 |
| AC-029 Console 新增菜品/图片上传 UI | >5MB/非图片 400 与上传 UI 全流程未在 G5 复测 | 菜品 CRUD/状态/每日菜单/库存写 200 + 审计；占位图逻辑存在 | `product-acceptance-v2.md` §1.1；`frontend-review.md` FE-5 |
| AC-033 订单列表脱敏/无敏感字段 | 员工侧 `/admin/orders` 403 由 S5e 冒烟覆盖，G5 未重跑；列表/详情全字段比对为抽样 | 管理员列表 `address="***"`（G5 实测）、响应无 `password_hash`/token、员工越权 404/403 | G5 `admin/orders` 响应；`test-report-v3.md` 冒烟 #9；`test-report.md` 安全项 |

> 说明：6 项 PARTIAL 均为“功能可用、证据深度不足”，不是功能缺失。Tier1 全部 19 条 AC 的主路径均已在产品验收 v2/v3 或测试回归中端到端执行；因此不构成“Tier1 功能不可用”的 No-Go。若评审要求 Tier1 满分 30/30 才可 GO，则应先补齐 AC-005 隔离边界与 AC-011/012 的 E2E 断言（预计 ≤30 分钟），本报告不为此背书。

## 3. P6+ 工程评分卡（前端 5 项 / 后端 5 项，各 20 分）

### 3.1 前端（每项 4 分，合计 20/20）

| 维度 | 结论 | 锚点 | 证据 |
|---|---|---|---|
| FE-1 响应式 | **PASS (4/4)** | 菜单/购物车/Console/结算 375 & 1440 | `styles/global.css:336-394`（1023/767 断点、表格转卡片、底部购物车栏）；375×812 实测 `scrollWidth 360≤375`（菜单）、`375≤375`（购物车）、`360≤375`（Console）；截图 `artifacts/evidence/frontend-review/fr-*-mobile-375.png` |
| FE-2 分页/长列表 | **PASS (4/4)** | 菜单/订单服务端分页 | `MenuPage.tsx:55-67`、`Pagination.tsx`、`DishCard` memo；`GET /menu?page=1&size=5` → `total=20,items=5`，页面 `Page 1 of 4 · 20`；`fr-pagination-size5.png` |
| FE-3 防抖/节流 | **PASS (4/4)** | 搜索/加购/下单 | `useDebounce.ts` 300ms；`DishCard` busy 350ms+disabled；`CheckoutPage.tsx` submitting+disabled+幂等键+`useRef` 闩锁；AC-053 十连点仅 1 行、同 tick 双击仅 1 POST（`b5-double-submit-success.png`） |
| FE-4 金额精度 | **PASS (4/4)** | 购物车/结算/订单 | `utils/money.ts` 整数分、`formatMoney` 补零、`parseYuanToCents` 字符串解析；5×2200=11000 → `¥110.00`（`fr-cart-5-items.png`、`fr-checkout-desktop.png`）；全页面金额 `^¥\d+\.\d{2}$` 0 例外 |
| FE-5 输入校验 | **PASS (4/4，修复后复评)** | 偏好/菜品/地址/原因/搜索 | G4 原 FAIL（`Balanced`、预算 0/0 与后端不一致）→ D-FE-01（P0）修复；产品 v2 §1.2 实测偏好整页保存 200、`Balanced→Medium`、预算 null、刷新持久（`b7/b8-preferences-*.png`）；`validation.ts` 覆盖 8 类输入，负向 400 文案统一 |

### 3.2 后端（每项 4 分，合计 20/20）

| 维度 | 结论 | 锚点 | 证据 |
|---|---|---|---|
| BE-1 缓存策略 | **PASS (4/4)** | 菜单热点读 + 写后失效 | `MenuService` 缓存；`AdminService.java:115,133,148,170,295,320,372` 全部 `Util.afterCommit`；实测改库存 SSE 28ms、Redis=DB=49→46；`backend-rereview.md` §1.5 |
| BE-2 下单幂等 | **PASS (4/4)** | `POST /orders` + Idempotency-Key | 幂等键用户维度唯一约束；同键 3 并发+1 串行 → 1 单同 orderId（`s5c-idem-final.log`）；异体 409 `IDEMPOTENCY_CONFLICT`、缺头 400；S5e 冒烟同键重放同 orderId=18 |
| BE-3 SQL 注入防护 | **PASS (4/4)** | 搜索/筛选/详情/订单 | 全参数化（MyBatis `#{}`/JdbcTemplate 占位符）；`' OR 1=1 --` → 200 `total=0`、无 500、无全表泄露；路径注入 → 400（`s5c-test-regress.log`） |
| BE-4 权限校验 | **PASS (4/4)** | `/api/v1/admin/**`、订单归属 | Spring Security JWT + 方法级角色；员工 `/admin/**` → 403 `FORBIDDEN`（G5 实测）、未登录 401（G5）、他人订单 404；管理员 200 + 审计 |
| BE-5 并发/防超卖 | **PASS (4/4)** | 库存扣减/取消回补 | 50 并发抢 10：201=10、409_STOCK=40、`available=0`、`reserved=10`、ledger RESERVE=10、reconcile drift=[]（`artifacts/test-conc-order.log`）；取消仅 1 条 RELEASE、二次 409（`s5c-test-regress.log`） |

## 4. 架构强制项与安全

| 项 | 结论 | 证据 |
|---|---|---|
| 前后端分离 | **PASS** | React 18+TS+Vite SPA（5175）→ Spring Boot 3.3 REST（8083），Vite proxy `/api` |
| JDK 17 + Spring Boot | **PASS** | `backend/scripts/start.sh` 固定 `/usr/lib/jvm/java-17-openjdk-amd64`；8083 PID 1385859 加载 22:51 构建 jar；`mvn test` 17/17 |
| 独立 MySQL（无 H2/SQLite） | **PASS** | 127.0.0.1:3306 `req_6343a752e110`；`docs/schema.sql`；health `db=UP` |
| Redis 可选但真实 | **PASS** | 127.0.0.1:6379 独立进程；health `redis=UP`；DB 为最终账本，Redis 仅预占/加速，实测 Redis=DB |
| 密码非明文 | **PASS** | BCrypt `$2` 前缀；响应/日志无 `password_hash`；`.env.example` 仅占位 |
| 密钥/PII 不入库/日志 | **PASS** | G5 `git grep`（sk-/ghp_/AKIA/PRIVATE KEY/LLM_API_KEY=）0 命中；仅 `.env.example` 入库；演示账号为种子默认值 |
| 文案语言 | **PASS** | 前端 `grep` 无中文；全页面英文；金额 `¥xx.xx` |

## 5. 缺陷关闭（GO 前门禁）

| 级别 | Open 数量 | 说明 |
|---|---|---|
| P0 | **0** | PA-D-001（Console 写 500）、D-BE-11（confirm）、D-FE-01（偏好保存）均 CLOSED |
| P1 | **0** | S5C-D-001（跨账号偏好/购物车残留）Stage 5d 修复、Stage 5e 测试+产品双复验 **CLOSED**；DEF-002~008 全 CLOSED |
| P2/P3 | 见下 | 不阻断 GO；Owner 已有，部分缺显式 SLA，G5 统一要求 **2026-11-15 前** 收口 |

| ID | 级别 | 内容 | Owner | G5 处置 |
|---|---|---|---|---|
| DEF-009 | P2 | 包结构与设计文档不一致 | S5 文档节点 | 2026-11-15 前补“实现偏差”段 |
| DEF-010 | P2 | architecture §4 Redis 措辞冲突 | S2-Architecture | 2026-11-15 前修正 |
| DEF-011 | P2 | AI 线程未传播 requestId | 后端开发 | 2026-11-15 前修复 |
| DEF-013 残留 | P2 | 文档端口/启动脚本（根 README 已修；`backend/README.md` G5 抽查未见 8090，残留待文档节点确认） | S5 文档节点 | 2026-11-15 前确认 |
| DEF-014 | P2 | `JWT_SECRET` 未校验 ≥32 字节 | 后端开发 | 2026-11-15 前 fail-fast |
| DEF-015 | P2 | ticket 第 4 次兑换证据冲突 | 测试执行 | 2026-11-15 前重跑 |
| DEF-016 | P2 | CHECK 3819 未映射 409 | 后端开发 | 2026-11-15 前补映射 |
| PA-D-004 | P2 | 未知 `/admin/dishes/{id}` 返回 500（应 404/405） | 后端开发 | 2026-11-15 前 |
| TE-D-001/002 | P2 | 超长邮箱错误码、preview 地址长度 | 后端开发 | 2026-11-15 前 |
| S5C-D-002 | P2 | 同键第 6 次重试 429 而非重放 | 后端开发 | 设计确认，2026-11-15 前 |
| D-FE-04 | P2 | E2E 响应式/防抖用例空跑 | 测试 | 2026-11-15 前重写断言 |
| TE-D-003/004、S5C-D-003、R-08/R-09 | P3 | 测试基建/文档项 | Test/后端 | 2026-11-16 前 |
| **G5-R-01（新）** | **P2** | 登录限流精确边界（第 10 vs 第 11 次）未在隔离 IP 签收；共享 IP 复测 10th=429，无法区分 off-by-one 与窗口干扰 | 后端开发 | **2026-11-15 前**用独立 IP/账号窗口复测并校准到契约 |

## 6. NOT TESTED 清单（残余风险）

| 项 | 状态 | 影响 | 风险等级 |
|---|---|---|---|
| 真实 LLM 推荐质量/首 token/超时 | NOT TESTED（无 `LLM_API_KEY`） | 仅验证规则降级 `fallback:true`；真实模型输出未评估 | 低（Tier3 加分项） |
| Tier3 取消后 SSE 恢复（AC-037） | NOT TESTED | 取消回补已由 DB/ledger 验证；SSE 恢复画面未实测 | 低 |
| 跨日自动完成 23:59 自然边界 | NOT TESTED（构造过期单已验证 t+40s Completed+SYSTEM 审计） | 同日单顺延到次日首个 tick（≤60s）完成，行为等价 | 低 |
| 30 分钟超时取消（AC-060） | NOT TESTED | 依赖定时任务；代码路径存在，未等真实超时 | 低 |
| 多标签页/跨设备同时登录不同账号 | NOT TESTED（PRD 未要求） | 单浏览器跨账号已 PASS；多会话边界未验 | 低 |
| 持续压测（50 QPS×60s、10 QPS×60s） | NOT TESTED | 仅抽样 P95（菜单 7ms、下单 39ms） | 中低 |
| 响应式/防抖 E2E 脚本断言 | NOT TESTED（脚本空跑，D-FE-04） | 已有截图/代码证据，但无自动化断言 | 低 |
| 图片上传 >5MB/非图片 UI 全流程 | NOT TESTED | 后端校验存在；前端上传 UI 未全流程验证 | 低 |
| 登录限流精确第 11 次边界 | NOT TESTED（G5-R-01） | 限流生效；边界可能早一次触发，属体验/契约偏差 | 低 |

## 7. 场景专项（active_profiles × required_checks）

| Profile | 关键 required_check | 结论 | 证据 |
|---|---|---|---|
| `general-engineering` | 构建启动、health、种子、英文、金额格式、文档 | **PASS** | G5 health/5175 200；菜单 20 条；金额正则 0 例外；README/doc/AI 导出齐全 |
| `transaction-order` | TO-1 整数分/服务端重算、TO-2 库存不为负、TO-3 取消只回补一次、TO-4 幂等、TO-5 唯一有效单、TO-6 状态机、TO-7 截单、TO-8 快照、TO-9 ≤5 份、TO-10 仅 Pending 可取消 | **PASS** | `test-report-v2.md` §2/§3；`test-conc-order.log`（50/10）；`s5c-idem-final.log`；产品 v3 回归 AC-014/015/030/032 |
| `identity-access` | IA-1 BCrypt、IA-2 员工 403、IA-3 角色矩阵、IA-4 输入校验、IA-5 限流/401/403、IA-6 审计、IA-7 越权 404 | **PASS** | G5：员工 403、未登录 401、管理员 200、admin 订单地址 `***`；`backend-rereview.md`；S5C-D-001 CLOSED |
| `ai-llm` | AI 候选确定性硬过滤、SSE、无 Key 降级、规则可配置/回滚 | **PASS（降级路径）/ 真实 LLM N/A** | `frontend-review.md` AC-038~040（5 卡 `Rule-based fallback`）；`PUT /admin/ai-rules` 200+审计；真实 LLM 无 Key → **N/A（明确理由）** |

> 场景 N/A 的理由均已写明；无“缺证据却记 PASS”的项。

## 8. 交付索引

| 交付物 | 路径 |
|---|---|
| 最终交付包 | `artifacts/6343a752-delivery.zip`（大小/sha256 见评论，附回执） |
| 质量报告（本文件） | `docs/quality-report.md` |
| G5 证据日志 | `artifacts/g5-quality-check.log` |
| 证据索引 | `artifacts/EVIDENCE-INDEX.md` |
| 代码 | `backend/`（源码，jar 见 `backend/target/webox-backend.jar` 未入包）、`frontend/`（源码 + `dist/`） |
| 文档 | `README.md`、`RUNBOOK.md`、`doc/`（10 份）、`docs/`（PRD/架构/API/测试/评审/缺陷/验收/质量报告） |
| 测试 | `tests/`（API/并发/E2E/SQL） |
| AI 原始对话 | `ai-conversations/`（85 文件：main/children/comments 18/runs 27/runs-meta/claude-code 18/INDEX/README） |
| Git 恢复包 | `artifacts/webox-repo.bundle`（54,643,221 bytes；`git clone` 实测成功，至 `ae9587c`） |

## 9. G5 自检

- [x] 亲自执行运行态抽查（health、5175、注册/登录/菜单/预览/下单/403/401），未只采信上游报告
- [x] 逐项核对 7 项门禁并给证据路径；未把 NOT TESTED 写成 PASS
- [x] 评分方法公开、可复算；47.3/50 与上游 27 PASS/6 PARTIAL 一致（PASS=1.0、PARTIAL=0.7）
- [x] 缺陷：open P0/P1=0；P2/P3 Owner+SLA（含 G5 新登记 G5-R-01）
- [x] 场景 active_profiles 全部 PASS/N/A + 证据
- [x] 无密钥/Token/PII 入库；未修改业务代码
- [x] 交付包不含 `.env`/`node_modules`/`target`/`.git`；bundle 已实测可 clone
- [x] 如实披露：未推送、bundle 落后 2 个文档提交、工作树 6 项未提交、AC-005 边界未隔离验证

## 10. 下一步

1. **知识沉淀工程师**：将 `docs/quality-report.md`、`docs/defect-log.md`、`doc/07-delivery.md`、AI 导出索引沉淀为团队知识/复盘材料（GO 路径）。
2. **P2 收口（Owner 已在 §5）**：2026-11-15 前完成 DEF-009/010/011/013/014/015/016、PA-D-004、TE-D-001/002、S5C-D-002、D-FE-04、G5-R-01；不阻断本次 GO。
3. **有 GitHub 写权限的环境**：按 `doc/07-delivery.md` §7.7 恢复 `git push`；当前离线交付以 bundle 为准，**不得视为已推送**。