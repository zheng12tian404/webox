package com.webox.inventory;

import com.webox.common.Api;
import com.webox.realtime.SseHub;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class InventoryService {
    private final JdbcTemplate jdbc;
    private final SseHub sseHub;

    public InventoryService(JdbcTemplate jdbc, SseHub sseHub) {
        this.jdbc = jdbc;
        this.sseHub = sseHub;
    }

    public int available(long dishId, LocalDate date) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT total_qty-reserved_qty-sold_qty AS available FROM dish_daily_stock WHERE dish_id=? AND serve_date=?",
                dishId, date);
        if (rows.isEmpty()) return 0;
        return Math.max(0, ((Number) rows.get(0).get("available")).intValue());
    }

    /** Atomic conditional reservation. Returns {before, after}. */
    public int[] reserve(long dishId, LocalDate date, int qty) {
        int n = jdbc.update("UPDATE dish_daily_stock SET reserved_qty=reserved_qty+?, version=version+1 "
                        + "WHERE dish_id=? AND serve_date=? AND total_qty-reserved_qty-sold_qty>=?",
                qty, dishId, date, qty);
        if (n == 0) {
            int avail = available(dishId, date);
            Map<String, Object> detail = new LinkedHashMap<>();
            detail.put("dishId", dishId);
            detail.put("requested", qty);
            detail.put("available", avail);
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("details", List.of(detail));
            throw Api.error(409, "STOCK_INSUFFICIENT", "Some dishes are sold out or insufficient", data);
        }
        int after = available(dishId, date);
        publish(dishId, after);
        return new int[]{after + qty, after};
    }

    public String mode(long dishId, LocalDate date) {
        List<String> m = jdbc.queryForList(
                "SELECT inventory_mode FROM dish_daily_stock WHERE dish_id=? AND serve_date=?", String.class, dishId, date);
        return m.isEmpty() ? "DB_ATOMIC" : m.get(0);
    }

    /** Release reserved stock exactly once, guarded by ledger business key. */
    public void release(long orderId, long dishId, LocalDate date, int qty, String operator, String reason) {
        String businessKey = "ORD:" + orderId + ":D:" + dishId + ":RELEASE";
        Map<String, Object> row = lockStock(dishId, date, qty);
        int before = ((Number) row.get("available")).intValue();
        int inserted = jdbc.update("INSERT IGNORE INTO inventory_ledger"
                        + "(order_id,dish_id,serve_date,entry_type,qty,before_available,after_available,business_key,operator,reason) "
                        + "VALUES (?,?,?,'RELEASE',?,?,?,?,?,?)",
                orderId, dishId, date, qty, before, before + qty, businessKey, operator, reason);
        if (inserted == 0) return; // already released
        int n = jdbc.update("UPDATE dish_daily_stock SET reserved_qty=reserved_qty-?, version=version+1 "
                + "WHERE dish_id=? AND serve_date=? AND reserved_qty>=?", qty, dishId, date, qty);
        if (n == 0) throw Api.error(409, "ORDER_STATE_INVALID", "Reserved stock is inconsistent");
        publish(dishId, before + qty);
    }

    /** Move reserved -> sold exactly once. */
    public void confirm(long orderId, long dishId, LocalDate date, int qty, String operator, String reason) {
        String businessKey = "ORD:" + orderId + ":D:" + dishId + ":CONFIRM";
        Map<String, Object> row = lockStock(dishId, date, qty);
        int before = ((Number) row.get("available")).intValue();
        int inserted = jdbc.update("INSERT IGNORE INTO inventory_ledger"
                        + "(order_id,dish_id,serve_date,entry_type,qty,before_available,after_available,business_key,operator,reason) "
                        + "VALUES (?,?,?,'CONFIRM',?,?,?,?,?,?)",
                orderId, dishId, date, qty, before, before, businessKey, operator, reason);
        if (inserted == 0) return;
        int n = jdbc.update("UPDATE dish_daily_stock SET reserved_qty=reserved_qty-?, sold_qty=sold_qty+?, version=version+1 "
                + "WHERE dish_id=? AND serve_date=? AND reserved_qty>=?", qty, qty, dishId, date, qty);
        if (n == 0) throw Api.error(409, "ORDER_STATE_INVALID", "Reserved stock is inconsistent");
    }

    public void reserveLedger(long orderId, long dishId, LocalDate date, int qty, int before, int after, String operator) {
        jdbc.update("INSERT IGNORE INTO inventory_ledger"
                        + "(order_id,dish_id,serve_date,entry_type,qty,before_available,after_available,business_key,operator,reason) "
                        + "VALUES (?,?,?,'RESERVE',?,?,?,?,?,?)",
                orderId, dishId, date, qty, before, after, "ORD:" + orderId + ":D:" + dishId + ":RESERVE", operator, null);
    }

    public void adjust(long dishId, LocalDate date, int delta, String operator, String reason) {
        int n = jdbc.update("UPDATE dish_daily_stock SET total_qty=total_qty+?, version=version+1 "
                + "WHERE dish_id=? AND serve_date=? AND total_qty+?>=reserved_qty+sold_qty", delta, dishId, date, delta);
        if (n == 0) throw Api.error(409, "STOCK_INSUFFICIENT", "Adjusted total cannot be lower than reserved + sold");
        int after = available(dishId, date);
        int before = after - delta;
        jdbc.update("INSERT INTO inventory_ledger"
                        + "(dish_id,serve_date,entry_type,qty,before_available,after_available,business_key,operator,reason) "
                        + "VALUES (?,?,'ADJUST',?,?,?,?,?,?)",
                dishId, date, Math.abs(delta), before, after,
                "ADJ:" + java.util.UUID.randomUUID(), operator, reason);
        publish(dishId, after);
    }

    private Map<String, Object> lockStock(long dishId, LocalDate date, int qty) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT total_qty,reserved_qty,sold_qty,total_qty-reserved_qty-sold_qty AS available "
                        + "FROM dish_daily_stock WHERE dish_id=? AND serve_date=? FOR UPDATE", dishId, date);
        if (rows.isEmpty()) throw Api.error(409, "STOCK_INSUFFICIENT", "Stock row missing for dish " + dishId);
        if (((Number) rows.get(0).get("reserved_qty")).intValue() < qty) {
            throw Api.error(409, "ORDER_STATE_INVALID", "Reserved stock is inconsistent");
        }
        return rows.get(0);
    }

    private void publish(long dishId, int available) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() { sseHub.publishStock(dishId, available); }
            });
        } else {
            sseHub.publishStock(dishId, available);
        }
    }
}