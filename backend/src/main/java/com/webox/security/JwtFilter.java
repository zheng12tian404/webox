package com.webox.security;

import com.webox.common.ApiException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

@Component
public class JwtFilter extends OncePerRequestFilter {
    private final JwtService jwtService;

    public JwtFilter(JwtService jwtService) {
        this.jwtService = jwtService;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        String header = req.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            try {
                UserPrincipal p = jwtService.parse(header.substring(7).trim());
                UsernamePasswordAuthenticationToken auth = new UsernamePasswordAuthenticationToken(
                        p, null, List.of(new SimpleGrantedAuthority("ROLE_" + p.role())));
                SecurityContextHolder.getContext().setAuthentication(auth);
                MDC.put("userId", String.valueOf(p.id()));
            } catch (ApiException e) {
                res.setStatus(401);
                res.setContentType("application/json;charset=UTF-8");
                res.getWriter().write("{\"code\":\"" + e.getCode() + "\",\"message\":\"" + e.getMessage()
                        + "\",\"data\":null,\"requestId\":\"" + MDC.get("requestId") + "\"}");
                return;
            }
        }
        try {
            chain.doFilter(req, res);
        } finally {
            MDC.remove("userId");
        }
    }
}