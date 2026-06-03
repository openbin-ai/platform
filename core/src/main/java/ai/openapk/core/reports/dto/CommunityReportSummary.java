package ai.openapk.core.reports.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Anonymous /community feed entry — just enough to render a card. Excludes
 * the full sections JSON (paid only on the detail endpoint). Author fields
 * are nullable because old reports may pre-date the display_name field;
 * the frontend falls back to "anonymous researcher" when null.
 */
public record CommunityReportSummary(
        UUID reportId,
        UUID projectId,
        String title,
        String projectName,
        String malwareType,
        List<String> tags,
        String sha256,
        Instant communityPublishedAt,
        String authorDisplayName,
        String authorEmailMd5,
        // Snippet of the first non-empty section; capped at ~240 chars. Used
        // for the feed-card preview line.
        String preview
) {}
