package ai.openapk.core.projects.ingest;

import ai.openapk.core.analysis.AnalysisMode;
import ai.openapk.core.auth.User;
import ai.openapk.core.notifications.NotificationService;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectKind;
import ai.openapk.core.projects.ProjectRepository;
import ai.openapk.core.projects.ProjectStatus;
import ai.openapk.core.projects.WorkflowStatus;
import ai.openapk.core.projects.dto.ProjectResponse;
import ai.openapk.core.projects.ingest.dto.IngestRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.Set;

/**
 * Accepts pre-decompiled BIN projects from the OpenAPK CLI. The CLI runs
 * Ghidra locally and POSTs the worker's JSON here; we persist a BIN project
 * directly in {@code READY} state, skipping the entire cloud worker dispatch.
 *
 * <p>This is the cost-stop path for native binary RE — moves the expensive
 * Ghidra compute to the user's own machine. The frontend treats CLI-sourced
 * projects identically to worker-sourced ones; only the {@code source}
 * tagging in the audit trail differs.
 */
@Service
public class IngestService {

    private static final Logger log = LoggerFactory.getLogger(IngestService.class);

    /**
     * Supported ingestion schema versions. A version is added here when a new
     * CLI release ships and removed once we're confident no live clients
     * still post that shape. Mismatched clients get a clean 400 instead of
     * a downstream parse blow-up.
     */
    private static final Set<String> SUPPORTED_SCHEMAS = Set.of("1.0");

    private final ProjectRepository repo;
    private final ObjectMapper mapper;
    private final NotificationService notifications;

    public IngestService(ProjectRepository repo, ObjectMapper mapper, NotificationService notifications) {
        this.repo = repo;
        this.mapper = mapper;
        this.notifications = notifications;
    }

    @Transactional
    public ProjectResponse ingestBinary(User user, IngestRequest req) {
        if (!SUPPORTED_SCHEMAS.contains(req.schemaVersion())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "ingestion schema version '" + req.schemaVersion()
                            + "' not supported (this backend accepts: "
                            + SUPPORTED_SCHEMAS + "). Please upgrade your CLI.");
        }

        JsonNode root = req.workerOutput();
        if (root == null || root.isNull() || root.isMissingNode()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "workerOutput is required");
        }
        if (root.has("error")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "workerOutput reports an error: " + root.get("error").asString(""));
        }

        // Re-serialize the worker output so we store a canonical form on
        // binary_analysis_jsonb — mirrors BinaryDecompileService which stores
        // the worker's HTTP response body verbatim. Keeping it as a string
        // avoids forcing a JsonNode round-trip every time the UI reads it back.
        String rawJson;
        try {
            rawJson = mapper.writeValueAsString(root);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "could not serialize workerOutput: " + e.getMessage());
        }

        JsonNode meta = root.path("metadata");

        Project p = new Project();
        p.setUser(user);
        p.setKind(ProjectKind.BIN);
        p.setOriginalFilename(req.originalFilename());
        p.setName(req.name() == null || req.name().isBlank() ? req.originalFilename() : req.name());
        p.setSizeBytes(req.sizeBytes());
        p.setSha256(req.sha256());
        // Already-decompiled — go straight to READY. No worker dispatch
        // means no quota slot consumed (that's the whole point of CLI ingest).
        p.setStatus(ProjectStatus.READY);
        p.setWorkflowStatus(WorkflowStatus.NEW);
        p.setAnalysisMode(AnalysisMode.MALWARE);
        // Prefer worker-detected metadata over caller's archHint; the worker
        // looks at actual file bytes whereas archHint is a guess from the CLI.
        String detectedArch = textOrNull(meta, "arch");
        p.setArch(detectedArch != null ? detectedArch : normalizeHint(req.archHint()));
        p.setExecutableFormat(textOrNull(meta, "executable_format"));
        p.setCompiler(textOrNull(meta, "compiler"));
        p.setLanguageId(textOrNull(meta, "language"));
        p.setImageBase(textOrNull(meta, "image_base"));
        p.setBinaryAnalysisJson(rawJson);
        p.setDecompiledAt(Instant.now());

        repo.save(p);

        log.info("CLI ingest accepted: user={} project={} name={} size={}b functions={} source={}",
                user.getId(), p.getId(), p.getName(), p.getSizeBytes(),
                root.path("functions").size(), req.source());

        // Decompile-complete email — same notification path as the APK flow,
        // gated by the user's opt-out preferences and skipped silently if SES
        // isn't configured.
        notifications.notifyDecompileComplete(user, p);

        return ProjectResponse.from(p);
    }

    private static String textOrNull(JsonNode node, String field) {
        JsonNode v = node.path(field);
        if (v.isMissingNode() || v.isNull()) return null;
        String s = v.asString("");
        return s.isBlank() ? null : s;
    }

    private static String normalizeHint(String hint) {
        if (hint == null || hint.isBlank() || hint.equalsIgnoreCase("auto")) return null;
        return hint;
    }
}
