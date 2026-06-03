package ai.openapk.core.auth.dto;

import jakarta.validation.constraints.Size;

/**
 * Self-profile PATCH (PATCH /api/users/me). Currently only display_name
 * is editable; email is sourced from the IdP and never user-writable.
 * Blank/null display_name resets back to the JWT-derived fallback.
 */
public record UpdateUserRequest(
        @Size(max = 60, message = "display name max 60 chars") String displayName
) {}
