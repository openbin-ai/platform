package ai.openapk.core.nativeanalysis;

import ai.openapk.core.projects.storage.ProjectStorage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.nio.file.Path;
import java.util.UUID;

/**
 * Background coordinator for a single (project, libPath) Ghidra analysis job.
 *
 * <p>Lives in its OWN bean (separate from {@link NativeAnalysisService}) so the
 * {@code @Async} proxy actually fires when the service calls in. Same goes
 * internally — DB ops are delegated to {@link NativeAnalysisTxOps} so each is
 * a properly-proxied short transaction. The long worker call here holds no
 * row locks.
 */
@Service
public class NativeAnalysisRunner {

    private static final Logger log = LoggerFactory.getLogger(NativeAnalysisRunner.class);

    private final NativeAnalysisTxOps tx;
    private final ProjectStorage storage;
    private final GhidraWorkerClient worker;

    public NativeAnalysisRunner(
            NativeAnalysisTxOps tx,
            ProjectStorage storage,
            GhidraWorkerClient worker
    ) {
        this.tx = tx;
        this.storage = storage;
        this.worker = worker;
    }

    /**
     * Dispatched from {@link NativeAnalysisService#kickoff} after the PENDING
     * row has been inserted. Drives the row through RUNNING → READY/FAILED.
     * Never throws — exceptions are caught and persisted as FAILED so the
     * frontend can render the cause.
     */
    @Async("nativeAnalysisExecutor")
    public void run(UUID userId, UUID projectId, String libPath, String arch) {
        try {
            tx.beginRunning(projectId, libPath);
        } catch (Exception e) {
            log.error("native analysis pre-run setup failed for project {} lib {}: {}",
                    projectId, libPath, e.toString(), e);
            safeFail(projectId, libPath, "failed to start: " + abbreviate(e.toString()));
            return;
        }

        Path abs;
        try {
            Path root = storage.srcDir(userId, projectId).normalize();
            abs = root.resolve(libPath).normalize();
            if (!abs.startsWith(root)) {
                throw new IllegalStateException("lib path escapes root: " + libPath);
            }
        } catch (Exception e) {
            log.error("native analysis path resolution failed for project {} lib {}: {}",
                    projectId, libPath, e.toString(), e);
            safeFail(projectId, libPath, "path resolution failed: " + abbreviate(e.toString()));
            return;
        }

        try {
            var resp = worker.analyze(abs, abs.getFileName().toString(), arch);
            if (resp.isOk()) {
                tx.markReady(projectId, libPath, resp.body());
                log.info("native analysis READY for project {} lib {}", projectId, libPath);
            } else {
                String msg = "worker returned status " + resp.status() + ": " + abbreviate(resp.body());
                log.warn("native analysis FAILED for project {} lib {}: {}", projectId, libPath, msg);
                safeFail(projectId, libPath, msg);
            }
        } catch (Exception e) {
            log.error("native analysis failed for project {} lib {}: {}",
                    projectId, libPath, e.toString(), e);
            safeFail(projectId, libPath, abbreviate(e.toString()));
        }
    }

    private void safeFail(UUID projectId, String libPath, String message) {
        try {
            tx.markFailed(projectId, libPath, message);
        } catch (Exception e) {
            // Last-resort: even the FAILED write failed. Just log; the row stays
            // wherever it was — frontend's polling won't see a terminal state.
            log.error("could not persist FAILED state for project {} lib {}: {}",
                    projectId, libPath, e.toString(), e);
        }
    }

    private static String abbreviate(String s) {
        if (s == null) return "unknown error";
        return s.length() > 500 ? s.substring(0, 500) + "…" : s;
    }
}
