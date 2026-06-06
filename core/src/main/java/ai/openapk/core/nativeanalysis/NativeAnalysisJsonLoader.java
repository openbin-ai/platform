package ai.openapk.core.nativeanalysis;

import ai.openapk.core.projects.analysis.AnalysisStorageService;
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
 * Single read-path for the per-(project, .so) worker JSON.
 * Legacy rows (cloud Ghidra sunset) carry the body inline in
 * {@code native_analyses.result_jsonb}; CLI-ingested rows (Phase 1+ of
 * the native S3 ingest pipeline) reference an S3 object key. Both
 * {@link NativeAnalysisService#getResultJson} and
 * {@link ai.openapk.core.jnibridge.JniBridgeScanService} call through
 * here so neither path is hard-coded into the business logic. Mirrors
 * {@link ai.openapk.core.projects.analysis.BinaryAnalysisLoader} for the
 * BIN side.
 *
 * <p>NOT cached — each call re-fetches from S3. Native lib analyses are
 * typically &lt;5 MB gzipped so the round-trip is acceptable; if it
 * becomes a hotspot a small Caffeine cache keyed on (row.id, etag) is
 * the right next step.
 */
@Service
public class NativeAnalysisJsonLoader {

    private static final Logger log = LoggerFactory.getLogger(NativeAnalysisJsonLoader.class);

    private final AnalysisStorageService analysisStorage;

    public NativeAnalysisJsonLoader(@Autowired(required = false) AnalysisStorageService analysisStorage) {
        this.analysisStorage = analysisStorage;
    }

    /**
     * Returns the worker JSON for this row, or {@code null} when neither
     * the inline column nor the S3 object is available. Inline wins when
     * both happen to be set (only possible on a malformed row).
     */
    public String load(NativeAnalysis row) {
        if (row == null) return null;
        String inline = row.getResultJson();
        if (inline != null && !inline.isBlank()) return inline;
        String key = row.getAnalysisS3Key();
        if (key == null || key.isBlank()) return null;
        if (analysisStorage == null) {
            log.warn("native row {} references S3 key but analysis storage is not configured", row.getId());
            return null;
        }
        try (InputStream raw = analysisStorage.openBody(key);
             GZIPInputStream gz = new GZIPInputStream(raw);
             ByteArrayOutputStream buf = new ByteArrayOutputStream(1 << 20)) {
            gz.transferTo(buf);
            return buf.toString(StandardCharsets.UTF_8);
        } catch (IOException e) {
            log.error("failed to read S3 native analysis key={} for row {}: {}",
                    key, row.getId(), e.toString());
            return null;
        }
    }
}
