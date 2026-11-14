# 06 · 从零部署

> 适用：本地演示 / 评审复现。目标：一条干净机器上从 0 启动 MySQL、后端、前端并完成登录下单。
> 端口说明：本项目标准端口是后端 **8080**、前端 **5173**；本次运行环境 8080 被系统 nginx 占用、5173 被其他工作区占用，实际验证使用后端 **8083**、前端 **5175**。两种方式都给出。

## 6.1 前置条件

| 组件 | 版本 | 本机路径/校验 |
|---|---|---|
| JDK | 17 | `JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64`；`java -version` |
| Maven | 3.9+ | `/opt/maven/bin/mvn -v` |
| Node.js | 20+（本机 22） | `/opt/nvm/versions/node/v22.22.3/bin/node -v` |
| npm | 10+ | `npm -v` |
| MySQL | 8.0 | `mysql --version`；`127.0.0.1:3306` |
| Redis | 7+（可选） | `redis-cli -p 6379 ping` → `PONG` |

```bash
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export PATH=/opt/gem/bin:/opt/nvm/versions/node/v22.22.3/bin:$JAVA_HOME/bin:/opt/maven/bin:$PATH
export MYSQL_HOST=127.0.0.1 MYSQL_PORT=3306 MYSQL_USER=test MYSQL_PASSWORD=test123456
```

## 6.2 数据库

```bash
# 1) 建库（演示库）
mysql -h127.0.0.1 -utest -ptest123456 -e \
  "CREATE DATABASE IF NOT EXISTS req_6343a752e110 CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"

# 2) 测试库（集成测试会自动建；也可预先创建，禁止与演示库混用）
mysql -h127.0.0.1 -utest -ptest123456 -e \
  "CREATE DATABASE IF NOT EXISTS req_6343a752e110_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
```

- 表结构：`backend/src/main/resources/db/schema.sql`（17 张表 + 种子）。后端启动时 `DbBootstrap` 检测到库内无表会自动执行。
- 种子：20 道菜、16 个选项组、41 个选项、当日/次日/后日菜单与库存（20–50 份）、演示账号、AI 规则。
- 跨天演示：`mysql ... req_6343a752e110 < backend/scripts/reseed_today.sql` 重建当日菜单。
- 重置演示库：`ALLOW_DEMO_RESET=1 bash backend/scripts/reset_demo.sh`（脚本含保护开关）。
- 重置测试库：`backend/scripts/reset_test.sql`（只允许测试库）。

## 6.3 Redis（可选）

```bash
redis-server --daemonize yes
redis-cli -p 6379 ping    # PONG
```

- `REDIS_ENABLED=true`（默认）：热点库存 `REDIS_PREALLOC` 预占；DB 仍是唯一账本，30s 对齐，异常整单降级 `DB_ATOMIC`。
- `REDIS_ENABLED=false`：全部走 DB 原子扣减，功能不降级。
- 验证降级：停掉 Redis 后下单仍成功，响应无 5xx。

## 6.4 后端

```bash
cd backend
/opt/maven/bin/mvn -DskipTests package
# 产物：target/webox-backend.jar

# 标准端口 8080
JWT_SECRET="$(openssl rand -hex 32)" \
MYSQL_DATABASE=req_6343a752e110 SERVER_PORT=8080 REDIS_ENABLED=true \
java -Duser.timezone=Asia/Shanghai -jar target/webox-backend.jar

# 本机实际：8080 被 nginx 占用 → 8083
JWT_SECRET="$(openssl rand -hex 32)" \
MYSQL_DATABASE=req_6343a752e110 SERVER_PORT=8083 REDIS_ENABLED=true \
nohup java -Duser.timezone=Asia/Shanghai -jar target/webox-backend.jar \
  > ../artifacts/backend-8083.log 2>&1 &
```

健康检查：

```bash
curl -s http://127.0.0.1:8083/api/v1/health
# {"code":"OK","message":"OK","data":{"status":"UP","db":"UP","redis":"UP","cache":"UP"},"requestId":"..."}
```

环境变量全集：

| 变量 | 默认 | 必填 | 说明 |
|---|---|---|---|
| `SERVER_PORT` | 8080 | 否 | HTTP 端口 |
| `MYSQL_HOST` / `MYSQL_PORT` | 127.0.0.1 / 3306 | 否 | MySQL 地址 |
| `MYSQL_USER` / `MYSQL_PASSWORD` | test / test123456 | 否 | 本机演示默认；生产用密钥管理注入 |
| `MYSQL_DATABASE` | req_6343a752e110 | 否 | 演示库名 |
| `JWT_SECRET` | 空（随机生成） | **生产必填** | 为空时重启后旧 token 失效 |
| `REDIS_ENABLED` | true | 否 | false = 全量 DB_ATOMIC |
| `REDIS_HOST` / `REDIS_PORT` | 127.0.0.1 / 6379 | 否 | Redis 地址 |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | 空 / OpenAI / gpt-4o-mini | 否 | 空则规则降级 |
| `CORS_ORIGIN` | http://127.0.0.1:5173 | 否 | 前端实际端口不同时覆盖 |
| `UPLOAD_DIR` | ./uploads/images | 否 | 管理端图片目录 |
| `TEST_CLOCK_ENABLED` | false | 否 | 仅 test profile 生效 |

## 6.5 前端

```bash
cd frontend
npm install

# 标准方式：5173 + 后端 8080
npm run dev

# 本机实际：5173 被占用 → 5175，代理指向 8083
VITE_PROXY_TARGET=http://127.0.0.1:8083 VITE_DEV_PORT=5175 npm run dev
# 打开 http://127.0.0.1:5175
```

其他命令：

```bash
npm run typecheck     # tsc --noEmit（strict）
npm run build         # 类型检查 + 生产构建 → dist/
npm run preview       # 预览 dist/
```

前端变量：`VITE_API_BASE_URL=/api/v1`、`VITE_SSE_POLL_MS=5000`、`VITE_REQUEST_TIMEOUT_MS=15000`、`VITE_AI_TIMEOUT_MS=25000`、`VITE_PROXY_TARGET`、`VITE_DEV_PORT`。

## 6.6 演示账号与首登

| 角色 | 邮箱 | 密码 | 入口 |
|---|---|---|---|
| 管理员 | `admin@webox.com` | `Admin12345` | `/login` → `/admin` |
| 员工 | `employee@webox.com` | `Employee123` | `/login` → `/menu` |

> 仅种子默认值，生产必须修改；文档/日志不得记录真实密码。

## 6.7 启动后验证

```bash
# 健康
curl -s http://127.0.0.1:8083/api/v1/health

# 登录（获取 token；不要把输出写入文档/日志）
curl -s -X POST http://127.0.0.1:8083/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@webox.com","password":"Admin12345"}'

# 冒烟（脚本内部处理 token）
BACKEND=http://127.0.0.1:8083 bash backend/scripts/smoke.sh

# 交易时序专项
BACKEND=http://127.0.0.1:8083 bash backend/scripts/g3_checks.sh
```

浏览器步骤：登录 → 菜单可见 9+ 道菜 → 详情选选项 → 加购（≤5 份）→ 结算预览 → 下单 → 我的订单 → 取消（仅 Pending）→ Console 改价（confirm+reason）→ 审计 → 看板。

## 6.8 常见问题（排障）

| 现象 | 原因 | 处理 |
|---|---|---|
| `Port 8080 already in use` | 系统 nginx 占用 | 用 `SERVER_PORT=8083`；或 `ss -ltnp \| grep 8080` 确认后停止占用进程 |
| `Port 5173 already in use` | 其他工作区 dev server | `VITE_DEV_PORT=5175`，并设 `VITE_PROXY_TARGET` 指向实际后端 |
| 启动报 `Unknown database` | 库未创建且账号无建库权限 | 手动执行 6.2 建库 SQL |
| 登录 401 且密码正确 | 种子未初始化/连错库 | 检查 `DbBootstrap` 日志与 `MYSQL_DATABASE`；重启触发 schema |
| 接口 403 | 员工访问 `/admin/**` | 预期行为；用管理员账号 |
| 前端请求 CORS 失败 | 直连后端且 Origin 非默认 | 设 `CORS_ORIGIN=http://127.0.0.1:5175`，或走 Vite 代理 |
| SSE 不更新 | 代理未透传/断线 | 前端自动降级 5s 轮询；检查 `/menu/stream` 与 ticket |
| 下单 409 `STOCK_INSUFFICIENT` | 当日库存不足 | Console 调库存或执行 `reseed_today.sql` |
| 下单 409 `ORDER_DUPLICATE` | 同日同餐次已有有效单 | 取消原单或改餐次/日期 |
| AI 无推荐/慢 | 无 `LLM_API_KEY` | 预期降级 `rule-based fallback`；配置 Key 后走 LLM |
| 跨天后菜单为空 | 种子只覆盖当天+2 天 | 执行 `reseed_today.sql` |
| refresh 返回 401 | token 过期/已轮换 | 重新登录；旧 refresh token 立即失效是设计行为 |

## 6.9 生产注意事项（非本次范围）

- `JWT_SECRET` 必须由密钥管理注入；数据库账号最小权限；关闭默认演示账号。
- 多实例部署需把 30 分钟超时调度改为分布式锁/任务队列（当前单实例 `@Scheduled`）。
- 上传目录需持久化与访问控制；建议前置网关限流/TLS。
- 真实 LLM 需配置超时、重试、成本与内容安全策略；候选集过滤必须保留。
- 备份：MySQL 逻辑备份 + `inventory_ledger` 对账任务；Redis 不作为账本。