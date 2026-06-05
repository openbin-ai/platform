package ai.openapk.core.projects.ingest;

import ai.openapk.core.analysis.AnalysisMode;
import ai.openapk.core.auth.User;
import ai.openapk.core.notifications.NotificationService;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectKind;
import ai.openapk.core.projects.ProjectRepository;
import ai.openapk.core.projects.ProjectStatus;
import ai.openapk.core.projects.WorkflowStatus;
import ai.openapk.core.projects.analysis.AnalysisMetadataExtractor;
import ai.openapk.core.projects.analysis.AnalysisStorageService;
import ai.openapk.core.projects.dto.ProjectResponse;
import ai.openapk.core.projects.ingest.dto.FinalizeIngestRequest;
import ai.openapk.core.projects.ingest.dto.InitiateIngestRequest;
import ai.openapk.core.projects.ingest.dto.InitiateIngestResponse;
import ai.openapk.core.projects.ingest.dto.IngestRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

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
     *
     * <p>1.0 — legacy inline-JSONB ingest. CLI POSTs the entire worker output
     *          as the body of /api/projects/ingest. Backend buffers + parses
     *          with Jackson and stores in {@code binary_analysis_jsonb}.
     *
     * <p>2.0 — S3 ingest. CLI calls /initiate to mint a presigned PUT, gzips
     *          and uploads the body to S3 directly, then /finalize to extract
     *          metadata. No JsonNode tree is ever built backend-side.
     */
    private static final Set<String> SUPPORTED_SCHEMAS = Set.of("1.0", "2.0");

    private final ProjectRepository repo;
    private final ObjectMapper mapper;
    private final NotificationService notifications;
    // Autowired = null when openapk.analysis-storage.bucket isn't set (dev
    // without S3). Initiate/finalize endpoints check for null and 503.
    private final AnalysisStorageService analysisStorage;
    private final AnalysisMetadataExtractor metadataExtractor;

    public IngestService(
            ProjectRepository repo,
            ObjectMapper mapper,
            NotificationService notifications,
            @Autowired(required = false) AnalysisStorageService analysisStorage,
            @Autowired(required = false) AnalysisMetadataExtractor metadataExtractor
    ) {
        this.repo = repo;
        this.mapper = mapper;
        this.notifications = notifications;
        this.analysisStorage = analysisStorage;
        this.metadataExtractor = metadataExtractor;
    }

    /**
     * Lambda passed to {@link ProjectResponse#from} so the response carries
     * the CloudFront signed URL when the project has an S3 key. Null when
     * CDN signing isn't configured.
     */
    private java.util.function.Function<String, String> urlSigner() {
        if (analysisStorage == null || !analysisStorage.cdnConfigured()) return null;
        return analysisStorage::signDownloadUrl;
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

        return ProjectResponse.from(p, urlSigner());
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

    // ---------- v2.0 S3 ingest flow ------------------------------------------

    /**
     * Step 1: pre-create a project row in INGEST_PENDING and hand back a
     * presigned S3 PUT URL the CLI can stream the gzipped worker JSON to.
     * No body data crosses the backend on this path — only metadata.
     */
    @Transactional
    public InitiateIngestResponse initiate(User user, InitiateIngestRequest req) {
        if (analysisStorage == null) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "S3 ingest is not configured on this backend (openapk.analysis-storage.bucket unset)");
        }
        if (!SUPPORTED_SCHEMAS.contains(req.schemaVersion())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "ingestion schema version '" + req.schemaVersion()
                            + "' not supported (this backend accepts: "
                            + SUPPORTED_SCHEMAS + "). Please upgrade your CLI.");
        }
        Project p = new Project();
        p.setUser(user);
        p.setKind(ProjectKind.BIN);
        p.setOriginalFilename(req.originalFilename());
        p.setName(req.name() == null || req.name().isBlank() ? req.originalFilename() : req.name());
        p.setSizeBytes(req.sizeBytes());
        p.setSha256(req.sha256());
        p.setStatus(ProjectStatus.INGEST_PENDING);
        p.setWorkflowStatus(WorkflowStatus.NEW);
        p.setAnalysisMode(AnalysisMode.MALWARE);
        p.setArch(normalizeHint(req.archHint()));
        repo.save(p);

        String key = analysisStorage.buildUploadKey(user.getId(), p.getId());
        // Pre-set the key on the row so a CLI crash between PUT and finalize
        // still leaves a forensically-recoverable pointer to the S3 object.
        // The lifecycle rule's status=pending tag cleans up the orphan after
        // 24h regardless.
        p.setBinaryAnalysisS3Key(key);
        repo.save(p);

        AnalysisStorageService.PresignedPut signed = analysisStorage.presignUpload(
                key,
                req.uploadSizeBytes(),
                "status=pending"
        );
        log.info("ingest initiated: user={} project={} key={} expectedSize={}b",
                user.getId(), p.getId(), key, req.uploadSizeBytes());
        return new InitiateIngestResponse(
                p.getId().toString(),
                signed.url(),
                key,
                signed.expiresIn().toSeconds(),
                Map.of(
                        "Content-Type",     signed.contentType(),
                        "Content-Encoding", signed.contentEncoding(),
                        "x-amz-tagging",    "status=pending"
                )
        );
    }

    /**
     * Step 2: HEAD the uploaded object, stream-parse metadata out of it,
     * and flip the project to READY. Body never lives in backend memory
     * — Jackson walks the gzip stream token-by-token.
     */
    @Transactional
    public ProjectResponse finalize(User user, FinalizeIngestRequest req) {
        if (analysisStorage == null || metadataExtractor == null) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "S3 ingest is not configured on this backend");
        }
        UUID projectId;
        try {
            projectId = UUID.fromString(req.projectId());
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "projectId is not a valid UUID");
        }
        Project p = repo.findById(projectId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "project not found"));
        // Ownership check — a malicious caller mustn't finalize someone
        // else's pending row. CurrentUserService already authenticated the
        // request; we just compare ids.
        if (!p.getUser().getId().equals(user.getId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "project does not belong to caller");
        }
        if (p.getStatus() != ProjectStatus.INGEST_PENDING) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "project is in status " + p.getStatus() + ", expected INGEST_PENDING");
        }
        String key = p.getBinaryAnalysisS3Key();
        if (key == null || key.isBlank()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "project has no S3 key — initiate didn't run cleanly, please re-initiate");
        }

        // HEAD first: cheap (no body transfer) and tells us if the CLI's
        // PUT actually landed. Missing object → user retries upload.
        AnalysisStorageService.ObjectMetadata head;
        try {
            head = analysisStorage.head(key);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "S3 object not found at expected key — did the upload finish? " + e.getMessage());
        }

        // Stream-parse the metadata out of the gzipped body. AnalysisMetadataExtractor
        // closes the stream itself; we don't try-with-resources here on
        // purpose because the InputStream is consumed inside extract().
        AnalysisMetadataExtractor.ExtractedMetadata meta;
        try (var body = analysisStorage.openBody(key)) {
            meta = metadataExtractor.extract(body);
        } catch (RuntimeException re) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Could not parse uploaded worker JSON: " + re.getMessage());
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "Failed to read uploaded object: " + e.getMessage());
        }

        // Apply extracted fields. arch from the worker wins over the CLI's
        // archHint (mirrors the legacy ingest path).
        if (meta.arch() != null) p.setArch(meta.arch());
        p.setExecutableFormat(meta.executableFormat());
        p.setCompiler(meta.compiler());
        p.setLanguageId(meta.languageId());
        p.setImageBase(meta.imageBase());
        p.setBinaryAnalysisS3Etag(head.etag());
        p.setBinaryAnalysisSizeBytes(head.sizeBytes());
        p.setStatus(ProjectStatus.READY);
        p.setDecompiledAt(Instant.now());
        repo.save(p);

        log.info("ingest finalized: user={} project={} key={} etag={} size={}b functions={}",
                user.getId(), p.getId(), key, head.etag(), head.sizeBytes(),
                meta.functionCount());

        notifications.notifyDecompileComplete(user, p);

        return ProjectResponse.from(p, urlSigner());
    }
}
