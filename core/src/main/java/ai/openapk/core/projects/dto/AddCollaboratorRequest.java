package ai.openapk.core.projects.dto;

import ai.openapk.core.projects.ProjectRole;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

/**
 * Body of {@code POST /api/projects/{id}/collaborators}. The owner
 * identifies the invitee EITHER by {@code userId} or by {@code email};
 * exactly one is required.
 *
 * <p>{@code userId} is what the share modal sends now: the analyst picks a
 * researcher from search or from their followers/following, and those
 * endpoints already return user ids. It also avoids a real problem with
 * email-only invites — {@code SocialUserSummary} deliberately never exposes
 * a user's email address (only its MD5, for Gravatar), so there was no way
 * to invite someone you could plainly see in the UI.
 *
 * <p>{@code email} is retained because typing a colleague's address is
 * still the natural move when they aren't in your follow graph, and older
 * clients send it.
 *
 * <p>{@code role} must be VIEWER or EDITOR. OWNER is rejected in the
 * service because the project's owner is implicit via
 * {@code projects.user_id}; there is no second owner.
 */
public record AddCollaboratorRequest(
        UUID userId,
        @Email String email,
        @NotNull ProjectRole role
) {
    /**
     * Exactly one identifier. Both-at-once is rejected rather than silently
     * preferring one, so a client bug surfaces as a 400 instead of an
     * invite quietly going to the wrong person.
     */
    @AssertTrue(message = "provide exactly one of userId or email")
    public boolean isExactlyOneIdentifier() {
        return (userId != null) ^ (email != null && !email.isBlank());
    }

    public boolean byUserId() {
        return userId != null;
    }
}
