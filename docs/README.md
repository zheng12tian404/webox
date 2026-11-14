# WeBox 项目文档索引（`docs/`）

本目录是**交付文档正文**（原 `doc/` 目录已迁移至此）；`docs/raw/` 保留**过程文档与原始证据**（PRD 原文、分析底稿、交叉评审、缺陷台账、各版本测试/验收报告、参考 wiki、图片）。

## 1. 目录结构

```text
docs/
├── README.md                # 本索引
├── 00-prd.md                # PRD、需求分层、业务规则、验收矩阵
├── 01-architecture.md       # 架构、模块、数据流、事务/幂等/并发/权限
├── 02-detailed-design.md    # 后端 + 前端详细设计
├── 03-api.md                # API 契约（39 端点、错误码、SSE）
├── 04-data-model.md         # 17 张表、索引、约束、种子
├── 05-testing.md            # 测试方案 + 用例 + 执行结果
├── 06-deployment.md         # 从零部署（JDK17/MySQL/Redis/前后端）
├── 07-delivery.md           # 交付范围、AC 覆盖、证据索引、限制、Git 推送
├── 08-team-process.md       # 小队流程 + 飞书 wiki 全文
└── raw/                     # 过程文档与原始证据（见下）
    ├── PRD.md / PRD.html / product_images/
    ├── prd-analysis.md / acceptance-matrix.md / assumptions.md / scenario-profile.md
    ├── architecture.md / api-contract.md / data-model.md / schema.sql
    ├── backend-design.md / frontend-design.md
    ├── cross-review-g1*.md / cross-review-g2*.md / cross-review-g3*.md
    ├── backend-review.md / backend-rereview.md / frontend-review.md
    ├── architecture-review*.md / review-findings.md / defect-log.md
    ├── test-plan.md / test-cases.md / test-report*.md
    ├── product-acceptance*.md / prd-verification-final.md
    ├── quality-report.md / observability.md
    └── reference/feishu-wiki.md
```

## 2. 阅读顺序

| # | 文档 | 读者 | 内容 |
|---|---|---|---|
| 00 | [00-prd.md](00-prd.md) | 产品/评审 | PRD 原文、需求分层、业务规则、AC-001–061 验收矩阵 |
| 01 | [01-architecture.md](01-architecture.md) | 架构/后端 | 拓扑、模块、数据流、事务/幂等/并发/缓存/权限、ADR、降级 |
| 02 | [02-detailed-design.md](02-detailed-design.md) | 开发 | 后端实现级设计（表/事务/接口/测试钩子）+ 前端页面/路由/状态/API 客户端 |
| 03 | [03-api.md](03-api.md) | 前后端/测试 | 39 端点契约、请求/响应示例、错误码、鉴权、分页、幂等、SSE |
| 04 | [04-data-model.md](04-data-model.md) | 后端/DBA | 17 张表、索引、约束、种子、DDL 证据 |
| 05 | [05-testing.md](05-testing.md) | 测试/质量 | 测试方案 + 85 用例 + 执行证据 + AC 覆盖状态（含 NOT TESTED） |
| 06 | [06-deployment.md](06-deployment.md) | 运维/复现 | 从零部署（MySQL/Redis/后端/前端）、端口、环境变量、排障 |
| 07 | [07-delivery.md](07-delivery.md) | 交付/质量 | 范围、Tier1/2 AC 覆盖、评分卡、证据索引、限制、演示脚本、Git 推送 |
| 08 | [08-team-process.md](08-team-process.md) | 流程/知识 | 小队 Stage 流程、门禁机制、飞书 wiki 全文 |

## 3. 关于原 `doc/` 与 `docs/` 的重叠

- **有同源重叠，但不是重复拷贝**：
  - `docs/00-08` 是**精选整合版**，按阅读顺序编排，面向项目读者；
  - `docs/raw/` 是**原始底稿与过程证据**，保留版本演进、交叉评审、缺陷台账、测试/验收各版本，供审计与追溯。
- 对应关系示例：
  - `docs/02-detailed-design.md` ← 整合 `raw/backend-design.md` + `raw/frontend-design.md`
  - `docs/05-testing.md` ← 整合 `raw/test-plan.md` + `raw/test-cases.md` + `raw/test-report*.md`
  - `docs/08-team-process.md` ← `raw/reference/feishu-wiki.md` + 小队流程说明
  - `docs/03-api.md` ← `raw/api-contract.md`（终版契约）
- 仓库中不再保留根目录 `doc/`；原 `doc/` 内容已全部迁移到本目录（`docs/00-08 + README`），原 `docs/` 内容已全部迁移到 `docs/raw/`。

## 4. 约定

- 端口：标准 8080/5173；本次实测 8083/5175（原因与两种启动方式见 06）。
- 金额一律整数分（BIGINT）；用户可见文案英文。
- 状态口径：`PASS` 必须有命令/DB/截图证据；未取得证据的一律 `NOT TESTED`。
- 文档不含密钥、Token、真实用户隐私；演示账号仅为种子默认值。

## 5. 相关入口

- 仓库总览与飞书 wiki 全文：[`../README.md`](../README.md)
- 执行手册（时间盒/环境/默认决策 D1–D26）：[`../RUNBOOK.md`](../RUNBOOK.md)
- AI 对话记录（前 7 条对话、其余全部对话、README 三个文件 + `raw/` 原始数据）：[`../ai-conversations/README.md`](../ai-conversations/README.md)
- 原始过程证据：本目录 [`raw/`](raw/)