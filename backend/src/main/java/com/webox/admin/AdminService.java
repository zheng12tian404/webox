package com.webox.admin;

import com.webox.catalog.MenuService;
import com.webox.common.Api;
import com.webox.common.RequestContext;
import com.webox.common.Util;
import com.webox.dto.Dtos;
import com.webox.inventory.InventoryService;
import com.webox.inventory.RedisStockService;
import com.webox.realtime.SseHub;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class AdminService {
    private final JdbcTemplate jdbc;
    private final AuditService audit;
    private final MenuService menuService;
    private final InventoryService inventory;
    private final RedisStockService redisStock;
    private final SseHub sseHub;

    public AdminService(JdbcTemplate jdbc, AuditService audit, MenuService menuService, InventoryService inventory,
                        RedisStockService redisStock, SseHub sseHub) {
        this.jdbc = jdbc;
        this.audit = audit;
        this.menuService = menuService;
        this.inventory = inventory;
        this.redisStock = redisStock;
        this.sseHub = sseHub;
    }

    /** Publish the post-commit consistency signals demanded by AC-030/AC-036. */
    private void publishStockAfterCommit(LocalDate date, long dishId, int available) {
        Util.afterCommit(() -> {
            sseHub.publishStock(dishId, available);
            redisStock.sync(date, dishId, available);
        });
    }

    // ---------------- dishes ----------------
    public Map<String, Object> listDishes(int page, int size, String search, String category, String status) {
        Util.validatePage(page, size);
        if (category != null && !category.isBlank() && !Util.CATEGORIES.contains(category)) {
            throw Api.error(400, "VALIDATION_CATEGORY", "Invalid category");
        }
        if (status != null && !status.isBlank() && !List.of("ON_SHELF", "OFF_SHELF").contains(status)) {
            throw Api.error(400, "VALIDATION_INVALID", "Invalid status");
        }
        if (search != null && search.length() > 50) throw Api.error(400, "VALIDATION_SEARCH_LENGTH", "Search too long");
        StringBuilder where = new StringBuilder(" WHERE 1=1");
        List<Object> args = new ArrayList<>();
        if (search != null && !search.isBlank()) {
            where.append(" AND (name LIKE ? ESCAPE '\\\\' OR description LIKE ? ESCAPE '\\\\')");
            String p = "%" + Util.escapeLike(search.trim()) + "%";
            args.add(p);
            args.add(p);
        }
        if (category != null && !category.isBlank()) { where.append(" AND category=?"); args.add(category); }
        if (status != null && !status.isBlank()) { where.append(" AND status=?"); args.add(status); }
        Long total = jdbc.queryForObject("SELECT COUNT(*) FROM dishes" + where, Long.class, args.toArray());
        args.add(size);
        args.add((page - 1) * size);
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id,name,description,price_cents,category,protein,allergens,spice_level,image_url,status FROM dishes"
                        + where + " ORDER BY id LIMIT ? OFFSET ?", args.toArray());
        List<Map<String, Object>> items = new ArrayList<>();
        for (Map<String, Object> r : rows) items.add(dishView(r));
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("items", items);
        data.put("page", page);
        data.put("size", size);
        data.put("total", total == null ? 0 : total);
        return data;
    }

    private Map<String, Object> dishView(Map<String, Object> r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("dishId", r.get("id"));
        m.put("name", r.get("name"));
        m.put("description", r.get("description"));
        m.put("priceCents", Util.cents(r.get("price_cents")));
        m.put("category", r.get("category"));
        m.put("protein", r.get("protein"));
        m.put("allergens", Util.parseList((String) r.get("allergens")));
        m.put("spiceLevel", r.get("spice_level"));
        m.put("imageUrl", r.get("image_url"));
        m.put("status", r.get("status"));
        return m;
    }

    @Transactional
    public Map<String, Object> createDish(Dtos.DishReq req) {
        validateDish(req);
        jdbc.update("INSERT INTO dishes(name,description,price_cents,category,protein,allergens,spice_level,image_url,status) "
                        + "VALUES (?,?,?,?,?,?,?,?,'ON_SHELF')",
                req.name().trim(), req.description().trim(), req.priceCents(), req.category(), req.protein(),
                Util.json(req.allergens() == null ? List.of() : req.allergens()), req.spiceLevel(), req.imageUrl());
        Long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        Map<String, Object> after = jdbc.queryForMap("SELECT * FROM dishes WHERE id=?", id);
        audit.log("DISH_CREATE", "DISH", String.valueOf(id), null, after, null);
        Util.afterCommit(menuService::invalidate);
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("dishId", id);
        return data;
    }

    @Transactional
    public Map<String, Object> updateDish(long dishId, Dtos.DishReq req) {
        Util.requireConfirm(req.confirm());
        Map<String, Object> before = jdbc.queryForMap("SELECT * FROM dishes WHERE id=?", dishId);
        validateDish(req);
        requireReason(req.reason());
        jdbc.update("UPDATE dishes SET name=?,description=?,price_cents=?,category=?,protein=?,allergens=?,spice_level=?,image_url=? "
                        + "WHERE id=?",
                req.name().trim(), req.description().trim(), req.priceCents(), req.category(), req.protein(),
                Util.json(req.allergens() == null ? List.of() : req.allergens()), req.spiceLevel(), req.imageUrl(), dishId);
        Map<String, Object> after = jdbc.queryForMap("SELECT * FROM dishes WHERE id=?", dishId);
        audit.log("DISH_UPDATE", "DISH", String.valueOf(dishId), before, after, req.reason());
        Util.afterCommit(menuService::invalidate);
        return dishView(after);
    }

    @Transactional
    public Map<String, Object> updateDishStatus(long dishId, Dtos.DishStatusReq req) {
        Util.requireConfirm(req.confirm());
        if (req.status() == null || !List.of("ON_SHELF", "OFF_SHELF").contains(req.status())) {
            throw Api.error(400, "VALIDATION_INVALID", "Invalid status");
        }
        requireReason(req.reason());
        Map<String, Object> before = jdbc.queryForMap("SELECT * FROM dishes WHERE id=?", dishId);
        jdbc.update("UPDATE dishes SET status=? WHERE id=?", req.status(), dishId);
        Map<String, Object> after = jdbc.queryForMap("SELECT * FROM dishes WHERE id=?", dishId);
        audit.log("DISH_STATUS", "DISH", String.valueOf(dishId), before, after, req.reason());
        Util.afterCommit(menuService::invalidate);
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("dishId", dishId);
        data.put("status", req.status());
        return data;
    }

    public Map<String, Object> uploadImage(long dishId, MultipartFile file) {
        jdbc.queryForObject("SELECT id FROM dishes WHERE id=?", Long.class, dishId);
        if (file == null || file.isEmpty()) throw Api.error(400, "VALIDATION_IMAGE", "Image file is required");
        if (file.getSize() > 5 * 1024 * 1024) throw Api.error(400, "VALIDATION_IMAGE", "Image must be at most 5MB");
        try {
            byte[] bytes = file.getBytes();
            String ext = magicExt(bytes);
            if (ext == null) throw Api.error(400, "VALIDATION_IMAGE", "Only jpg, png or webp images are allowed");
            Path dir = Paths.get("./uploads/images");
            Files.createDirectories(dir);
            String name = UUID.randomUUID() + "." + ext;
            Files.write(dir.resolve(name), bytes);
            String url = "/images/" + name;
            jdbc.update("UPDATE dishes SET image_url=? WHERE id=?", url, dishId);
            audit.log("DISH_IMAGE", "DISH", String.valueOf(dishId), null, Map.of("imageUrl", url), null);
            Util.afterCommit(menuService::invalidate);
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("imageUrl", url);
            return data;
        } catch (IOException e) {
            throw Api.error(400, "VALIDATION_IMAGE", "Failed to store image");
        }
    }

    private String magicExt(byte[] b) {
        if (b.length > 3 && (b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8 && (b[2] & 0xFF) == 0xFF) return "jpg";
        if (b.length > 8 && (b[0] & 0xFF) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G') return "png";
        if (b.length > 12 && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F'
                && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') return "webp";
        return null;
    }

    private void validateDish(Dtos.DishReq req) {
        if (req.name() == null || req.name().isBlank() || req.name().length() > 100) {
            throw Api.error(400, "VALIDATION_INVALID", "name is required (max 100)");
        }
        if (req.description() == null || req.description().length() > 1000) {
            throw Api.error(400, "VALIDATION_INVALID", "description is required (max 1000)");
        }
        if (req.priceCents() == null || req.priceCents() <= 0) {
            throw Api.error(400, "VALIDATION_INVALID", "priceCents must be positive");
        }
        if (req.category() == null || !Util.CATEGORIES.contains(req.category())) {
            throw Api.error(400, "VALIDATION_CATEGORY", "Invalid category");
        }
        if (req.protein() == null || req.protein().length() > 50) {
            throw Api.error(400, "VALIDATION_INVALID", "protein is required (max 50)");
        }
        if (req.spiceLevel() == null || !Util.SPICE.contains(req.spiceLevel())) {
            throw Api.error(400, "VALIDATION_INVALID", "Invalid spiceLevel");
        }
        if (req.allergens() != null) {
            for (String a : req.allergens()) {
                if (!Util.ALLERGENS.contains(a)) throw Api.error(400, "VALIDATION_INVALID", "Invalid allergen: " + a);
            }
        }
        if (req.imageUrl() != null && req.imageUrl().length() > 300) {
            throw Api.error(400, "VALIDATION_INVALID", "imageUrl too long");
        }
    }

    private void requireReason(String reason) {
        if (reason == null || reason.isBlank() || reason.length() > 200) {
            throw Api.error(400, "VALIDATION_REASON_REQUIRED", "A reason of 1-200 characters is required");
        }
    }

    // ---------------- daily menu ----------------
    public List<Map<String, Object>> dailyMenu(String dateStr) {
        LocalDate date = dateStr == null || dateStr.isBlank() ? RequestContext.today().plusDays(1)
                : Util.parseDate(dateStr, "VALIDATION_INVALID");
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT m.dish_id,d.name,s.total_qty,s.reserved_qty,s.sold_qty,s.inventory_mode,m.publish_status "
                        + "FROM daily_menu m JOIN dishes d ON d.id=m.dish_id "
                        + "LEFT JOIN dish_daily_stock s ON s.dish_id=m.dish_id AND s.serve_date=m.serve_date "
                        + "WHERE m.serve_date=? ORDER BY m.dish_id", date);
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            int total = Util.intVal(r.get("total_qty"));
            int reserved = Util.intVal(r.get("reserved_qty"));
            int sold = Util.intVal(r.get("sold_qty"));
            int available = Math.max(0, total - reserved - sold);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("dishId", r.get("dish_id"));
            m.put("dishName", r.get("name"));
            m.put("totalQty", total);
            m.put("reservedQty", reserved);
            m.put("soldQty", sold);
            m.put("available", available);
            m.put("lowStock", available <= 3);
            m.put("inventoryMode", r.get("inventory_mode") == null ? "DB_ATOMIC" : r.get("inventory_mode"));
            m.put("published", "PUBLISHED".equals(r.get("publish_status")));
            out.add(m);
        }
        return out;
    }

    @Transactional
    public Map<String, Object> saveDailyMenu(Dtos.DailyMenuReq req) {
        Util.requireConfirm(req.confirm());
        if (req.serveDate() == null || req.serveDate().isBlank()) {
            throw Api.error(400, "VALIDATION_INVALID", "serveDate is required");
        }
        LocalDate date = Util.parseDate(req.serveDate(), "VALIDATION_INVALID");
        if (req.items() == null || req.items().isEmpty()) {
            throw Api.error(400, "VALIDATION_INVALID", "items are required");
        }
        requireReason(req.reason());
        List<Map<String, Object>> before = dailyMenu(date.toString());
        for (Dtos.DailyMenuItem item : req.items()) {
            if (item.dishId() == null) throw Api.error(400, "VALIDATION_INVALID", "dishId is required");
            jdbc.queryForObject("SELECT id FROM dishes WHERE id=?", Long.class, item.dishId());
            int total = item.totalQty() == null ? (req.totalQty() == null ? 0 : req.totalQty()) : item.totalQty();
            if (total < 0) throw Api.error(400, "VALIDATION_INVALID", "totalQty must be >= 0");
            String publish = Boolean.FALSE.equals(item.published()) ? "DRAFT" : "PUBLISHED";
            jdbc.update("INSERT INTO daily_menu(dish_id,serve_date,publish_status) VALUES (?,?,?) "
                            + "ON DUPLICATE KEY UPDATE publish_status=VALUES(publish_status)",
                    item.dishId(), date, publish);
            String mode = item.inventoryMode() == null ? "DB_ATOMIC" : item.inventoryMode();
            if (!List.of("DB_ATOMIC", "REDIS_PREALLOC").contains(mode)) {
                throw Api.error(400, "VALIDATION_INVALID", "Invalid inventoryMode");
            }
            List<Map<String, Object>> stock = jdbc.queryForList(
                    "SELECT reserved_qty+sold_qty AS used FROM dish_daily_stock WHERE dish_id=? AND serve_date=?",
                    item.dishId(), date);
            if (stock.isEmpty()) {
                jdbc.update("INSERT INTO dish_daily_stock(dish_id,serve_date,total_qty,inventory_mode) VALUES (?,?,?,?)",
                        item.dishId(), date, total, mode);
            } else {
                int used = Util.intVal(stock.get(0).get("used"));
                if (total < used) throw Api.error(409, "STOCK_INSUFFICIENT", "totalQty cannot be lower than reserved + sold");
                jdbc.update("UPDATE dish_daily_stock SET total_qty=?, inventory_mode=?, version=version+1 "
                        + "WHERE dish_id=? AND serve_date=?", total, mode, item.dishId(), date);
            }
        }
        List<Map<String, Object>> after = dailyMenu(date.toString());
        for (Map<String, Object> m : after) {
            publishStockAfterCommit(date, ((Number) m.get("dishId")).longValue(), Util.intVal(m.get("available")));
        }
        audit.log("DAILY_MENU_UPDATE", "DAILY_MENU", date.toString(), before, after, req.reason());
        Util.afterCommit(menuService::invalidate);
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("serveDate", date.toString());
        data.put("items", after);
        return data;
    }

    @Transactional
    public Map<String, Object> updateStock(String serveDate, long dishId, Dtos.StockReq req) {
        Util.requireConfirm(req.confirm());
        requireReason(req.reason());
        if (req.totalQty() == null || req.totalQty() < 0) {
            throw Api.error(400, "VALIDATION_INVALID", "totalQty must be >= 0");
        }
        LocalDate date = Util.parseDate(serveDate, "VALIDATION_INVALID");
        Map<String, Object> before = jdbc.queryForMap(
                "SELECT total_qty, reserved_qty, sold_qty FROM dish_daily_stock WHERE dish_id=? AND serve_date=?", dishId, date);
        int n = jdbc.update("UPDATE dish_daily_stock SET total_qty=?, version=version+1 "
                        + "WHERE dish_id=? AND serve_date=? AND ?>=reserved_qty+sold_qty",
                req.totalQty(), dishId, date, req.totalQty());
        if (n == 0) throw Api.error(409, "STOCK_INSUFFICIENT", "totalQty cannot be lower than reserved + sold");
        int available = inventory.available(dishId, date);
        Map<String, Object> after = Map.of("totalQty", req.totalQty(), "available", available);
        audit.log("STOCK_UPDATE", "STOCK", dishId + ":" + date, before, after, req.reason());
        publishStockAfterCommit(date, dishId, available);
        Util.afterCommit(menuService::invalidate);
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("dishId", dishId);
        data.put("serveDate", date.toString());
        data.put("totalQty", req.totalQty());
        data.put("available", available);
        return data;
    }

    public Map<String, Object> reconcile(String dateStr) {
        LocalDate date = dateStr == null || dateStr.isBlank() ? RequestContext.today()
                : Util.parseDate(dateStr, "VALIDATION_INVALID");
        List<Map<String, Object>> drift = new ArrayList<>();
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT s.dish_id, s.total_qty, s.total_qty-s.reserved_qty-s.sold_qty AS book_available, "
                        + "s.total_qty - COALESCE(SUM(CASE l.entry_type WHEN 'RESERVE' THEN l.qty WHEN 'RELEASE' THEN -l.qty ELSE 0 END),0) AS ledger_derived "
                        + "FROM dish_daily_stock s LEFT JOIN inventory_ledger l "
                        + "ON l.dish_id=s.dish_id AND l.serve_date=s.serve_date "
                        + "WHERE s.serve_date=? GROUP BY s.dish_id,s.total_qty,s.reserved_qty,s.sold_qty", date);
        for (Map<String, Object> r : rows) {
            long book = Util.cents(r.get("book_available"));
            long derived = Util.cents(r.get("ledger_derived"));
            if (book != derived) {
                Map<String, Object> d = new LinkedHashMap<>();
                d.put("dishId", r.get("dish_id"));
                d.put("bookAvailable", book);
                d.put("ledgerDerived", derived);
                drift.add(d);
            }
        }
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("date", date.toString());
        data.put("checked", rows.size());
        data.put("drift", drift);
        return data;
    }

    @Transactional
    public Map<String, Object> adjust(Dtos.AdjustReq req) {
        Util.requireConfirm(req.confirm());
        requireReason(req.reason());
        if (req.dishId() == null || req.serveDate() == null || req.delta() == null || req.delta() == 0) {
            throw Api.error(400, "VALIDATION_INVALID", "dishId, serveDate and non-zero delta are required");
        }
        LocalDate date = Util.parseDate(req.serveDate(), "VALIDATION_INVALID");
        Map<String, Object> before = jdbc.queryForMap("SELECT total_qty,reserved_qty,sold_qty FROM dish_daily_stock "
                + "WHERE dish_id=? AND serve_date=?", req.dishId(), date);
        inventory.adjust(req.dishId(), date, req.delta(), "admin", req.reason());
        int available = inventory.available(req.dishId(), date);
        Map<String, Object> after = Map.of("totalQty", Util.intVal(before.get("total_qty")) + req.delta(), "available", available);
        publishStockAfterCommit(date, req.dishId(), available);
        audit.log("STOCK_ADJUST", "STOCK", req.dishId() + ":" + date, before, after, req.reason());
        Util.afterCommit(menuService::invalidate);
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("dishId", req.dishId());
        data.put("serveDate", date.toString());
        data.put("available", available);
        return data;
    }

    // ---------------- orders ----------------
    public Map<String, Object> listOrders(int page, int size, String status, String dateStr) {
        Util.validatePage(page, size);
        StringBuilder where = new StringBuilder(" WHERE 1=1");
        List<Object> args = new ArrayList<>();
        if (status != null && !status.isBlank()) {
            if (!Util.ORDER_STATUSES.contains(status)) throw Api.error(400, "VALIDATION_INVALID", "Invalid status");
            where.append(" AND status=?");
            args.add(status);
        }
        if (dateStr != null && !dateStr.isBlank()) {
            where.append(" AND delivery_date=?");
            args.add(Util.parseDate(dateStr, "VALIDATION_INVALID"));
        }
        Long total = jdbc.queryForObject("SELECT COUNT(*) FROM orders" + where, Long.class, args.toArray());
        args.add(size);
        args.add((page - 1) * size);
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id,order_no,user_id,status,delivery_date,meal_type,total_cents,item_count,created_at FROM orders"
                        + where + " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?", args.toArray());
        List<Map<String, Object>> items = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("orderId", r.get("id"));
            m.put("orderNo", r.get("order_no"));
            m.put("userId", r.get("user_id"));
            m.put("status", r.get("status"));
            m.put("deliveryDate", String.valueOf(r.get("delivery_date")));
            m.put("mealType", r.get("meal_type"));
            m.put("address", "***");
            m.put("totalCents", Util.cents(r.get("total_cents")));
            m.put("itemCount", Util.intVal(r.get("item_count")));
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

    // ---------------- dashboard ----------------
    public Map<String, Object> dashboard(String dateStr) {
        LocalDate date = dateStr == null || dateStr.isBlank() ? RequestContext.today()
                : Util.parseDate(dateStr, "VALIDATION_INVALID");
        Map<String, Object> today = new LinkedHashMap<>();
        int orders = count("SELECT COUNT(*) FROM orders WHERE delivery_date=? AND status<>'Cancelled'", date);
        long revenue = jdbc.queryForObject("SELECT COALESCE(SUM(total_cents),0) FROM orders WHERE delivery_date=? AND status<>'Cancelled'",
                Long.class, date);
        today.put("orders", orders);
        today.put("revenueCents", revenue);
        today.put("completed", count("SELECT COUNT(*) FROM orders WHERE delivery_date=? AND status='Completed'", date));
        today.put("pending", count("SELECT COUNT(*) FROM orders WHERE delivery_date=? AND status='Pending'", date));
        today.put("cancelled", count("SELECT COUNT(*) FROM orders WHERE delivery_date=? AND status='Cancelled'", date));

        List<Map<String, Object>> topDishes = new ArrayList<>();
        for (Map<String, Object> r : jdbc.queryForList(
                "SELECT oi.dish_id, oi.dish_name AS name, SUM(oi.qty) AS sold FROM order_items oi "
                        + "JOIN orders o ON o.id=oi.order_id WHERE o.delivery_date=? AND o.status<>'Cancelled' "
                        + "GROUP BY oi.dish_id,oi.dish_name ORDER BY sold DESC LIMIT 5", date)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("dishId", r.get("dish_id"));
            m.put("name", r.get("name"));
            m.put("soldQty", Util.intVal(r.get("sold")));
            topDishes.add(m);
        }
        Map<String, Object> mealSplit = new LinkedHashMap<>();
        mealSplit.put("lunch", count("SELECT COUNT(*) FROM orders WHERE delivery_date=? AND status<>'Cancelled' AND meal_type='Lunch'", date));
        mealSplit.put("dinner", count("SELECT COUNT(*) FROM orders WHERE delivery_date=? AND status<>'Cancelled' AND meal_type='Dinner'", date));

        List<Map<String, Object>> trend = new ArrayList<>();
        for (int i = 6; i >= 0; i--) {
            LocalDate d = date.minusDays(i);
            Map<String, Object> t = new LinkedHashMap<>();
            t.put("date", d.toString());
            t.put("orders", count("SELECT COUNT(*) FROM orders WHERE delivery_date=? AND status<>'Cancelled'", d));
            t.put("revenueCents", jdbc.queryForObject(
                    "SELECT COALESCE(SUM(total_cents),0) FROM orders WHERE delivery_date=? AND status<>'Cancelled'", Long.class, d));
            trend.add(t);
        }

        List<Map<String, Object>> lowStock = new ArrayList<>();
        for (Map<String, Object> r : jdbc.queryForList(
                "SELECT s.dish_id, d.name, s.total_qty-s.reserved_qty-s.sold_qty AS available FROM dish_daily_stock s "
                        + "JOIN dishes d ON d.id=s.dish_id WHERE s.serve_date=? "
                        + "HAVING available>=0 AND available<=3 ORDER BY available", date)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("dishId", r.get("dish_id"));
            m.put("name", r.get("name"));
            m.put("available", Math.max(0, Util.intVal(r.get("available"))));
            lowStock.add(m);
        }

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("today", today);
        data.put("topDishes", topDishes);
        data.put("mealSplit", mealSplit);
        data.put("trend", trend);
        data.put("lowStock", lowStock);
        return data;
    }

    private int count(String sql, Object arg) {
        Integer n = jdbc.queryForObject(sql, Integer.class, arg);
        return n == null ? 0 : n;
    }

    // ---------------- audit ----------------
    public Map<String, Object> auditLogs(int page, int size, String action, String objectType) {
        Util.validatePage(page, size);
        StringBuilder where = new StringBuilder(" WHERE 1=1");
        List<Object> args = new ArrayList<>();
        if (action != null && !action.isBlank()) { where.append(" AND action=?"); args.add(action); }
        if (objectType != null && !objectType.isBlank()) { where.append(" AND object_type=?"); args.add(objectType); }
        Long total = jdbc.queryForObject("SELECT COUNT(*) FROM audit_log" + where, Long.class, args.toArray());
        args.add(size);
        args.add((page - 1) * size);
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id,actor_id,actor_email,action,object_type,object_id,before_json,after_json,reason,ip,request_id,created_at "
                        + "FROM audit_log" + where + " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?", args.toArray());
        List<Map<String, Object>> items = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", r.get("id"));
            m.put("actorId", r.get("actor_id"));
            m.put("actorEmail", r.get("actor_email"));
            m.put("action", r.get("action"));
            m.put("objectType", r.get("object_type"));
            m.put("objectId", r.get("object_id"));
            m.put("before", r.get("before_json") == null ? null : Util.parseMap(String.valueOf(r.get("before_json"))));
            m.put("after", r.get("after_json") == null ? null : Util.parseMap(String.valueOf(r.get("after_json"))));
            m.put("reason", r.get("reason"));
            m.put("ip", r.get("ip"));
            m.put("requestId", r.get("request_id"));
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

    // ---------------- AI rules ----------------
    public Map<String, Object> getAiRules() {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT config_key,version,config_json,created_at FROM ai_rule_config WHERE config_key='recommend_weights' "
                        + "AND active=1 ORDER BY version DESC LIMIT 1");
        Map<String, Object> data = new LinkedHashMap<>();
        if (rows.isEmpty()) {
            data.put("configKey", "recommend_weights");
            data.put("version", 0);
            data.put("config", Util.parseMap("{\"preferredCategory\":3,\"spiceMatch\":2,\"budgetFit\":2,\"protein\":1,\"taste\":1}"));
            data.put("updatedAt", null);
            return data;
        }
        Map<String, Object> r = rows.get(0);
        data.put("configKey", r.get("config_key"));
        data.put("version", r.get("version"));
        data.put("config", Util.parseMap(String.valueOf(r.get("config_json"))));
        data.put("updatedAt", Util.iso(r.get("created_at")));
        return data;
    }

    @Transactional
    public Map<String, Object> putAiRules(Dtos.AiRuleReq req) {
        Util.requireConfirm(req.confirm());
        requireReason(req.reason());
        String configKey = req.configKey() == null || req.configKey().isBlank() ? "recommend_weights" : req.configKey();
        String configJson;
        if (req.rollbackToVersion() != null) {
            List<Map<String, Object>> hist = jdbc.queryForList(
                    "SELECT config_json FROM ai_rule_config WHERE config_key=? AND version=?", configKey, req.rollbackToVersion());
            if (hist.isEmpty()) throw Api.error(400, "VALIDATION_INVALID", "Rollback version not found");
            configJson = String.valueOf(hist.get(0).get("config_json"));
        } else {
            if (req.config() == null || req.config().isNull()) {
                throw Api.error(400, "VALIDATION_INVALID", "config is required");
            }
            configJson = req.config().toString();
        }
        Integer maxVersion = jdbc.queryForObject(
                "SELECT COALESCE(MAX(version),0) FROM ai_rule_config WHERE config_key=?", Integer.class, configKey);
        int version = (maxVersion == null ? 0 : maxVersion) + 1;
        jdbc.update("UPDATE ai_rule_config SET active=0 WHERE config_key=?", configKey);
        jdbc.update("INSERT INTO ai_rule_config(config_key,version,config_json,active,change_reason,created_by) VALUES (?,?,?,1,?,?)",
                configKey, version, configJson, req.reason(), com.webox.config.SecurityConfig.current().id());
        Map<String, Object> auditAfter = new LinkedHashMap<>();
        auditAfter.put("version", version);
        auditAfter.put("rollbackToVersion", req.rollbackToVersion());
        audit.log("AI_RULE_UPDATE", "AI_RULE", configKey + ":v" + version, null, auditAfter, req.reason());
        return getAiRules();
    }
}