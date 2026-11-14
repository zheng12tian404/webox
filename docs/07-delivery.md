# 07 · 交付说明

- 主 Issue：`6343a752-e110-407c-8dfb-a5873425d917`（WeBox 企业员工餐食订购平台）
- 交付时间：2026-11-14（CST）；终版文档同步：**Stage 5e，2026-11-14 23:20 CST**
- 技术基线：React 18 + TypeScript + Vite → Java 17 + Spring Boot 3.3 → 独立 MySQL 8；Redis 可选
- 端口：标准 8080 / 5173；本次实测 **8083 / 5175**（8080 被 nginx、5173 被其他工作区占用）
- 终版结论来源：`docs/raw/test-report-v3.md`、`docs/raw/product-acceptance-v3.md`（Stage 5e）；基线：`docs/raw/test-report-v2.md`、`docs/raw/product-acceptance-v2.md`、`docs/raw/backend-rereview.md`、`docs/raw/architecture-review-closure.md`

## 7.1 交付范围

| Tier | 内容 | 状态 |
|---|---|---|
| Tier 1（30 分） | 注册登录、每日菜单、购物车、下单、订单列表/详情/取消 | 已实现，主路径有执行证据 |
| Tier 2（20 分） | 饮食偏好、订餐规则（5 份上限/截单/唯一单/预算）、Console 菜品与每日菜单、RBAC + 审计 | 已实现，主路径有执行证据；部分 UI 边界见 7.4 |
| Tier 3（+10） | 实时库存 SSE、Redis/DB 双库存策略、AI 推荐与降级、经营看板、库存对账 | 已实现；AI 为规则降级路径验证，真实 LLM 未验证 |
| 工程要求 | 幂等、原子扣减、取消只回补一次、订单快照、统一错误码/分页/鉴权、审计、稳定性 | 已实现并有并发/DB 证据 |

明确不做：真实支付/退款（PRD 无资金流）、多站点/微服务/消息队列（时间盒内按模块化单体交付）。

## 7.2 Tier 1 / Tier 2 AC 覆盖

> 完整 60 条矩阵与逐条状态见 [`05-testing.md`](05-testing.md) §5.4（Stage 5c 增量见 §5.6，**Stage 5e 终版见 §5.7**）。状态口径：PASS=有命令/DB/截图直接覆盖；PARTIAL=有间接证据或仅抽样；NOT TESTED=未取得执行证据。

| Tier | AC 范围 | PASS | PARTIAL | NOT TESTED |
|---|---|---|---|---|
| Tier 1 | AC-001–019（19 条） | 16 | 3（AC-005 限流边界、AC-011/012 购物车 UI E2E 断言） | 0 |
| Tier 2 | AC-020–033（14 条） | 11 | 3（AC-027/AC-029/AC-033） | 0 |
| Tier 3 | AC-034–044（11 条） | 6 | 4（AC-034/036/041/042） | 1（AC-037） |
| NFR/安全 | AC-045–060（16 条） | 10 | 4（AC-045/046/049/052） | 1（AC-060）+ AC-059 N/A |

Tier 1/2 共 33 条：**PASS 27、PARTIAL 6、NOT TESTED 0**（Stage 5e 终版，较 Stage 5c 不变；v1 为 PASS 24/PARTIAL 7/NOT TESTED 2）。Stage 5e 产品 v3 复验 AC-014/015/030/032 与 AC-021/022/023 均 PASS；AC-053 由 NOT TESTED 转 PASS（加购 10 连点实测，结算双击沿用 5c 证据），NFR PASS 由 9 升至 10。

门禁事实（Stage 5e）：**P0 未关闭 = 0**；**P1 未关闭 = 0**。`S5C-D-001` 经 Stage 5d 修复、Stage 5e 测试独立复验（`docs/raw/test-report-v3.md` §2，15/15 PASS）与产品定向复验（`docs/raw/product-acceptance-v3.md` §1，AC-021/022/023 PASS）后已 **CLOSED**，“GO 前无 open P0/P1”门禁满足；残余仅 P2/P3（有 Owner/SLA，不阻断）。最终评分以 `docs/raw/quality-report.md` 为准，本文件不虚构评分。

## 7.3 评分卡映射（证据导向）

| 评分项 | 证据 |
|---|---|
| 功能完成度 Tier 1（30） | 菜单/购物车/下单/订单/取消：`backend-smoke.txt`、`mvn-test.log`、S5c 双击下单/重复单/取消回归（`artifacts/s5c-*`） |
| 功能完成度 Tier 2（20） | 偏好/截单/唯一单/5 份上限/Console/审计：`backend-testclock.txt`、`s5c-product/ac030-032-curl.log`、`b7/b8-preferences-*.png` |
| 后端 P6+（20） | 幂等 6/6；防超卖 50/10（10 成功/40 冲突、`available=0`）；confirm 门禁 7/7 端点；取消回补/ledger；统一错误码；RBAC/审计；`mvn test` 17/17 |
| 前端 P6+（20） | 金额整数分与 `¥` 格式、购物车行身份、5 份上限、同 tick 双击仅 1 POST、过敏原三入口、SSE/轮询降级、响应式截图、异常态 `data-error-code` |
| Tier 3（+10） | SSE（28ms）、Redis 双策略、AI 降级、看板、对账；真实 LLM 与 AC-037 仍 NOT TESTED/PARTIAL |

## 7.4 证据索引

| 类别 | 路径 |
|---|---|
| 需求/架构/API/数据 | `docs/00-prd.md`、`docs/01-architecture.md`、`docs/02-detailed-design.md`、`docs/03-api.md`、`docs/04-data-model.md` |
| 测试 | `docs/05-testing.md`（§5.7 Stage 5e 终版）、`docs/raw/test-plan.md`、`docs/raw/test-cases.md`、`tests/` |
| 测试报告 v3（Stage 5e） | `docs/raw/test-report-v3.md`；`artifacts/s5e-cross-account.log`、`s5e-smoke.log`、`s5e-prefs-server.log`、`s5e-a-peanuts-modal.png`、`s5e-b-no-modal.png`、`s5e-a-modal-again.png` |
| 产品复验 v3（Stage 5e） | `docs/raw/product-acceptance-v3.md`；`artifacts/s5e-product/`（浏览器流程日志、localStorage 快照、截图、回归 curl/DB） |
| 测试报告 v2 | `docs/raw/test-report-v2.md`；`artifacts/s5c-test-regress*.log`、`s5c-test-idem-final.log`、`s5c-test-regress4.log` |
| 产品复验 v2 | `docs/raw/product-acceptance-v2.md`；`artifacts/s5c-product/`（curl/DB/隔离 Chrome 截图） |
| 后端复评 | `docs/raw/backend-rereview.md`；`artifacts/s5c-backend-rereview-evidence.log` |
| 架构关闭复核 | `docs/raw/architecture-review-closure.md`；`artifacts/s5c-architecture-closure-evidence.txt` |
| 部署 | `docs/06-deployment.md`、`RUNBOOK.md`、`backend/scripts/start.sh` |
| 后端测试输出 | `artifacts/evidence/backend/mvn-test.log`、`backend-smoke.txt`、`backend-g3-checks*.txt`、`backend-testclock.txt` |
| 并发 | `artifacts/test-conc-order.log`（50/10）、`artifacts/evidence/backend/concurrency/idempotency_race.log` |
| 前端 | `artifacts/evidence/frontend/frontend-build.log`、`artifacts/s5c-fe-*.png`、`artifacts/s5c-product/b*.png` |
| 文档节点回归 | `artifacts/backend-8084-refresh-check.log`（login/refresh OK） |
| AI 原始对话 | `ai-conversations/`（INDEX.md + README.md） |
| Git 推送 | `artifacts/s5e-git-push.log`（Stage 5e 终版）、`artifacts/s5c-git-push.log`、`artifacts/git-push.log`、`artifacts/repo-files.txt` |
| 文档校验 | `artifacts/s5e-doc-check.txt`（docs/ 10 份、飞书 wiki、本地链接） |
| 评审/缺陷 | `docs/raw/review-findings.md`、`docs/raw/cross-review-g*.md`、`docs/raw/defect-log.md` |

## 7.5 已知限制

1. **端口**：8080 被系统 nginx 占用、5173 被其他工作区占用；实测后端 8083、前端 5175。标准端口命令已给出（`SERVER_PORT` / `VITE_DEV_PORT`），`backend/scripts/start.sh` 固定 JDK17 绝对路径 + health 探测。
2. **限流与性能**：下单 5/min/用户第 6 次 429 已实测；登录 20/min/IP 已实触发（精确第 11 次边界未单独签收）；菜单/下单仅抽样 P95=7ms/39ms，未做 50 QPS×60s、10 QPS×60s 持续压测。
3. **并发规模**：50 用户抢 10 份已 PASS（ready 50/50、10 成功/40 冲突）；更大规模与多实例未测。
4. **AI**：无 `LLM_API_KEY`，真实验证的是规则降级路径（`fallback:true`）；真实 LLM 质量/首 token/超时未测。
5. **单实例调度**：30 分钟超时取消（AC-060）仍 `NOT TESTED`；自动完成（DEF-005）已运行实测，但仅判 `delivery_date < today`，**同日 23:59 跨日分支未实现/未测**（R-09，P3）。
6. **支付/退款**：不实现（PRD 无资金流）；取消仅状态变更 + 库存回补。
7. **已关闭 P1（仅记录，不阻断）**：`S5C-D-001` 跨账号偏好缓存残留——Stage 5d 已修复（登录/登出/引导失败统一清理 prefs+cart 内存与 localStorage；`ensurePrefs()` 校验 `ownerUserId` 归属并做请求代际防串写）；Stage 5e 测试独立复验（`test-report-v3.md` §2）与产品定向复验（`product-acceptance-v3.md` §1）均 PASS，台账已 **CLOSED**。
8. **其他未测**：AC-037 取消后 SSE 恢复、AC-052 响应式 E2E 断言（脚本空跑）、双客户端 SSE 时序、多实例部署（AC-059 记 `N/A`）、跨设备/多标签页同时登录不同账号（PRD 未要求）。AC-053 已由 Stage 5e 补齐加购连点并转 PASS。
9. **残余 P2/P3**：`PA-D-004` 未知 `/admin/dishes/{id}` 返回 500、`S5C-D-002` 同键第 6 次重试 429、`S5C-D-003` 共享测试库、`DEF-009/010/011/013/014/015/016`、`TE-D-001/002`、`D-FE-04`；Owner/SLA 见 `docs/raw/defect-log.md`。

## 7.6 演示脚本（约 8 分钟）

前置：后端 8083 健康、前端 5175 打开；无需真实 LLM Key。

| # | 操作 | 预期 |
|---|---|---|
| 1 | `curl /api/v1/health` | `status=UP, db=UP`（Redis 可 UP/DOWN） |
| 2 | 员工登录 `employee@webox.com / Employee123` | 进入 `/menu`，显示当日 9+ 道菜、价格 `¥xx.xx` |
| 3 | 搜索/分类筛选 + 打开菜品详情 | 过敏原、辣度、选项组与加价正确 |
| 4 | 选 Whole Wheat + Cheese(+¥3) 加购；再加至 5 份后第 6 份 | 第 6 份被禁用并提示英文上限原因 |
| 5 | 结算页预览 | 显示餐次、截单时间、自动切换标识、预算提示（超限不阻断） |
| 6 | 下单（按钮防抖 + 幂等键） | 201，订单号 `WB...`，库存扣减；重复提交返回同一单 |
| 7 | 我的订单 → 取消 Pending 单 | 状态 Cancelled，库存回补；再取消 409 |
| 8 | 管理员登录 → Console 改价（confirm + reason） | 200；审计记录 before/after/reason/IP；去掉 confirm 再试 → 400 `VALIDATION_CONFIRM_REQUIRED` 且数据不变 |
| 9 | 员工端刷新菜单 | 新价格可见（缓存失效 afterCommit）；历史订单仍为旧价快照 |
| 10 | AI 推荐（无 Key）→ 看板 | `rule-based fallback` 标注、候选已过滤；看板订单/收入/低库存与 DB 一致 |
| 11 | 并发/幂等证据回放 | `order_race` 50 抢 10 不超卖（10×201/40×409、available=0）；`idempotency_race` 同键仅 1 单 |

## 7.7 Git 仓库与推送

- 远端：`https://github.com/zheng12tian404/webox.git`（默认分支 `main`；交付前为空仓库），`git remote -v` 已确认 origin fetch/push 均指向该地址。
- 本地：共享根 `git init -b main`；已删除 `frontend/.git` 嵌套仓库；`.gitignore` 排除 `node_modules/`、`target/`、`dist/`、`.env*`（保留 `.env.example`）、`*.log`、IDE、`uploads/`、`.mico/`。提交前核验 `git ls-files` 中 node_modules/target/dist/.env 计数 = 0。
- 提交范围：`README.md`、`RUNBOOK.md`、`docs/`、`docs/raw/`、`backend/`、`frontend/`、`tests/`、`artifacts/`（文本/截图证据）；**不含**任何密钥/Token/PII，演示账号仅为种子默认值。
- 提交消息：`fix(stage5d): close S5C-D-001 cross-account prefs/cart leak`（含 Stage 5d 前端修复 + Stage 5e 终版文档与 v3 报告）；Stage 5c 基线提交 `83a531f`。最终 commit hash 以 `artifacts/s5e-git-push.log` 的 `git rev-parse HEAD` 为准（本文件不写死可能随 amend 变化的短哈希）。
- 推送结果（Stage 5e，2026-11-14 23:2x CST，重试）：**未推送**。`GIT_TERMINAL_PROMPT=0 git push -u origin main` 返回 **128**，`remote: No anonymous write access.` / `fatal: Authentication failed for 'https://github.com/zheng12tian404/webox.git/'`；无 GitHub 写权限凭据（与 Stage 5c 相同：`gh` 未登录、环境无 Token、SSH 22 不通）。`git ls-remote origin` 可读（exit 0），仅写认证失败。未索取、未记录任何凭据。
- 失败处置：已执行 `git bundle create artifacts/webox-repo.bundle --all`，可用 `git clone artifacts/webox-repo.bundle webox` 恢复全部提交；bundle 大小与 sha256 见 `artifacts/s5e-git-push.log` 与 `artifacts/s5e-doc-check.txt`。
- 恢复推送：在有写权限的环境执行 `git remote set-url origin https://github.com/zheng12tian404/webox.git && git push -u origin main`（需用户自己的凭据）。

## 7.8 下一步

1. **Quality Checker**：依据 `docs/raw/test-report-v3.md`、`docs/raw/product-acceptance-v3.md` 与 `quality-report.md` 做 Go/No-Go 与最终打包；P2/P3 按 `docs/raw/defect-log.md` 的 Owner/SLA 收口。`S5C-D-001` 已 CLOSED，无 open P0/P1，门禁满足。
2. 若需生产化：分布式调度（AC-060）、持续压测（AC-045/046）、真实 LLM 评测、限流下沉 Redis、密钥管理、备份与对账告警演练、跨设备登录边界。
3. 有 GitHub 写权限的环境按 §7.7 恢复推送；本地 commit 与 bundle 已完整保留。