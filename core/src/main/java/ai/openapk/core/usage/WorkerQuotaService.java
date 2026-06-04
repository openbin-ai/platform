package ai.openapk.core.usage;

import ai.openapk.core.config.OpenApkProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.UUID;

/**
 * Per-user daily quota gate for cloud worker invocations (Ghidra, JADX).
 *
 * <p>Phase 0 emergency throttle: a single hardcoded daily cap (from
 * {@code openapk.workers.daily-cap-per-user}) applies to every user, with
 * no per-user override and no tier exemption — that detail comes with the
 * real credits system in Phase 2. UTC-day window mirrors {@code LlmUsageService}.
 *
 * <p>Two-call API:
 * <ol>
 *   <li>{@link #reserveRun} — atomic check-and-insert. Throws 429 if the
 *       user is already at or over the cap. Returns the audit row id.</li>
 *   <li>{@link #markComplete} — called after the worker returns to stamp
 *       success/failure on the audit row. {@code REQUIRES_NEW} so a
 *       caller's rollback can't lose the audit.</li>
 * </ol>
 */
@Service
public class WorkerQuotaService {

    private static final Logger log = LoggerFactory.getLogger(WorkerQuotaService.class);

    private final WorkerRunRepository runs;
    private final OpenApkProperties props;

    public WorkerQuotaService(WorkerRunRepository runs, OpenApkProperties props) {
        this.runs = runs;
        this.props = props;
    }

    /**
     * Atomic check + insert. Counts the user's worker runs since the start of
     * the current UTC day; if at or over the cap, throws 429. Otherwise inserts
     * a row with {@code success = null} (in flight) and returns its id, which
     * the caller passes to {@link #markComplete} when the worker call returns.
     *
     * <p>Note: the count-then-insert is not transactionally atomic, so a burst
     * of concurrent requests from one user can briefly exceed the cap. That's
     * acceptable for an emergency throttle — the bill stops bleeding either
     * way, and proper credits ledgering with SELECT FOR UPDATE comes later.
     */
    @Transactional
    public UUID reserveRun(UUID userId, UUID projectId, String workerType) {
        Integer cap = capOrNull();
        if (cap != null) {
            long today = runs.countSince(userId, startOfTodayUtc());
            if (today >= cap) {
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                        String.format(
                                "Cloud worker daily quota exhausted (%d/%d used). " +
                                "Download the desktop CLI for unlimited local decompiles, or buy credits to continue.",
                                today, cap));
            }
        }
        WorkerRun row = new WorkerRun();
        row.setUserId(userId);
        row.setProjectId(projectId);
        row.setWorkerType(workerType);
        // success starts null = in flight
        runs.save(row);
        return row.getId();
    }

    /**
     * Stamp the outcome on a previously-reserved run. Safe to call with a
     * {@code null} runId (no-op) so callers can use it from finally blocks
     * without guarding. Errors here are swallowed so an audit write failure
     * can't turn a successful worker call into a 500.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void markComplete(UUID runId, boolean success, String errorMessage) {
        if (runId == null) return;
        try {
            runs.findById(runId).ifPresent(row -> {
                row.setSuccess(success);
                row.setErrorMessage(abbreviate(errorMessage));
                runs.save(row);
            });
        } catch (Exception e) {
            log.warn("worker_runs audit update failed for run {}: {}", runId, e.toString());
        }
    }

    private Integer capOrNull() {
        if (props.workers() == null) return null;
        Integer cap = props.workers().dailyCapPerUser();
        return (cap == null || cap <= 0) ? null : cap;
    }

    private static Instant startOfTodayUtc() {
        return LocalDate.now(ZoneOffset.UTC).atStartOfDay().toInstant(ZoneOffset.UTC);
    }

    private static String abbreviate(String s) {
        if (s == null) return null;
        return s.length() > 1000 ? s.substring(0, 1000) : s;
    }
}
