package ai.openapk.core.manifest;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.manifest.dto.AndroidManifestInfo;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/api/projects/{id}/manifest")
public class ManifestController {

    private final ManifestService service;
    private final CurrentUserService currentUser;

    public ManifestController(ManifestService service, CurrentUserService currentUser) {
        this.service = service;
        this.currentUser = currentUser;
    }

    @GetMapping
    public AndroidManifestInfo load(@PathVariable("id") UUID id) {
        return service.load(currentUser.current(), id);
    }
}
