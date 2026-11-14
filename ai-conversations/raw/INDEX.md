# AI 对话导出索引（ai-conversations/INDEX.md）

- 主 Issue：`6343a752-e110-407c-8dfb-a5873425d917`（WS-55）
- 导出时间：**2026-11-15 00:05 CST**（MiCO 评论实时抓取；Claude Code 为原始文件）
- 覆盖：**30 个 Issue**（主 Issue + 29 个子 Issue）、**73 条评论**
- 原则：原始平台记录，未筛选、未截断、未改写；每条记录带 `[YYYY-MM-DD HH:MM:SS]` 时间。

## 1. 可读记录（推荐先看）

| 文件 | 内容 | 条目 |
|---|---|---|
| [`USER-AGENT-CONVERSATION.md`](USER-AGENT-CONVERSATION.md) | **记录一**：郑田 ↔ 全部 Agent 的完整对话（含系统阶段通知） | 73 条评论文本 + 时间/作者/Issue/附件名 |
| [`AGENT-COLLABORATION-RECORD.md`](AGENT-COLLABORATION-RECORD.md) | **记录二**：各 Agent 相互协作（交付、评审、修复、门禁、阶段推进）；附录为系统通知 | 50 条 Agent 评论 + 11 条系统通知 |
| [`CLAUDE-CODE-RAW-TRANSCRIPTS.md`](CLAUDE-CODE-RAW-TRANSCRIPTS.md) | **记录三**：本机 Claude Code 原始 `.jsonl` transcript 清单 | 18 个会话文件（大小/hash/读取方式） |
| [`README.md`](README.md) | 本目录使用说明、时间口径、隐私与重生成方式 | — |

## 2. 原始数据

| 文件/目录 | 类型 | 说明 |
|---|---|---|
| `main-issue.json` | issue | 主 Issue 全文与元数据（需求、附件、创建时间） |
| `children.json` | issue | 30 个 Issue 的阶段结构（Stage 1–6 + 5b/5c/5d/5e） |
| `comments/*.json` | comment | 每个 Issue 的原始评论 JSON（30 个文件，实时抓取） |
| `runs/*.json` | run | 27 个 Agent 运行消息快照（平台导出，截至 2026-11-14 23:20） |
| `runs-meta/` | run | 运行元数据 |
| `claude-code/*.jsonl` | transcript | 18 个 Claude Code 编码会话原始逐行 JSON |

## 3. 统计

- 评论作者：郑田（用户）12 条、Agent 50 条、系统通知 11 条（合计 73 条）
- 时间范围：2026-11-14 21:45:42 – 2026-11-15 00:01:15（Asia/Shanghai）
- Claude Code transcript：18 个文件，约 25 MB
- 原始目录总大小：约 25 MB

## 4. 未取得项与说明

- `runs/` 为 23:20 平台快照；之后新增的 Stage 5d/5e/6 运行消息未重新导出，评论记录已覆盖到 00:01。
- Claude Code transcript 由本机客户端原始文件复制，未做摘要；`CLAUDE-CODE-RAW-TRANSCRIPTS.md` 提供清单与读取方式。
- 不含真实密钥/Token/PII；平台附件链接为临时签名地址，会过期。
- 重新生成：见 [`README.md`](README.md) 的“如何重新生成”。