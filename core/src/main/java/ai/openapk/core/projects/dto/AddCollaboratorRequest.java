package ai.openapk.core.projects.dto;

import ai.openapk.core.projects.ProjectRole;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * Body of {@code POST /api/projects/{id}/collaborators}. The owner picks
 * a user by email (rather than UUID) — much easier to type, and the share
 * modal already has the user typing it from "share with"-style mental
 * model.
 *
 * <p>{@code role} must be VIEWER or EDITOR. OWNER is rejected at the
 * controller layer because the project's owner is implicit via
 * {@code projects.user_id}; there is no second owner.
 */
public record AddCollaboratorRequest(
        @NotBlank @Email String email,
        @NotNull ProjectRole role
) {}
