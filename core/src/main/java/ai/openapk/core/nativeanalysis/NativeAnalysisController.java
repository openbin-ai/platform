package ai.openapk.core.nativeanalysis;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.nativeanalysis.dto.AnalyzeRequest;
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
    private final CurrentUserService currentUser;

    public NativeAnalysisController(NativeAnalysisService service, CurrentUserService currentUser) {
        this.service = service;
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
}
