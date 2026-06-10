package ai.openapk.core.auth;

import ai.openapk.core.auth.dto.UpdateUserRequest;
import ai.openapk.core.auth.dto.UserResponse;
import ai.openapk.core.reports.CommunityService;
import jakarta.validation.Valid;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Authenticated self-profile endpoints. {@code GET /api/users/me} gives
 * the frontend the current user's display_name + email + Gravatar hash;
 * {@code PATCH /api/users/me} lets the user edit display_name.
 *
 * <p>Email is intentionally NOT writable — the IdP (Keycloak) is the
 * source of truth for it. The display_name is the user-controlled public
 * label that appears next to their community-published reports.
 */
@RestController
@RequestMapping("/api/users/me")
public class UserController {

    private final CurrentUserService currentUser;
    private final UserRepository users;

    public UserController(CurrentUserService currentUser, UserRepository users) {
        this.currentUser = currentUser;
        this.users = users;
    }

    @GetMapping
    @Transactional(readOnly = true)
    public UserResponse me() {
        User u = currentUser.current();
        return new UserResponse(
                u.getId(),
                u.getDisplayName(),
                u.getEmail(),
                CommunityService.md5Hex(u.getEmail())
        );
    }

    /**
     * Update display name. Blank or null clears it back to "use whatever
     * the JWT claim says" — handled because {@link CurrentUserService}
     * re-seeds from the JWT when display_name is null/blank.
     */
    @PatchMapping
    @Transactional
    public UserResponse update(@Valid @RequestBody UpdateUserRequest req) {
        User u = currentUser.current();
        String dn = req.displayName();
        u.setDisplayName(dn == null || dn.isBlank() ? null : dn.trim());
        users.save(u);
        return new UserResponse(
                u.getId(),
                u.getDisplayName(),
                u.getEmail(),
                CommunityService.md5Hex(u.getEmail())
        );
    }
}
