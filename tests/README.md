# WeBox 测试脚手架

- 版本：v1.0（Stage 2 Test Designer，2026-11-14）
- 对应方案：`docs/test-plan.md`；用例：`docs/test-cases.md`；契约：`docs/api-contract.md`
- 只包含测试脚本与断言，**不含业务实现**。Stage 5 可直接运行；本阶段只验证脚本语法（`node --check` / `bash -n`）。

## 1. 目录

```text
tests/
├── api/                 # API 契约/异常/权限（Node 22 fetch）
│   ├── lib.mjs          # 公共请求/断言/证据/DB 查询
│   ├── smoke.mjs        # TC-079 健康 + 种子 + 图片
│   ├── auth.mjs         # TC-001~005、TC-084 提权
│   ├── menu.mjs         # TC-010~018 分页/筛选/搜索/注入/详情/选项
│   ├── orders.mjs       # TC-029~037、044~046 下单/幂等/唯一单/取消/篡改价
│   ├── authz.mjs        # TC-047/051/074 角色隔离/越权/篡改 JWT
│   ├── validation.mjs   # TC-070~072 包络/长度边界/限流
│   └── perf.mjs         # TC-068/069 延迟采样
├── concurrency/
│   ├── order_race.mjs        # TC-058 50 并发抢 10 份
│   └── idempotency_race.mjs  # TC-034 同键 5 并发 + 2 串行
├── sql/
│   ├── reset.sql        # 清事务数据 + 释放 reserved（仅独立库）
│   └── assertions.sql   # 库存非负/唯一有效单/ledger/金额/哈希/审计
└── e2e/
    ├── checklist.md     # agent-browser 人工/半自动步骤
    └── run_e2e.sh       # 三档 viewport 截图 + 横向滚动断言
```

## 2. 环境变量

```bash
export BASE_URL=http://127.0.0.1:8080
export APP_URL=http://127.0.0.1:5173
export MYSQL_HOST=127.0.0.1 MYSQL_PORT=3306 MYSQL_USER=test MYSQL_PASSWORD=test123456
export MYSQL_DATABASE=req_6343a752e110
export RUN_ID=$(date +%Y%m%d%H%M%S)
export EVIDENCE_DIR=/home/gem/code/req-squad/workspace/6343a752-e110-407c-8dfb-a5873425d917/artifacts/test/$RUN_ID
mkdir -p "$EVIDENCE_DIR"
```

依赖：Node ≥22（原生 fetch）、`mysql` 客户端、`agent-browser`、后端 test profile（`webox.test.clock-enabled=true`，供 `X-Test-Clock`）。

## 3. 执行顺序

```bash
# 0) 重置数据（仅独立库；会清空订单/ledger/幂等）
mysql -h127.0.0.1 -utest -ptest123456 req_6343a752e110 < tests/sql/reset.sql

# 1) 健康与种子（失败先修环境，不要继续）
node tests/api/smoke.mjs

# 2) 功能/权限/校验
node tests/api/auth.mjs
node tests/api/menu.mjs
node tests/api/orders.mjs
node tests/api/authz.mjs
node tests/api/validation.mjs

# 3) 并发与幂等（保留原始输出）
node tests/concurrency/order_race.mjs
node tests/concurrency/idempotency_race.mjs

# 4) DB 不变量（违规查询应 0 行）
mysql -h127.0.0.1 -utest -ptest123456 req_6343a752e110 < tests/sql/assertions.sql \
  | tee "$EVIDENCE_DIR/db-assertions.tsv"

# 5) 性能（正式口径：QPS=50 / DURATION=60；下单 QPS=10）
PERF_QPS=50 PERF_DURATION_S=60 node tests/api/perf.mjs

# 6) E2E 截图（完整交互按 tests/e2e/checklist.md）
bash tests/e2e/run_e2e.sh
```

退出码：任一 `FAIL` → 1；`SKIP` 不计入失败但必须在报告中说明原因。所有脚本输出 `<name>.json` 到 `$EVIDENCE_DIR`。

## 4. 断言与环境约定

| 项 | 约定 |
|---|---|
| 响应包络 | `{code,message,data,requestId}`；`X-Request-Id` 与 body `requestId` 同值 |
| 登录字段 | `data.accessToken`；角色 `data.user.role`（`roleOf()` 已兼容 `data.role`） |
| 幂等 | `POST /orders` 头 `Idempotency-Key` 8~64；缺失 400；异体 409 |
| 取消 | `POST /orders/{id}/cancel` body `{reason}` |
| 管理员置态 | `PATCH /admin/orders/{id}/status` `{toStatus,confirm,reason}` |
| 库存设置 | `PUT /admin/daily-menu/{serveDate}/{dishId}/stock` `{totalQty,confirm,reason}` |
| 对账 | `GET /admin/inventory/reconcile?date=`；`POST /admin/inventory/adjust` |
| 截单时钟 | `X-Test-Clock: 2026-11-14T10:00:00+08:00`（仅 test profile） |
| SSE | `GET /menu/stream`（Bearer）；事件 `snapshot|stock|meta|dish|reason|done` |

## 5. 并发夹具说明（G1A-05 / G1T-M2）

`order_race.mjs` 默认通过 SQL 复制种子员工 `password_hash` 直插 `race_<RUN_ID>_<i>@test.com`（密码 `Employee123`），规避注册限流；DB 直插失败时回退注册接口并显式 `SKIP` 提示可能触发 429。执行前请确认 `users` 表存在种子员工。

## 6. 测试数据与安全

- 只在独立库 `req_6343a752e110` 操作；`reset.sql` 顶部有 `USE` 保护性声明，禁止改库名执行到共享库。
- 不打印/落盘 JWT 全文、密码哈希、API Key；证据只保留状态码、响应片段、DB 聚合值。
- 低库存/售罄演示：用 H3 设 `totalQty=3/0`，测后恢复 30（或重跑种子），避免污染后续用例。
- AI 无 Key：`unset LLM_API_KEY` 后重启后端；真实模型质量记 `NOT TESTED`。

## 7. 已知依赖（未满足时的处理）

| 依赖 | 未满足时 |
|---|---|
| 后端 8080 / 前端 5173 未启动 | 全部 API/E2E 记 `NOT TESTED`，不得判 PASS |
| mysql 客户端/表名不符 | DB 断言 `SKIP`，按 `docs/data-model.md` 调整 SQL |
| `X-Test-Clock` 未生效 | TC-039a~g / TC-040 记 `NOT TESTED`（不得用真实时钟近似） |
| Redis 未启动 | TC-066 的 `REDIS_PREALLOC` 降级分支可执行，预占正常分支记 `N/A(Redis 不可用)` |
| LLM 无 Key | TC-062 真实流式 `NOT TESTED`；TC-063 降级必须 PASS |