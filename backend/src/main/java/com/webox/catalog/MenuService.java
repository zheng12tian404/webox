package com.webox.catalog;

import com.github.benmanes.caffeine.cache.Cache;
import com.webox.common.Api;
import com.webox.common.RequestContext;
import com.webox.common.Util;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class MenuService {
    private final JdbcTemplate jdbc;
    private final Cache<String, Object> cache;

    public MenuService(JdbcTemplate jdbc, Cache<String, Object> menuCache) {
        this.jdbc = jdbc;
        this.cache = menuCache;
    }

    public void invalidate() { cache.invalidateAll(); }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> staticDishes(LocalDate date) {
        String key = "dishes:" + date;
        Object cached = cache.getIfPresent(key);
        if (cached != null) return (List<Map<String, Object>>) cached;
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT d.id, d.name, d.description, d.price_cents, d.category, d.spice_level, d.image_url, "
                        + "EXISTS(SELECT 1 FROM dish_option_groups g WHERE g.dish_id=d.id) AS has_options, "
                        + "EXISTS(SELECT 1 FROM dish_option_groups g WHERE g.dish_id=d.id AND g.required=1) AS has_required_options "
                        + "FROM daily_menu m JOIN dishes d ON d.id=m.dish_id "
                        + "WHERE m.serve_date=? AND m.publish_status='PUBLISHED' AND d.status='ON_SHELF' ORDER BY d.name", date);
        cache.put(key, rows);
        return rows;
    }

    public Map<String, Object> list(String dateStr, int page, int size, String categories, String search, String sort) {
        Util.validatePage(page, size);
        LocalDate date = dateStr == null || dateStr.isBlank() ? RequestContext.today() : Util.parseDate(dateStr, "VALIDATION_INVALID");
        List<String> cats = new ArrayList<>();
        if (categories != null && !categories.isBlank()) {
            for (String c : categories.split(",")) {
                String t = c.trim();
                if (!t.isEmpty() && !Util.CATEGORIES.contains(t)) {
                    throw Api.error(400, "VALIDATION_CATEGORY", "Invalid category: " + t);
                }
                if (!t.isEmpty()) cats.add(t);
            }
        }
        if (search != null && search.length() > 50) {
            throw Api.error(400, "VALIDATION_SEARCH_LENGTH", "Search must be at most 50 characters");
        }
        String needle = search == null ? "" : search.trim().toLowerCase();

        Map<Long, Integer> available = availableMap(date);
        Map<String, Object> prefs = preferenceContext();
        List<String> preferredCats = (List<String>) ((Map<String, Object>) prefs.get("categories")).get("categories");
        String spicePref = (String) ((Map<String, Object>) prefs.get("categories")).get("spice");
        boolean recommend = (Boolean) ((Map<String, Object>) prefs.get("categories")).get("enabled");

        List<Map<String, Object>> items = new ArrayList<>();
        for (Map<String, Object> d : staticDishes(date)) {
            String category = String.valueOf(d.get("category"));
            String name = String.valueOf(d.get("name"));
            String description = String.valueOf(d.get("description"));
            if (!cats.isEmpty() && !cats.contains(category)) continue;
            if (!needle.isEmpty() && !name.toLowerCase().contains(needle) && !description.toLowerCase().contains(needle)) continue;
            int qty = available.getOrDefault(((Number) d.get("id")).longValue(), 0);
            boolean forYou = recommend && (preferredCats.contains(category)
                    || (spicePref != null && spicePref.equals(String.valueOf(d.get("spice_level")))));
            Map<String, Object> m = new LinkedHashMap<>();
            long dishId = ((Number) d.get("id")).longValue();
            long price = Util.cents(d.get("price_cents"));
            m.put("dishId", dishId);
            m.put("name", name);
            m.put("description", description);
            m.put("priceCents", price);
            m.put("priceDisplay", Util.money(price));
            m.put("category", category);
            m.put("spiceLevel", d.get("spice_level"));
            m.put("imageUrl", d.get("image_url"));
            m.put("available", qty > 0);
            m.put("availableQty", qty);
            m.put("lowStock", qty > 0 && qty <= 3);
            m.put("soldOut", qty == 0);
            m.put("hasOptions", Util.intVal(d.get("has_options")) == 1);
            m.put("hasRequiredOptions", Util.intVal(d.get("has_required_options")) == 1);
            m.put("forYou", forYou);
            items.add(m);
        }
        if ("for-you".equals(sort)) {
            items.sort(Comparator.comparing((Map<String, Object> m) -> Boolean.TRUE.equals(m.get("forYou")) ? 0 : 1)
                    .thenComparing(m -> String.valueOf(m.get("name"))));
        } else {
            items.sort(Comparator.comparing(m -> String.valueOf(m.get("name"))));
        }
        int total = items.size();
        int from = Math.min((page - 1) * size, total);
        int to = Math.min(from + size, total);
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("items", items.subList(from, to));
        data.put("page", page);
        data.put("size", size);
        data.put("total", total);
        return data;
    }

    private Map<Long, Integer> availableMap(LocalDate date) {
        Map<Long, Integer> out = new HashMap<>();
        for (Map<String, Object> r : jdbc.queryForList(
                "SELECT dish_id, total_qty-reserved_qty-sold_qty AS available FROM dish_daily_stock WHERE serve_date=?", date)) {
            out.put(((Number) r.get("dish_id")).longValue(), Math.max(0, Util.intVal(r.get("available"))));
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> preferenceContext() {
        long uid = 0;
        try { uid = com.webox.config.SecurityConfig.current().id(); } catch (Exception ignored) {}
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM user_preferences WHERE user_id=?", uid);
        Map<String, Object> ctx = new LinkedHashMap<>();
        if (rows.isEmpty()) {
            ctx.put("categories", List.of());
            ctx.put("spice", null);
            ctx.put("enabled", false);
        } else {
            Map<String, Object> r = rows.get(0);
            ctx.put("categories", Util.parseList((String) r.get("preferred_categories")));
            ctx.put("spice", r.get("spice_preference"));
            ctx.put("enabled", Util.intVal(r.get("recommend_enabled")) == 1);
        }
        Map<String, Object> wrapper = new LinkedHashMap<>();
        wrapper.put("categories", ctx);
        return wrapper;
    }

    public Map<String, Object> detail(long dishId) {
        LocalDate today = RequestContext.today();
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT d.* FROM dishes d JOIN daily_menu m ON m.dish_id=d.id AND m.serve_date=? AND m.publish_status='PUBLISHED' "
                        + "WHERE d.id=? AND d.status='ON_SHELF'", today, dishId);
        if (rows.isEmpty()) throw Api.error(404, "DISH_NOT_FOUND", "Dish not found on today's menu");
        Map<String, Object> d = rows.get(0);
        int qty = 0;
        List<Map<String, Object>> stock = jdbc.queryForList(
                "SELECT total_qty-reserved_qty-sold_qty AS available FROM dish_daily_stock WHERE dish_id=? AND serve_date=?",
                dishId, today);
        if (!stock.isEmpty()) qty = Math.max(0, Util.intVal(stock.get(0).get("available")));
        long price = Util.cents(d.get("price_cents"));
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("dishId", d.get("id"));
        data.put("name", d.get("name"));
        data.put("description", d.get("description"));
        data.put("priceCents", price);
        data.put("priceDisplay", Util.money(price));
        data.put("category", d.get("category"));
        data.put("protein", d.get("protein"));
        data.put("allergens", Util.parseList((String) d.get("allergens")));
        data.put("spiceLevel", d.get("spice_level"));
        data.put("imageUrl", d.get("image_url"));
        data.put("available", qty > 0);
        data.put("availableQty", qty);
        data.put("optionGroups", optionGroups(dishId));
        return data;
    }

    public List<Map<String, Object>> optionGroups(long dishId) {
        List<Map<String, Object>> groups = jdbc.queryForList(
                "SELECT id,name,required,min_select,max_select FROM dish_option_groups WHERE dish_id=? ORDER BY sort_order,id", dishId);
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> g : groups) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("groupId", g.get("id"));
            m.put("name", g.get("name"));
            m.put("required", Util.intVal(g.get("required")) == 1);
            m.put("minSelect", g.get("min_select"));
            m.put("maxSelect", g.get("max_select"));
            List<Map<String, Object>> opts = jdbc.queryForList(
                    "SELECT id,name,price_delta_cents FROM dish_options WHERE group_id=? ORDER BY sort_order,id", g.get("id"));
            List<Map<String, Object>> options = new ArrayList<>();
            for (Map<String, Object> o : opts) {
                Map<String, Object> om = new LinkedHashMap<>();
                om.put("optionId", o.get("id"));
                om.put("name", o.get("name"));
                om.put("priceDeltaCents", Util.cents(o.get("price_delta_cents")));
                options.add(om);
            }
            m.put("options", options);
            out.add(m);
        }
        return out;
    }

    public Map<String, Object> filters() {
        Object cached = cache.getIfPresent("filters");
        if (cached != null) return (Map<String, Object>) cached;
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("categories", Util.CATEGORIES);
        data.put("spiceLevels", Util.SPICE);
        data.put("allergens", Util.ALLERGENS);
        List<Map<String, Object>> dates = new ArrayList<>();
        LocalDate today = RequestContext.today();
        for (int i = 0; i < 3; i++) {
            LocalDate d = today.plusDays(i);
            Integer count = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM daily_menu WHERE serve_date=? AND publish_status='PUBLISHED'", Integer.class, d);
            Map<String, Object> dm = new LinkedHashMap<>();
            dm.put("date", d.toString());
            dm.put("published", count != null && count > 0);
            dates.add(dm);
        }
        data.put("dates", dates);
        cache.put("filters", data);
        return data;
    }
}