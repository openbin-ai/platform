-- Native-lib analysis migration to the S3 ingest pipeline.
--
-- Mirrors V22 (projects table) for native_analyses: adds the S3 columns
-- used by the new CLI flow where the user runs Ghidra locally on a
-- downloaded .so and streams the result up via a presigned PUT. A new
-- INGEST_PENDING status (same name as on projects.status for symmetry)
-- represents "row created by /native/ingest/initiate, awaiting the CLI's
-- PUT + finalize". The old PENDING/RUNNING states stay valid for the
-- sunset cloud-Ghidra rows already in the table.
--
-- Dual-read compatible: result_jsonb stays nullable. NativeAnalysisService
-- prefers analysis_s3_key when set, otherwise reads from result_jsonb.

ALTER TABLE native_analyses
    ADD COLUMN analysis_s3_key      VARCHAR(512),
    ADD COLUMN analysis_s3_etag     VARCHAR(128),
    ADD COLUMN analysis_size_bytes  BIGINT;

-- Orphan-cleanup index — same shape as the BIN-side partial index.
-- Matches INGEST_PENDING rows whose S3 PUT never landed (CLI crashed
-- between initiate and finalize); a periodic job sweeps the bucket.
CREATE INDEX idx_native_pending_s3_ingest
    ON native_analyses (created_at)
    WHERE status = 'INGEST_PENDING' AND analysis_s3_key IS NOT NULL;
