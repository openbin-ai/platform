package ai.openapk.core.social.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Wire shape for a single comment in the thread response. {@code replies}
 * is always present (possibly empty) on top-level comments and always
 * empty for replies — the schema only allows one level of nesting. When
 * {@code deleted} is true the {@code body} is "[deleted]" and the author
 * fields are masked; the row stays in the tree so child replies keep
 * their visual context.
 */
public record CommentResponse(
        UUID id,
        // Exactly one of reportId / postId is set — a comment hangs off a
        // community report or a blog post, never both.
        UUID reportId,
        UUID postId,
        UUID parentCommentId,
        UUID authorId,
        String authorDisplayName,
        String authorEmailMd5,
        String body,
        Instant createdAt,
        boolean deleted,
        // Per-viewer flag. Drives the inline delete button on the user's
        // own comments. Always false for anonymous viewers.
        boolean mine,
        List<CommentResponse> replies
) {}
