package ai.openapk.core.nativeanalysis;

/**
 * Lifecycle of a single (project, .so) native-analysis job.
 * <ul>
 *   <li>{@code PENDING} — legacy: row inserted by the now-sunset cloud Ghidra
 *       executor, never picked up. New flows do not produce this state.</li>
 *   <li>{@code RUNNING} — legacy: cloud Ghidra worker was mid-analysis. Same
 *       sunset caveat as {@code PENDING}.</li>
 *   <li>{@code INGEST_PENDING} — CLI flow: {@code /native/ingest/initiate}
 *       has minted a presigned S3 PUT URL and we're waiting on the CLI to
 *       upload + call finalize. The frontend renders "Run the CLI command"
 *       affordance, no auto-polling needed (the CLI's success drives
 *       the flip to READY).</li>
 *   <li>{@code READY}   — worker output persisted (either inline
 *       {@code result_jsonb} for legacy rows, or S3 via the
 *       {@code analysis_s3_key} columns for new ones).</li>
 *   <li>{@code FAILED}  — worker call failed or returned an error</li>
 * </ul>
 */
public enum NativeAnalysisStatus {
    PENDING,
    RUNNING,
    INGEST_PENDING,
    READY,
    FAILED
}
