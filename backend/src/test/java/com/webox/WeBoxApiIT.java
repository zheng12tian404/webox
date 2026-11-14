package com.webox;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.webox.common.RequestContext;
import com.webox.common.Util;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Integration tests run against the ISOLATED test database (req_6343a752e110_test).
 * The first SELECT DATABASE() is asserted to prevent accidentally touching demo data.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class WeBoxApiIT {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private String db() {
        return jdbc.queryForObject("SELECT DATABASE()", String.class);
    }

    private JsonNode json(MvcResult r) throws Exception {
        return MAPPER.readTree(r.getResponse().getContentAsString());
    }

    private String registerAndLogin(String prefix) throws Exception {
        String email = prefix + System.nanoTime() + "@test.com";
        mvc.perform(post("/api/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"Passw0rd1\",\"displayName\":\"IT\"}"))
                .andExpect(status().isCreated());
        MvcResult r = mvc.perform(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"Passw0rd1\"}"))
                .andExpect(status().isOk()).andReturn();
        return json(r).path("data").path("accessToken").asText();
    }

    private String adminToken() throws Exception {
        MvcResult r = mvc.perform(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"admin@webox.com\",\"password\":\"Admin12345\"}"))
                .andExpect(status().isOk()).andReturn();
        return json(r).path("data").path("accessToken").asText();
    }

    private JsonNode submit(String token, String key, long dishId, int qty) throws Exception {
        MvcResult r = mvc.perform(post("/api/v1/orders").header("Authorization", "Bearer " + token)
                        .header("Idempotency-Key", key).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"items\":[{\"dishId\":" + dishId + ",\"qty\":" + qty + "}],"
                                + "\"address\":\"Building A, 12F\"}"))
                .andReturn();
        return MAPPER.readTree(r.getResponse().getContentAsString());
    }

    @BeforeEach
    void resetTestDataOnly() {
        String name = db();
        assertTrue(name.endsWith("_test"), "refusing to clean a non-test database: " + name);
        jdbc.update("DELETE FROM idempotency_records");
        jdbc.update("DELETE FROM inventory_ledger");
        jdbc.update("DELETE FROM order_items");
        jdbc.update("DELETE FROM orders");
        jdbc.update("DELETE FROM audit_log");
        jdbc.update("DELETE FROM ai_conversation");
        jdbc.update("UPDATE dish_daily_stock SET reserved_qty=0, sold_qty=0");
    }

    @Test
    void testDatabaseIsIsolated() {
        String name = db();
        assertTrue(name.endsWith("_test"), "tests must run against the _test database, got " + name);
    }

    @Test
    void authValidationAndPermissions() throws Exception {
        // password policy
        mvc.perform(post("/api/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"bad@test.com\",\"password\":\"short\"}"))
                .andExpect(status().isBadRequest());
        // pagination bounds
        String token = registerAndLogin("perm");
        MvcResult r = mvc.perform(get("/api/v1/menu?page=1&size=101").header("Authorization", "Bearer " + token))
                .andExpect(status().isBadRequest()).andReturn();
        assertEquals("VALIDATION_PAGINATION", json(r).path("code").asText());
        // employee -> admin 403
        mvc.perform(get("/api/v1/admin/dishes").header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden());
        // unauthenticated 401
        mvc.perform(get("/api/v1/orders")).andExpect(status().isUnauthorized());
    }

    @Test
    void idempotentSubmitAndDuplicateActiveOrder() throws Exception {
        String token = registerAndLogin("idem");
        String key = "it-key-" + System.nanoTime();
        JsonNode first = submit(token, key, 17L, 1);
        assertEquals("OK", first.path("code").asText());
        long orderId = first.path("data").path("orderId").asLong();
        assertTrue(orderId > 0);

        JsonNode replay = submit(token, key, 17L, 1);
        assertEquals(orderId, replay.path("data").path("orderId").asLong());

        JsonNode bodyChanged = submit(token, key, 17L, 2);
        assertEquals("IDEMPOTENCY_CONFLICT", bodyChanged.path("code").asText());

        JsonNode duplicate = submit(token, "it-key2-" + System.nanoTime(), 17L, 1);
        assertEquals("ORDER_DUPLICATE", duplicate.path("code").asText());
        assertEquals(orderId, duplicate.path("data").path("existingOrderId").asLong());

        Integer orders = jdbc.queryForObject(
                "SELECT COUNT(*) FROM orders o JOIN idempotency_records i ON i.order_id=o.id WHERE i.idem_key=?", Integer.class, key);
        assertEquals(1, orders);
        String idemStatus = jdbc.queryForObject(
                "SELECT status FROM idempotency_records WHERE idem_key=?", String.class, key);
        assertEquals("COMPLETED", idemStatus);
    }

    /** AC-004 regression: refresh returned 500 (Timestamp cast) instead of rotating tokens. */
    @Test
    void refreshRotatesTokensRejectsReuseAndExpired() throws Exception {
        String email = "refresh" + System.nanoTime() + "@test.com";
        mvc.perform(post("/api/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"Passw0rd1\"}"))
                .andExpect(status().isCreated());
        MvcResult login = mvc.perform(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"Passw0rd1\"}"))
                .andExpect(status().isOk()).andReturn();
        JsonNode loginData = json(login).path("data");
        String access = loginData.path("accessToken").asText();
        String refresh = loginData.path("refreshToken").asText();
        long userId = loginData.path("user").path("id").asLong();
        assertEquals(7200, loginData.path("expiresIn").asInt());

        mvc.perform(get("/api/v1/auth/me").header("Authorization", "Bearer " + access))
                .andExpect(status().isOk());

        MvcResult rotated = mvc.perform(post("/api/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"refreshToken\":\"" + refresh + "\"}"))
                .andExpect(status().isOk()).andReturn();
        JsonNode rotatedData = json(rotated).path("data");
        String newAccess = rotatedData.path("accessToken").asText();
        String newRefresh = rotatedData.path("refreshToken").asText();
        assertFalse(newAccess.isBlank());
        assertFalse(newRefresh.isBlank());
        assertNotEquals(refresh, newRefresh, "refresh token must rotate");
        assertEquals(userId, rotatedData.path("user").path("id").asLong());

        MvcResult me = mvc.perform(get("/api/v1/auth/me").header("Authorization", "Bearer " + newAccess))
                .andExpect(status().isOk()).andReturn();
        assertEquals(email, json(me).path("data").path("email").asText());

        // old refresh token is single-use
        MvcResult reused = mvc.perform(post("/api/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"refreshToken\":\"" + refresh + "\"}"))
                .andExpect(status().isUnauthorized()).andReturn();
        assertEquals("AUTH_TOKEN_INVALID", json(reused).path("code").asText());

        // an expired but existing token must also be 401, not 500
        String expiredToken = "expired-" + System.nanoTime();
        jdbc.update("INSERT INTO refresh_tokens(user_id,token_hash,expires_at) VALUES (?,?,?)",
                userId, Util.sha256(expiredToken), java.time.LocalDateTime.now().minusMinutes(1));
        MvcResult expired = mvc.perform(post("/api/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"refreshToken\":\"" + expiredToken + "\"}"))
                .andExpect(status().isUnauthorized()).andReturn();
        assertEquals("AUTH_TOKEN_INVALID", json(expired).path("code").asText());

        // unknown token -> 401 as well
        MvcResult unknown = mvc.perform(post("/api/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"refreshToken\":\"no-such-token\"}"))
                .andExpect(status().isUnauthorized()).andReturn();
        assertEquals("AUTH_TOKEN_INVALID", json(unknown).path("code").asText());
    }

    /** Regression: audit snapshots contain JDBC LocalDateTime; without JavaTimeModule Console dish CRUD returned 500. */
    @Test
    void adminDishCrudWritesAuditSnapshotsWithDatetimes() throws Exception {
        String admin = adminToken();
        MvcResult created = mvc.perform(post("/api/v1/admin/dishes")
                        .header("Authorization", "Bearer " + admin).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"IT Dish\",\"description\":\"audit regression\",\"priceCents\":1500,"
                                + "\"category\":\"Chinese\",\"protein\":\"Tofu\",\"allergens\":[\"Soy\"],"
                                + "\"spiceLevel\":\"Mild\",\"imageUrl\":\"/images/it-dish.jpg\"}"))
                .andExpect(status().isCreated()).andReturn();
        long dishId = json(created).path("data").path("dishId").asLong();
        assertTrue(dishId > 0);

        mvc.perform(put("/api/v1/admin/dishes/" + dishId)
                        .header("Authorization", "Bearer " + admin).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"IT Dish v2\",\"description\":\"audit regression\",\"priceCents\":1600,"
                                + "\"category\":\"Chinese\",\"protein\":\"Tofu\",\"allergens\":[\"Soy\"],"
                                + "\"spiceLevel\":\"Mild\",\"imageUrl\":\"/images/it-dish.jpg\","
                                + "\"confirm\":true,\"reason\":\"IT update\"}"))
                .andExpect(status().isOk());

        mvc.perform(patch("/api/v1/admin/dishes/" + dishId + "/status")
                        .header("Authorization", "Bearer " + admin).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"OFF_SHELF\",\"confirm\":true,\"reason\":\"IT status\"}"))
                .andExpect(status().isOk());

        Integer audits = jdbc.queryForObject(
                "SELECT COUNT(*) FROM audit_log WHERE object_type='DISH' AND object_id=? AND action IN ('DISH_UPDATE','DISH_STATUS')",
                Integer.class, String.valueOf(dishId));
        assertTrue(audits != null && audits >= 2, "both mutations must be audited");
        String after = jdbc.queryForObject(
                "SELECT after_json FROM audit_log WHERE action='DISH_UPDATE' AND object_id=? ORDER BY id DESC LIMIT 1",
                String.class, String.valueOf(dishId));
        assertNotNull(after);
        assertTrue(after.contains("updated_at"), "audit snapshot must serialize DATETIME columns: " + after);
    }

    @Test
    void concurrentSameKeyCreatesExactlyOneOrder() throws Exception {
        String token = registerAndLogin("race");
        String key = "it-race-" + System.nanoTime();
        int n = 5;
        ExecutorService pool = Executors.newFixedThreadPool(n);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<JsonNode>> futures = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            futures.add(pool.submit(() -> {
                start.await();
                return submit(token, key, 16L, 1);
            }));
        }
        start.countDown();
        List<Long> ids = new ArrayList<>();
        for (Future<JsonNode> f : futures) ids.add(f.get(15, TimeUnit.SECONDS).path("data").path("orderId").asLong());
        pool.shutdown();
        assertEquals(1, ids.stream().distinct().count(), "concurrent same-key submissions must map to one order");
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM idempotency_records WHERE idem_key=?", Integer.class, key);
        assertEquals(1, count);
    }

    @Test
    void concurrentDifferentUsersNeverOversell() throws Exception {
        String admin = adminToken();
        var eff = Util.resolveMeal(null, null, RequestContext.now());
        String effDate = eff.date().toString();
        // 6 buyers, 3 portions
        mvc.perform(put("/api/v1/admin/daily-menu/" + effDate + "/18/stock")
                        .header("Authorization", "Bearer " + admin).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"totalQty\":3,\"confirm\":true,\"reason\":\"IT oversell test\"}"))
                .andExpect(status().isOk());
        List<String> tokens = new ArrayList<>();
        for (int i = 0; i < 6; i++) tokens.add(registerAndLogin("buy" + i + "_"));
        ExecutorService pool = Executors.newFixedThreadPool(6);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Integer>> futures = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            String t = tokens.get(i);
            futures.add(pool.submit(() -> {
                start.await();
                JsonNode r = submit(t, "it-oos-" + System.nanoTime(), 18L, 1);
                return "OK".equals(r.path("code").asText()) ? 201 : 409;
            }));
        }
        start.countDown();
        int ok = 0;
        for (Future<Integer> f : futures) if (f.get(20, TimeUnit.SECONDS) == 201) ok++;
        pool.shutdown();
        assertEquals(3, ok, "exactly 3 orders may succeed for 3 portions");
        Integer available = jdbc.queryForObject(
                "SELECT total_qty-reserved_qty-sold_qty FROM dish_daily_stock WHERE dish_id=18 AND serve_date=?",
                Integer.class, effDate);
        assertNotNull(available);
        assertTrue(available >= 0, "available must never go negative");
        Integer over = jdbc.queryForObject(
                "SELECT COUNT(*) FROM dish_daily_stock WHERE serve_date=? AND reserved_qty+sold_qty>total_qty",
                Integer.class, effDate);
        assertEquals(0, over);
        // restore for later tests / reuse
        mvc.perform(put("/api/v1/admin/daily-menu/" + effDate + "/18/stock")
                        .header("Authorization", "Bearer " + admin).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"totalQty\":40,\"confirm\":true,\"reason\":\"IT restore\"}"))
                .andReturn();
    }
}