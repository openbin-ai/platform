package ai.openapk.core.media.dto;

import java.time.Instant;

public record MediaItem(
        String filename,
        String url,
        long sizeBytes,
        Instant createdAt
) {}
