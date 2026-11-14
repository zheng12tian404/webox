package com.webox.auth;

import com.webox.common.Api;
import com.webox.common.RateLimiter;
import com.webox.common.Util;
import com.webox.dto.Dtos;
import com.webox.security.JwtService;
import com.webox.security.UserPrincipal;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

@Service
public class AuthService {
    private final JdbcTemplate jdbc;
    private final PasswordEncoder encoder;
    private final JwtService jwt;
    private final RateLimiter limiter;
    private final SecureRandom random = new SecureRandom();

    public AuthService(JdbcTemplate jdbc, PasswordEncoder encoder, JwtService jwt, RateLimiter limiter) {
        this.jdbc = jdbc;
        this.encoder = encoder;
        this.jwt = jwt;
        this.limiter = limiter;
    }

    @Transactional
    public Map<String, Object> register(Dtos.RegisterReq req) {
        String email = req.email().trim().toLowerCase();
        if (email.length() > 200) throw Api.error(400, "VALIDATION_EMAIL_LENGTH", "Email is too long");
        checkPassword(req.password());
        String displayName = req.displayName() == null ? null : req.displayName().trim();
        if (displayName != null && displayName.length() > 100) {
            throw Api.error(400, "VALIDATION_INVALID", "displayName must be at most 100 characters");
        }
        try {
            jdbc.update("INSERT INTO users(email,password_hash,display_name,role) VALUES (?,?,?,'EMPLOYEE')",
                    email, encoder.encode(req.password()), displayName);
        } catch (DuplicateKeyException e) {
            throw Api.error(409, "AUTH_EMAIL_EXISTS", "Email already registered");
        }
        Long id = jdbc.queryForObject("SELECT id FROM users WHERE email=?", Long.class, email);
        Map<String, Object> user = new LinkedHashMap<>();
        user.put("id", id);
        user.put("email", email);
        user.put("role", "EMPLOYEE");
        return user;
    }

    public Map<String, Object> login(Dtos.LoginReq req, String ip) {
        String email = req.email().trim().toLowerCase();
        limiter.check("login:ip:" + ip, 20, 60_000);
        limiter.check("login:ipmail:" + ip + ":" + email, 10, 60_000);
        Map<String, Object> row;
        try {
            row = jdbc.queryForMap("SELECT id,email,password_hash,role,status FROM users WHERE email=?", email);
        } catch (Exception e) {
            throw Api.error(401, "AUTH_INVALID_CREDENTIALS", "Invalid email or password");
        }
        if (!"ACTIVE".equals(row.get("status")) || !encoder.matches(req.password(), String.valueOf(row.get("password_hash")))) {
            throw Api.error(401, "AUTH_INVALID_CREDENTIALS", "Invalid email or password");
        }
        long id = ((Number) row.get("id")).longValue();
        String role = String.valueOf(row.get("role"));
        String access = jwt.issue(new UserPrincipal(id, email, role));
        String refresh = issueRefresh(id);
        Map<String, Object> user = new LinkedHashMap<>();
        user.put("id", id);
        user.put("email", email);
        user.put("role", role);
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("accessToken", access);
        data.put("refreshToken", refresh);
        data.put("expiresIn", jwt.accessTtlSeconds());
        data.put("user", user);
        return data;
    }

    @Transactional
    public Map<String, Object> refresh(Dtos.RefreshReq req) {
        String hash = Util.sha256(req.refreshToken());
        Map<String, Object> row;
        try {
            row = jdbc.queryForMap("SELECT id,user_id,revoked,expires_at FROM refresh_tokens WHERE token_hash=?", hash);
        } catch (Exception e) {
            throw Api.error(401, "AUTH_TOKEN_INVALID", "Invalid refresh token");
        }
        // expires_at is a MySQL DATETIME: Connector/J hands back LocalDateTime, not java.sql.Timestamp.
        LocalDateTime expiresAt = Util.localDateTime(row.get("expires_at"));
        if (Util.intVal(row.get("revoked")) != 0
                || expiresAt == null
                || expiresAt.isBefore(LocalDateTime.now())) {
            throw Api.error(401, "AUTH_TOKEN_INVALID", "Invalid refresh token");
        }
        long tokenId = ((Number) row.get("id")).longValue();
        long userId = ((Number) row.get("user_id")).longValue();
        int revoked = jdbc.update("UPDATE refresh_tokens SET revoked=1 WHERE id=? AND revoked=0", tokenId);
        if (revoked == 0) throw Api.error(401, "AUTH_TOKEN_INVALID", "Invalid refresh token");
        Map<String, Object> user = jdbc.queryForMap("SELECT id,email,role FROM users WHERE id=?", userId);
        String access = jwt.issue(new UserPrincipal(userId, String.valueOf(user.get("email")), String.valueOf(user.get("role"))));
        String refresh = issueRefresh(userId);
        Map<String, Object> u = new LinkedHashMap<>();
        u.put("id", userId);
        u.put("email", user.get("email"));
        u.put("role", user.get("role"));
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("accessToken", access);
        data.put("refreshToken", refresh);
        data.put("expiresIn", jwt.accessTtlSeconds());
        data.put("user", u);
        return data;
    }

    public Map<String, Object> logout(Dtos.RefreshReq req) {
        jdbc.update("UPDATE refresh_tokens SET revoked=1 WHERE token_hash=?", Util.sha256(req.refreshToken()));
        return new LinkedHashMap<>();
    }

    public Map<String, Object> me(long userId) {
        Map<String, Object> row = jdbc.queryForMap("SELECT id,email,role,display_name FROM users WHERE id=?", userId);
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("id", row.get("id"));
        data.put("email", row.get("email"));
        data.put("role", row.get("role"));
        data.put("displayName", row.get("display_name"));
        return data;
    }

    private String issueRefresh(long userId) {
        byte[] raw = new byte[32];
        random.nextBytes(raw);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        jdbc.update("INSERT INTO refresh_tokens(user_id,token_hash,expires_at) VALUES (?,?,?)",
                userId, Util.sha256(token), LocalDateTime.now().plusDays(7));
        return token;
    }

    private void checkPassword(String p) {
        if (p == null || p.length() < 8 || p.length() > 64
                || !p.chars().anyMatch(Character::isLetter) || !p.chars().anyMatch(Character::isDigit)) {
            throw Api.error(400, "VALIDATION_PASSWORD_POLICY",
                    "Password must be 8-64 characters and contain both letters and digits");
        }
    }
}