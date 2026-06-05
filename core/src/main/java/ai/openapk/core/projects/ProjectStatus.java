package ai.openapk.core.projects;

public enum ProjectStatus {
    UPLOADED,
    DECOMPILING,
    READY,
    FAILED,
    /**
     * BIN-only intermediate state used by the two-step S3 ingest flow.
     * Set on /api/projects/ingest/initiate when the backend mints a presigned
     * PUT URL and pre-creates the project row; cleared to READY on
     * /api/projects/ingest/finalize. Lifecycle policy cleans up S3 keys whose
     * projects remain in this state past 24h (CLI died between steps).
     */
    INGEST_PENDING
}
