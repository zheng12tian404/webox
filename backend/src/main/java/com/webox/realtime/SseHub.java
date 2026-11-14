package com.webox.realtime;

import com.webox.common.Util;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

@Component
public class SseHub {
    private static final Logger log = LoggerFactory.getLogger(SseHub.class);
    private final List<Entry> emitters = new CopyOnWriteArrayList<>();
    private final JdbcTemplate jdbc;

    public SseHub(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private record Entry(SseEmitter emitter, LocalDate date) {}

    public SseEmitter subscribe(LocalDate date) {
        SseEmitter emitter = new SseEmitter(0L);
        Entry entry = new Entry(emitter, date);
        emitter.onCompletion(() -> emitters.remove(entry));
        emitter.onTimeout(() -> { emitters.remove(entry); emitter.complete(); });
        emitter.onError(e -> emitters.remove(entry));
        emitters.add(entry);
        try {
            emitter.send(SseEmitter.event().reconnectTime(3000L).name("snapshot").data(Util.json(snapshot(date))));
        } catch (Exception e) {
            emitters.remove(entry);
            emitter.completeWithError(e);
        }
        log.info("SSE subscriber added, active={}", emitters.size());
        return emitter;
    }

    public List<Map<String, Object>> snapshot(LocalDate date) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT s.dish_id, s.total_qty-s.reserved_qty-s.sold_qty AS available FROM dish_daily_stock s "
                        + "JOIN daily_menu m ON m.dish_id=s.dish_id AND m.serve_date=s.serve_date "
                        + "JOIN dishes d ON d.id=s.dish_id AND d.status='ON_SHELF' "
                        + "WHERE s.serve_date=? AND m.publish_status='PUBLISHED' ORDER BY s.dish_id", date);
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("dishId", r.get("dish_id"));
            m.put("available", Math.max(0, Util.intVal(r.get("available"))));
            out.add(m);
        }
        return out;
    }

    public void publishStock(long dishId, int available) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("dishId", dishId);
        data.put("available", Math.max(0, available));
        for (Entry e : emitters) {
            try {
                e.emitter().send(SseEmitter.event().reconnectTime(3000L).name("stock").data(Util.json(data)));
            } catch (Exception ex) {
                emitters.remove(e);
                try { e.emitter().complete(); } catch (Exception ignored) {}
            }
        }
    }

    @Scheduled(fixedDelay = 15000)
    public void heartbeat() {
        for (Entry e : emitters) {
            try {
                e.emitter().send(SseEmitter.event().comment("ping"));
            } catch (Exception ex) {
                emitters.remove(e);
            }
        }
    }

    public int activeConnections() { return emitters.size(); }
}