package ai.openapk.core.nativeanalysis;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.UUID;

/**
 * Tiny transactional facade around {@link NativeAnalysisRepository}.
 *
 * <p>Lives in its own bean so {@link NativeAnalysisRunner} (which orchestrates
 * the long worker call) can keep each DB op in a short, properly-proxied
 * transaction. If these methods lived on the runner, cross-method self-calls
 * would bypass the {@code @Transactional} proxy.
 *
 * <p>All three methods rely on JPA dirty tracking — they load the managed
 * entity inside the transaction, mutate its fields, and let the commit hook
 * flush the UPDATE.
 */
@Service
public class NativeAnalysisTxOps {

    private final NativeAnalysisRepository nativeRepo;

    public NativeAnalysisTxOps(NativeAnalysisRepository nativeRepo) {
        this.nativeRepo = nativeRepo;
    }

    /** Flip a PENDING row to RUNNING. Returns silently if the row vanished. */
    @Transactional
    public void beginRunning(UUID projectId, String libPath) {
        nativeRepo.findByProjectIdAndLibPath(projectId, libPath).ifPresent(row -> {
            row.setStatus(NativeAnalysisStatus.RUNNING);
        });
    }

    @Transactional
    public void markReady(UUID projectId, String libPath, String resultJson) {
        nativeRepo.findByProjectIdAndLibPath(projectId, libPath).ifPresent(row -> {
            row.setResultJson(resultJson);
            row.setStatus(NativeAnalysisStatus.READY);
            row.setErrorMessage(null);
            row.setAnalyzedAt(Instant.now());
        });
    }

    @Transactional
    public void markFailed(UUID projectId, String libPath, String message) {
        nativeRepo.findByProjectIdAndLibPath(projectId, libPath).ifPresent(row -> {
            row.setStatus(NativeAnalysisStatus.FAILED);
            row.setErrorMessage(message);
        });
    }
}
