package ai.openapk.core.blog.dto;

import java.time.Instant;
import java.util.UUID;

/** Feed / profile card. No body — the list view never renders one. */
public record BlogPostSummary(
        UUID id,
        String slug,
        String title,
        String summary,
        UUID authorId,
        String authorDisplayName,
        String authorEmailMd5,
        Instant publishedAt,
        Instant updatedAt,
        long upvotes,
        long commentCount,
        // Per-viewer, false for anonymous readers.
        boolean upvotedByMe,
        boolean mine,
        // Null publishedAt already implies this; kept explicit so the author's
        // dashboard doesn't have to infer state from a timestamp.
        boolean draft,
        int readingMinutes
) {}
