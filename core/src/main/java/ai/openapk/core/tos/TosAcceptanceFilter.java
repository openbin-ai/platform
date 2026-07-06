package ai.openapk.core.tos;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.auth.User;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;
import tools.jackson.databind.ObjectMapper;

import java.util.Set;

/**
 * Gates all authenticated API calls behind acceptance of the current
 * TOS version. Runs as a Spring MVC HandlerInterceptor (i.e. AFTER Spring
 * Security's JWT auth + CurrentUserService resolution but BEFORE the
 * controller method), so {@link CurrentUserService#current()} is safe to
 * call here.
 *
 * <p>Response on mismatch: HTTP 412 Precondition Required-shaped JSON
 * with the current + accepted version so the frontend hook can re-render
 * the modal without an additional round-trip.
 *
 * <p>Exempt paths fall into three buckets:
 * <ol>
 *   <li>TOS endpoints themselves — users in a pre-acceptance state must
 *       be able to read state + post acceptance.</li>
 *   <li>Public surfaces (community feed, abuse report, TOS markdown,
 *       health) that don't require an authenticated user.</li>
 *   <li>OPTIONS preflight — browser CORS check, no body, no user.</li>
 * </ol>
 */
@Component
public class TosAcceptanceFilter implements HandlerInterceptor {

    private static final Logger log = LoggerFactory.getLogger(TosAcceptanceFilter.class);

    /** Path prefixes the filter ignores entirely. */
    private static final Set<String> EXEMPT_PREFIXES = Set.of(
            "/api/me/tos",          // status + accept endpoints
            "/api/tos.md",          // public TOS markdown
            "/api/community/",      // anonymous-read public feed
            "/api/public/",         // anonymous-read public projects
            "/actuator/"            // Spring Actuator (health, info)
    );

    private final TosService tos;
    private final CurrentUserService currentUser;
    private final ObjectMapper mapper;

    public TosAcceptanceFilter(TosService tos, CurrentUserService currentUser, ObjectMapper mapper) {
        this.tos = tos;
        this.currentUser = currentUser;
        this.mapper = mapper;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws Exception {
        // CORS preflight — no user context, must respond before browser
        // can send the real request.
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) return true;

        String path = request.getRequestURI();
        for (String prefix : EXEMPT_PREFIXES) {
            if (path.startsWith(prefix)) return true;
        }

        // Only enforce for /api/** (anything else, e.g. static assets,
        // is not the platform's concern).
        if (!path.startsWith("/api/")) return true;

        User user;
        try {
            user = currentUser.current();
        } catch (Exception e) {
            // No authenticated user → let Spring Security handle the
            // unauthenticated case with its own 401. We never short-circuit
            // unauthed requests because the security chain might still
            // want them through (e.g. for permitAll endpoints).
            return true;
        }
        if (tos.hasAccepted(user)) return true;

        write412(response, tos.state(user));
        return false;
    }

    private void write412(HttpServletResponse response, TosService.AcceptanceState state) throws Exception {
        response.setStatus(HttpStatus.PRECONDITION_REQUIRED.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        // X-Tos-Version is a redundant convenience header so the frontend
        // can avoid parsing the body to know which version it needs.
        response.setHeader("X-Tos-Required-Version", state.currentVersion());
        String body = mapper.writeValueAsString(java.util.Map.of(
                "error", "tos_acceptance_required",
                "message", "Please accept the current Terms of Service to continue.",
                "currentVersion", state.currentVersion(),
                "acceptedVersion", state.acceptedVersion() == null ? "" : state.acceptedVersion(),
                "tosUrl", "/api/tos.md",
                "acceptUrl", "/api/me/tos/accept"
        ));
        response.getWriter().write(body);
        // Don't break browser CORS by leaving headers off — Spring's
        // CorsFilter ran before us and may have set ACAO/ACAC, but if
        // we're short-circuiting here it's safest to repeat them.
        // (Most clients won't blow up without them, but be safe.)
        if (response.getHeader(HttpHeaders.VARY) == null) {
            response.addHeader(HttpHeaders.VARY, "Origin");
        }
    }
}
