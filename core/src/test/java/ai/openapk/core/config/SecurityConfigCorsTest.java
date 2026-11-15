package ai.openapk.core.config;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The stats endpoint's wildcard CORS entry must win over the credentialed
 * "/**" entry — UrlBasedCorsConfigurationSource returns the first pattern
 * that matches, so registration order is the whole mechanism.
 */
class SecurityConfigCorsTest {

    private static OpenApkProperties props() {
        return new OpenApkProperties(null,
                new OpenApkProperties.Cors(List.of("https://app.openbin.ai"), "https://openapk.ai"),
                null, null, null, null, null, null, null, null, null, null, null);
    }

    @Test
    void statsPathAllowsOnlyTheLandingsWithoutCredentials() {
        var src = new SecurityConfig().corsConfigurationSource(props());
        var cfg = src.getCorsConfiguration(new MockHttpServletRequest("GET", "/api/public/stats"));
        assertThat(cfg).isNotNull();
        assertThat(cfg.getAllowedOrigins())
                .contains("https://openbin.ai", "https://www.openbin.ai", "https://openapk.ai", "https://www.openapk.ai")
                .doesNotContain("*");
        assertThat(cfg.checkOrigin("https://openbin.ai")).isEqualTo("https://openbin.ai");
        assertThat(cfg.checkOrigin("https://evil.example")).isNull();
        assertThat(cfg.getAllowCredentials()).isFalse();
        assertThat(cfg.getAllowedMethods()).containsExactly("GET", "OPTIONS");
    }

    @Test
    void everythingElseKeepsTheCredentialedAllowList() {
        var src = new SecurityConfig().corsConfigurationSource(props());
        var cfg = src.getCorsConfiguration(new MockHttpServletRequest("GET", "/api/public/projects/x"));
        assertThat(cfg).isNotNull();
        assertThat(cfg.getAllowedOrigins()).containsExactly("https://app.openbin.ai", "https://openapk.ai");
        assertThat(cfg.getAllowCredentials()).isTrue();
    }
}
