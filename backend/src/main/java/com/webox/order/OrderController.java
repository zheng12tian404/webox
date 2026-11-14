package com.webox.order;

import com.webox.common.Api;
import com.webox.config.SecurityConfig;
import com.webox.dto.Dtos;
import com.webox.security.UserPrincipal;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/orders")
public class OrderController {
    private final OrderService orders;

    public OrderController(OrderService orders) {
        this.orders = orders;
    }

    @PostMapping("/preview")
    public Map<String, Object> preview(@Valid @RequestBody Dtos.PreviewReq req) {
        return Api.ok(orders.preview(SecurityConfig.current().id(), req));
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> submit(@Valid @RequestBody Dtos.SubmitReq req,
                                                      @RequestHeader(value = "Idempotency-Key", required = false) String key) {
        OrderService.Outcome outcome = orders.submit(SecurityConfig.current(), req, key);
        Map<String, Object> body = new LinkedHashMap<>(outcome.body());
        body.put("requestId", com.webox.common.RequestContext.requestId());
        return ResponseEntity.status(outcome.status()).body(body);
    }

    @GetMapping
    public Map<String, Object> list(@RequestParam(defaultValue = "1") int page,
                                    @RequestParam(defaultValue = "20") int size,
                                    @RequestParam(required = false) String status) {
        return Api.ok(orders.list(SecurityConfig.current().id(), page, size, status));
    }

    @GetMapping("/active")
    public Map<String, Object> active(@RequestParam String date, @RequestParam String mealType) {
        return Api.ok(orders.active(SecurityConfig.current().id(), date, mealType));
    }

    @GetMapping("/{orderId}")
    public Map<String, Object> detail(@PathVariable long orderId) {
        return Api.ok(orders.detail(SecurityConfig.current(), orderId));
    }

    @PostMapping("/{orderId}/cancel")
    public Map<String, Object> cancel(@PathVariable long orderId,
                                      @RequestBody(required = false) Dtos.CancelReq req) {
        UserPrincipal user = SecurityConfig.current();
        return Api.ok(orders.cancel(user, orderId, req == null ? null : req.reason()));
    }
}