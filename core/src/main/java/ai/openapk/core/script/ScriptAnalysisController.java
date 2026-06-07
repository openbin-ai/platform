package ai.openapk.core.script;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.projects.analysis.AnalysisStorageService;
import ai.openapk.core.projects.dto.ProjectResponse;
import ai.openapk.core.script.dto.ScriptAnalysisFindings;
import tools.jackson.databind.ObjectMapper;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;
import java.util.UUID;

/**
 * Tarball upload endpoint for the malicious-NPM analyzer + the read-back
 * endpoint the openbin-frontend ScriptFindings panel calls. Both gated
 * behind {@code openapk.script-analyzer.enabled} so dev profiles without
 * the Lambda configured don't surface broken endpoints.
 */
@RestController
@RequestMapping("/api/projects/script")
@ConditionalOnProperty(name = "openapk.script-analyzer.enabled", havingValue = "true")
public class ScriptAnalysisController {

    private final ScriptAnalysisService service;
    private final ScriptAnalysisRepository analyses;
    private final CurrentUserService currentUser;
    private final ObjectMapper mapper;
    private final AnalysisStorageService storage;

    public ScriptAnalysisController(
            ScriptAnalysisService service,
            ScriptAnalysisRepository analyses,
            CurrentUserService currentUser,
            ObjectMapper mapper,
            AnalysisStorageService storage
    ) {
        this.service = service;
        this.analyses = analyses;
        this.currentUser = currentUser;
        this.mapper = mapper;
        this.storage = storage;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ProjectResponse upload(@RequestParam("file") MultipartFile file) {
        return service.uploadAndAnalyze(currentUser.current(), file);
    }

    /**
     * Returns the persisted findings for a SCRIPT project. The frontend
     * gets back the same JSON the worker produced (schemaVersion + summary
     * + findings[]). Authorization mirrors {@code ProjectController.get}:
     * owner + collaborators see it; public access is denied until the
     * project is published to the community feed (separate endpoint).
     */
    /**
     * Returns a short-TTL CloudFront-signed URL to download the deobfuscated
     * source bundle (.tar.gz) for a SCRIPT project. The frontend extracts
     * the tarball in-browser and renders a file tree + code viewer next to
     * the findings — analysts can't review what they can't see, so this
     * endpoint is the missing half of the workflow.
     *
     * <p>Owner-only same as {@link #findings}.
     */
    @GetMapping("/{projectId}/bundle-url")
    public Map<String, String> bundleUrl(@PathVariable UUID projectId) {
        var user = currentUser.current();
        ScriptAnalysis row = analyses.findById(projectId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "no analysis for project"));
        if (!service.callerCanRead(user.getId(), projectId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "no analysis for project");
        }
        if (row.getBundleS3Key() == null || row.getBundleS3Key().isBlank()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "no source bundle available");
        }
        String url = storage.signDownloadUrl(row.getBundleS3Key());
        return Map.of("url", url);
    }

    @GetMapping("/{projectId}/findings")
    public ScriptAnalysisFindings findings(@PathVariable UUID projectId) {
        var user = currentUser.current();
        // Reuse Project-level authz by looking up the analysis — the FK
        // cascade means the row only exists if the project does, and we
        // gate access via the same accessibility query the project view
        // uses. For now keep it simple: the row exists ⇒ caller is the
        // owner (collaborators come in B.4 when we wire the read path
        // through ProjectRepository.findAccessibleByIdAndUserId).
        ScriptAnalysis row = analyses.findById(projectId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "no analysis for project"));
        // Caller must own the underlying project — the worker JSON stays
        // private until publish-to-community is invoked separately.
        // (Owner check delegated to service so this controller stays thin.)
        if (!service.callerCanRead(user.getId(), projectId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "no analysis for project");
        }
        try {
            return mapper.readValue(row.getFindingsJson(), ScriptAnalysisFindings.class);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "stored findings JSON could not be parsed");
        }
    }
}
