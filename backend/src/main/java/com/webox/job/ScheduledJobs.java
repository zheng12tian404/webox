package com.webox.job;

import com.webox.order.IdempotencyService;
import com.webox.order.OrderService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@Component
public class ScheduledJobs {
    private static final Logger log = LoggerFactory.getLogger(ScheduledJobs.class);
    private final JdbcTemplate jdbc;
    private final OrderService orders;
    private final IdempotencyService idempotency;

    public ScheduledJobs(JdbcTemplate jdbc, OrderService orders, IdempotencyService idempotency) {
        this.jdbc = jdbc;
        this.orders = orders;
        this.idempotency = idempotency;
    }

    /** Releases Pending orders older than 30 minutes exactly once (CAS + ledger unique key). */
    @Scheduled(fixedDelay = 60000, initialDelay = 15000)
    public void releaseTimedOutOrders() {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id FROM orders WHERE status='Pending' AND created_at < NOW(3) - INTERVAL 30 MINUTE LIMIT 100");
        int released = 0;
        for (Map<String, Object> r : rows) {
            try {
                if (orders.timeoutCancel(((Number) r.get("id")).longValue())) released++;
            } catch (Exception e) {
                log.warn("Timeout release failed for order {}: {}", r.get("id"), e.getMessage());
            }
        }
        if (released > 0) log.info("Timeout released {} pending orders", released);
    }

    /** Confirmed orders past their delivery day (23:59) become Completed with a SYSTEM audit row. */
    @Scheduled(fixedDelay = 60000, initialDelay = 20000)
    public void autoCompleteOrders() {
        LocalDate today = com.webox.common.RequestContext.today();
        List<Long> ids = jdbc.queryForList(
                "SELECT id FROM orders WHERE status='Confirmed' AND delivery_date < ? LIMIT 200", Long.class, today);
        int done = 0;
        for (Long id : ids) {
            int n = jdbc.update("UPDATE orders SET status='Completed' WHERE id=? AND status='Confirmed'", id);
            if (n == 0) continue;
            jdbc.update("INSERT INTO audit_log(actor_id,actor_email,action,object_type,object_id,before_json,after_json,reason) "
                            + "VALUES (NULL,'SYSTEM','ORDER_AUTO_COMPLETE','ORDER',?,?,?,'AUTO_COMPLETE')",
                    String.valueOf(id), "{\"status\":\"Confirmed\"}", "{\"status\":\"Completed\"}");
            done++;
        }
        if (done > 0) log.info("Auto-completed {} confirmed orders past delivery day", done);
    }

    @Scheduled(fixedDelay = 3600000, initialDelay = 30000)
    public void cleanupIdempotency() {
        int n = idempotency.cleanup();
        if (n > 0) log.info("Deleted {} expired idempotency records", n);
    }

    @Scheduled(fixedDelay = 3600000, initialDelay = 45000)
    public void cleanupRefreshTokens() {
        jdbc.update("DELETE FROM refresh_tokens WHERE expires_at < NOW(3) LIMIT 1000");
    }
}