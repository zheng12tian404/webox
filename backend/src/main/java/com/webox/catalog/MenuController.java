package com.webox.catalog;

import com.webox.common.Api;
import com.webox.common.ApiException;
import com.webox.common.RequestContext;
import com.webox.config.SecurityConfig;
import com.webox.realtime.SseHub;
import com.webox.realtime.TicketStore;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/menu")
public class MenuController {
    private final MenuService menuService;
    private final SseHub sseHub;
    private final TicketStore tickets;

    public MenuController(MenuService menuService, SseHub sseHub, TicketStore tickets) {
        this.menuService = menuService;
        this.sseHub = sseHub;
        this.tickets = tickets;
    }

    @GetMapping
    public Map<String, Object> list(@RequestParam(required = false) String date,
                                    @RequestParam(defaultValue = "1") int page,
                                    @RequestParam(defaultValue = "20") int size,
                                    @RequestParam(required = false) String category,
                                    @RequestParam(required = false) String search,
                                    @RequestParam(defaultValue = "default") String sort) {
        return Api.ok(menuService.list(date, page, size, category, search, sort));
    }

    @GetMapping("/filters")
    public Map<String, Object> filters() {
        return Api.ok(menuService.filters());
    }

    @GetMapping("/{dishId}")
    public Map<String, Object> detail(@PathVariable long dishId) {
        return Api.ok(menuService.detail(dishId));
    }

    @PostMapping("/stream-ticket")
    public Map<String, Object> streamTicket(HttpServletRequest request) {
        long uid = SecurityConfig.current().id();
        String ticket = tickets.issue(uid, request.getRemoteAddr());
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("ticket", ticket);
        data.put("expiresIn", 60);
        return Api.ok(data);
    }

    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream(@RequestParam(required = false) String date,
                             @RequestParam(required = false) String ticket,
                             HttpServletRequest request) {
        var authentication = org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
        boolean authenticated = authentication != null && authentication.isAuthenticated()
                && authentication.getPrincipal() instanceof com.webox.security.UserPrincipal;
        if (!authenticated) {
            if (ticket == null || ticket.isBlank()) {
                throw Api.error(401, "AUTH_UNAUTHORIZED", "Authentication required");
            }
            long uid = tickets.redeem(ticket, request.getRemoteAddr());
            if (uid < 0) throw Api.error(401, "AUTH_UNAUTHORIZED", "Invalid stream ticket");
        }
        LocalDate d = date == null || date.isBlank() ? RequestContext.today() : LocalDate.parse(date);
        return sseHub.subscribe(d);
    }
}