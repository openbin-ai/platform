package ai.openapk.core.projects.analysis;

import ai.openapk.core.projects.Project;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.zip.GZIPInputStream;

/**
 * Single read-path for the Ghidra worker JSON. Legacy projects keep the
 * blob inline in {@code projects.binary_analysis_jsonb}; projects ingested
 * via the S3 pipeline (Phase 1+) reference an S3 object by key and the
 * column is NULL. Consumers (BinaryDigestService, AnalysisService,
 * CryptoService, CallChainService, DeobfuscationService, RenameService)
 * should all go through {@link #load(Project)} so neither path is
 * hard-coded into the business logic.
 *
 * <p>NOT cached. Each call re-fetches from S3 — the analysis JSON can be
 * tens of MB and we don't want to pin it per-project in the heap. If this
 * becomes a hotspot later, a small Caffeine cache keyed on
 * {@code (projectId, etag)} is the right next step.
 */
@Service
public class BinaryAnalysisLoader {

    private static final Logger log = LoggerFactory.getLogger(BinaryAnalysisLoader.class);

    private final AnalysisStorageService analysisStorage;

    public BinaryAnalysisLoader(@Autowired(required = false) AnalysisStorageService analysisStorage) {
        this.analysisStorage = analysisStorage;
    }

    /**
     * Returns the full worker JSON for the project, or {@code null} if no
     * analysis has been stored yet.
     *
     * <p>Order of preference:
     * <ol>
     *   <li>Legacy inline JSONB column ({@code binary_analysis_jsonb}).</li>
     *   <li>S3 object referenced by {@code binary_analysis_s3_key}.</li>
     * </ol>
     * Legacy first because if both are somehow populated, the inline copy
     * is authoritative (it's what BinaryDecompileService wrote synchronously).
     */
    public String load(Project project) {
        String legacy = project.getBinaryAnalysisJson();
        if (legacy != null && !legacy.isBlank()) {
            return legacy;
        }
        String key = project.getBinaryAnalysisS3Key();
        if (key == null || key.isBlank()) {
            return null;
        }
        if (analysisStorage == null) {
            log.warn("project {} references S3 analysis key but analysis storage is not configured",
                    project.getId());
            return null;
        }
        try (InputStream raw = analysisStorage.openBody(key);
             GZIPInputStream gz = new GZIPInputStream(raw);
             ByteArrayOutputStream buf = new ByteArrayOutputStream(1 << 20)) {
            gz.transferTo(buf);
            return buf.toString(StandardCharsets.UTF_8);
        } catch (IOException e) {
            log.error("failed to read S3 analysis object key={} for project {}: {}",
                    key, project.getId(), e.toString());
            return null;
        }
    }
}
