package com.webox.inventory;

import com.webox.common.Api;
import com.webox.common.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class RedisStockService {
    private static final Logger log = LoggerFactory.getLogger(RedisStockService.class);
    private final RedisClient redis;
    private final JdbcTemplate jdbc;

    public RedisStockService(RedisClient redis, JdbcTemplate jdbc) {
        this.redis = redis;
        this.jdbc = jdbc;
    }

    public static final class Preallocation {
        private final List<long[]> entries = new ArrayList<>();
        private final LocalDate date;
        private boolean degraded;
        public Preallocation(LocalDate date) { this.date = date; }
        public synchronized void add(long dishId, int qty) { entries.add(new long[]{dishId, qty}); }
        public synchronized List<long[]> entries() { return new ArrayList<>(entries); }
        public LocalDate date() { return date; }
        public boolean isDegraded() { return degraded; }
        public void markDegraded() { degraded = true; }
    }

    private String key(LocalDate date, long dishId) { return "webox:stock:" + date + ":" + dishId; }

    private int ttl(LocalDate date) {
        long secs = Duration.between(LocalDateTime.now(), date.atTime(LocalTime.of(23, 59, 59))).getSeconds();
        return (int) Math.max(60, secs);
    }

    /**
     * Best-effort Redis preallocation. Any Redis failure degrades the whole order to DB_ATOMIC.
     * Throws STOCK_INSUFFICIENT when Redis explicitly reports insufficient stock.
     */
    public void prealloc(Preallocation ctx, long dishId, LocalDate date, int qty, int dbAvailable) {
        if (ctx.isDegraded() || !redis.enabled()) { ctx.markDegraded(); return; }
        try {
            String k = key(date, dishId);
            String v = redis.get(k);
            if (v == null) {
                redis.set(k, String.valueOf(Math.max(0, dbAvailable)), ttl(date));
            }
            long r = redis.prealloc(k, qty);
            if (r == 1) {
                ctx.add(dishId, qty);
                return;
            }
            if (r == -1) {
                redis.set(k, String.valueOf(Math.max(0, dbAvailable)), ttl(date));
                r = redis.prealloc(k, qty);
                if (r == 1) { ctx.add(dishId, qty); return; }
            }
            if (r == 0) {
                Map<String, Object> d = new LinkedHashMap<>();
                d.put("dishId", dishId);
                d.put("requested", qty);
                d.put("available", dbAvailable);
                Map<String, Object> data = new LinkedHashMap<>();
                data.put("details", List.of(d));
                throw Api.error(409, "STOCK_INSUFFICIENT", "Some dishes are sold out or insufficient", data);
            }
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            log.warn("Redis preallocation failed, degrading order to DB_ATOMIC: {}", e.getMessage());
            ctx.markDegraded();
        }
    }

    /** G3A-M1: compensate the WHOLE order's preallocated list when T1 rolls back. */
    public void compensate(Preallocation ctx) {
        if (ctx == null) return;
        for (long[] e : ctx.entries()) {
            try {
                redis.incrBy(key(ctx.date(), e[0]), e[1]);
            } catch (Exception ex) {
                log.warn("Redis compensation failed for dish {}: {}", e[0], ex.getMessage());
            }
        }
    }

    public void sync(LocalDate date, long dishId, int available) {
        if (!redis.enabled()) return;
        try { redis.set(key(date, dishId), String.valueOf(Math.max(0, available)), ttl(date)); }
        catch (Exception e) { log.debug("Redis sync skipped: {}", e.getMessage()); }
    }

    @Scheduled(fixedDelay = 30000)
    public void alignAll() {
        if (!redis.enabled()) return;
        try {
            LocalDate today = LocalDate.now(java.time.ZoneId.of("Asia/Shanghai"));
            for (Map<String, Object> r : jdbc.queryForList(
                    "SELECT dish_id, serve_date, total_qty-reserved_qty-sold_qty AS available FROM dish_daily_stock "
                            + "WHERE inventory_mode='REDIS_PREALLOC' AND serve_date>=?", today)) {
                LocalDate d = ((java.sql.Date) r.get("serve_date")).toLocalDate();
                sync(d, ((Number) r.get("dish_id")).longValue(),
                        Math.max(0, ((Number) r.get("available")).intValue()));
            }
        } catch (Exception e) {
            log.debug("Redis alignment skipped: {}", e.getMessage());
        }
    }
}