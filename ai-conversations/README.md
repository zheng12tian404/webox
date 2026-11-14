# AI 对话记录（ai-conversations/）

- 导出时间：2026-11-15 00:30 CST（实时抓取 MiCO 评论）
- 原始 Issue：`6343a752-e110-407c-8dfb-a5873425d917`（WS-55）
- 覆盖：**30 个 Issue**（主 Issue + 29 个子 Issue）、**77 条评论**
- 顶层为 **3 个 Markdown 记录 + 1 个说明 PDF**；原始 JSON / runs / Claude Code transcript 统一放在 `raw/`。

## 文件

| 文件 | 内容 | 时间范围 | 条目 |
|---|---|---|---|
| [`01-first-7-conversations.md`](01-first-7-conversations.md) | **郑田前 7 条对话**及对应 Agent/系统回复（需求提出 → 状态机要求 → GitHub/README → doc 目录 → 启动验收 → 代码 zip） | 2026-11-14 21:45:42 – 2026-11-14 23:34:01 | 66 |
| [`README.md`](README.md) | 本说明 | — | — |
| [`需求开发小队说明.pdf`](需求开发小队说明.pdf) | 用户提供的《需求开发小队说明》PDF（原样保存，662,995 bytes；SHA-256 `290e322e2d9638f79dab9b8c28138de25a3e3f882735d276446c6f54a9e7c654`） | — | — |

## 说明 PDF

- `需求开发小队说明.pdf`：用户在 2026-11-14 16:28 评论中提供的附件，原样保存（PDF 1.7，662,995 bytes）。
- 用途：对“需求开发小队”的分工、流程与交付标准的说明材料；与 `01/02` 对话记录、`raw/` 原始数据互为补充。
- 校验：SHA-256 `290e322e2d9638f79dab9b8c28138de25a3e3f882735d276446c6f54a9e7c654`。

## 时间与作者

- 每条记录格式：`#### [YYYY-MM-DD HH:MM:SS] 作者`；郑田的发言前有 `🔹 郑田第 N 条对话` 标记。
- 作者包括：郑田（用户）、Dispatcher、产品/架构/前后端方案、前后端开发、双端评审、测试方案/执行、Quality、文档工程师、系统通知。
- 评论为实时抓取；`runs/` 为平台运行消息快照（截至 2026-11-14 23:20）。

## raw/ 原始数据

| 路径 | 内容 |
|---|---|
| `raw/main-issue.json` / `raw/children.json` | 主 Issue 与 30 个 Issue 的结构 |
| `raw/comments/*.json` | 每个 Issue 的原始评论 JSON |
| `raw/runs/*.json` / `raw/runs-meta/` | Agent 运行消息与元数据 |
| `raw/claude-code/*.jsonl` | 18 个本机 Claude Code 原始 transcript |
| `raw/USER-AGENT-CONVERSATION.md` | 旧版全量可读记录（兼容保留） |
| `raw/AGENT-COLLABORATION-RECORD.md` | Agent 协作专题记录（兼容保留） |
| `raw/CLAUDE-CODE-RAW-TRANSCRIPTS.md` | Claude Code transcript 清单（兼容保留） |
| `raw/INDEX.md` | 原始导出索引 |

## 隐私

- 不含真实密钥/Token/PII；演示账号仅为种子默认值。
- 平台附件链接为临时签名地址，会过期。
