package com.webox.dto;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;

public final class Dtos {
    private Dtos() {}

    public record RegisterReq(
            @NotBlank @Email @Size(max = 200) String email,
            @NotBlank @Size(min = 8, max = 64) String password,
            @Size(max = 100) String displayName) {}

    public record LoginReq(@NotBlank String email, @NotBlank String password) {}

    public record RefreshReq(@NotBlank String refreshToken) {}

    public record PrefReq(List<String> allergens, List<String> preferredCategories, String spicePreference,
                          String tastePreference, Long budgetMinCents, Long budgetMaxCents, Boolean recommendEnabled) {}

    public record AddressReq(@NotBlank @Size(max = 200) String address) {}

    public record ItemReq(@NotNull Long dishId, Integer qty, List<Long> optionIds) {}

    public record PreviewReq(@NotNull @Valid List<ItemReq> items, String deliveryDate, String mealType, String address) {}

    public record SubmitReq(@NotNull @Valid List<ItemReq> items, String deliveryDate, String mealType,
                            @Size(max = 200) String address, Boolean confirmAutoSwitch) {}

    public record CancelReq(@Size(max = 200) String reason) {}

    public record StatusReq(String toStatus, Boolean confirm, @Size(max = 200) String reason) {}

    public record DishReq(@Size(max = 100) String name, @Size(max = 1000) String description, Long priceCents,
                          String category, @Size(max = 50) String protein, List<String> allergens, String spiceLevel,
                          @Size(max = 300) String imageUrl, Boolean confirm, @Size(max = 200) String reason) {}

    public record DishStatusReq(String status, Boolean confirm, @Size(max = 200) String reason) {}

    public record StockReq(Integer totalQty, Boolean confirm, @Size(max = 200) String reason) {}

    public record DailyMenuItem(Long dishId, Boolean published, Integer totalQty, String inventoryMode) {}

    public record DailyMenuReq(String serveDate, Integer totalQty, List<DailyMenuItem> items, Boolean confirm,
                               @Size(max = 200) String reason) {}

    public record AdjustReq(Long dishId, String serveDate, Integer delta, Boolean confirm, @Size(max = 200) String reason) {}

    public record AiRuleReq(String configKey, JsonNode config, Boolean confirm, @Size(max = 200) String reason,
                            Integer rollbackToVersion) {}

    public record AiReq(@Size(max = 500) String prompt, String sessionId) {}

    public record FilterDates(String date, boolean published) {}
}