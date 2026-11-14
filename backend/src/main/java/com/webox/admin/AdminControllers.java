package com.webox.admin;

import com.webox.common.Api;
import com.webox.dto.Dtos;
import com.webox.order.OrderService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.Map;

public final class AdminControllers {
    private AdminControllers() {}

    @RestController
    @RequestMapping("/api/v1/admin/dishes")
    public static class DishController {
        private final AdminService admin;

        public DishController(AdminService admin) { this.admin = admin; }

        @GetMapping
        public Map<String, Object> list(@RequestParam(defaultValue = "1") int page,
                                        @RequestParam(defaultValue = "20") int size,
                                        @RequestParam(required = false) String search,
                                        @RequestParam(required = false) String category,
                                        @RequestParam(required = false) String status) {
            return Api.ok(admin.listDishes(page, size, search, category, status));
        }

        @PostMapping
        public ResponseEntity<Map<String, Object>> create(@RequestBody Dtos.DishReq req) {
            return ResponseEntity.status(HttpStatus.CREATED).body(Api.ok(admin.createDish(req)));
        }

        @PutMapping("/{dishId}")
        public Map<String, Object> update(@PathVariable long dishId, @RequestBody Dtos.DishReq req) {
            return Api.ok(admin.updateDish(dishId, req));
        }

        @PatchMapping("/{dishId}/status")
        public Map<String, Object> status(@PathVariable long dishId, @RequestBody Dtos.DishStatusReq req) {
            return Api.ok(admin.updateDishStatus(dishId, req));
        }

        @PostMapping("/{dishId}/image")
        public Map<String, Object> image(@PathVariable long dishId, @RequestParam("file") MultipartFile file) {
            return Api.ok(admin.uploadImage(dishId, file));
        }
    }

    @RestController
    @RequestMapping("/api/v1/admin")
    public static class MenuController {
        private final AdminService admin;

        public MenuController(AdminService admin) { this.admin = admin; }

        @GetMapping("/daily-menu")
        public Map<String, Object> dailyMenu(@RequestParam(required = false) String date) {
            return Api.ok(admin.dailyMenu(date));
        }

        @PutMapping("/daily-menu")
        public Map<String, Object> saveDailyMenu(@RequestBody Dtos.DailyMenuReq req) {
            return Api.ok(admin.saveDailyMenu(req));
        }

        @PutMapping("/daily-menu/{serveDate}/{dishId}/stock")
        public Map<String, Object> stock(@PathVariable String serveDate, @PathVariable long dishId,
                                         @RequestBody Dtos.StockReq req) {
            return Api.ok(admin.updateStock(serveDate, dishId, req));
        }

        @GetMapping("/inventory/reconcile")
        public Map<String, Object> reconcile(@RequestParam(required = false) String date) {
            return Api.ok(admin.reconcile(date));
        }

        @PostMapping("/inventory/adjust")
        public Map<String, Object> adjust(@RequestBody Dtos.AdjustReq req) {
            return Api.ok(admin.adjust(req));
        }

        @GetMapping("/dashboard")
        public Map<String, Object> dashboard(@RequestParam(required = false) String date) {
            return Api.ok(admin.dashboard(date));
        }

        @GetMapping("/audit-logs")
        public Map<String, Object> auditLogs(@RequestParam(defaultValue = "1") int page,
                                             @RequestParam(defaultValue = "20") int size,
                                             @RequestParam(required = false) String action,
                                             @RequestParam(required = false) String objectType) {
            return Api.ok(admin.auditLogs(page, size, action, objectType));
        }

        @GetMapping("/ai-rules")
        public Map<String, Object> aiRules() {
            return Api.ok(admin.getAiRules());
        }

        @PutMapping("/ai-rules")
        public Map<String, Object> putAiRules(@RequestBody Dtos.AiRuleReq req) {
            return Api.ok(admin.putAiRules(req));
        }
    }

    @RestController
    @RequestMapping("/api/v1/admin/orders")
    public static class OrderController {
        private final AdminService admin;
        private final OrderService orders;

        public OrderController(AdminService admin, OrderService orders) {
            this.admin = admin;
            this.orders = orders;
        }

        @GetMapping
        public Map<String, Object> list(@RequestParam(defaultValue = "1") int page,
                                        @RequestParam(defaultValue = "20") int size,
                                        @RequestParam(required = false) String status,
                                        @RequestParam(required = false) String date) {
            return Api.ok(admin.listOrders(page, size, status, date));
        }

        @PatchMapping("/{orderId}/status")
        public Map<String, Object> patchStatus(@PathVariable long orderId, @RequestBody Dtos.StatusReq req) {
            orders.adminPatchStatus(orderId, req.toStatus(), req.confirm(), req.reason());
            return Api.ok(orders.detail(com.webox.config.SecurityConfig.current(), orderId));
        }
    }
}