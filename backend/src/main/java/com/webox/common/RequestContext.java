package com.webox.common;

import org.slf4j.MDC;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.UUID;

public final class RequestContext {
    public static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");
    private static final ThreadLocal<Instant> TEST_CLOCK = new ThreadLocal<>();

    private RequestContext() {}

    public static String requestId() {
        String id = MDC.get("requestId");
        return id == null ? UUID.randomUUID().toString() : id;
    }

    public static void setTestClock(Instant instant) { TEST_CLOCK.set(instant); }
    public static void clearTestClock() { TEST_CLOCK.remove(); }
    public static boolean hasTestClock() { return TEST_CLOCK.get() != null; }

    public static ZonedDateTime now() {
        Instant i = TEST_CLOCK.get();
        return (i == null ? Instant.now() : i).atZone(ZONE);
    }

    public static java.time.LocalDate today() { return now().toLocalDate(); }
}