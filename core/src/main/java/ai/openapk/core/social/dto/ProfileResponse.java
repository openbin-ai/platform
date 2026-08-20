package ai.openapk.core.social.dto;

import ai.openapk.core.blog.dto.BlogPostSummary;
import ai.openapk.core.reports.dto.CommunityReportSummary;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Public author profile. Anonymous-readable; {@code amFollowing} is
 * always false for anonymous viewers (the follow button hides itself in
 * that case and prompts sign-in instead).
 */
public record ProfileResponse(
        UUID userId,
        String displayName,
        String emailMd5,
        Instant joinedAt,
        long followerCount,
        long followingCount,
        boolean amFollowing,
        // Public identity. Handles are bare (no @ / no URL) — the frontend
        // builds the link, so a stored value can't carry its own scheme.
        String bio,
        String websiteUrl,
        String githubUser,
        String xUser,
        String mastodonUrl,
        String linkedinUrl,
        // True when the viewer IS this user — drives the "edit profile" affordance.
        boolean isMe,
        // Reports where this user is the LEAD (project owner).
        List<CommunityReportSummary> reports,
        // Reports where this user is a credited CONTRIBUTOR but not the lead.
        // Empty for legacy reports published before the byline existed.
        List<CommunityReportSummary> collaborativeReports,
        // Published blog posts by this author, newest first.
        List<BlogPostSummary> posts
) {}
