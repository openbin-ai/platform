package ai.openapk.core.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

@Service
public class CurrentUserService {

    private static final Logger log = LoggerFactory.getLogger(CurrentUserService.class);

    private final UserRepository users;

    public CurrentUserService(UserRepository users) {
        this.users = users;
    }

    /**
     * Same as {@link #current()} but returns {@code null} for anonymous
     * callers instead of throwing. Used on endpoints that are permitted
     * unauthenticated (e.g. {@code /api/community/**}) but want to
     * opportunistically personalize the response when a Bearer is
     * present — like showing "did you upvote this" on the public feed.
     */
    @Transactional
    public User currentOrNull() {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (!(auth instanceof JwtAuthenticationToken)) return null;
        return current();
    }

    @Transactional
    public User current() {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (!(auth instanceof JwtAuthenticationToken jwtAuth)) {
            throw new IllegalStateException("no JWT authentication in security context");
        }
        var jwt = jwtAuth.getToken();
        final String email = jwt.getClaimAsString("email");
        final String name = firstNonBlank(
                jwt.getClaimAsString("name"),
                jwt.getClaimAsString("preferred_username")
        );

        // External identifier: prefer the standard OIDC `sub`, but tolerate token
        // shapes that omit it (some Keycloak configs strip `sub` from access tokens).
        // Fall back to preferred_username, then email.
        final String sub = firstNonBlank(
                jwt.getSubject(),
                jwt.getClaimAsString("preferred_username"),
                email
        );
        if (sub == null) {
            log.error("JWT has no sub/preferred_username/email. Claims present: {}", jwt.getClaims().keySet());
            throw new IllegalStateException("JWT has no usable stable identifier");
        }

        var user = users.findByKeycloakSub(sub).orElseGet(() -> {
            users.insertIfNotExists(UUID.randomUUID(), sub, email, name);
            return users.findByKeycloakSub(sub).orElseThrow(() ->
                    new IllegalStateException("user provisioning failed for sub=" + sub));
        });

        user.setLastSeenAt(Instant.now());
        if (email != null && !Objects.equals(email, user.getEmail())) user.setEmail(email);
        // Display name is user-owned once set: PATCH /api/users/me writes
        // it explicitly. Only seed from the JWT when we don't have one
        // yet — otherwise every authed request would clobber the user's
        // chosen public name back to the IdP's "name" claim.
        if (name != null && (user.getDisplayName() == null || user.getDisplayName().isBlank())) {
            user.setDisplayName(name);
        }
        return user;
    }

    private static String firstNonBlank(String... values) {
        for (String v : values) {
            if (v != null && !v.isBlank()) return v;
        }
        return null;
    }
}
