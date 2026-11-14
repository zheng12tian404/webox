package com.webox.auth;

import com.webox.common.Api;
import com.webox.common.Util;
import com.webox.config.SecurityConfig;
import com.webox.dto.Dtos;
import jakarta.validation.Valid;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/me")
public class MeController {
    private final JdbcTemplate jdbc;

    public MeController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping("/preferences")
    public Map<String, Object> getPreferences() {
        long uid = SecurityConfig.current().id();
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM user_preferences WHERE user_id=?", uid);
        Map<String, Object> data = new LinkedHashMap<>();
        if (rows.isEmpty()) {
            data.put("allergens", List.of());
            data.put("preferredCategories", List.of());
            data.put("spicePreference", null);
            data.put("tastePreference", null);
            data.put("budgetMinCents", null);
            data.put("budgetMaxCents", null);
            data.put("recommendEnabled", false);
            return Api.ok(data);
        }
        Map<String, Object> r = rows.get(0);
        data.put("allergens", Util.parseList((String) r.get("allergens")));
        data.put("preferredCategories", Util.parseList((String) r.get("preferred_categories")));
        data.put("spicePreference", r.get("spice_preference"));
        data.put("tastePreference", r.get("taste_preference"));
        data.put("budgetMinCents", r.get("budget_min_cents"));
        data.put("budgetMaxCents", r.get("budget_max_cents"));
        data.put("recommendEnabled", Util.intVal(r.get("recommend_enabled")) == 1);
        return Api.ok(data);
    }

    @PutMapping("/preferences")
    public Map<String, Object> putPreferences(@RequestBody Dtos.PrefReq req) {
        long uid = SecurityConfig.current().id();
        List<String> allergens = req.allergens() == null ? List.of() : req.allergens();
        List<String> categories = req.preferredCategories() == null ? List.of() : req.preferredCategories();
        for (String a : allergens) {
            if (!Util.ALLERGENS.contains(a)) throw Api.error(400, "VALIDATION_CATEGORY", "Invalid allergen: " + a);
        }
        for (String c : categories) {
            if (!Util.CATEGORIES.contains(c)) throw Api.error(400, "VALIDATION_CATEGORY", "Invalid category: " + c);
        }
        if (req.spicePreference() != null && !Util.SPICE.contains(req.spicePreference())) {
            throw Api.error(400, "VALIDATION_CATEGORY", "Invalid spice preference");
        }
        String taste = req.tastePreference();
        if ("Balanced".equalsIgnoreCase(taste)) taste = "Medium"; // FE alias (FR-B1)
        if (taste != null && !List.of("Light", "Medium", "Rich").contains(taste)) {
            throw Api.error(400, "VALIDATION_CATEGORY", "Invalid taste preference");
        }
        Long budgetMin = req.budgetMinCents();
        Long budgetMax = req.budgetMaxCents();
        if (budgetMin != null && budgetMax != null && budgetMin == 0L && budgetMax == 0L) {
            budgetMin = null; // 0/0 means "not set" (FR-B1)
            budgetMax = null;
        }
        if (budgetMin != null && budgetMax != null && (budgetMin <= 0L || budgetMin > budgetMax)) {
            throw Api.error(400, "VALIDATION_INVALID", "Budget requires 0 < min <= max");
        }
        jdbc.update("INSERT INTO user_preferences(user_id,allergens,preferred_categories,spice_preference,taste_preference,"
                        + "budget_min_cents,budget_max_cents,recommend_enabled) VALUES (?,?,?,?,?,?,?,?) "
                        + "ON DUPLICATE KEY UPDATE allergens=VALUES(allergens), preferred_categories=VALUES(preferred_categories),"
                        + " spice_preference=VALUES(spice_preference), taste_preference=VALUES(taste_preference),"
                        + " budget_min_cents=VALUES(budget_min_cents), budget_max_cents=VALUES(budget_max_cents),"
                        + " recommend_enabled=VALUES(recommend_enabled)",
                uid, Util.json(allergens), Util.json(categories), req.spicePreference(), taste,
                budgetMin, budgetMax, Boolean.TRUE.equals(req.recommendEnabled()) ? 1 : 0);
        return getPreferences();
    }

    @GetMapping("/addresses")
    public Map<String, Object> listAddresses() {
        long uid = SecurityConfig.current().id();
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id,address,last_used_at FROM addresses WHERE user_id=? ORDER BY last_used_at DESC, id DESC", uid);
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", r.get("id"));
            m.put("address", r.get("address"));
            m.put("lastUsedAt", Util.iso(r.get("last_used_at")));
            out.add(m);
        }
        return Api.ok(out);
    }

    @PostMapping("/addresses")
    public ResponseEntity<Map<String, Object>> addAddress(@Valid @RequestBody Dtos.AddressReq req) {
        long uid = SecurityConfig.current().id();
        String address = req.address().trim();
        if (address.isEmpty()) throw Api.error(400, "VALIDATION_ADDRESS_LENGTH", "Address is required");
        try {
            jdbc.update("INSERT INTO addresses(user_id,address) VALUES (?,?)", uid, address);
        } catch (DuplicateKeyException ignored) {
            // unique (user_id,address): return existing
        }
        Long id = jdbc.queryForObject("SELECT id FROM addresses WHERE user_id=? AND address=?", Long.class, uid, address);
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("id", id);
        data.put("address", address);
        return ResponseEntity.status(HttpStatus.CREATED).body(Api.ok(data));
    }

    @DeleteMapping("/addresses/{id}")
    public Map<String, Object> deleteAddress(@PathVariable long id) {
        long uid = SecurityConfig.current().id();
        int n = jdbc.update("DELETE FROM addresses WHERE id=? AND user_id=?", id, uid);
        if (n == 0) throw Api.error(404, "NOT_FOUND", "Address not found");
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("deleted", true);
        return Api.ok(data);
    }
}