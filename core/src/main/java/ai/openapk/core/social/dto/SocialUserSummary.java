package ai.openapk.core.social.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * One row in a followers / following list. Mirrors the public-profile
 * shape but stripped down — we don't ship the per-user report list or
 * follower/following counts here because the list view is just a roster
 * with inline follow buttons; clicking through hits the full profile.
 *
 * <p>{@code amFollowing} is opportunistically personalized when the
 * viewer is authenticated and isn't this row's user. Anonymous viewers
 * always get false; the row's Follow button bounces them through
 * Keycloak the first time they try to use it.
 */
public record SocialUserSummary(
        UUID userId,
        String displayName,
        String emailMd5,
        Instant followedAt,
        boolean amFollowing
) {}
