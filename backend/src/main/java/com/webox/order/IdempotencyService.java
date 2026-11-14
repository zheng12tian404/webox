package com.webox.order;

import com.webox.common.Api;
import com.webox.common.Util;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.Map;

@Service
public class IdempotencyService {
    private final JdbcTemplate jdbc;

    public IdempotencyService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record Claim(long id, Integer replayStatus, String replayBody) {
        public boolean replay() { return replayStatus != null; }
    }

    /** T0: claims the key in an independent autocommit transaction. */
    public Claim claim(long userId, String key, String hash) {
        try {
            jdbc.update("INSERT INTO idempotency_records(user_id,idem_key,request_hash,status,expires_at) "
                            + "VALUES (?,?,?,'IN_PROGRESS',?)",
                    userId, key, hash, LocalDateTime.now().plusHours(24));
            Long id = jdbc.queryForObject(
                    "SELECT id FROM idempotency_records WHERE user_id=? AND idem_key=?", Long.class, userId, key);
            return new Claim(id, null, null);
        } catch (DuplicateKeyException ignored) {
            // fall through to the replay / conflict path
        }
        for (int attempt = 0; attempt < 11; attempt++) {
            Map<String, Object> row = jdbc.queryForMap(
                    "SELECT id,request_hash,status,response_status,response_body,updated_at FROM idempotency_records "
                            + "WHERE user_id=? AND idem_key=?", userId, key);
            String existingHash = String.valueOf(row.get("request_hash"));
            if (!existingHash.equals(hash)) {
                throw Api.error(409, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was used with a different request body");
            }
            long id = ((Number) row.get("id")).longValue();
            String status = String.valueOf(row.get("status"));
            if ("COMPLETED".equals(status)) {
                return new Claim(id, ((Number) row.get("response_status")).intValue(),
                        row.get("response_body") == null ? null : String.valueOf(row.get("response_body")));
            }
            if ("FAILED".equals(status)) {
                int n = jdbc.update("UPDATE idempotency_records SET status='IN_PROGRESS' WHERE id=? AND status='FAILED'", id);
                if (n == 1) return new Claim(id, null, null);
                continue;
            }
            Object updatedRaw = row.get("updated_at");
            LocalDateTime updated = updatedRaw instanceof LocalDateTime ldt ? ldt
                    : updatedRaw instanceof Timestamp ts ? ts.toLocalDateTime() : null;
            if (updated != null && updated.isBefore(LocalDateTime.now().minusSeconds(30))) {
                int n = jdbc.update("UPDATE idempotency_records SET status='IN_PROGRESS' "
                        + "WHERE id=? AND status='IN_PROGRESS' AND updated_at=?", id, updated);
                if (n == 1) return new Claim(id, null, null);
                continue;
            }
            try {
                Thread.sleep(200);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }
        throw Api.error(409, "IDEMPOTENCY_CONFLICT", "A request with this Idempotency-Key is still in progress");
    }

    /** T2: independent transaction storing the outcome snapshot (including business 4xx). */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void complete(long id, int status, Map<String, Object> body, Long orderId) {
        jdbc.update("UPDATE idempotency_records SET status='COMPLETED', response_status=?, response_body=?, order_id=? WHERE id=?",
                status, Util.json(body), orderId, id);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void fail(long id) {
        jdbc.update("UPDATE idempotency_records SET status='FAILED', response_status=500 WHERE id=? AND status='IN_PROGRESS'", id);
    }

    public int cleanup() {
        return jdbc.update("DELETE FROM idempotency_records WHERE expires_at < NOW(3) LIMIT 1000");
    }
}