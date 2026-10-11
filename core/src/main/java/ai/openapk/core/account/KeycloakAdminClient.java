package ai.openapk.core.account;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;

import java.util.Map;

/**
 * Deletes a user's identity in Keycloak so a deleted account can't
 * auto-reprovision on its next request (see
 * {@code CurrentUserService.current()}, which JIT-creates a row for any valid
 * JWT). We talk to the Keycloak Admin REST API directly with a plain
 * {@link RestClient} rather than pulling in {@code keycloak-admin-client} —
 * that dependency drags RESTEasy/JAX-RS in and is a version-compat headache
 * on Spring Boot 4, and all we need is a token grant plus one DELETE.
 *
 * <p>Egress here is NOT the BYOK SSRF surface: the server URL is operator
 * config, not user input, so it deliberately does not go through
 * {@code EgressUrlPolicy}.
 *
 * <p>Disabled by default so local dev (no admin service account) still works;
 * prod sets {@code OPENAPK_KEYCLOAK_ADMIN_ENABLED=true} plus the client
 * credentials. When disabled, {@link #deleteUser} is a logged no-op — the
 * app-side data is still anonymized, the IdP identity just isn't removed.
 */
@Component
public class KeycloakAdminClient {

    private static final Logger log = LoggerFactory.getLogger(KeycloakAdminClient.class);

    private final boolean enabled;
    private final String serverUrl;   // e.g. http://keycloak:8080  (no trailing slash needed)
    private final String realm;       // realm the app users live in
    private final String clientId;    // confidential client w/ realm-management manage-users
    private final String clientSecret;
    private final RestClient http = RestClient.create();

    public KeycloakAdminClient(
            @Value("${openapk.keycloak.admin.enabled:false}") boolean enabled,
            @Value("${openapk.keycloak.admin.server-url:}") String serverUrl,
            @Value("${openapk.keycloak.admin.realm:openapk}") String realm,
            @Value("${openapk.keycloak.admin.client-id:}") String clientId,
            @Value("${openapk.keycloak.admin.client-secret:}") String clientSecret
    ) {
        this.enabled = enabled;
        this.serverUrl = serverUrl == null ? "" : serverUrl.replaceAll("/+$", "");
        this.realm = realm;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
    }

    /**
     * Delete the Keycloak user whose id equals {@code keycloakSub}. In a
     * standard Keycloak setup the OIDC {@code sub} is the user's internal id,
     * so we can delete by it directly. Returns {@code true} if the identity is
     * gone (deleted now, or already absent), {@code false} if we couldn't act.
     *
     * <p>Never throws: account deletion has already anonymized the app-side
     * data by the time this runs (post-commit), so an IdP hiccup must not turn
     * a completed deletion into a 500. A failure is logged at ERROR with the
     * sub so an operator can finish the cleanup by hand.
     */
    public boolean deleteUser(String keycloakSub) {
        if (!enabled) {
            log.warn("Keycloak admin disabled — IdP identity for sub={} NOT removed "
                    + "(app data anonymized). Set OPENAPK_KEYCLOAK_ADMIN_* to enable.", keycloakSub);
            return false;
        }
        if (serverUrl.isBlank() || clientId.isBlank() || clientSecret.isBlank()) {
            log.error("Keycloak admin enabled but misconfigured (server/client/secret blank) — "
                    + "IdP identity for sub={} NOT removed.", keycloakSub);
            return false;
        }
        // A sub that isn't a UUID means the token had no real `sub` and we fell
        // back to preferred_username/email (see CurrentUserService); we can't
        // address the admin API by that. Bail loudly rather than 404-spam.
        if (!looksLikeUuid(keycloakSub)) {
            log.error("Cannot delete Keycloak user: sub={} is not a UUID (token likely lacked `sub`). "
                    + "Remove the IdP account manually.", keycloakSub);
            return false;
        }
        try {
            String token = fetchAdminToken();
            if (token == null) return false;

            HttpStatusCode status = http.delete()
                    .uri(serverUrl + "/admin/realms/{realm}/users/{id}", realm, keycloakSub)
                    .header("Authorization", "Bearer " + token)
                    .retrieve()
                    .onStatus(s -> true, (req, res) -> { /* inspect below, don't throw */ })
                    .toBodilessEntity()
                    .getStatusCode();

            if (status.is2xxSuccessful() || status.value() == 404) {
                // 404 = already gone; treat as success (idempotent).
                log.info("Keycloak identity removed for sub={} (status {})", keycloakSub, status.value());
                return true;
            }
            log.error("Keycloak user delete for sub={} returned {} — remove manually.", keycloakSub, status.value());
            return false;
        } catch (Exception e) {
            log.error("Keycloak user delete failed for sub={}: {} — remove manually.", keycloakSub, e.toString());
            return false;
        }
    }

    private String fetchAdminToken() {
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("grant_type", "client_credentials");
        form.add("client_id", clientId);
        form.add("client_secret", clientSecret);
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> body = http.post()
                    .uri(serverUrl + "/realms/{realm}/protocol/openid-connect/token", realm)
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .body(form)
                    .retrieve()
                    .body(Map.class);
            Object tok = body == null ? null : body.get("access_token");
            if (tok == null) {
                log.error("Keycloak admin token response had no access_token");
                return null;
            }
            return tok.toString();
        } catch (Exception e) {
            log.error("Keycloak admin token grant failed: {}", e.toString());
            return null;
        }
    }

    private static boolean looksLikeUuid(String s) {
        if (s == null) return false;
        try {
            java.util.UUID.fromString(s);
            return true;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }
}
