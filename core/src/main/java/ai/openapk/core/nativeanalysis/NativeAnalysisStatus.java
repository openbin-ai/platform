package ai.openapk.core.nativeanalysis;

/**
 * Lifecycle of a single (project, .so) native-analysis job.
 * <ul>
 *   <li>{@code PENDING} — row inserted, executor hasn't picked it up yet</li>
 *   <li>{@code RUNNING} — executor handed off to Ghidra worker, awaiting response</li>
 *   <li>{@code READY}   — worker returned, result persisted</li>
 *   <li>{@code FAILED}  — worker call failed or returned an error</li>
 * </ul>
 * Frontend treats {@code PENDING}/{@code RUNNING} as "poll again in a few seconds".
 */
public enum NativeAnalysisStatus {
    PENDING,
    RUNNING,
    READY,
    FAILED
}
