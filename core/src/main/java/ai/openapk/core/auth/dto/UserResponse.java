package ai.openapk.core.auth.dto;

/**
 * Self-profile response (GET /api/users/me). {@code emailMd5} is the
 * Gravatar identifier — we never ship the raw email out except in the
 * separate {@code email} field, which is intentionally only visible to
 * the user themselves. Anonymous community readers see only the MD5
 * (via CommunityReportSummary / CommunityReportDetail).
 */
public record UserResponse(
        String displayName,
        String email,
        String emailMd5
) {}
