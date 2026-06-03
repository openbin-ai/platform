package ai.openapk.core.usage.dto;

import jakarta.validation.constraints.PositiveOrZero;

/**
 * null = "no limit" (clear the cap). 0 is allowed but means "no calls
 * permitted" — useful for revoking a user temporarily.
 */
public record UpdateLimitsRequest(
        @PositiveOrZero Long dailyTokenCap,
        @PositiveOrZero Long monthlyTokenCap
) {}
