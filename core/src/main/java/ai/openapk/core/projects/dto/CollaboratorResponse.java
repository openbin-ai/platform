package ai.openapk.core.projects.dto;

import ai.openapk.core.projects.ProjectRole;

import java.time.Instant;
import java.util.UUID;

/**
 * One row in the project's collaborator roster. Includes enough about the
 * user to render an avatar + display name without a second round trip.
 * Email exposed because the share modal needs it to confirm "you added the
 * right person".
 */
public record CollaboratorResponse(
        UUID userId,
        String email,
        String displayName,
        ProjectRole role,
        Instant addedAt,
        UUID addedBy
) {}
