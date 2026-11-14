package com.webox.order;

import com.webox.common.Api;
import com.webox.common.RequestContext;
import com.webox.common.Util;
import com.webox.dto.Dtos;
import com.webox.inventory.InventoryService;
import com.webox.inventory.RedisStockService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.sql.PreparedStatement;
import java.sql.Statement;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

@Service
public class OrderTxService {
    private final JdbcTemplate jdbc;
    private final InventoryService inventory;
    private final RedisStockService redisStock;

    public OrderTxService(JdbcTemplate jdbc, InventoryService inventory, RedisStockService redisStock) {
        this.jdbc = jdbc;
        this.inventory = inventory;
        this.redisStock = redisStock;
    }

    public record Line(long dishId, String dishName, int qty, long unitPrice, long subtotal,
                       List<Map<String, Object>> options) {}

    public record Calc(List<Line> lines, long totalCents, int itemCount, Util.Effective effective, boolean budgetExceeded) {}

    public Calc validateAndPrice(long userId, List<Dtos.ItemReq> items, String deliveryDate, String mealType) {
        if (items == null || items.isEmpty()) throw Api.error(400, "VALIDATION_QUANTITY", "At least one item is required");
        LocalDate reqDate = deliveryDate == null || deliveryDate.isBlank() ? null
                : Util.parseDate(deliveryDate, "VALIDATION_INVALID");
        Util.Effective eff = Util.resolveMeal(reqDate, mealType, RequestContext.now());
        int itemCount = 0;
        List<Line> lines = new ArrayList<>();
        for (Dtos.ItemReq item : items) {
            if (item == null || item.dishId() == null) throw Api.error(400, "VALIDATION_QUANTITY", "dishId is required");
            int qty = item.qty() == null ? 0 : item.qty();
            if (qty < 1 || qty > 5) throw Api.error(400, "VALIDATION_QUANTITY", "qty must be between 1 and 5");
            itemCount += qty;
            if (itemCount > 5) throw Api.error(400, "ORDER_LIMIT_EXCEEDED", "At most 5 portions per order");
            List<Map<String, Object>> dishes = jdbc.queryForList(
                    "SELECT d.id,d.name,d.price_cents FROM daily_menu m JOIN dishes d ON d.id=m.dish_id "
                            + "WHERE d.id=? AND m.serve_date=? AND m.publish_status='PUBLISHED' AND d.status='ON_SHELF'",
                    item.dishId(), eff.date());
            if (dishes.isEmpty()) {
                throw Api.error(409, "ORDER_MEAL_UNAVAILABLE", "Dish " + item.dishId() + " is not available for this meal");
            }
            Map<String, Object> dish = dishes.get(0);
            long unit = Util.cents(dish.get("price_cents"));
            List<Map<String, Object>> selectedOptions = new ArrayList<>();
            List<Long> optionIds = item.optionIds() == null ? List.of() : item.optionIds();
            if (optionIds.size() != optionIds.stream().distinct().count()) {
                throw Api.error(400, "VALIDATION_OPTION_INVALID", "Duplicate optionId");
            }
            List<Map<String, Object>> groups = jdbc.queryForList(
                    "SELECT id,name,required,min_select,max_select FROM dish_option_groups WHERE dish_id=? ORDER BY sort_order,id",
                    item.dishId());
            Map<Long, Map<Long, Object>> optionsByGroup = new LinkedHashMap<>();
            for (Map<String, Object> g : groups) {
                optionsByGroup.put(((Number) g.get("id")).longValue(), new LinkedHashMap<>());
            }
            for (Long oid : optionIds) {
                List<Map<String, Object>> opts = jdbc.queryForList(
                        "SELECT o.id,o.group_id,o.name,o.price_delta_cents FROM dish_options o "
                                + "JOIN dish_option_groups g ON g.id=o.group_id WHERE o.id=? AND g.dish_id=?",
                        oid, item.dishId());
                if (opts.isEmpty()) throw Api.error(400, "VALIDATION_OPTION_INVALID", "Option " + oid + " does not belong to this dish");
                Map<String, Object> o = opts.get(0);
                long gid = ((Number) o.get("group_id")).longValue();
                Map<String, Object> g = groups.stream()
                        .filter(x -> ((Number) x.get("id")).longValue() == gid).findFirst().orElseThrow();
                Map<Long, Object> inGroup = optionsByGroup.get(gid);
                if (inGroup.size() >= Util.intVal(g.get("max_select"))) {
                    throw Api.error(400, "VALIDATION_OPTION_INVALID", "Too many options selected for group " + g.get("name"));
                }
                inGroup.put(oid, o);
                unit += Util.cents(o.get("price_delta_cents"));
                Map<String, Object> om = new LinkedHashMap<>();
                om.put("name", o.get("name"));
                om.put("priceDeltaCents", Util.cents(o.get("price_delta_cents")));
                selectedOptions.add(om);
            }
            for (Map<String, Object> g : groups) {
                long gid = ((Number) g.get("id")).longValue();
                int min = Util.intVal(g.get("min_select"));
                if (Util.intVal(g.get("required")) == 1) min = Math.max(min, 1);
                int chosen = optionsByGroup.get(gid).size();
                if (chosen < min) {
                    throw Api.error(400, "VALIDATION_OPTION_REQUIRED", "Group '" + g.get("name") + "' requires a selection");
                }
            }
            lines.add(new Line(((Number) dish.get("id")).longValue(), String.valueOf(dish.get("name")),
                    qty, unit, unit * qty, selectedOptions));
        }
        long total = lines.stream().mapToLong(Line::subtotal).sum();
        boolean budgetExceeded = false;
        List<Map<String, Object>> prefs = jdbc.queryForList(
                "SELECT budget_max_cents FROM user_preferences WHERE user_id=?", userId);
        if (!prefs.isEmpty() && prefs.get(0).get("budget_max_cents") != null) {
            budgetExceeded = total > Util.cents(prefs.get(0).get("budget_max_cents"));
        }
        return new Calc(lines, total, itemCount, eff, budgetExceeded);
    }

    /** T1: single business transaction, DB writes only. */
    @Transactional(isolation = Isolation.READ_COMMITTED, rollbackFor = Exception.class)
    public Map<String, Object> execute(long userId, String email, Dtos.SubmitReq req, RedisStockService.Preallocation ctx, String idemKey) {
        String address = req.address() == null ? "" : req.address().trim();
        if (address.isEmpty() || address.length() > 200) {
            throw Api.error(400, "VALIDATION_ADDRESS_LENGTH", "Address is required and must be at most 200 characters");
        }
        Calc calc = validateAndPrice(userId, req.items(), req.deliveryDate(), req.mealType());
        Util.Effective eff = calc.effective();

        List<Map<String, Object>> existing = jdbc.queryForList(
                "SELECT id,order_no FROM orders WHERE user_id=? AND delivery_date=? AND meal_type=? "
                        + "AND status IN ('Pending','Confirmed') LIMIT 1", userId, eff.date(), eff.meal());
        if (!existing.isEmpty()) {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("existingOrderId", existing.get(0).get("id"));
            data.put("existingOrderNo", existing.get(0).get("order_no"));
            throw Api.error(409, "ORDER_DUPLICATE", "An active order already exists for this meal", data);
        }

        // Aggregate quantities per dish and reserve in ascending dish_id order (deadlock reduction).
        Map<Long, Integer> demand = new TreeMap<>();
        for (Line l : calc.lines()) demand.merge(l.dishId(), l.qty(), Integer::sum);

        Map<Long, int[]> reserved = new LinkedHashMap<>();
        for (Map.Entry<Long, Integer> e : demand.entrySet()) {
            long dishId = e.getKey();
            LocalDate date = eff.date();
            String mode = inventory.mode(dishId, date);
            int available = inventory.available(dishId, date);
            if ("REDIS_PREALLOC".equals(mode)) {
                redisStock.prealloc(ctx, dishId, date, e.getValue(), available);
            }
            int[] delta = inventory.reserve(dishId, date, e.getValue());
            reserved.put(dishId, delta);
        }

        // Insert order + items snapshot.
        String tempNo = "T" + java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 20);
        Map<String, Object> snapshot = new LinkedHashMap<>();
        List<Map<String, Object>> snapItems = new ArrayList<>();
        for (Line l : calc.lines()) {
            Map<String, Object> sm = new LinkedHashMap<>();
            sm.put("dishId", l.dishId());
            sm.put("dishName", l.dishName());
            sm.put("unitPriceCents", l.unitPrice());
            sm.put("options", l.options());
            sm.put("qty", l.qty());
            sm.put("subtotalCents", l.subtotal());
            snapItems.add(sm);
        }
        snapshot.put("items", snapItems);
        snapshot.put("totalCents", calc.totalCents());
        snapshot.put("address", address);
        snapshot.put("deliveryDate", eff.date().toString());
        snapshot.put("mealType", eff.meal());
        snapshot.put("createdAt", RequestContext.now().toOffsetDateTime().toString());

        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbc.update(con -> {
            PreparedStatement ps = con.prepareStatement(
                    "INSERT INTO orders(order_no,user_id,status,delivery_date,meal_type,address,total_cents,item_count,"
                            + "budget_exceeded,idempotency_key,snapshot_json) VALUES (?,?,'Pending',?,?,?,?,?,?,?,?)",
                    Statement.RETURN_GENERATED_KEYS);
            ps.setString(1, tempNo);
            ps.setLong(2, userId);
            ps.setDate(3, java.sql.Date.valueOf(eff.date()));
            ps.setString(4, eff.meal());
            ps.setString(5, address);
            ps.setLong(6, calc.totalCents());
            ps.setInt(7, calc.itemCount());
            ps.setInt(8, calc.budgetExceeded() ? 1 : 0);
            ps.setString(9, idemKey);
            ps.setString(10, Util.json(snapshot));
            return ps;
        }, keyHolder);
        long orderId = keyHolder.getKey().longValue();
        String orderNo = "WB" + eff.date().toString().replace("-", "") + "-" + String.format("%04d", orderId % 10000);
        jdbc.update("UPDATE orders SET order_no=? WHERE id=?", orderNo, orderId);

        for (Line l : calc.lines()) {
            jdbc.update("INSERT INTO order_items(order_id,dish_id,dish_name,unit_price_cents,options_json,qty,subtotal_cents) "
                            + "VALUES (?,?,?,?,?,?,?)",
                    orderId, l.dishId(), l.dishName(), l.unitPrice(), Util.json(l.options()), l.qty(), l.subtotal());
        }
        for (Map.Entry<Long, int[]> e : reserved.entrySet()) {
            int[] delta = e.getValue();
            inventory.reserveLedger(orderId, e.getKey(), eff.date(), demand.get(e.getKey()), delta[0], delta[1], email);
        }

        jdbc.update("INSERT INTO addresses(user_id,address) VALUES (?,?) ON DUPLICATE KEY UPDATE usage_count=usage_count+1, last_used_at=NOW(3)",
                userId, address);

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("orderId", orderId);
        data.put("orderNo", orderNo);
        data.put("status", "Pending");
        data.put("deliveryDate", eff.date().toString());
        data.put("mealType", eff.meal());
        data.put("address", address);
        data.put("totalCents", calc.totalCents());
        data.put("itemCount", calc.itemCount());
        data.put("autoSwitched", eff.autoSwitched());
        data.put("estimatedDelivery", eff.meal() + " on " + eff.date());
        return data;
    }

}