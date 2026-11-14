# WeBox Frontend (React 18 + TypeScript + Vite)

Employee meal ordering SPA with an admin Console.

## Run

```bash
export PATH=/opt/nvm/versions/node/v22.22.3/bin:$PATH
npm install
npm run typecheck        # tsc --noEmit (strict)
npm run build            # production build -> dist/
npm run dev -- --host 0.0.0.0 --port 5173
```

Dev server proxies `/api` to `http://127.0.0.1:8080/api/v1` (override with `VITE_PROXY_TARGET` + `VITE_DEV_PORT`).

```bash
VITE_PROXY_TARGET=http://127.0.0.1:8083 VITE_DEV_PORT=5175 npm run dev
```

Environment: `VITE_API_BASE_URL=/api/v1`, `VITE_SSE_POLL_MS=5000`, `VITE_REQUEST_TIMEOUT_MS=15000`, `VITE_AI_TIMEOUT_MS=25000`.

## Routes

Employee: `/login`, `/register`, `/` and `/menu`, `/dishes/:dishId`, `/cart`, `/checkout`, `/order-success/:orderId`, `/orders`, `/orders/:orderId`, `/preferences`.

Console (ADMIN): `/admin`, `/admin/dishes`, `/admin/dishes/new`, `/admin/dishes/:dishId/edit`, `/admin/daily-menu`, `/admin/orders`, `/admin/inventory`, `/admin/audit`, `/admin/ai-rules`. `/console/*` redirects to `/admin`.

## Architecture notes

- Zustand stores: `authStore` (memory access token + localStorage refresh token/user), `cartStore` (localStorage `webox.cart.v1`, max 5 total items), `stockStore` (SSE availability map), `prefsStore`.
- API client: unified envelope, Bearer, single-flight 401 refresh, timeouts, pagination, `Idempotency-Key`.
- SSE: `fetch + ReadableStream` for `/menu/stream` (`snapshot|stock`, 3 failures → 5s polling) and `/ai/recommend` (`meta|dish|reason|done`, fallback badge).
- Money: integer cents end-to-end, `formatMoney(cents)` → `¥22.50`, `parseYuanToCents` without float arithmetic.
- Test hooks: `data-testid` per `docs/frontend-design.md` §9; error toasts carry `data-error-code` and `data-request-id`.

## Local mock (UI-only, not shipped)

`scripts/mock-api.mjs` is a contract-shaped mock for UI self-test when the backend is unavailable:

```bash
MOCK_PORT=19080 node scripts/mock-api.mjs
```

It is **not** evidence of backend integration; real-backend results are in `../artifacts/frontend-real-api.log`.

## Known environment notes

- Port 8080 is occupied by an nginx instance in this workspace; the backend was verified on 8083 (`SERVER_PORT=8083 java -jar backend/target/webox-backend.jar`).
- Dev port 5173 is occupied by another workspace; frontend was verified on 5175.
- Backend `POST /api/v1/auth/refresh` was fixed in Stage 5/5c (`Util.localDateTime` no longer blind-casts JDBC timestamps); verified login → refresh 200 → `/me` 200 → old refresh 401. A full page reload keeps the session.
