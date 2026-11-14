package com.webox.admin;

import com.webox.common.RequestContext;
import com.webox.common.Util;
import com.webox.config.SecurityConfig;
import com.webox.security.UserPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

@Service
public class AuditService {
    private static final Logger log = LoggerFactory.getLogger(AuditService.class);
    private final JdbcTemplate jdbc;

    public AuditService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void log(String action, String objectType, String objectId, Object before, Object after, String reason) {
        try {
            UserPrincipal p = SecurityConfig.current();
            String ip = null;
            var attrs = RequestContextHolder.getRequestAttributes();
            if (attrs instanceof ServletRequestAttributes sra) {
                HttpServletRequest req = sra.getRequest();
                String fwd = req.getHeader("X-Forwarded-For");
                ip = fwd != null ? fwd.split(",")[0].trim() : req.getRemoteAddr();
            }
            jdbc.update("INSERT INTO audit_log(actor_id,actor_email,action,object_type,object_id,before_json,after_json,reason,ip,request_id) "
                            + "VALUES (?,?,?,?,?,?,?,?,?,?)",
                    p.id(), p.email(), action, objectType, objectId,
                    before == null ? null : Util.json(before), after == null ? null : Util.json(after),
                    reason, ip, RequestContext.requestId());
        } catch (Exception e) {
            log.error("Audit write failed for {} {}: {}", action, objectId, e.getMessage());
            throw e;
        }
    }
}