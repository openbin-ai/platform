package ai.openapk.core.projects.dto;

import ai.openapk.core.projects.ProjectRole;

import java.time.Instant;
import java.util.UUID;

/**
 * One entry in the in-project member roster: the owner plus every
 * collaborator, each with role and last-active presence. Unlike
 * {@link CollaboratorResponse} (collaborators only, for the share modal),
 * this includes the OWNER and a {@code lastActiveAt} so the project view can
 * render "who's working this project · active 2m ago".
 *
 * <p>{@code lastActiveAt} is null when the member has never sent a presence
 * heartbeat. {@code isSelf} lets the client mark the caller's own row.
 * {@code isBot} is wired for the future BINNY bot user (always false today).
 */
public record ProjectMemberResponse(
        UUID userId,
        String email,
        String displayName,
        ProjectRole role,
        Instant addedAt,
        Instant lastActiveAt,
        boolean isBot,
        boolean isSelf
) {}
