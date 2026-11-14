package com.webox.common;

import java.util.LinkedHashMap;
import java.util.Map;

public final class Api {
    private Api() {}

    public static Map<String, Object> envelope(String code, String message, Object data) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("code", code);
        m.put("message", message);
        m.put("data", data);
        m.put("requestId", RequestContext.requestId());
        return m;
    }

    public static Map<String, Object> ok(Object data) {
        return envelope("OK", "OK", data);
    }

    public static ApiException error(int status, String code, String message) {
        return new ApiException(status, code, message, null);
    }

    public static ApiException error(int status, String code, String message, Object data) {
        return new ApiException(status, code, message, data);
    }
}