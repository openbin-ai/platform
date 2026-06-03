package ai.openapk.core.jnibridge;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.jnibridge.dto.JniBridgeView;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/api/projects/{id}/jni-bridge")
public class JniBridgeController {

    private final JniBridgeScanService service;
    private final CurrentUserService currentUser;

    public JniBridgeController(JniBridgeScanService service, CurrentUserService currentUser) {
        this.service = service;
        this.currentUser = currentUser;
    }

    /** Cached scan if present, else build + persist + return. */
    @GetMapping
    public JniBridgeView get(@PathVariable("id") UUID id) {
        return service.getOrBuild(currentUser.current(), id);
    }

    /** Force a fresh scan, overwriting any cached doc. Used by the Rescan button. */
    @PostMapping("/rescan")
    public JniBridgeView rescan(@PathVariable("id") UUID id) {
        return service.rescan(currentUser.current(), id);
    }
}
