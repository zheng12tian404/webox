package com.webox.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.webox.common.Api;
import com.webox.common.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

@Service
public class JwtService {
    private static final Logger log = LoggerFactory.getLogger(JwtService.class);
    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder B64D = Base64.getUrlDecoder();

    private final byte[] secret;
    private final ObjectMapper mapper;
    private final long accessTtl;

    public JwtService(@Value("${webox.jwt.secret:}") String configuredSecret,
                      @Value("${webox.jwt.access-ttl-seconds:7200}") long accessTtl,
                      ObjectMapper mapper) {
        this.mapper = mapper;
        this.accessTtl = accessTtl;
        if (configuredSecret == null || configuredSecret.isBlank()) {
            byte[] r = new byte[32];
            new SecureRandom().nextBytes(r);
            this.secret = r;
            log.warn("JWT_SECRET not set; using an ephemeral random key (tokens invalid after restart)");
        } else {
            this.secret = configuredSecret.getBytes(StandardCharsets.UTF_8);
        }
    }

    public long accessTtlSeconds() { return accessTtl; }

    public String issue(UserPrincipal p) {
        long now = System.currentTimeMillis() / 1000;
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("sub", String.valueOf(p.id()));
        payload.put("email", p.email());
        payload.put("role", p.role());
        payload.put("iat", now);
        payload.put("exp", now + accessTtl);
        try {
            String header = B64.encodeToString("{\"alg\":\"HS256\",\"typ\":\"JWT\"}".getBytes(StandardCharsets.UTF_8));
            String body = B64.encodeToString(mapper.writeValueAsBytes(payload));
            String sig = B64.encodeToString(hmac(header + "." + body));
            return header + "." + body + "." + sig;
        } catch (Exception e) {
            throw new IllegalStateException("JWT signing failed", e);
        }
    }

    public UserPrincipal parse(String token) {
        try {
            String[] parts = token.split("\\.");
            if (parts.length != 3) throw Api.error(401, "AUTH_TOKEN_INVALID", "Invalid token");
            byte[] expected = hmac(parts[0] + "." + parts[1]);
            byte[] actual = B64D.decode(parts[2]);
            if (!MessageDigest.isEqual(expected, actual)) {
                throw Api.error(401, "AUTH_TOKEN_INVALID", "Invalid token");
            }
            Map<?, ?> payload = mapper.readValue(B64D.decode(parts[1]), Map.class);
            long exp = ((Number) payload.get("exp")).longValue();
            if (System.currentTimeMillis() / 1000 >= exp) {
                throw Api.error(401, "AUTH_TOKEN_INVALID", "Token expired");
            }
            return new UserPrincipal(Long.parseLong(String.valueOf(payload.get("sub"))),
                    String.valueOf(payload.get("email")), String.valueOf(payload.get("role")));
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw Api.error(401, "AUTH_TOKEN_INVALID", "Invalid token");
        }
    }

    private byte[] hmac(String data) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret, "HmacSHA256"));
        return mac.doFinal(data.getBytes(StandardCharsets.UTF_8));
    }
}