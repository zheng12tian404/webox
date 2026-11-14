package com.webox.security;

public record UserPrincipal(long id, String email, String role) {
    public boolean isAdmin() { return "ADMIN".equals(role); }
}