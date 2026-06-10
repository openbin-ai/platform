package ai.openapk.core.auth.dto;

import java.util.UUID;

/**
 * Self-profile response (GET /api/users/me). {@code emailMd5} is the
 * Gravatar identifier — we never ship the raw email out except in the
 * separate {@code email} field, which is intentionally only visible to
 * the user themselves. Anonymous community readers see only the MD5
 * (via CommunityReportSummary / CommunityReportDetail).
 *
 * <p>{@code userId} is the backend UUID. The frontend uses it to
 * navigate to the user's own community profile page ({@code /u/{userId}})
 * — that page is the same one anonymous visitors see for any researcher,
 * which avoids forking the profile UI just for the "view yourself" case.
 */
public record UserResponse(
        UUID userId,
        String displayName,
        String email,
        String emailMd5
) {}
