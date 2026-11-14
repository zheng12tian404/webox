package com.webox.order;

import com.webox.admin.AuditService;
import com.webox.common.Api;
import com.webox.common.ApiException;
import com.webox.common.RequestContext;
import com.webox.common.RateLimiter;
import com.webox.common.Util;
import com.webox.dto.Dtos;
import com.webox.inventory.InventoryService;
import com.webox.inventory.RedisStockService;
import com.webox.security.UserPrincipal;
import org.springframework.dao.ConcurrencyFailureException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

@Service
public class OrderService {
    private final JdbcTemplate jdbc;
    private final OrderTxService tx;
    private final IdempotencyService idem;
    private final RedisStockService redisStock;
    private final InventoryService inventory;
    private final AuditService audit;
    private final RateLimiter rateLimiter;

    public OrderService(JdbcTemplate jdbc, OrderTxService tx, IdempotencyService idem,
                        RedisStockService redisStock, InventoryService inventory, AuditService audit,
                        RateLimiter rateLimiter) {
        this.jdbc = jdbc;
        this.tx = tx;
        this.idem = idem;
        this.redisStock = redisStock;
        this.inventory = inventory;
        this.audit = audit;
        this.rateLimiter = rateLimiter;
    }

    public record Outcome(int status, Map<String, Object> body) {}

    public Map<String, Object> preview(long userId, Dtos.PreviewReq req) {
        OrderTxService.Calc calc = tx.validateAndPrice(userId, req.items(), req.deliveryDate(), req.mealType());
        List<Map<String, Object>> items = new ArrayList<>();
        for (OrderTxService.Line l : calc.lines()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("dishName", l.dishName());
            m.put("options", l.options());
            m.put("qty", l.qty());
            m.put("unitPriceCents", l.unitPrice());
            m.put("subtotalCents", l.subtotal());
            items.add(m);
        }
        Util.Effective eff = calc.effective();
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("items", items);
        data.put("totalCents", calc.totalCents());
        data.put("itemCount", calc.itemCount());
        data.put("effectiveDate", eff.date().toString());
        data.put("effectiveMeal", eff.meal());
        data.put("cutoffAt", cutoffAt(eff));
        data.put("autoSwitched", eff.autoSwitched());
        data.put("budgetExceeded", calc.budgetExceeded());
        List<Map<String, Object>> existing = jdbc.queryForList(
                "SELECT id FROM orders WHERE user_id=? AND delivery_date=? AND meal_type=? AND status IN ('Pending','Confirmed') LIMIT 1",
                userId, eff.date(), eff.meal());
        if (!existing.isEmpty()) data.put("existingOrderId", existing.get(0).get("id"));
        List<Map<String, Object>> addresses = new ArrayList<>();
        for (Map<String, Object> r : jdbc.queryForList(
                "SELECT id,address,last_used_at FROM addresses WHERE user_id=? ORDER BY last_used_at DESC, id DESC LIMIT 10", userId)) {
            Map<String, Object> a = new LinkedHashMap<>();
            a.put("id", r.get("id"));
            a.put("address", r.get("address"));
            a.put("lastUsedAt", Util.iso(r.get("last_used_at")));
            addresses.add(a);
        }
        data.put("addresses", addresses);
        return data;
    }

    private String cutoffAt(Util.Effective eff) {
        java.time.LocalTime t = "Lunch".equals(eff.meal()) ? java.time.LocalTime.of(10, 0) : java.time.LocalTime.of(15, 0);
        return eff.date().atTime(t).atZone(RequestContext.ZONE).toOffsetDateTime().toString();
    }

    public Outcome submit(UserPrincipal user, Dtos.SubmitReq req, String key) {
        if (key == null || key.isBlank()) {
            throw Api.error(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required");
        }
        if (key.length() < 8 || key.length() > 64) {
            throw Api.error(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key must be 8-64 characters");
        }
        rateLimiter.check("order:user:" + user.id(), 5, 60_000L);
        String hash = Util.canonicalSubmit(req);
        IdempotencyService.Claim claim = idem.claim(user.id(), key, hash);
        if (claim.replay()) {
            Map<String, Object> stored = Util.parseMap(claim.replayBody());
            return new Outcome(claim.replayStatus(), stored);
        }
        RedisStockService.Preallocation prealloc = null;
        try {
            LocalDate ctxDate;
            try {
                ctxDate = Util.resolveMeal(
                        req.deliveryDate() == null || req.deliveryDate().isBlank() ? null : LocalDate.parse(req.deliveryDate()),
                        req.mealType(), RequestContext.now()).date();
            } catch (ApiException e) {
                idem.complete(claim.id(), e.getStatus(), errorBody(e), null);
                throw e;
            } catch (Exception e) {
                ctxDate = RequestContext.today();
            }
            prealloc = new RedisStockService.Preallocation(ctxDate);
            Map<String, Object> data;
            try {
                data = tx.execute(user.id(), user.email(), req, prealloc, key);
            } catch (ConcurrencyFailureException deadlock) {
                redisStock.compensate(prealloc);
                prealloc = new RedisStockService.Preallocation(ctxDate);
                data = tx.execute(user.id(), user.email(), req, prealloc, key);
            } catch (DuplicateKeyException dup) {
                redisStock.compensate(prealloc);
                prealloc = null; // already compensated; outer catch must not INCRBY twice
                ApiException mapped = mapDuplicate(dup, user.id(), req);
                idem.complete(claim.id(), mapped.getStatus(), errorBody(mapped), null);
                throw mapped;
            }
            idem.complete(claim.id(), 201, Map.of("code", "OK", "message", "Order placed", "data", data),
                    ((Number) data.get("orderId")).longValue());
            return new Outcome(201, Map.of("code", "OK", "message", "Order placed", "data", data));
        } catch (ApiException e) {
            if (prealloc != null) redisStock.compensate(prealloc);
            idem.complete(claim.id(), e.getStatus(), errorBody(e), null);
            throw e;
        } catch (RuntimeException e) {
            if (prealloc != null) redisStock.compensate(prealloc);
            idem.fail(claim.id());
            throw e;
        }
    }

    private ApiException mapDuplicate(DuplicateKeyException e, long userId, Dtos.SubmitReq req) {
        String msg = String.valueOf(e.getMessage());
        if (msg.contains("uk_orders_idem")) {
            return Api.error(409, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was used with a different request body");
        }
        try {
            Util.Effective eff = Util.resolveMeal(
                    req.deliveryDate() == null || req.deliveryDate().isBlank() ? null : LocalDate.parse(req.deliveryDate()),
                    req.mealType(), RequestContext.now());
            List<Map<String, Object>> rows = jdbc.queryForList(
                    "SELECT id,order_no FROM orders WHERE user_id=? AND delivery_date=? AND meal_type=? "
                            + "AND status IN ('Pending','Confirmed') LIMIT 1", userId, eff.date(), eff.meal());
            Map<String, Object> data = new LinkedHashMap<>();
            if (!rows.isEmpty()) {
                data.put("existingOrderId", rows.get(0).get("id"));
                data.put("existingOrderNo", rows.get(0).get("order_no"));
            }
            return Api.error(409, "ORDER_DUPLICATE", "An active order already exists for this meal", data);
        } catch (Exception ex) {
            return Api.error(409, "ORDER_DUPLICATE", "An active order already exists for this meal");
        }
    }

    private Map<String, Object> errorBody(ApiException e) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("code", e.getCode());
        m.put("message", e.getMessage());
        m.put("data", e.getData());
        return m;
    }

    public Map<String, Object> list(long userId, int page, int size, String status) {
        Util.validatePage(page, size);
        if (status != null && !status.isBlank() && !Util.ORDER_STATUSES.contains(status)) {
            throw Api.error(400, "VALIDATION_INVALID", "Invalid order status");
        }
        String where = " WHERE user_id=?" + (status == null || status.isBlank() ? "" : " AND status=?");
        List<Object> args = new ArrayList<>();
        args.add(userId);
        if (status != null && !status.isBlank()) args.add(status);
        Long total = jdbc.queryForObject("SELECT COUNT(*) FROM orders" + where, Long.class, args.toArray());
        args.add(size);
        args.add((page - 1) * size);
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id,order_no,status,total_cents,item_count,delivery_date,meal_type,created_at FROM orders"
                        + where + " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?", args.toArray());
        List<Map<String, Object>> items = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("orderId", r.get("id"));
            m.put("orderNo", r.get("order_no"));
            m.put("status", r.get("status"));
            m.put("totalCents", Util.cents(r.get("total_cents")));
            m.put("itemCount", Util.intVal(r.get("item_count")));
            m.put("deliveryDate", String.valueOf(r.get("delivery_date")));
            m.put("mealType", r.get("meal_type"));
            m.put("createdAt", Util.iso(r.get("created_at")));
            items.add(m);
        }
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("items", items);
        data.put("page", page);
        data.put("size", size);
        data.put("total", total == null ? 0 : total);
        return data;
    }

    public Map<String, Object> detail(UserPrincipal user, long orderId) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM orders WHERE id=?", orderId);
        if (rows.isEmpty()) throw Api.error(404, "ORDER_NOT_FOUND", "Order not found");
        Map<String, Object> o = rows.get(0);
        long owner = ((Number) o.get("user_id")).longValue();
        if (!user.isAdmin() && owner != user.id()) throw Api.error(404, "ORDER_NOT_FOUND", "Order not found");
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("orderId", o.get("id"));
        data.put("orderNo", o.get("order_no"));
        data.put("status", o.get("status"));
        data.put("deliveryDate", String.valueOf(o.get("delivery_date")));
        data.put("mealType", o.get("meal_type"));
        data.put("address", o.get("address"));
        data.put("totalCents", Util.cents(o.get("total_cents")));
        data.put("itemCount", Util.intVal(o.get("item_count")));
        data.put("createdAt", Util.iso(o.get("created_at")));
        data.put("cancelledAt", Util.iso(o.get("cancelled_at")));
        data.put("cancelReason", o.get("cancel_reason"));
        List<Map<String, Object>> items = new ArrayList<>();
        for (Map<String, Object> r : jdbc.queryForList(
                "SELECT dish_id,dish_name,unit_price_cents,options_json,qty,subtotal_cents FROM order_items WHERE order_id=? ORDER BY id",
                orderId)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("dishId", r.get("dish_id"));
            m.put("dishName", r.get("dish_name"));
            m.put("unitPriceCents", Util.cents(r.get("unit_price_cents")));
            Object opts = r.get("options_json");
            m.put("options", opts == null ? List.of() : Util.parseListOfMaps(String.valueOf(opts)));
            m.put("qty", r.get("qty"));
            m.put("subtotalCents", Util.cents(r.get("subtotal_cents")));
            items.add(m);
        }
        data.put("items", items);
        return data;
    }

    public Map<String, Object> active(long userId, String dateStr, String mealType) {
        LocalDate date = dateStr == null || dateStr.isBlank() ? RequestContext.today()
                : Util.parseDate(dateStr, "VALIDATION_INVALID");
        if (mealType != null && !Util.MEALS.contains(mealType)) {
            throw Api.error(400, "VALIDATION_INVALID", "Invalid mealType");
        }
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id,order_no,status FROM orders WHERE user_id=? AND delivery_date=? AND meal_type=? "
                        + "AND status IN ('Pending','Confirmed') LIMIT 1", userId, date, mealType);
        if (rows.isEmpty()) return null;
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("orderId", rows.get(0).get("id"));
        data.put("orderNo", rows.get(0).get("order_no"));
        data.put("status", rows.get(0).get("status"));
        return data;
    }

    @Transactional
    public Map<String, Object> cancel(UserPrincipal user, long orderId, String reason) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM orders WHERE id=?", orderId);
        if (rows.isEmpty()) throw Api.error(404, "ORDER_NOT_FOUND", "Order not found");
        Map<String, Object> o = rows.get(0);
        long owner = ((Number) o.get("user_id")).longValue();
        if (!user.isAdmin() && owner != user.id()) throw Api.error(404, "ORDER_NOT_FOUND", "Order not found");
        if (reason != null && reason.length() > 200) {
            throw Api.error(400, "VALIDATION_REASON_REQUIRED", "Reason must be at most 200 characters");
        }
        if (user.isAdmin() && (reason == null || reason.isBlank())) {
            throw Api.error(400, "VALIDATION_REASON_REQUIRED", "A reason is required for admin operations");
        }
        String status = String.valueOf(o.get("status"));
        int n = jdbc.update("UPDATE orders SET status='Cancelled', cancelled_at=NOW(3), cancel_reason=? "
                + "WHERE id=? AND status='Pending'", reason, orderId);
        if (n == 0) {
            if ("Cancelled".equals(status) || "Confirmed".equals(status) || "Completed".equals(status)) {
                throw Api.error(409, "ORDER_STATE_INVALID", "Only pending orders can be cancelled");
            }
            throw Api.error(409, "ORDER_STATE_INVALID", "Order state changed, please retry");
        }
        LocalDate date = ((java.sql.Date) o.get("delivery_date")).toLocalDate();
        for (Map<String, Object> r : aggregatedItems(orderId)) {
            long dishId = ((Number) r.get("dish_id")).longValue();
            int qty = Util.intVal(r.get("qty"));
            inventory.release(orderId, dishId, date, qty, user.email(), reason == null ? "CANCELLED" : reason);
            redisStock.sync(date, dishId, inventory.available(dishId, date));
        }
        if (user.isAdmin()) {
            audit.log("ORDER_CANCEL", "ORDER", String.valueOf(orderId),
                    Map.of("status", status), Map.of("status", "Cancelled"), reason);
        }
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("orderId", orderId);
        data.put("status", "Cancelled");
        data.put("cancelledAt", Util.iso(jdbc.queryForObject("SELECT cancelled_at FROM orders WHERE id=?", Timestamp.class, orderId)));
        return data;
    }

    public List<Map<String, Object>> aggregatedItems(long orderId) {
        return jdbc.queryForList("SELECT dish_id, SUM(qty) AS qty FROM order_items WHERE order_id=? GROUP BY dish_id ORDER BY dish_id", orderId);
    }

    /** Timeout release path: CAS status + release reserved stock exactly once. */
    @Transactional
    public boolean timeoutCancel(long orderId) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM orders WHERE id=? AND status='Pending'", orderId);
        if (rows.isEmpty()) return false;
        Map<String, Object> o = rows.get(0);
        int n = jdbc.update("UPDATE orders SET status='Cancelled', cancelled_at=NOW(3), cancel_reason='TIMEOUT' "
                + "WHERE id=? AND status='Pending'", orderId);
        if (n == 0) return false;
        LocalDate date = ((java.sql.Date) o.get("delivery_date")).toLocalDate();
        for (Map<String, Object> r : aggregatedItems(orderId)) {
            long dishId = ((Number) r.get("dish_id")).longValue();
            inventory.release(orderId, dishId, date, Util.intVal(r.get("qty")), "SYSTEM", "TIMEOUT");
            redisStock.sync(date, dishId, inventory.available(dishId, date));
        }
        return true;
    }

    @Transactional
    public void adminPatchStatus(long orderId, String toStatus, Boolean confirm, String reason) {
        Util.requireConfirm(confirm);
        if (reason == null || reason.isBlank() || reason.length() > 200) {
            throw Api.error(400, "VALIDATION_REASON_REQUIRED", "A reason of 1-200 characters is required");
        }
        if (!List.of("Confirmed", "Completed", "Cancelled").contains(toStatus)) {
            throw Api.error(400, "VALIDATION_INVALID", "Invalid target status");
        }
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM orders WHERE id=?", orderId);
        if (rows.isEmpty()) throw Api.error(404, "ORDER_NOT_FOUND", "Order not found");
        Map<String, Object> o = rows.get(0);
        String from = String.valueOf(o.get("status"));
        if (!OrderStateMachine.canTransition(from, toStatus)) {
            throw Api.error(409, "ORDER_STATE_INVALID", "Illegal order state transition " + from + " -> " + toStatus);
        }
        int n = jdbc.update("UPDATE orders SET status=?, cancelled_at=CASE WHEN ?='Cancelled' THEN NOW(3) ELSE cancelled_at END, "
                        + "cancel_reason=CASE WHEN ?='Cancelled' THEN ? ELSE cancel_reason END WHERE id=? AND status=?",
                toStatus, toStatus, toStatus, reason, orderId, from);
        if (n == 0) throw Api.error(409, "ORDER_STATE_INVALID", "Order state changed, please retry");
        LocalDate date = ((java.sql.Date) o.get("delivery_date")).toLocalDate();
        if ("Confirmed".equals(toStatus)) {
            for (Map<String, Object> r : aggregatedItems(orderId)) {
                long dishId = ((Number) r.get("dish_id")).longValue();
                inventory.confirm(orderId, dishId, date, Util.intVal(r.get("qty")), "admin", reason);
            }
        } else if ("Cancelled".equals(toStatus)) {
            for (Map<String, Object> r : aggregatedItems(orderId)) {
                long dishId = ((Number) r.get("dish_id")).longValue();
                inventory.release(orderId, dishId, date, Util.intVal(r.get("qty")), "admin", reason);
                redisStock.sync(date, dishId, inventory.available(dishId, date));
            }
        }
        audit.log("ORDER_STATUS", "ORDER", String.valueOf(orderId),
                Map.of("status", from), Map.of("status", toStatus), reason);
    }
}