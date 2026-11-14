# Observability & Alerting (AC-058)

## Metrics thresholds (5-minute rolling window)

| Signal | Threshold | Severity | Action |
|---|---|---|---|
| HTTP 5xx ratio | > 1% of requests | P1 | Page on-call, check `ERROR` logs by `requestId`, roll back last deploy if >5% |
| API P95 latency | > 1000 ms | P1 | Check slow SQL (`/admin/dashboard`, menu queries), DB pool saturation |
| Inventory drift (`reconcile.drift` non-empty) | > 0 dish/date | P0 | Freeze ordering for that date, run ledger replay, reconcile before reopening |
| Redis prealloc degradation | any `markDegraded` log line | P2 | Verify Redis 6379; orders fall back to DB_ATOMIC, no oversell |

## Log fields
Every line carries `requestId` and `userId` from MDC (`logging.pattern.console` in `application.yml`); audit rows persist `actor`, `before/after`, `reason`, `ip`, `request_id`.

## Endpoints
- `GET /api/v1/health` — liveness/readiness (DB + Redis status).
- `GET /api/v1/admin/inventory/reconcile?date=YYYY-MM-DD` — drift check used by the alert above.

## Backup / restore
- `backend/scripts/backup.sh [db] [out]` — mysqldump single-transaction, gzip, prints sha256.
- `backend/scripts/restore.sh <backup> <target_db>` — refuses the demo DB unless `ALLOW_DEMO_RESTORE=1`; always restores into the named target only.
