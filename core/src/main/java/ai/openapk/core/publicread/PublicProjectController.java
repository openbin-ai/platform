package ai.openapk.core.publicread;

import ai.openapk.core.highlights.ProjectHighlightService;
import ai.openapk.core.highlights.dto.HighlightResponse;
import ai.openapk.core.media.MediaService;
import ai.openapk.core.projects.ProjectPublicGuard;
import ai.openapk.core.projects.ProjectService;
import ai.openapk.core.projects.dto.ProjectResponse;
import ai.openapk.core.reports.ProjectReportService;
import ai.openapk.core.reports.dto.ReportResponse;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * ANONYMOUS read surface for projects the owner has made public
 * ({@code projects.public_read_at}). Every handler routes through
 * {@link ProjectPublicGuard#requirePublic} (inside the service methods, or
 * directly for media) which 404s identically for private/missing projects, so
 * an anonymous caller can't tell a private project from a nonexistent one.
 *
 * <p>Whitelist only — READ endpoints, mirroring what a VIEWER sees minus PII
 * (no roster/collaborators) and minus any write / LLM path. Mounted under
 * /api/public/** which {@code SecurityConfig} permits anonymously; it must NOT
 * mint a CloudFront signed URL for anonymous callers (see
 * {@link ProjectService#getPublic}).
 */
@RestController
@RequestMapping("/api/public/projects/{id}")
public class PublicProjectController {

    private final ProjectService projectService;
    private final ProjectHighlightService highlightService;
    private final ProjectReportService reportService;
    private final ProjectPublicGuard publicGuard;
    private final MediaService mediaService;

    public PublicProjectController(
            ProjectService projectService,
            ProjectHighlightService highlightService,
            ProjectReportService reportService,
            ProjectPublicGuard publicGuard,
            MediaService mediaService
    ) {
        this.projectService = projectService;
        this.highlightService = highlightService;
        this.reportService = reportService;
        this.publicGuard = publicGuard;
        this.mediaService = mediaService;
    }

    /** Project summary/metadata (no signed analysis URL for anonymous callers). */
    @GetMapping
    public ProjectResponse get(@PathVariable UUID id) {
        return projectService.getPublic(id);
    }

    /**
     * BIN analysis JSON (functions, decompiled C, disasm, strings, imports),
     * renames applied. Unlike the rest of this surface, this endpoint requires
     * an authenticated caller (any account — no project membership needed):
     * SecurityConfig carves it out of the /api/public/** permitAll. Product
     * decision 2026-07-26 — the code view is the sign-up hook; report +
     * highlights stay anonymous.
     */
    @GetMapping(value = "/binary-analysis", produces = MediaType.APPLICATION_JSON_VALUE)
    public String binaryAnalysis(@PathVariable UUID id) {
        return projectService.getBinaryAnalysisJsonPublic(id);
    }

    /** Highlights board (read-only). */
    @GetMapping("/highlights")
    public List<HighlightResponse> highlights(@PathVariable UUID id) {
        return highlightService.listPublic(id);
    }

    /** The published report (read-only; empty template if none authored). */
    @GetMapping("/report")
    public ReportResponse report(@PathVariable UUID id) {
        return reportService.getPublicReport(id);
    }

    /**
     * Serve a screenshot referenced by this public project's report/highlights.
     * Gated on public_read_at first, then resolved by the project owner's
     * storage. Filename is UUID.png-validated in the service (no traversal).
     */
    @GetMapping("/media/{name}")
    public ResponseEntity<?> media(@PathVariable UUID id, @PathVariable("name") String name) {
        publicGuard.requirePublic(id);
        MediaService.Resolved resolved = mediaService.resolvePublic(id, name);
        if (resolved instanceof MediaService.Resolved.Presigned p) {
            // 302 to the presigned URL — works for a plain anonymous <img src>
            // (no Authorization header carried, so no Firefox CORS-redirect
            // refusal). Mirrors the community media endpoint.
            return ResponseEntity.status(HttpStatus.FOUND)
                    .header(HttpHeaders.LOCATION, p.url().toString())
                    .header(HttpHeaders.CACHE_CONTROL, "public, max-age=300")
                    .build();
        }
        var path = ((MediaService.Resolved.Local) resolved).path();
        return ResponseEntity.ok()
                .contentType(MediaType.IMAGE_PNG)
                .header(HttpHeaders.CACHE_CONTROL, "public, max-age=3600")
                .body(new FileSystemResource(path));
    }
}
