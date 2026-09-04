package ai.openapk.core.projects.samples;

/** Lifecycle of an attached sample's analysis. CLI-only S3 ingest, so there is
 * no PENDING/RUNNING cloud-worker state — the blob either landed or it didn't. */
public enum ProjectSampleStatus {
    /** initiate ran; waiting for the CLI's S3 PUT + finalize. */
    INGEST_PENDING,
    /** Blob finalized and readable. */
    READY,
    /** Finalize failed permanently (kept for the error message). */
    FAILED
}
