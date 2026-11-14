package com.webox.admin;

import com.webox.common.Api;
import com.webox.inventory.RedisClient;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
public class HealthController {
    private final JdbcTemplate jdbc;
    private final RedisClient redis;

    public HealthController(JdbcTemplate jdbc, RedisClient redis) {
        this.jdbc = jdbc;
        this.redis = redis;
    }

    @GetMapping("/api/v1/health")
    public ResponseEntity<Map<String, Object>> health() {
        boolean dbUp;
        try {
            jdbc.queryForObject("SELECT 1", Integer.class);
            dbUp = true;
        } catch (Exception e) {
            dbUp = false;
        }
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("status", dbUp ? "UP" : "DOWN");
        data.put("db", dbUp ? "UP" : "DOWN");
        data.put("redis", redis.ping() ? "UP" : "DOWN");
        data.put("cache", "UP");
        Map<String, Object> body = Api.envelope("OK", dbUp ? "OK" : "Database unavailable", data);
        return ResponseEntity.status(dbUp ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).body(body);
    }
}