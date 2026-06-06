package ai.openapk.core.nativeanalysis;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.nativeanalysis.dto.AnalyzeRequest;
import ai.openapk.core.nativeanalysis.dto.FinalizeNativeIngestRequest;
import ai.openapk.core.nativeanalysis.dto.InitiateNativeIngestRequest;
import ai.openapk.core.nativeanalysis.dto.InitiateNativeIngestResponse;
import ai.openapk.core.nativeanalysis.dto.NativeLibraryView;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/projects/{id}/native")
public class NativeAnalysisController {

    private final NativeAnalysisService service;
    private final NativeAnalysisIngestService ingestService;
    private final CurrentUserService currentUser;

    public NativeAnalysisController(NativeAnalysisService service,
                                    NativeAnalysisIngestService ingestService,
                                    CurrentUserService currentUser) {
        this.service = service;
        this.ingestService = ingestService;
        this.currentUser = currentUser;
    }

    /** Every .so under {@code resources/lib/*}, joined with any persisted job status. */
    @GetMapping("/libraries")
    public List<NativeLibraryView> libraries(@PathVariable("id") UUID id) {
        return service.listLibraries(currentUser.current(), id);
    }

    /** Kick off (or re-kick) a Ghidra analysis for one .so. Returns the current view. */
    @PostMapping("/analyze")
    public ResponseEntity<NativeLibraryView> analyze(
            @PathVariable("id") UUID id,
            @Valid @RequestBody AnalyzeRequest req
    ) {
        NativeLibraryView view = service.kickoff(currentUser.current(), id, req.libPath());
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(view);
    }

    /**
     * Full extract for one .so. 204 No Content until status flips to READY.
     * Returned as raw JSON to avoid round-tripping through a typed DTO — the
     * worker's shape is the source of truth and the frontend renders it
     * straight.
     */
    @GetMapping(value = "/result", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> result(
            @PathVariable("id") UUID id,
            @RequestParam("libPath") String libPath
    ) {
        String json = service.getResultJson(currentUser.current(), id, libPath);
        if (json == null) return ResponseEntity.noContent().build();
        return ResponseEntity.ok(json);
    }

    /**
     * CLI flow step 1: mint a presigned S3 PUT URL the CLI uploads the
     * gzipped worker JSON to. Pre-creates (or resets) the native_analyses
     * row in {@code INGEST_PENDING} so a CLI crash mid-flight leaves a
     * recoverable orphan (cleaned up by the lifecycle rule after 24h).
     */
    @PostMapping("/ingest/initiate")
    public ResponseEntity<InitiateNativeIngestResponse> initiateIngest(
            @PathVariable("id") UUID id,
            @Valid @RequestBody InitiateNativeIngestRequest req
    ) {
        return ResponseEntity.status(HttpStatus.ACCEPTED)
                .body(ingestService.initiate(currentUser.current(), id, req));
    }

    /**
     * CLI flow step 2: the CLI's PUT to S3 has completed; HEAD the object
     * to capture size + ETag and flip the row to READY. Returns the updated
     * {@link NativeLibraryView} so the CLI / frontend can render immediately.
     */
    @PostMapping("/ingest/finalize")
    public ResponseEntity<NativeLibraryView> finalizeIngest(
            @PathVariable("id") UUID id,
            @Valid @RequestBody FinalizeNativeIngestRequest req
    ) {
        return ResponseEntity.ok(ingestService.finalize(currentUser.current(), id, req));
    }
}
