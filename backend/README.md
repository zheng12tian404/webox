# WeBox Backend — WeBox 员工餐食订购平台

Spring Boot 3.3 / JDK 17 / MySQL 8.0 / JdbcTemplate + Spring Security (JWT) / Caffeine 缓存。
实现 `docs/api-contract.md` v1.1 的 **39 个端点**（#1–#38 + #33b），金额全链路整数分（BIGINT cents）。

## 1. 环境要求

| 项 | 值 |
|---|---|
| JDK | 17（`JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64`） |
| Maven | 3.9+ |
| MySQL | 8.0，`127.0.0.1:3306`，默认 `test/test123456` |
| Redis | 可选，`127.0.0.1:6379`（`REDIS_ENABLED=false` 时整单降级 DB_ATOMIC） |
| 端口 | 默认 8080（可用 `SERVER_PORT` 覆盖） |

> 本机运行环境 8080 被系统 nginx 占用、5173 被其他工作区占用；本次验证使用 **8083**（标准默认仍为 8080，可用 `SERVER_PORT` 覆盖）。`scripts/start.sh` 已固定 JDK17 绝对路径并在启动后做 health 探测；前端代理需指向实际后端端口。

## 2. 数据库

| 用途 | 库名 |
|---|---|
| 演示 | `req_6343a752e110` |
| 测试（隔离，禁止连演示库） | `req_6343a752e110_test` |

- 首次启动自动执行 `src/main/resources/db/schema.sql`：17 张表 + 种子（20 菜 / 16 选项组 / 41 选项 / 当日+1+2 日菜单与库存 / 管理员与员工 / AI 规则）。
- 种子账号：`admin@webox.com / Admin12345`（ADMIN）、`employee@webox.com / Employee123`（EMPLOYEE）；BCrypt cost 10 入库。
- 跨天演示前执行 `scripts/reseed_today.sql`（重建当日/次日/后日菜单与库存）。
- 重置：`scripts/reset_test.sql`（仅测试库）；`scripts/reset_demo.sh`（必须 `ALLOW_DEMO_RESET=1`）。

## 3. 构建与启动

```bash
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
cd backend

# 测试（连接 req_6343a752e110_test，@ActiveProfiles("test")）
/opt/maven/bin/mvn test

# 打包（可执行 jar）
/opt/maven/bin/mvn -DskipTests package

# 启动（演示库；本机 8083，标准 8080）
JWT_SECRET="$(openssl rand -hex 32)" \
SERVER_PORT=8083 MYSQL_DATABASE=req_6343a752e110 \
nohup java -Duser.timezone=Asia/Shanghai -jar target/webox-backend.jar > backend-run.log 2>&1 &

curl -s http://127.0.0.1:8083/api/v1/health
```

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `SERVER_PORT` | 8080 | HTTP 端口 |
| `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE` | 127.0.0.1/3306/test/test123456/req_6343a752e110 | JDBC |
| `JWT_SECRET` | 空 → 启动时随机生成 | 生产必须设置；未设置时重启后 token 失效 |
| `REDIS_ENABLED/HOST/PORT` | true/127.0.0.1/6379 | 热点库存预占与健康检查 |
| `TEST_CLOCK_ENABLED` | false | 仅 test profile 允许 `X-Test-Clock` |
| `LLM_API_KEY/BASE_URL/MODEL` | 空/openai/gpt-4o-mini | 为空时 AI 规则降级（`fallback:true`） |
| `CORS_ORIGIN` | http://127.0.0.1:5173 | 允许来源（同时允许 localhost:5173） |
| `UPLOAD_DIR` | ./uploads/images | 管理员图片上传目录 |

密钥不落库、不写日志；日志仅输出 requestId/userId/method/path/status/duration。

## 4. 关键实现

- **幂等三段式**：T0 独立事务抢占 `idempotency_records(IN_PROGRESS)` → T1 单业务事务 → T2 独立事务落 `COMPLETED`（含业务 4xx 快照）；仅 5xx 落 `FAILED` 可重试；并发同键轮询 2s。`uk_orders_idem` 1062 → `IDEMPOTENCY_CONFLICT`。
- **防超卖**：`UPDATE dish_daily_stock SET reserved_qty=reserved_qty+? WHERE total-reserved-sold>=?`；0 行 → 409 `STOCK_INSUFFICIENT`（details）；死锁重试 1 次；`ck_stock_nonneg` 兜底。
- **唯一有效单**：`active_key` 生成列 + `uk_orders_active`；1062 → 409 `ORDER_DUPLICATE` + `existingOrderId`；取消/完成自动置 NULL。
- **ledger**：`ORD:{orderId}:D:{dishId}:RESERVE|RELEASE|CONFIRM` 唯一；`INSERT IGNORE` 后仅首次改库存；对账 drift=0。
- **Redis 双策略**：`REDIS_PREALLOC` 先 Lua DECRBY 再 DB 条件扣减；T1 失败按**整单**预占清单 INCRBY 补偿；Redis 异常整单降级 DB_ATOMIC；30s 对齐，DB 为唯一账本。
- **30 分钟超时**：`@Scheduled` 每 60s CAS 取消 + RELEASE 一条；测试用 SQL 回拨 `created_at` 后 ≤60s 触发。
- **权限**：BCrypt + HMAC JWT + 刷新令牌轮换（SHA-256 存哈希、旧值立即失效）；`/admin/**` ADMIN，员工 403；他人订单 404 防枚举；高风险操作 `confirm+reason+audit`。
- **缓存**：Caffeine 60s 缓存菜单静态字段与筛选枚举；写操作（菜品/每日菜单/库存）立即失效；库存每次实时查 DB。
- **SSE**：菜单流 `snapshot`/`stock`（仅 dishId+available）、15s 心跳、`retry:3000`；ticket 60s 内最多兑换 3 次；afterCommit 推送。
- **AI**：确定性候选过滤（上架/有库存/过敏原/近 7 天）→ 规则打分或 LLM 排序；无 Key 1s 内 `fallback:true`；规则版本化与回滚。

## 5. 测试与脚本

| 命令/脚本 | 内容 |
|---|---|
| `mvn test` | `UtilTest`（金额/六边界截单/哈希/状态机/LIKE 转义）+ `WeBoxApiIT`（测试库隔离、鉴权/校验/403、幂等重放与冲突、5 并发同键 1 单、6 人抢 3 份不超卖） |
| `scripts/smoke.sh` | 健康/登录/菜单/详情/预览/下单/重放/异体/重复单/取消/403/售罄 409/审计/看板/对账/AI 降级 |
| `scripts/g3_checks.sh` | 30 分钟超时释放（130s 两个调度周期）、Redis 整单补偿、测试时钟拒绝、SSE ticket、对账 |
| `tests/concurrency/order_race.mjs` | 15 用户抢 5 份基线；Stage 5c 以 `tests/s5c-regress*.mjs` 完成 50 用户抢 10 份（10×201 / 40×409、available=0） |
| `tests/concurrency/idempotency_race.mjs` | 同键 5 并发 + 2 串行：1 单，1 条 RESERVE |

## 6. 已知限制

- 8080 在本次运行环境被 nginx 占用，演示实例使用 8083（标准 8080）；`/api/v1` 路径与契约一致。`scripts/start.sh` 固定 JDK17 并做 health 探测。
- 单实例 `@Scheduled`（演示足够）；多实例需分布式锁（ADR-004 文档化）。
- 真实 LLM 质量未验证（无 Key）；规则降级路径已验证。
- 支付/退款按 D22 不实现。