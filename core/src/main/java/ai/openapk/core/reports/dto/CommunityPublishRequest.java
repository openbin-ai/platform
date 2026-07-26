package ai.openapk.core.reports.dto;

import jakarta.validation.constraints.Size;

import java.util.List;

/**
 * Payload for {@code POST /report/community/publish}. The author categorizes
 * their report at publish time so it lands in the feed with proper tags.
 *
 * <p>{@code malwareType} must be one of the STIX 2.1 {@code malware-type}
 * open-vocabulary values (validated service-side; null/empty allowed and
 * stored as null). {@code tags} are free-form, capped at 8 entries / 32
 * chars each by the service layer.
 *
 * <p>{@code makeProjectPublic} couples the project's anonymous code view to
 * the publish action: when true (the modal default), publishing also sets
 * {@code projects.public_read_at} so the report can link through to a
 * forkable public project view. Null is treated as false for back-compat
 * (an older client that omits the field only publishes the report, leaving
 * the standalone visibility toggle as the way to expose the code).
 */
public record CommunityPublishRequest(
        String malwareType,
        @Size(max = 8, message = "max 8 tags") List<@Size(max = 32, message = "tag too long") String> tags,
        Boolean makeProjectPublic
) {}
