package com.webox.auth;

import com.webox.common.Api;
import com.webox.config.SecurityConfig;
import com.webox.dto.Dtos;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/v1")
public class AuthController {
    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/auth/register")
    public ResponseEntity<Map<String, Object>> register(@Valid @RequestBody Dtos.RegisterReq req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(Api.ok(authService.register(req)));
    }

    @PostMapping("/auth/login")
    public Map<String, Object> login(@Valid @RequestBody Dtos.LoginReq req, HttpServletRequest request) {
        String ip = request.getRemoteAddr();
        return Api.ok(authService.login(req, ip));
    }

    @PostMapping("/auth/refresh")
    public Map<String, Object> refresh(@Valid @RequestBody Dtos.RefreshReq req) {
        return Api.ok(authService.refresh(req));
    }

    @PostMapping("/auth/logout")
    public Map<String, Object> logout(@Valid @RequestBody Dtos.RefreshReq req) {
        SecurityConfig.current();
        return Api.ok(authService.logout(req));
    }

    @GetMapping("/auth/me")
    public Map<String, Object> me() {
        return Api.ok(authService.me(SecurityConfig.current().id()));
    }
}