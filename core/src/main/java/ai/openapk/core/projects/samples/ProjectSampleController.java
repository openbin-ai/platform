package ai.openapk.core.projects.samples;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.projects.samples.dto.FinalizeSampleIngestRequest;
import ai.openapk.core.projects.samples.dto.InitiateSampleIngestRequest;
import ai.openapk.core.projects.samples.dto.InitiateSampleIngestResponse;
import ai.openapk.core.projects.samples.dto.SampleView;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Multi-sample projects: the ADDITIONAL samples attached to a BIN project.
 * The project's primary sample keeps living on the project row / the existing
 * {@code /binary-analysis} surface; these endpoints handle the extras.
 */
@RestController
@RequestMapping("/api/projects/{id}/samples")
public class ProjectSampleController {

    private final ProjectSampleService service;
    private final CurrentUserService currentUser;

    public ProjectSampleController(ProjectSampleService service, CurrentUserService currentUser) {
        this.service = service;
        this.currentUser = currentUser;
    }

    /** All attached samples, oldest first, with signed analysis URLs when READY. */
    @GetMapping
    public List<SampleView> list(@PathVariable("id") UUID id) {
        return service.list(currentUser.current(), id);
    }

    /**
     * Inline fallback read of one sample's raw worker JSON (prefer the signed
     * {@code analysisDownloadUrl} from the list). Renames are NOT applied.
     */
    @GetMapping(value = "/{sampleId}/binary-analysis", produces = MediaType.APPLICATION_JSON_VALUE)
    public String analysis(@PathVariable("id") UUID id, @PathVariable("sampleId") UUID sampleId) {
        return service.getAnalysisJson(currentUser.current(), id, sampleId);
    }

    /** CLI flow step 1: mint the presigned S3 PUT for one sample's worker JSON. */
    @PostMapping("/ingest/initiate")
    public ResponseEntity<InitiateSampleIngestResponse> initiate(
            @PathVariable("id") UUID id,
            @Valid @RequestBody InitiateSampleIngestRequest req
    ) {
        return ResponseEntity.status(HttpStatus.ACCEPTED)
                .body(service.initiate(currentUser.current(), id, req));
    }

    /** CLI flow step 2: confirm the PUT landed and flip the sample to READY. */
    @PostMapping("/ingest/finalize")
    public ResponseEntity<SampleView> finalize(
            @PathVariable("id") UUID id,
            @Valid @RequestBody FinalizeSampleIngestRequest req
    ) {
        return ResponseEntity.ok(service.finalize(currentUser.current(), id, req));
    }

    /** Remove an attached sample (EDITOR+); its S3 blob is deleted too. */
    @DeleteMapping("/{sampleId}")
    public ResponseEntity<Void> delete(@PathVariable("id") UUID id, @PathVariable("sampleId") UUID sampleId) {
        service.delete(currentUser.current(), id, sampleId);
        return ResponseEntity.noContent().build();
    }
}
