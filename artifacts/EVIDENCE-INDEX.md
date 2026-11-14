# 交付证据索引（G5）

| 类别 | 文件/目录 | 说明 |
|---|---|---|
| 质量门禁 | `docs/quality-report.md`、`artifacts/g5-quality-check.log` | G5 七项、Tier1/2 47.3/50、P6+ 10 项、场景、风险 |
| 测试终版 | `docs/test-report-v3.md`、`artifacts/s5e-smoke.log`、`s5e-cross-account.log`、`s5e-prefs-server.log` | S5e 9/9 冒烟 + S5C-D-001 独立复验 |
| 产品验收终版 | `docs/product-acceptance-v3.md`、`artifacts/s5e-product/` | 跨账号 A→B→A、AC-030/032/014/015/053 回归 |
| 测试回归 | `docs/test-report-v2.md`、`artifacts/s5c-test-regress*.log`、`s5c-test-idem-final.log`、`artifacts/test-conc-order.log` | 48 项回归、幂等、50/10 防超卖 |
| 后端评审 | `docs/backend-review.md`、`docs/backend-rereview.md`、`artifacts/s5c-backend-rereview-evidence.log` | P0/P1 关闭、P6+ 五项 |
| 前端评审 | `docs/frontend-review.md`、`artifacts/evidence/frontend-review/` | FE 五项、响应式截图 |
| 架构评审 | `docs/architecture-review.md`、`docs/architecture-review-closure.md`、`artifacts/s5c-architecture-closure-evidence.txt` | Blocker/Major 关闭、技术基线 |
| 缺陷/评审 | `docs/defect-log.md`、`docs/review-findings.md` | open P0/P1=0；P2/P3 Owner/SLA |
| 构建/启动 | `artifacts/evidence/backend/mvn-test.log`、`artifacts/evidence/frontend/frontend-build.log`、`backend/scripts/start.sh` | mvn 17/17、vite build、JDK17 |
| 文档校验 | `artifacts/s5e-doc-check.txt` | doc 10 份、链接 0 缺失、密钥 0 命中 |
| Git | `artifacts/webox-repo.bundle`、`artifacts/s5e-git-push.log` | 未推送（无凭据）；bundle 可 clone |
