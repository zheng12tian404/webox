package com.webox.realtime;

import org.springframework.stereotype.Component;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class TicketStore {
    private static final SecureRandom RANDOM = new SecureRandom();
    private final Map<String, Ticket> tickets = new ConcurrentHashMap<>();

    private static final class Ticket {
        final long userId;
        final String ip;
        final long expiresAt;
        final int[] uses = {0};
        Ticket(long userId, String ip, long expiresAt) { this.userId = userId; this.ip = ip; this.expiresAt = expiresAt; }
    }

    public String issue(long userId, String ip) {
        byte[] r = new byte[32];
        RANDOM.nextBytes(r);
        String t = Base64.getUrlEncoder().withoutPadding().encodeToString(r);
        tickets.put(t, new Ticket(userId, ip, System.currentTimeMillis() + 60_000));
        tickets.entrySet().removeIf(e -> e.getValue().expiresAt < System.currentTimeMillis());
        return t;
    }

    /** Returns userId or -1 when the ticket is invalid/expired/over-used. */
    public long redeem(String ticket, String ip) {
        Ticket t = tickets.get(ticket);
        if (t == null) return -1;
        synchronized (t) {
            if (t.expiresAt < System.currentTimeMillis()) { tickets.remove(ticket); return -1; }
            if (t.ip != null && ip != null && !t.ip.equals(ip)) return -1;
            if (t.uses[0] >= 3) { tickets.remove(ticket); return -1; }
            t.uses[0]++;
            return t.userId;
        }
    }
}