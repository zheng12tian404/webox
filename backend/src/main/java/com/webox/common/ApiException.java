package com.webox.common;

public class ApiException extends RuntimeException {
    private final int status;
    private final String code;
    private final Object data;

    public ApiException(int status, String code, String message, Object data) {
        super(message);
        this.status = status;
        this.code = code;
        this.data = data;
    }

    public int getStatus() { return status; }
    public String getCode() { return code; }
    public Object getData() { return data; }
}