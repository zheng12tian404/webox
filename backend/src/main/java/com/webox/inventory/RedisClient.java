package com.webox.inventory;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

/**
 * Minimal RESP (Redis protocol) client. Kept dependency-free so that Redis remains optional
 * and any connectivity failure can be handled as a graceful degradation by callers.
 */
@Component
public class RedisClient {
    private final boolean enabled;
    private final String host;
    private final int port;
    private final int timeoutMs;

    public RedisClient(@Value("${webox.redis.enabled:true}") boolean enabled,
                       @Value("${webox.redis.host:127.0.0.1}") String host,
                       @Value("${webox.redis.port:6379}") int port,
                       @Value("${webox.redis.timeout-ms:300}") int timeoutMs) {
        this.enabled = enabled;
        this.host = host;
        this.port = port;
        this.timeoutMs = timeoutMs;
    }

    public boolean enabled() { return enabled; }

    public boolean ping() {
        if (!enabled) return false;
        try {
            Object r = command("PING");
            return "PONG".equals(String.valueOf(r));
        } catch (Exception e) {
            return false;
        }
    }

    public String get(String key) {
        Object r = command("GET", key);
        return r == null ? null : String.valueOf(r);
    }

    public void set(String key, String value, int ttlSeconds) {
        command("SET", key, value, "EX", String.valueOf(ttlSeconds));
    }

    public long decrBy(String key, long n) {
        Object r = command("DECRBY", key, String.valueOf(n));
        return ((Number) r).longValue();
    }

    public long incrBy(String key, long n) {
        Object r = command("INCRBY", key, String.valueOf(n));
        return ((Number) r).longValue();
    }

    /** Lua preallocation: returns 1 ok, 0 insufficient, -1 key missing. */
    public long prealloc(String key, long qty) {
        String lua = "local v=tonumber(redis.call('GET',KEYS[1]) or '-1') "
                + "if v<0 then return -1 end "
                + "if v<tonumber(ARGV[1]) then return 0 end "
                + "redis.call('DECRBY',KEYS[1],ARGV[1]) return 1";
        Object r = command("EVAL", lua, "1", key, String.valueOf(qty));
        return ((Number) r).longValue();
    }

    public Object command(String... args) {
        if (!enabled) throw new IllegalStateException("redis disabled");
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, port), timeoutMs);
            socket.setSoTimeout(timeoutMs);
            OutputStream out = new BufferedOutputStream(socket.getOutputStream());
            StringBuilder sb = new StringBuilder("*").append(args.length).append("\r\n");
            for (String a : args) {
                byte[] b = a.getBytes(StandardCharsets.UTF_8);
                sb.append("$").append(b.length).append("\r\n").append(a).append("\r\n");
            }
            out.write(sb.toString().getBytes(StandardCharsets.UTF_8));
            out.flush();
            InputStream in = new BufferedInputStream(socket.getInputStream());
            return read(in);
        } catch (Exception e) {
            throw new IllegalStateException("redis command failed: " + e.getMessage(), e);
        }
    }

    private Object read(InputStream in) throws Exception {
        int type = in.read();
        if (type < 0) throw new IllegalStateException("empty redis response");
        String line = readLine(in);
        switch (type) {
            case '+': return line;
            case '-': throw new IllegalStateException("redis error: " + line);
            case ':': return Long.parseLong(line);
            case '$': {
                int len = Integer.parseInt(line);
                if (len < 0) return null;
                byte[] buf = in.readNBytes(len);
                readLine(in);
                return new String(buf, StandardCharsets.UTF_8);
            }
            case '*': {
                int n = Integer.parseInt(line);
                if (n < 0) return null;
                Object[] arr = new Object[n];
                for (int i = 0; i < n; i++) arr[i] = read(in);
                return arr;
            }
            default: throw new IllegalStateException("unknown redis reply type " + type);
        }
    }

    private String readLine(InputStream in) throws Exception {
        StringBuilder sb = new StringBuilder();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\r') {
                int n = in.read();
                if (n == '\n') break;
                sb.append((char) c).append((char) n);
            } else {
                sb.append((char) c);
            }
        }
        return sb.toString();
    }
}