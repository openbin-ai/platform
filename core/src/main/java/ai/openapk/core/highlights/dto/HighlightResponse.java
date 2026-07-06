package ai.openapk.core.highlights.dto;

import ai.openapk.core.highlights.HighlightType;

import java.time.Instant;
import java.util.UUID;

/**
 * One Highlights-board card. {@code createdByName} is the contributor's
 * display name for attribution (null if the author's account is gone).
 */
public record HighlightResponse(
        UUID id,
        HighlightType type,
        String targetRef,
        String mediaKey,
        String tag,
        String note,
        int position,
        UUID createdBy,
        String createdByName,
        Instant createdAt
) {}
