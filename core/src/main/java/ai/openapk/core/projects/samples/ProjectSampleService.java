package ai.openapk.core.projects.samples;

import ai.openapk.core.auth.User;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectAccessGuard;
import ai.openapk.core.projects.ProjectKind;
import ai.openapk.core.projects.analysis.AnalysisMetadataExtractor;
import ai.openapk.core.projects.analysis.AnalysisStorageService;
import ai.openapk.core.projects.samples.dto.FinalizeSampleIngestRequest;
import ai.openapk.core.projects.samples.dto.InitiateSampleIngestRequest;
import ai.openapk.core.projects.samples.dto.InitiateSampleIngestResponse;
import ai.openapk.core.projects.samples.dto.SampleView;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.server.ResponseStatusException;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.zip.GZIPInputStream;

/**
 * Multi-sample projects: the S3 ingest + read surface for ADDITIONAL samples
 * attached to a BIN project. Mirrors
 * {@link ai.openapk.core.nativeanalysis.NativeAnalysisIngestService} (the
 * per-project child-analysis precedent) with two deliberate upgrades: the
 * sample's sha256 is STORED (dedup-per-project is enforced by a unique
 * constraint) and finalize stream-parses the worker metadata so the sample
 * switcher can show arch/format/language per sample.
 *
 * <p>Deliberately NOT wired into renames/highlights/reports — those are keyed
 * (project, symbol-name) and collide across samples; extra samples are
 * read-only side analyses, like attached native libs. The public-read surface
 * exposes only the primary sample.
 */
@Service
public class ProjectSampleService {

    private static final Logger log = LoggerFactory.getLogger(ProjectSampleService.class);

    /** CLI-only surface; there was never a 1.0 for sample ingest. */
    private static final Set<String> SUPPORTED_SCHEMAS = Set.of("2.0");

    private final ProjectSampleRepository sampleRepo;
    private final ProjectAccessGuard guard;
    /** Null when openapk.analysis-storage.bucket is unset (dev/local). */
    private final AnalysisStorageService analysisStorage;
    private final AnalysisMetadataExtractor metadataExtractor;

    public ProjectSampleService(
            ProjectSampleRepository sampleRepo,
            ProjectAccessGuard guard,
            @Autowired(required = false) AnalysisStorageService analysisStorage,
            @Autowired(required = false) AnalysisMetadataExtractor metadataExtractor
    ) {
        this.sampleRepo = sampleRepo;
        this.guard = guard;
        this.analysisStorage = analysisStorage;
        this.metadataExtractor = metadataExtractor;
    }

    /** Every attached sample of the project, oldest first, with signed URLs when READY. */
    @Transactional(readOnly = true)
    public List<SampleView> list(User user, UUID projectId) {
        guard.requireRead(user, projectId);
        Function<String, String> signer = urlSigner();
        return sampleRepo.findAllByProjectIdOrderByCreatedAtAsc(projectId).stream()
                .map(s -> SampleView.from(s, signer))
                .toList();
    }

    /**
     * Inline read of one attached sample's raw worker JSON — the fallback for
     * clients that can't use the signed CloudFront URL. Gunzips from S3 into
     * heap like the legacy primary-blob endpoint; prefer the signed URL.
     * NOTE: renames are NOT applied — sample analyses are rename-free by design
     * (names collide across samples).
     */
    @Transactional(readOnly = true)
    public String getAnalysisJson(User user, UUID projectId, UUID sampleId) {
        guard.requireRead(user, projectId);
        ProjectSample s = requireSample(projectId, sampleId);
        if (s.getStatus() != ProjectSampleStatus.READY) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "sample is in status " + s.getStatus() + ", expected READY");
        }
        if (analysisStorage == null || s.getAnalysisS3Key() == null || s.getAnalysisS3Key().isBlank()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "sample has no stored analysis");
        }
        try (InputStream body = analysisStorage.openBody(s.getAnalysisS3Key());
             GZIPInputStream gz = new GZIPInputStream(body)) {
            return new String(gz.readAllBytes(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "failed to load sample analysis: " + e.getMessage());
        }
    }

    /**
     * Step 1: validate + upsert the sample row to INGEST_PENDING and mint the
     * presigned PUT. Re-initiating an existing (project, sha256) sample resets
     * it — the user may be re-decompiling with a different Ghidra version or a
     * forced processor.
     */
    @Transactional
    public InitiateSampleIngestResponse initiate(User user, UUID projectId, InitiateSampleIngestRequest req) {
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
        // EDITOR: sample ingest writes a project_samples row + presigns S3 PUT.
        Project project = guard.requireEdit(user, projectId);
        if (project.getKind() != ProjectKind.BIN) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "sample ingest is only valid for BIN projects (project kind=" + project.getKind() + ")");
        }
        String sha = req.sha256().toLowerCase(Locale.ROOT);
        if (sha.equalsIgnoreCase(project.getSha256())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "this binary IS the project's primary sample — re-decompile it with `openbin decompile` instead");
        }

        ProjectSample row = sampleRepo.findByProjectIdAndSha256(projectId, sha)
                .orElseGet(ProjectSample::new);
        row.setProjectId(projectId);
        row.setLabel(req.label().trim());
        row.setOriginalFilename(req.originalFilename());
        row.setSha256(sha);
        row.setSizeBytes(req.sizeBytes());
        row.setArch(normalizeHint(req.archHint()));
        row.setStatus(ProjectSampleStatus.INGEST_PENDING);
        row.setErrorMessage(null);
        row.setAnalyzedAt(null);
        row.setAnalysisS3Etag(null);
        row.setAnalysisSizeBytes(null);
        row = sampleRepo.saveAndFlush(row);

        // Per-row leaf key: re-initiates mint a NEW key, so a leaked earlier
        // presigned URL can't overwrite a finalized newer upload.
        String key = "analysis/samples/" + project.getUser().getId() + "/" + projectId
                + "/" + row.getId() + "/result.json.gz";
        row.setAnalysisS3Key(key);
        sampleRepo.save(row);

        AnalysisStorageService.PresignedPut signed =
                analysisStorage.presignUpload(key, req.uploadSizeBytes(), "status=pending");
        log.info("sample ingest initiated: user={} project={} sample={} sha={} key={} expectedSize={}b",
                user.getId(), projectId, row.getId(), sha, key, req.uploadSizeBytes());
        return new InitiateSampleIngestResponse(
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
     * Step 2: HEAD the uploaded object, stream-parse metadata, flip to READY,
     * and clear the pending tag so the orphan-ingest lifecycle rule doesn't
     * reap a finalized result (~24h later, project still says READY — the
     * exact failure V-analysis-pending-tag taught us).
     */
    @Transactional
    public SampleView finalize(User user, UUID projectId, FinalizeSampleIngestRequest req) {
        if (analysisStorage == null) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "S3 ingest is not configured on this backend");
        }
        guard.requireEdit(user, projectId);
        UUID sampleId;
        try {
            sampleId = UUID.fromString(req.sampleId());
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "sampleId is not a valid UUID");
        }
        ProjectSample row = requireSample(projectId, sampleId);
        if (row.getStatus() != ProjectSampleStatus.INGEST_PENDING) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "sample is in status " + row.getStatus() + ", expected INGEST_PENDING");
        }
        String key = row.getAnalysisS3Key();
        if (key == null || key.isBlank()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "sample has no S3 key — initiate didn't run cleanly, please re-initiate");
        }

        AnalysisStorageService.ObjectMetadata head;
        try {
            head = analysisStorage.head(key);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "S3 object not found at expected key — did the upload finish? " + e.getMessage());
        }

        // Same stream-parse as the primary ingest so the sample switcher can
        // show per-sample arch/format/language. Worker-reported arch wins
        // over the CLI hint.
        if (metadataExtractor != null) {
            try (var body = analysisStorage.openBody(key)) {
                AnalysisMetadataExtractor.ExtractedMetadata meta = metadataExtractor.extract(body);
                if (meta.arch() != null) row.setArch(meta.arch());
                row.setExecutableFormat(meta.executableFormat());
                row.setCompiler(meta.compiler());
                row.setLanguageId(meta.languageId());
                row.setImageBase(meta.imageBase());
            } catch (RuntimeException re) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Could not parse uploaded worker JSON: " + re.getMessage());
            } catch (Exception e) {
                throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                        "Failed to read uploaded object: " + e.getMessage());
            }
        }

        row.setAnalysisS3Etag(head.etag());
        row.setAnalysisSizeBytes(head.sizeBytes());
        row.setStatus(ProjectSampleStatus.READY);
        row.setAnalyzedAt(Instant.now());
        sampleRepo.save(row);

        try {
            analysisStorage.markReady(key);
        } catch (Exception e) {
            log.error("sample ingest finalized but failed to clear pending tag for project={} key={} — "
                    + "lifecycle may reap it in ~24h; re-tag status=ready manually: {}",
                    projectId, key, e.toString());
        }

        log.info("sample ingest finalized: user={} project={} sample={} key={} etag={} size={}b",
                user.getId(), projectId, row.getId(), key, head.etag(), head.sizeBytes());
        return SampleView.from(row, urlSigner());
    }

    /** Remove an attached sample (EDITOR+). The S3 object is deleted after commit. */
    @Transactional
    public void delete(User user, UUID projectId, UUID sampleId) {
        guard.requireEdit(user, projectId);
        ProjectSample row = requireSample(projectId, sampleId);
        String key = row.getAnalysisS3Key();
        sampleRepo.delete(row);
        // Sample blobs are never shared (fork copies only the primary blob),
        // so no refcount is needed — but delete after commit so a rolled-back
        // delete can't destroy a live blob.
        if (analysisStorage != null && key != null && !key.isBlank()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    analysisStorage.deleteObject(key);
                }
            });
        }
    }

    // ---------- helpers ----------

    private ProjectSample requireSample(UUID projectId, UUID sampleId) {
        ProjectSample row = sampleRepo.findById(sampleId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "sample not found"));
        if (!row.getProjectId().equals(projectId)) {
            // Don't let a caller swap project IDs mid-flight.
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "sample does not belong to this project");
        }
        return row;
    }

    private Function<String, String> urlSigner() {
        if (analysisStorage == null || !analysisStorage.cdnConfigured()) {
            return null;
        }
        return analysisStorage::signDownloadUrl;
    }

    private static String normalizeHint(String hint) {
        if (hint == null) return null;
        String h = hint.trim();
        if (h.isEmpty() || h.equalsIgnoreCase("auto") || h.equalsIgnoreCase("unknown")) return null;
        return h.length() > 64 ? h.substring(0, 64) : h;
    }
}
