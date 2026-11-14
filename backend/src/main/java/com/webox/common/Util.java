package com.webox.common;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.webox.dto.Dtos;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class Util {
    /**
     * Shared mapper for audit snapshots, idempotency bodies and SSE payloads.
     * JavaTimeModule is required: JDBC rows carry LocalDateTime/LocalDate, and without it
     * Jackson throws InvalidDefinitionException (500 on Console dish update/status).
     */
    private static final ObjectMapper MAPPER = new ObjectMapper()
            .registerModule(new com.fasterxml.jackson.datatype.jsr310.JavaTimeModule())
            .disable(com.fasterxml.jackson.databind.SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    public static final List<String> CATEGORIES = List.of("Chinese", "Western", "Japanese", "Light Meal", "Korean", "Southeast Asian");
    public static final List<String> SPICE = List.of("None", "Mild", "Medium", "Hot");
    public static final List<String> ALLERGENS = List.of("Peanuts", "Dairy", "Egg", "Gluten", "Soy", "Fish", "Shellfish");
    public static final List<String> MEALS = List.of("Lunch", "Dinner");
    public static final List<String> ORDER_STATUSES = List.of("Pending", "Confirmed", "Completed", "Cancelled");

    private Util() {}

    public static String money(long cents) {
        long abs = Math.abs(cents);
        return (cents < 0 ? "-" : "") + "¥" + (abs / 100) + "." + String.format("%02d", abs % 100);
    }

    public static ObjectMapper mapper() { return MAPPER; }

    /** High-risk admin mutations require an explicit confirm=true (AC-032). */
    public static void requireConfirm(Boolean confirm) {
        if (!Boolean.TRUE.equals(confirm)) {
            throw Api.error(400, "VALIDATION_CONFIRM_REQUIRED", "confirm=true is required for this operation");
        }
    }

    /** Run side effects (cache invalidation, Redis sync, SSE publish) only after the DB commit. */
    public static void afterCommit(Runnable action) {
        if (org.springframework.transaction.support.TransactionSynchronizationManager.isSynchronizationActive()) {
            org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(
                new org.springframework.transaction.support.TransactionSynchronization() {
                    @Override public void afterCommit() { action.run(); }
                });
        } else {
            action.run();
        }
    }

    public static JsonNode toJson(Object o) { return MAPPER.valueToTree(o); }

    public static String json(Object o) {
        try { return MAPPER.writeValueAsString(o); } catch (Exception e) { throw new IllegalStateException(e); }
    }

    public static <T> T fromJson(String s, Class<T> c) {
        try { return MAPPER.readValue(s, c); } catch (Exception e) { throw new IllegalStateException(e); }
    }

    public static Map<String, Object> parseMap(String json) {
        try {
            if (json == null || json.isBlank()) return new LinkedHashMap<>();
            return MAPPER.readValue(json, new com.fasterxml.jackson.core.type.TypeReference<LinkedHashMap<String, Object>>() {});
        } catch (Exception e) { return new LinkedHashMap<>(); }
    }

    public static List<String> parseList(String json) {
        try {
            if (json == null || json.isBlank()) return new ArrayList<>();
            return MAPPER.readValue(json, new com.fasterxml.jackson.core.type.TypeReference<List<String>>() {});
        } catch (Exception e) { return new ArrayList<>(); }
    }

    public static List<Map<String, Object>> parseListOfMaps(String json) {
        try {
            if (json == null || json.isBlank()) return new ArrayList<>();
            return MAPPER.readValue(json, new com.fasterxml.jackson.core.type.TypeReference<List<Map<String, Object>>>() {});
        } catch (Exception e) { return new ArrayList<>(); }
    }

    public static String sha256(String s) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    public static long cents(Object o) {
        if (o == null) return 0L;
        if (o instanceof Number n) return n.longValue();
        return Long.parseLong(String.valueOf(o));
    }

    public static int intVal(Object o) {
        if (o == null) return 0;
        if (o instanceof Boolean b) return b ? 1 : 0;
        if (o instanceof Number n) return n.intValue();
        String s = String.valueOf(o);
        if ("true".equalsIgnoreCase(s)) return 1;
        if ("false".equalsIgnoreCase(s)) return 0;
        return Integer.parseInt(s);
    }

    public static String escapeLike(String input) {
        return input.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    public static void validatePage(int page, int size) {
        if (page < 1 || size < 1 || size > 100) {
            throw Api.error(400, "VALIDATION_PAGINATION", "page must be >=1 and size between 1 and 100");
        }
    }

    public static LocalDate parseDate(String s, String code) {
        try {
            return LocalDate.parse(s);
        } catch (Exception e) {
            throw Api.error(400, code, "Invalid date, expected YYYY-MM-DD");
        }
    }

    public static LocalDateTime ldt(LocalDate d, LocalTime t) { return LocalDateTime.of(d, t); }

    public static ZonedDateTime at(LocalDate d, LocalTime t) {
        return ZonedDateTime.of(d, t, RequestContext.ZONE);
    }

    /** Cutoff rule: Lunch 10:00, Dinner 15:00 (Asia/Shanghai). */
    public static Effective resolveMeal(LocalDate requestedDate, String requestedMeal, ZonedDateTime now) {
        LocalDate today = now.toLocalDate();
        LocalTime time = now.toLocalTime();
        LocalDate date = requestedDate;
        String meal = requestedMeal;
        boolean auto = false;
        if (date == null && meal == null) {
            if (time.isBefore(LocalTime.of(10, 0))) { date = today; meal = "Lunch"; }
            else if (time.isBefore(LocalTime.of(15, 0))) { date = today; meal = "Dinner"; }
            else { date = today.plusDays(1); meal = "Lunch"; }
            return new Effective(date, meal, false);
        }
        if (date == null) date = today;
        if (date.isBefore(today)) {
            throw Api.error(400, "VALIDATION_DATE_PAST", "Delivery date cannot be in the past");
        }
        if (meal == null) meal = time.isBefore(LocalTime.of(10, 0)) ? "Lunch" : time.isBefore(LocalTime.of(15, 0)) ? "Dinner" : "Lunch";
        if (!MEALS.contains(meal)) throw Api.error(400, "VALIDATION_INVALID", "Invalid mealType");
        LocalTime cutoff = "Lunch".equals(meal) ? LocalTime.of(10, 0) : LocalTime.of(15, 0);
        if (!now.toLocalDateTime().isBefore(ldt(date, cutoff))) {
            auto = true;
            if (time.isBefore(LocalTime.of(15, 0)) && date.equals(today)) { meal = "Dinner"; }
            else { date = today.plusDays(1); meal = "Lunch"; }
            if (date.isBefore(today)) throw Api.error(409, "ORDER_MEAL_UNAVAILABLE", "No meal can be ordered");
        }
        return new Effective(date, meal, auto);
    }

    public record Effective(LocalDate date, String meal, boolean autoSwitched) {}

    public static String canonicalSubmit(Dtos.SubmitReq req) {
        List<Map<String, Object>> items = new ArrayList<>();
        for (Dtos.ItemReq i : req.items()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("dishId", i.dishId());
            m.put("qty", i.qty());
            List<Long> ops = new ArrayList<>(i.optionIds() == null ? List.of() : i.optionIds());
            ops.sort(Long::compareTo);
            m.put("optionIds", ops);
            items.add(m);
        }
        items.sort((a, b) -> Long.compare((Long) a.get("dishId"), (Long) b.get("dishId")));
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("items", items);
        root.put("deliveryDate", req.deliveryDate());
        root.put("mealType", req.mealType());
        root.put("address", req.address() == null ? null : req.address().trim());
        root.put("confirmAutoSwitch", req.confirmAutoSwitch());
        return sha256(json(root));
    }

    public static String priceDisplay(long cents) { return money(cents); }

    /** ISO-8601 timestamp in Asia/Shanghai with offset, e.g. 2026-11-14T22:00:00+08:00. */
    public static String iso(Object o) {
        if (o == null) return null;
        if (o instanceof java.time.LocalDateTime ldt) return ldt.atZone(RequestContext.ZONE).toOffsetDateTime().toString();
        if (o instanceof java.sql.Timestamp ts) return ts.toLocalDateTime().atZone(RequestContext.ZONE).toOffsetDateTime().toString();
        if (o instanceof java.time.LocalDate ld) return ld.toString();
        if (o instanceof java.time.OffsetDateTime odt) return odt.toString();
        if (o instanceof java.time.ZonedDateTime zdt) return zdt.toOffsetDateTime().toString();
        return String.valueOf(o);
    }

    public static ZoneId zone() { return RequestContext.ZONE; }

    /**
     * Normalize a JDBC datetime value to LocalDateTime.
     * MySQL Connector/J returns DATETIME columns as LocalDateTime, but drivers/column
     * types and test doubles may return java.sql.Timestamp, OffsetDateTime, Date or a
     * String instead. Never cast blindly; unknown/null values yield null (caller decides).
     */
    public static LocalDateTime localDateTime(Object o) {
        if (o == null) return null;
        if (o instanceof LocalDateTime ldt) return ldt;
        if (o instanceof java.sql.Timestamp ts) return ts.toLocalDateTime();
        if (o instanceof java.time.OffsetDateTime odt) return odt.atZoneSameInstant(RequestContext.ZONE).toLocalDateTime();
        if (o instanceof ZonedDateTime zdt) return zdt.withZoneSameInstant(RequestContext.ZONE).toLocalDateTime();
        if (o instanceof java.time.Instant inst) return LocalDateTime.ofInstant(inst, RequestContext.ZONE);
        if (o instanceof java.util.Date d) return LocalDateTime.ofInstant(d.toInstant(), RequestContext.ZONE);
        String s = String.valueOf(o).trim();
        if (s.isEmpty()) return null;
        int space = s.indexOf(' ');
        String iso = space > 0 ? s.substring(0, space) + 'T' + s.substring(space + 1) : s;
        try { return LocalDateTime.parse(iso); } catch (Exception ignored) { /* fall through */ }
        try { return LocalDateTime.of(java.time.LocalDate.parse(s), LocalTime.MIDNIGHT); } catch (Exception ignored) { /* fall through */ }
        try { return java.time.OffsetDateTime.parse(iso).atZoneSameInstant(RequestContext.ZONE).toLocalDateTime(); } catch (Exception ignored) { /* fall through */ }
        return null;
    }
}