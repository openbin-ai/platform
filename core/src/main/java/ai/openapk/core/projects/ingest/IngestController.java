package ai.openapk.core.projects.ingest;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.projects.dto.ProjectResponse;
import ai.openapk.core.projects.ingest.dto.IngestRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/projects/ingest")
public class IngestController {

    private final IngestService service;
    private final CurrentUserService currentUser;

    public IngestController(IngestService service, CurrentUserService currentUser) {
        this.service = service;
        this.currentUser = currentUser;
    }

    /**
     * Accept a pre-decompiled BIN project from the OpenAPK CLI. The body
     * carries the Ghidra worker JSON the CLI captured locally; we persist
     * it as a READY project without spinning up the cloud worker.
     */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ProjectResponse ingest(@Valid @RequestBody IngestRequest req) {
        return service.ingestBinary(currentUser.current(), req);
    }
}
