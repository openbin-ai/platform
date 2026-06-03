package ai.openapk.core.usage.dto;

/**
 * Snapshot of the user's current token spend + caps. `null` caps mean unlimited.
 * dailyResetsAt / monthlyResetsAt are ISO instants the frontend uses to render
 * a countdown.
 */
public record UsageSummaryResponse(
        long todayTokens,
        long monthTokens,
        Long dailyCap,
        Long monthlyCap,
        String dailyResetsAt,
        String monthlyResetsAt,
        long totalCalls,
        long totalTokens
) {}
