package ai.openapk.core.bundles.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * Lightweight bundle row for the projects-list grouping: identity, name,
 * creation time, and a member count. No member payload — the overview page
 * fetches {@link BundleDetail} for that.
 */
public record BundleSummary(
        UUID id,
        String name,
        Instant createdAt,
        int fileCount
) {}
