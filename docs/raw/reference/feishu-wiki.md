# 「需求开发小队」Agent 设计与 PRD 全流程

<callout emoji="🚀">
**一句话方案**：先用 AI 在 Multica/mico 上设计一个**通用**的 PRD 分析 → 架构 → 开发 → 评审 → 测试 → 质量闭环小队；把任意 PRD 输入小队，由小队自主交付；再通过多次试跑不断迭代 Agent 能力。
</callout>

## 1. 小队总览

- 小队名称：**需求开发小队**（郑田的个人空间）
- 规模：**13 个 Agent + 郑田（tech-lead / 观察者）**
- 目标：**2 小时内**交付可运行的前后端分离全栈系统（JDK 17 + Spring Boot + 独立 MySQL）
- 特点：场景化、自动门禁、作者≠评审者、交叉评审、缺陷闭环、AI 对话原始导出

> 郑田不是 Agent，不进入关键路径；只在不可逆风险或明确 FEEDBACK 时介入。

### 1.1 Agent 清单

| # | Agent | 角色定位 | 主要职责 | 关键产物 |
|-|-|-|-|-|
| 1 | `[需求] - Dispatcher` | 小队 Leader / 交付编排者 | 读 PRD、识别场景、记录 T0、建共享根、按 Stage 派活、控制 SLA、自动门禁、缺陷回环、最终收口 | `RUNBOOK.md`、Stage 子 Issue、进展评论、最终摘要 |
| 2 | `[需求] - 产品工程师` | 产品负责人 | 产品意图、用户旅程、业务规则、角色权限、边界、验收口径、场景 profile 细化、G1/G4 交叉评审 | `prd-analysis.md`、`acceptance-matrix.md`、`scenario-profile.md`、产品验收 |
| 3 | `[需求] - Architecture` | 技术架构师 | 全栈架构、API 契约、数据模型、NFR、事务/并发/幂等/缓存/权限、ADR、G1\~G4 架构评审与抽检 | `architecture.md`、`api-contract.md`、`data-model.md`、`architecture-review.md` |
| 4 | `[需求] - 后端技术方案设计师` | 后端方案设计 | 接口、DDL、事务/锁、幂等、缓存、权限、测试钩子；把架构落成可实现的方案；G2/G3 评审 | `backend-design.md`、`backend-task-list.md` |
| 5 | `[需求] - 前端技术方案设计师` | 前端方案设计 | 页面/路由/状态/API 客户端、响应式、分页、防抖、金额、校验、异常态；G2/G3 评审 | `frontend-design.md`、`frontend-task-list.md` |
| 6 | `[需求] - 后端开发工程师` | 后端实现 | Spring Boot + MySQL 实现、自测、证据；交易红线（幂等/防超卖/取消回补/权限）；按台账修复 | 后端代码、单测/集成测试、证据 |
| 7 | `[需求] - 前端开发工程师` | 前端实现 | React SPA 实现、自测、证据；购物车行身份、数量上限、价格、地址/选项、提交幂等、响应式 | 前端代码、前端测试、截图 |
| 8 | `[需求] - 后端代码评审员` | 后端独立评审 | 7 维评审 + 后端 P6+ 五项；测试代码评审；场景检查；复评关闭 | `backend-review.md` |
| 9 | `[需求] - 前端代码评审员` | 前端独立评审 | 7 维评审 + 前端 P6+ 五项；浏览器抽查；场景检查；复评关闭 | `frontend-review.md` |
| 10 | `[需求] - 测试方案设计师` | 测试设计 | 风险驱动测试方案、AC→用例、场景 required_checks、负向/边界/并发/幂等/权限/金额/响应式 | `test-plan.md`、`test-cases.md`、G1 测试视角评审 |
| 11 | `[需求] - 测试执行工程师` | 测试执行 | 启动全栈，执行 API/DB/E2E/并发/幂等/超卖/截单/权限/金额/SSE/AI 护栏；出报告、登记缺陷、回归 | `test-report.md`、证据目录、`defect-log.md` |
| 12 | `[需求] - Quality Checker` | 质量门禁 | 交付物、Tier1/2 完成度、前后端 P6+、场景 checks、缺陷关闭、Go/No-Go、最终打包 | `quality-report.md`、最终交付 zip |
| 13 | `[需求] - 交付文档与知识沉淀工程师` | 文档与知识 | README/API/架构/测试文档、AI 对话原始导出、知识沉淀、交付包文档 | `README.md`、`docs/API.md`、`docs/ARCHITECTURE.md`、`docs/TESTING.md`、`ai-conversations/` |

## 2. 场景化与质量机制

### 2.1 场景路由

- `scenario-router` + `scenario-library`：general、transaction-order、workflow-approval、search-ranking、realtime-collaboration、reporting-analytics、ai-llm、identity-access、file-media、notification。
- PRD 进入后，Dispatcher 在 T0 识别 primary/secondary 场景，写 `docs/scenario-profile.md`。
- 每个 Agent 交付时追加 `## Scenario checks`，逐项写 PASS/N/A/FAIL + 证据。
- 新增业务场景只新增 profile，不改 Agent，扩展性强。

### 2.2 交叉评审（G1/G2/G3/G4）

| 关口 | 作者 | 交叉评审 | 重点 |
|-|-|-|-|
| G1 | 产品工程师 | Architecture + Test Designer | 业务规则、边界、可测性、NFR、场景 checks |
| G2 | Architecture + Test Designer | 产品 + 测试/架构互评 | 契约、数据模型、事务/并发/幂等、测试钩子 |
| G3 | BTL + FTL | Architecture + 产品 + 测试 | 接口/DDL、页面/状态、验收可测性 |
| G4 | 开发 | BR/FR + 架构抽检 + 产品验收 + 测试执行 | 代码质量、架构符合性、业务验收、测试证据 |

### 2.3 缺陷闭环

登记 → 分级（P0/P1/P2/P3）→ 按根因回到最早责任节点 → 修复 → 原评审复评 → 回归 → 关闭 → 门禁检查。

- GO 前不允许 open P0/P1；
- P2 必须有 Owner 与截止；
- 不允许口头“已改”、不允许静默通过；
- 修复后版本递增、对应门禁失效、只重跑受影响下游。

### 2.4 其他机制

- **作者≠评审者**：代码、需求、架构、测试方案均有独立评审。
- **自动门禁**：G1\~G5 由产物与证据驱动，不等待人工签字。
- **时间盒**：T+100 代码冻结、T+112 测试冻结、T+120 交付。
- **AI 对话原始导出**：主 Issue + 子 Issue comments、全部 runs、Claude Code `.jsonl`，不接受截图/摘要。
- **资深专家人设**：各 Agent 有 30 年互联网大厂专家判断风格，但不改变职责边界；只有 Architecture 保留“架构师”头衔。

## 3. PRD 在小队中的流转全流程

| 阶段 | 时间 | 执行 Agent | 输入 | 动作与产出 | 门禁/评审 |
|-|-|-|-|-|-|
| 0 接收 | T+0 | Dispatcher | PRD、附件、飞书链接 | 场景识别、建共享根、写 `RUNBOOK.md`、建 Stage 1 | — |
| 1 产品/PRD | T+0\~10 | 产品工程师 | PRD、场景 profile | 需求分层、用户旅程、业务规则、AC 矩阵、异常边界、评分卡映射 | G1 |
| 2 架构/测试方案 | T+10\~30 | Architecture + 测试方案设计师 | PRD 分析、AC、场景 profile | 先做 G1 交叉评审；再产出架构、API 契约、数据模型、测试方案/用例 | G2 |
| 3 技术方案 | T+30\~45 | 后端/前端技术方案设计师 | 架构/API/数据模型/测试方案 | 先做 G2 交叉评审；再产出前后端实现级设计 | G3 |
| 3b 方案评审 | T+45\~50 | Architecture + 产品 + 测试 | 前后端方案 | G3 交叉评审；P0/P1 写入 Stage 4 最小修复项 | G3 |
| 4 开发 | T+50\~100 | 后端开发 + 前端开发 | 方案、契约、场景 checks | 实现、自测、证据；T+100 代码冻结 | 代码冻结 |
| 5 评审/测试/文档 | T+100\~115 | BR + FR + Architecture 抽检 + 产品验收 + 测试执行 + 文档 | 代码、契约、测试方案 | 代码评审、架构符合性、产品验收、测试执行、README/API/架构/测试、AI 导出 | G4 |
| 5b 修复 | +8 分钟 | 对应开发 + 原评审 + 测试 | 缺陷台账 | 修复、复评、回归、关闭 | — |
| 6 质量 | T+115\~120 | Quality Checker | 全部产物 | 场景 checks、缺陷关闭、评分卡、最终包、Go/No-Go | G5 |
| 收口 | T+120 | Dispatcher | Quality GO | 最终摘要、关闭主 Issue | — |

> 实际 WeBox v3 试跑：T0 18:16 → GO 20:01/20:05，约 105 分钟；Tier1/2 50/50，前后端 P6+ 各 20/20，38/38 场景 checks，P0/P1=0。

## 4. 全流程图

<whiteboard token="Zi1FwnzxNhNdVqbFyfjcrFH5nAc"></whiteboard>

### 4.1 贯穿全流程的三条线

- **场景线**：`docs/scenario-profile.md` 从 T0 贯穿到 Quality，每个 Agent 都按 active_profiles 检查。
- **证据线**：每个阶段产物、命令、测试、截图、DB 查询都有路径；PASS 必须可追溯。
- **缺陷线**：`review-findings.md` / `defect-log.md` 记录所有问题，P0/P1 不关闭不得 GO。

## 5. 面试叙述建议

1. **先讲“通用小队”，再讲“PRD 输入”**：不是为某个 PRD 写死流程，而是设计一个可复用的研发组织。
2. **重点讲三个机制**：场景路由（按业务加载检查清单）、交叉评审（产品/架构/测试互评）、缺陷闭环（发现→回环→复评→回归→关闭）。
3. **用试跑证明**：WeBox v3 在 105 分钟内 GO，2 个 P1 由评审/测试发现并闭环，Tier1/2 从 42/50 恢复到 50/50。
4. **讲迭代**：v1 串行流程 → v2 并行 2 小时流水线 → v3 场景化 + 交叉评审 + 缺陷闭环 + 资深专家人设；每次试跑都暴露 Agent 能力缺口并修复。
5. **讲扩展性**：新增业务场景只加场景 profile；新增质量要求只加检查项/技能，不改整体编排。

## 6. 后续迭代方向

- 引入 Spec Kit/OpenSpec 强化需求澄清；
- OpenAPI/Pact 做契约测试；
- ArchUnit/Semgrep/JaCoCo/PIT 做架构与代码质量门禁；
- Playwright/Testcontainers 把 E2E 与真实 DB 集成固化成可一键回归的套件；
- 更多场景 profile（支付、审批、实时协同、报表、AI Agent 等）。

<callout emoji="📝">
**核心结论**：这套小队的价值不在于“让 AI 写代码”，而在于把需求、架构、开发、评审、测试、质量做成一条**可编排、可评审、可回滚、可沉淀**的流水线，并通过试跑持续迭代每个 Agent 的能力。
</callout>