package com.webox.ai;

import com.webox.common.RateLimiter;
import com.webox.common.RequestContext;
import com.webox.common.Util;
import com.webox.config.SecurityConfig;
import com.webox.dto.Dtos;
import com.webox.security.UserPrincipal;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@RestController
@RequestMapping("/api/v1/ai")
public class AiController {
    private static final Logger log = LoggerFactory.getLogger(AiController.class);
    private final JdbcTemplate jdbc;
    private final RateLimiter limiter;
    private final ExecutorService executor = Executors.newFixedThreadPool(4);

    @Value("${webox.llm.api-key:}")
    private String llmKey;
    @Value("${webox.llm.base-url:https://api.openai.com/v1}")
    private String llmBase;
    @Value("${webox.llm.model:gpt-4o-mini}")
    private String llmModel;

    public AiController(JdbcTemplate jdbc, RateLimiter limiter) {
        this.jdbc = jdbc;
        this.limiter = limiter;
    }

    @PostMapping(value = "/recommend", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter recommend(@RequestBody Dtos.AiReq req) {
        UserPrincipal user = SecurityConfig.current();
        limiter.check("ai:" + user.id(), 10, 60_000);
        String prompt = req.prompt() == null ? "" : req.prompt();
        if (prompt.length() > 500) {
            throw com.webox.common.Api.error(400, "VALIDATION_INVALID", "prompt must be at most 500 characters");
        }
        SseEmitter emitter = new SseEmitter(25_000L);
        String sessionId = req.sessionId() == null || req.sessionId().isBlank()
                ? "s-" + UUID.randomUUID().toString().substring(0, 8) : req.sessionId();
        executor.submit(() -> run(emitter, user, prompt, sessionId));
        return emitter;
    }

    private record Candidate(long dishId, String name, String category, String spice, long price, int available,
                             String protein, double score) {}

    private void run(SseEmitter emitter, UserPrincipal user, String prompt, String sessionId) {
        long start = System.currentTimeMillis();
        try {
            List<Candidate> candidates = candidates(user.id());
            List<String> reasons = new ArrayList<>();
            List<Candidate> chosen;
            boolean fallback = llmKey == null || llmKey.isBlank();
            String model = fallback ? "rule-based" : llmModel;
            List<Candidate> llmChosen = fallback ? null : tryLlm(prompt, candidates, reasons);
            if (llmChosen != null) {
                chosen = llmChosen;
            } else {
                fallback = true;
                model = "rule-based";
                chosen = candidates.stream().limit(5).toList();
                reasons.clear();
                for (Candidate c : chosen) reasons.add(reasonFor(c));
            }
            Map<String, Object> meta = new LinkedHashMap<>();
            meta.put("fallback", fallback);
            meta.put("model", model);
            meta.put("sessionId", sessionId);
            emitter.send(SseEmitter.event().reconnectTime(3000L).name("meta").data(Util.json(meta)));
            List<Long> ids = new ArrayList<>();
            for (int i = 0; i < chosen.size(); i++) {
                Candidate c = chosen.get(i);
                ids.add(c.dishId());
                Map<String, Object> dish = new LinkedHashMap<>();
                dish.put("dishId", c.dishId());
                dish.put("name", c.name());
                dish.put("priceCents", c.price());
                dish.put("priceDisplay", Util.money(c.price()));
                dish.put("category", c.category());
                dish.put("available", c.available());
                emitter.send(SseEmitter.event().name("dish").data(Util.json(dish)));
                Map<String, Object> reason = new LinkedHashMap<>();
                reason.put("dishId", c.dishId());
                reason.put("text", i < reasons.size() ? reasons.get(i) : reasonFor(c));
                emitter.send(SseEmitter.event().name("reason").data(Util.json(reason)));
            }
            emitter.send(SseEmitter.event().name("done").data(Util.json(Map.of("dishIds", ids))));
            persist(user.id(), sessionId, prompt, ids, model, fallback, System.currentTimeMillis() - start);
            emitter.complete();
        } catch (Exception e) {
            log.warn("AI recommend failed: {}", e.getMessage());
            try { emitter.completeWithError(e); } catch (Exception ignored) {}
        }
    }

    private List<Candidate> candidates(long userId) {
        List<String> allergens = new ArrayList<>();
        List<String> preferred = new ArrayList<>();
        String spice = null;
        Long budgetMax = null;
        List<Map<String, Object>> prefs = jdbc.queryForList("SELECT * FROM user_preferences WHERE user_id=?", userId);
        if (!prefs.isEmpty()) {
            allergens = Util.parseList((String) prefs.get(0).get("allergens"));
            preferred = Util.parseList((String) prefs.get(0).get("preferred_categories"));
            spice = (String) prefs.get(0).get("spice_preference");
            budgetMax = prefs.get(0).get("budget_max_cents") == null ? null : Util.cents(prefs.get(0).get("budget_max_cents"));
        }
        Set<Long> recent = new HashSet<>();
        for (Map<String, Object> r : jdbc.queryForList(
                "SELECT DISTINCT oi.dish_id FROM order_items oi JOIN orders o ON o.id=oi.order_id "
                        + "WHERE o.user_id=? AND o.status<>'Cancelled' AND o.created_at>=NOW(3)-INTERVAL 7 DAY", userId)) {
            recent.add(((Number) r.get("dish_id")).longValue());
        }
        List<Map<String, Object>> weightsRows = jdbc.queryForList(
                "SELECT config_json FROM ai_rule_config WHERE config_key='recommend_weights' AND active=1 ORDER BY version DESC LIMIT 1");
        Map<String, Object> w = weightsRows.isEmpty()
                ? Util.parseMap("{\"preferredCategory\":3,\"spiceMatch\":2,\"budgetFit\":2,\"protein\":1,\"taste\":1}")
                : Util.parseMap(String.valueOf(weightsRows.get(0).get("config_json")));

        List<Candidate> out = new ArrayList<>();
        for (Map<String, Object> r : jdbc.queryForList(
                "SELECT d.id,d.name,d.category,d.spice_level,d.price_cents,d.allergens,d.protein,"
                        + "s.total_qty-s.reserved_qty-s.sold_qty AS available FROM dishes d "
                        + "JOIN daily_menu m ON m.dish_id=d.id AND m.serve_date=? AND m.publish_status='PUBLISHED' "
                        + "JOIN dish_daily_stock s ON s.dish_id=d.id AND s.serve_date=m.serve_date "
                        + "WHERE d.status='ON_SHELF'", RequestContext.today())) {
            long id = ((Number) r.get("id")).longValue();
            if (recent.contains(id)) continue;
            int avail = Math.max(0, Util.intVal(r.get("available")));
            if (avail <= 0) continue;
            List<String> dishAllergens = Util.parseList((String) r.get("allergens"));
            if (dishAllergens.stream().anyMatch(allergens::contains)) continue;
            String category = String.valueOf(r.get("category"));
            long price = Util.cents(r.get("price_cents"));
            double score = 0;
            if (preferred.contains(category)) score += num(w.get("preferredCategory"), 3);
            if (spice != null && spice.equals(String.valueOf(r.get("spice_level")))) score += num(w.get("spiceMatch"), 2);
            if (budgetMax == null || price <= budgetMax) score += num(w.get("budgetFit"), 2);
            if (r.get("protein") != null) score += num(w.get("protein"), 1);
            out.add(new Candidate(id, String.valueOf(r.get("name")), category,
                    String.valueOf(r.get("spice_level")), price, avail,
                    String.valueOf(r.get("protein")), score));
        }
        out.sort(Comparator.comparingDouble(Candidate::score).reversed().thenComparing(Candidate::name));
        return out;
    }

    private double num(Object o, double def) {
        return o instanceof Number n ? n.doubleValue() : def;
    }

    private String reasonFor(Candidate c) {
        String text = "Matches your preferences: " + c.category() + ", " + c.spice() + " spice, ready today.";
        return text.length() > 200 ? text.substring(0, 200) : text;
    }

    /** Optional OpenAI-compatible call; any failure falls back to rules. */
    private List<Candidate> tryLlm(String prompt, List<Candidate> candidates, List<String> reasons) {
        if (candidates.isEmpty()) return null;
        try {
            StringBuilder list = new StringBuilder();
            for (Candidate c : candidates) {
                list.append(c.dishId()).append(": ").append(c.name()).append(" (").append(c.category())
                        .append(", ¥").append(c.price() / 100).append(".").append(String.format("%02d", c.price() % 100)).append(")\n");
            }
            String userMsg = "User request: " + prompt + "\nCandidate dishes (id: name):\n" + list
                    + "\nReturn ONLY a JSON array like [{\"dishId\":1,\"reason\":\"...\"}] using only candidate ids.";
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("model", llmModel);
            body.put("temperature", 0.3);
            body.put("max_tokens", 500);
            body.put("messages", List.of(
                    Map.of("role", "system", "content", "You are a meal recommendation assistant. Only choose from the supplied candidate ids."),
                    Map.of("role", "user", "content", userMsg)));
            HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
            HttpRequest request = HttpRequest.newBuilder(URI.create(llmBase.replaceAll("/$", "") + "/chat/completions"))
                    .timeout(Duration.ofSeconds(8))
                    .header("Authorization", "Bearer " + llmKey)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(Util.json(body)))
                    .build();
            HttpResponse<String> resp = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() / 100 != 2) return null;
            Map<String, Object> root = Util.parseMap(resp.body());
            List<Map<String, Object>> choices = (List<Map<String, Object>>) root.get("choices");
            if (choices == null || choices.isEmpty()) return null;
            Map<String, Object> msg = (Map<String, Object>) choices.get(0).get("message");
            String content = String.valueOf(msg.get("content"));
            String json = content.substring(content.indexOf('['), content.lastIndexOf(']') + 1);
            List<Map<String, Object>> parsed = Util.parseListOfMaps(json);
            Map<Long, Candidate> byId = new LinkedHashMap<>();
            for (Candidate c : candidates) byId.put(c.dishId(), c);
            List<Candidate> chosen = new ArrayList<>();
            for (Map<String, Object> p : parsed) {
                long id = Util.cents(p.get("dishId"));
                Candidate c = byId.get(id);
                if (c != null && !chosen.contains(c)) {
                    chosen.add(c);
                    String reason = String.valueOf(p.get("reason"));
                    reasons.add(reason.length() > 200 ? reason.substring(0, 200) : reason);
                }
            }
            return chosen.isEmpty() ? null : chosen.stream().limit(5).toList();
        } catch (Exception e) {
            log.warn("LLM call failed, falling back to rules: {}", e.getMessage());
            return null;
        }
    }

    private void persist(long userId, String sessionId, String prompt, List<Long> ids, String model,
                         boolean fallback, long latencyMs) {
        try {
            Map<String, Object> resp = new LinkedHashMap<>();
            resp.put("dishIds", ids);
            jdbc.update("INSERT INTO ai_conversation(user_id,session_id,prompt,response_json,dish_ids,model,fallback,latency_ms) "
                            + "VALUES (?,?,?,?,?,?,?,?)",
                    userId, sessionId, prompt, Util.json(resp), Util.json(ids), model, fallback ? 1 : 0, (int) latencyMs);
        } catch (Exception e) {
            log.debug("AI conversation persist skipped: {}", e.getMessage());
        }
    }
}