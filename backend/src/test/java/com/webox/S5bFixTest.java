package com.webox;

import com.webox.common.ApiException;
import com.webox.common.RateLimiter;
import com.webox.common.Util;
import org.junit.jupiter.api.Test;

import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.*;

/** Stage 5b regression tests: confirm gate, order rate limit, after-commit helper. */
class S5bFixTest {
    @Test
    void confirmFalseIsRejected() {
        ApiException e = assertThrows(ApiException.class, () -> Util.requireConfirm(Boolean.FALSE));
        assertEquals(400, e.getStatus());
        assertEquals("VALIDATION_CONFIRM_REQUIRED", e.getCode());
        ApiException n = assertThrows(ApiException.class, () -> Util.requireConfirm(null));
        assertEquals("VALIDATION_CONFIRM_REQUIRED", n.getCode());
    }

    @Test
    void confirmTruePasses() {
        assertDoesNotThrow(() -> Util.requireConfirm(Boolean.TRUE));
    }

    @Test
    void sixthOrderInWindowIsRateLimited() {
        RateLimiter rl = new RateLimiter();
        for (int i = 0; i < 5; i++) rl.check("order:user:42", 5, 60_000L);
        ApiException e = assertThrows(ApiException.class, () -> rl.check("order:user:42", 5, 60_000L));
        assertEquals(429, e.getStatus());
        assertEquals("RATE_LIMITED", e.getCode());
        assertDoesNotThrow(() -> rl.check("order:user:43", 5, 60_000L)); // other users unaffected
    }

    @Test
    void afterCommitRunsImmediatelyWhenNoTransaction() {
        AtomicBoolean ran = new AtomicBoolean(false);
        Util.afterCommit(() -> ran.set(true));
        assertTrue(ran.get());
    }
}
