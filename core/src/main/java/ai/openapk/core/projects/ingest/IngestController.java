package ai.openapk.core.projects.ingest;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.projects.dto.ProjectResponse;
import ai.openapk.core.projects.ingest.dto.FinalizeIngestRequest;
import ai.openapk.core.projects.ingest.dto.InitiateIngestRequest;
import ai.openapk.core.projects.ingest.dto.InitiateIngestResponse;
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
     * Legacy inline-JSONB ingest. The body carries the entire Ghidra
     * worker JSON; Spring buffers it and Jackson builds a JsonNode tree
     * in heap. Schema 1.0 only — schema 2.0 clients use initiate/finalize
     * instead. Kept alive during the v1 → v2 cutover; remove once no
     * live CLIs still post here.
     */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ProjectResponse ingest(@Valid @RequestBody IngestRequest req) {
        return service.ingestBinary(currentUser.current(), req);
    }

    /**
     * Step 1 of the schema-2.0 S3 ingest flow. Pre-creates the project
     * row and returns a presigned S3 PUT URL the CLI streams the gzipped
     * worker JSON to. Zero body data crosses the backend on this call.
     */
    @PostMapping("/initiate")
    @ResponseStatus(HttpStatus.CREATED)
    public InitiateIngestResponse initiate(@Valid @RequestBody InitiateIngestRequest req) {
        return service.initiate(currentUser.current(), req);
    }

    /**
     * Step 2 of the schema-2.0 S3 ingest flow. After the CLI's PUT to S3
     * succeeds it posts here; the backend HEADs the object, streams the
     * metadata out, and flips the project status to READY.
     */
    @PostMapping("/finalize")
    @ResponseStatus(HttpStatus.OK)
    public ProjectResponse finalize(@Valid @RequestBody FinalizeIngestRequest req) {
        return service.finalize(currentUser.current(), req);
    }
}
