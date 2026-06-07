package ai.openapk.core.social.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.UUID;

/**
 * POST body for {@code /api/social/comments}. {@code parentCommentId} is
 * optional — present for replies, omitted for top-level comments. The 4000
 * char cap mirrors the DB CHECK so the validation error surfaces as a 400
 * before the row ever hits Postgres.
 */
public record CreateCommentRequest(
        UUID reportId,
        UUID parentCommentId,
        @NotBlank
        @Size(min = 1, max = 4000)
        String body
) {}
