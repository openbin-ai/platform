package ai.openapk.core.tos;

import ai.openapk.core.auth.CurrentUserService;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;

/**
 * TOS endpoints. The frontend hits these on app load to decide whether
 * to show the blocking acceptance modal:
 *
 * <ul>
 *   <li>{@code GET /api/me/tos} — returns currentVersion + acceptedVersion;
 *       used by the frontend hook to decide whether to gate.</li>
 *   <li>{@code POST /api/me/tos/accept} — records the user's acceptance.
 *       Idempotent: re-accepting the same version is a no-op write.</li>
 *   <li>{@code GET /api/tos.md} — public (no auth, no acceptance gate)
 *       markdown of the current TOS text the modal renders.</li>
 * </ul>
 *
 * The first two endpoints are EXEMPT from {@link TosAcceptanceFilter} —
 * users in a pre-acceptance state must be able to read their status and
 * post an acceptance. {@code /api/tos.md} is public.
 */
@RestController
public class TosController {

    private final TosService service;
    private final CurrentUserService currentUser;

    public TosController(TosService service, CurrentUserService currentUser) {
        this.service = service;
        this.currentUser = currentUser;
    }

    @GetMapping("/api/me/tos")
    public TosService.AcceptanceState state() {
        return service.state(currentUser.current());
    }

    @PostMapping("/api/me/tos/accept")
    @ResponseStatus(HttpStatus.OK)
    public TosService.AcceptanceState accept() {
        return service.accept(currentUser.current());
    }

    /**
     * Serves the bundled TOS markdown — public so the acceptance modal
     * can render it even before the user accepts. Content lives in
     * {@code src/main/resources/legal/tos.md} so updates ship with the
     * backend image (no need to also push a frontend deploy when only
     * the prose changes).
     */
    @GetMapping(value = "/api/tos.md", produces = "text/markdown")
    public ResponseEntity<String> tosMarkdown() {
        try {
            var resource = new ClassPathResource("legal/tos.md");
            String body = new String(resource.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            return ResponseEntity.ok()
                    .contentType(MediaType.valueOf("text/markdown; charset=UTF-8"))
                    .header("X-Tos-Version", service.currentVersion())
                    .body(body);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body("TOS document is unavailable. Please contact husam@openbin.ai.");
        }
    }
}
