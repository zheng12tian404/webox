package com.webox.common;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.UUID;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestIdFilter extends OncePerRequestFilter {
    @Value("${spring.profiles.active:default}")
    private String activeProfile;

    @Value("${webox.test.clock-enabled:false}")
    private boolean clockEnabled;

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        String rid = UUID.randomUUID().toString();
        MDC.put("requestId", rid);
        res.setHeader("X-Request-Id", rid);
        res.setHeader("Access-Control-Expose-Headers", "X-Request-Id");
        try {
            String clock = req.getHeader("X-Test-Clock");
            if (clock != null && !clock.isBlank()) {
                boolean testProfile = activeProfile != null && activeProfile.contains("test");
                if (!testProfile || !clockEnabled) {
                    writeError(res, 400, "VALIDATION_TEST_CLOCK_FORBIDDEN",
                            "X-Test-Clock is only allowed in test profile");
                    return;
                }
                try {
                    RequestContext.setTestClock(OffsetDateTime.parse(clock).toInstant());
                } catch (DateTimeParseException e) {
                    writeError(res, 400, "VALIDATION_TEST_CLOCK_FORBIDDEN", "Invalid X-Test-Clock value");
                    return;
                }
            }
            chain.doFilter(req, res);
        } finally {
            RequestContext.clearTestClock();
            MDC.remove("requestId");
        }
    }

    private void writeError(HttpServletResponse res, int status, String code, String msg) throws IOException {
        res.setStatus(status);
        res.setContentType("application/json;charset=UTF-8");
        res.getWriter().write("{\"code\":\"" + code + "\",\"message\":\"" + msg +
                "\",\"data\":null,\"requestId\":\"" + RequestContext.requestId() + "\"}");
    }
}