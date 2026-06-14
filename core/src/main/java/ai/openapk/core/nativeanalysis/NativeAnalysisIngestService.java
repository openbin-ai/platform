package ai.openapk.core.nativeanalysis;

import ai.openapk.core.auth.User;
import ai.openapk.core.nativeanalysis.dto.FinalizeNativeIngestRequest;
import ai.openapk.core.nativeanalysis.dto.InitiateNativeIngestRequest;
import ai.openapk.core.nativeanalysis.dto.InitiateNativeIngestResponse;
import ai.openapk.core.nativeanalysis.dto.NativeLibraryView;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectAccessGuard;
import ai.openapk.core.projects.ProjectKind;
import ai.openapk.core.projects.analysis.AnalysisStorageService;
import ai.openapk.core.projects.storage.ProjectStorage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * S3-based ingest pipeline for native-library Ghidra results, the CLI-only
 * counterpart to {@link ai.openapk.core.projects.ingest.IngestService} on
 * the BIN side. The user downloads a {@code .so} from their APK project,
 * runs Ghidra locally via the openbin CLI, and the CLI streams the gzipped
 * worker JSON into S3 via a presigned PUT before flipping the row to READY.
 *
 * <p>The cloud Ghidra worker that previously ran inside our infra is sunset
 * (see {@link ai.openapk.core.projects.GhidraSunsetMessage}); this is the
 * supported path going forward for per-{@code .so} analysis attached to an
 * APK project.
 *
 * <p>Status lifecycle: {@code initiate} upserts the row to
 * {@code INGEST_PENDING} with the S3 key set; {@code finalize} HEADs the
 * object, captures size + ETag, and flips to {@code READY}. The orphan
 * cleanup index in V25 targets {@code INGEST_PENDING} rows whose CLI never
 * completed the PUT.
 */
@Service
public class NativeAnalysisIngestService {

    private static final Logger log = LoggerFactory.getLogger(NativeAnalysisIngestService.class);

    /**
     * Supported schema versions. Mirrors the BIN ingest pipeline. v2.0 is
     * the only currently-supported version because there was never a v1.0
     * for native-lib CLI ingest.
     */
    private static final Set<String> SUPPORTED_SCHEMAS = Set.of("2.0");

    /**
     * Same shape as {@link NativeAnalysisService#NATIVE_LIB_ROOT} —
     * duplicated here so we don't reach into a sibling service's private
     * surface. Keep in sync if either changes.
     */
    private static final String NATIVE_LIB_ROOT = "resources/lib";

    /**
     * Conservative cap on the libPath length. Matches the column width.
     * Backstop against malicious clients trying to overflow the row.
     */
    private static final int LIB_PATH_MAX = 512;

    private static final Pattern LIB_PATH_RE = Pattern.compile(
            "^resources/lib/[^/]+/[^/]+\\.so$");

    private final NativeAnalysisRepository nativeRepo;
    private final ProjectStorage storage;
    /** Null when openapk.analysis-storage.bucket is unset (dev/local). */
    private final AnalysisStorageService analysisStorage;
    private final ProjectAccessGuard guard;

    public NativeAnalysisIngestService(
            NativeAnalysisRepository nativeRepo,
            ProjectStorage storage,
            @Autowired(required = false) AnalysisStorageService analysisStorage,
            ProjectAccessGuard guard
    ) {
        this.nativeRepo = nativeRepo;
        this.storage = storage;
        this.analysisStorage = analysisStorage;
        this.guard = guard;
    }

    /**
     * Step 1: validate ownership + libPath, upsert the row to
     * {@code INGEST_PENDING} with the S3 key pre-populated, and return a
     * presigned PUT URL the CLI uploads to.
     *
     * <p>Re-initiating on an already-READY row is allowed — the user might
     * be re-running analysis with a different Ghidra version. The row is
     * reset to INGEST_PENDING and the old S3 object is overwritten by the
     * CLI's PUT. (We don't proactively delete the old object; lifecycle
     * rules take care of orphans.)
     */
    @Transactional
    public InitiateNativeIngestResponse initiate(User user, UUID projectId, InitiateNativeIngestRequest req) {
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

        // EDITOR: native ingest writes a native_analyses row + presigns S3 PUT.
        Project project = guard.requireEdit(user, projectId);
        if (project.getKind() != ProjectKind.APK) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "native ingest is only valid for APK projects (project kind=" + project.getKind() + ")");
        }

        // Owner-keyed: srcDir lives under the project owner's user folder.
        String libPath = validateLibPath(req.libPath(), project.getUser().getId(), projectId);
        String arch = inferArch(libPath);

        // Upsert the row. PENDING/INGEST_PENDING from a prior attempt is
        // overwritten — the user is starting fresh.
        NativeAnalysis row = nativeRepo.findByProjectIdAndLibPath(projectId, libPath).orElseGet(NativeAnalysis::new);
        row.setProjectId(projectId);
        row.setLibPath(libPath);
        row.setArch(arch);
        row.setSizeBytes(sizeOf(user.getId(), projectId, libPath));
        row.setStatus(NativeAnalysisStatus.INGEST_PENDING);
        row.setResultJson(null);
        row.setErrorMessage(null);
        row.setAnalyzedAt(null);
        row.setAnalysisS3Etag(null);
        row.setAnalysisSizeBytes(null);
        row = nativeRepo.saveAndFlush(row);

        String key = buildKey(user.getId(), projectId, row.getId());
        row.setAnalysisS3Key(key);
        nativeRepo.save(row);

        AnalysisStorageService.PresignedPut signed = analysisStorage.presignUpload(
                key,
                req.uploadSizeBytes(),
                "status=pending"
        );
        log.info("native ingest initiated: user={} project={} lib={} key={} expectedSize={}b",
                user.getId(), projectId, libPath, key, req.uploadSizeBytes());
        return new InitiateNativeIngestResponse(
                row.getId().toString(),
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
     * Step 2: HEAD the uploaded object, capture size + ETag, flip the row
     * to READY. The metadata extractor is BIN-specific (arch, image base,
     * etc.) so we don't run it for native libs — the worker JSON for an
     * individual {@code .so} is self-contained and the frontend reads it
     * directly via the existing {@code /native/result} endpoint.
     */
    @Transactional
    public NativeLibraryView finalize(User user, UUID projectId, FinalizeNativeIngestRequest req) {
        if (analysisStorage == null) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "S3 ingest is not configured on this backend");
        }
        // EDITOR: finalize flips the native_analyses row to READY. Guard
        // upfront so a stranger can't probe for nativeAnalysisId existence,
        // then assert the row belongs to this project (an editor on project
        // A mustn't finalize project B's row by submitting a different id).
        guard.requireEdit(user, projectId);
        UUID nativeId;
        try {
            nativeId = UUID.fromString(req.nativeAnalysisId());
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "nativeAnalysisId is not a valid UUID");
        }
        NativeAnalysis row = nativeRepo.findById(nativeId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "native analysis row not found"));
        if (!row.getProjectId().equals(projectId)) {
            // Don't let a CLI swap project IDs mid-flight.
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "nativeAnalysisId does not belong to this project");
        }
        if (row.getStatus() != NativeAnalysisStatus.INGEST_PENDING) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "native row is in status " + row.getStatus() + ", expected INGEST_PENDING");
        }
        String key = row.getAnalysisS3Key();
        if (key == null || key.isBlank()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "row has no S3 key — initiate didn't run cleanly, please re-initiate");
        }

        AnalysisStorageService.ObjectMetadata head;
        try {
            head = analysisStorage.head(key);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "S3 object not found at expected key — did the upload finish? " + e.getMessage());
        }

        row.setAnalysisS3Etag(head.etag());
        row.setAnalysisSizeBytes(head.sizeBytes());
        row.setStatus(NativeAnalysisStatus.READY);
        row.setAnalyzedAt(Instant.now());
        nativeRepo.save(row);

        // Clear the pending tag the presigned PUT applied so the 1-day
        // orphan-ingest lifecycle rule doesn't delete this finalized result.
        // Best-effort — see IngestService.finalize for the full rationale.
        try {
            analysisStorage.markReady(key);
        } catch (Exception e) {
            log.error("native ingest finalized but failed to clear pending tag for project={} key={} — "
                    + "lifecycle may reap it in ~24h; re-tag status=ready manually: {}",
                    projectId, key, e.toString());
        }

        log.info("native ingest finalized: user={} project={} lib={} key={} etag={} size={}b",
                user.getId(), projectId, row.getLibPath(), key, head.etag(), head.sizeBytes());

        return new NativeLibraryView(
                row.getLibPath(),
                row.getArch(),
                row.getSizeBytes(),
                row.getStatus(),
                row.getErrorMessage(),
                row.getAnalyzedAt()
        );
    }

    // ---------- helpers ----------

    private static String buildKey(UUID userId, UUID projectId, UUID nativeAnalysisId) {
        // Per-row leaf keeps each (project, libPath) result isolated and
        // makes the orphan-cleanup pass trivially scoped. The nativeAnalysisId
        // UUID also means re-initiates produce a different key, so a leaked
        // earlier presigned URL can't overwrite a finalized newer upload.
        return "analysis/native/" + userId + "/" + projectId + "/" + nativeAnalysisId + "/result.json.gz";
    }

    private String validateLibPath(String libPath, UUID userId, UUID projectId) {
        if (libPath == null || libPath.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "libPath is required");
        }
        if (libPath.length() > LIB_PATH_MAX) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "libPath too long");
        }
        if (!LIB_PATH_RE.matcher(libPath).matches()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "libPath must be of the form resources/lib/<abi>/<name>.so");
        }
        // Confirm the .so actually exists on disk — the CLI is supposed to
        // download it from /file/raw first, so a missing file means the
        // caller is fabricating a libPath. Cheap sanity check, no IO if the
        // workspace was already cleared.
        Path root = storage.srcDir(userId, projectId).normalize();
        Path resolved = root.resolve(libPath).normalize();
        if (!resolved.startsWith(root)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "libPath escapes project root");
        }
        if (!Files.isRegularFile(resolved)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "no such .so under this project");
        }
        return libPath;
    }

    private long sizeOf(UUID userId, UUID projectId, String libPath) {
        try {
            Path root = storage.srcDir(userId, projectId).normalize();
            return Files.size(root.resolve(libPath).normalize());
        } catch (IOException e) {
            return -1L;
        }
    }

    private static String inferArch(String relPath) {
        String[] parts = relPath.split("/");
        if (parts.length >= 4 && "resources".equals(parts[0]) && "lib".equals(parts[1])) {
            return parts[2];
        }
        return "unknown";
    }
}
