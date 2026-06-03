package ai.openapk.core.reports.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record ReportResponse(
        UUID id,
        UUID projectId,
        String title,
        List<ReportSection> sections,
        Instant createdAt,
        Instant updatedAt,
        Instant publishedAt,
        Instant communityPublishedAt,
        String malwareType,
        List<String> tags
) {}
