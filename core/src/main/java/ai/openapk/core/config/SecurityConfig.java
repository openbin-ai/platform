package ai.openapk.core.config;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import jakarta.servlet.DispatcherType;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

@Configuration
@EnableWebSecurity
@EnableMethodSecurity
@EnableConfigurationProperties(OpenApkProperties.class)
public class SecurityConfig {

    @Bean
    SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            @Qualifier("corsConfigurationSource") CorsConfigurationSource cors
    ) throws Exception {
        return http
                .cors(c -> c.configurationSource(cors))
                .csrf(csrf -> csrf.disable())
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .dispatcherTypeMatchers(DispatcherType.ERROR, DispatcherType.ASYNC).permitAll()
                        .requestMatchers("/actuator/health/**", "/actuator/info").permitAll()
                        // /community/** is the anonymous-read public feed
                        // (list + single-report read). Abuse-report POST is
                        // also anonymous so signed-out readers can flag. All
                        // mutating community ops (publish/unpublish) live
                        // under /api/projects/{id}/report/community/** which
                        // is still authenticated.
                        .requestMatchers("/api/community/**").permitAll()
                        // The public-project CODE view (decompiled functions)
                        // requires an account: anonymous visitors get the
                        // report + highlights teaser, signing in unlocks the
                        // code. MUST be declared before the /api/public/**
                        // permitAll below — first match wins.
                        .requestMatchers("/api/public/projects/*/binary-analysis").authenticated()
                        // /api/public/** is the anonymous read surface for
                        // projects the owner flagged public_read_at (metadata,
                        // highlights, report, media). Gated per-request by
                        // ProjectPublicGuard, which 404s private/missing
                        // projects identically (no existence leak). Only READ
                        // endpoints live under it — every write/LLM path stays
                        // under the authenticated /api/projects/**.
                        .requestMatchers("/api/public/**").permitAll()
                        // /api/tos.md is the markdown body the acceptance
                        // modal renders. Must be readable BEFORE the user
                        // has signed in (the gate blocks all other /api/**)
                        // and BEFORE acceptance.
                        .requestMatchers("/api/tos.md").permitAll()
                        .requestMatchers("/api/**").authenticated()
                        .anyRequest().denyAll()
                )
                .oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()))
                .build();
    }

    /** The landings' origins plus the Vite dev ports the three frontends land on locally. */
    static final List<String> STATS_ORIGINS = List.of(
            "https://openbin.ai", "https://www.openbin.ai",
            "https://openapk.ai", "https://www.openapk.ai",
            "http://localhost:5173", "http://localhost:5174", "http://localhost:5175"
    );

    @Bean
    CorsConfigurationSource corsConfigurationSource(OpenApkProperties props) {
        var cfg = new CorsConfiguration();
        cfg.setAllowedOrigins(props.cors().effectiveOrigins());
        cfg.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"));
        cfg.setAllowedHeaders(List.of("*"));
        cfg.setExposedHeaders(List.of("Location"));
        cfg.setAllowCredentials(true);
        // Headline numbers for the static marketing landings (openbin.ai,
        // openapk.ai), which are not in the credentialed origin list. Public
        // data, GET only, no credentials. Named origins rather than "*" so
        // another site's JavaScript cannot embed the live numbers through a
        // visitor's browser; curl can still call it, as with any URL a public
        // page fetches. Registered BEFORE "/**": the source returns the
        // first pattern that matches.
        var stats = new CorsConfiguration();
        stats.setAllowedOrigins(STATS_ORIGINS);
        stats.setAllowedMethods(List.of("GET", "OPTIONS"));
        stats.setAllowedHeaders(List.of("*"));
        stats.setAllowCredentials(false);
        var src = new UrlBasedCorsConfigurationSource();
        src.registerCorsConfiguration("/api/public/stats", stats);
        src.registerCorsConfiguration("/**", cfg);
        return src;
    }
}
