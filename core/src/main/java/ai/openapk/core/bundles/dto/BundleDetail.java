package ai.openapk.core.bundles.dto;

import ai.openapk.core.projects.dto.ProjectResponse;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Full bundle payload for the overview page (/bundles/:id): identity + name +
 * the member projects as ordinary {@link ProjectResponse} rows (analysis-URL
 * signing intentionally skipped — the overview shows metadata only; clicking a
 * file opens its ProjectView which mints the signed URL then).
 */
public record BundleDetail(
        UUID id,
        String name,
        Instant createdAt,
        List<ProjectResponse> files
) {}
