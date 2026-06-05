-- Phase 1 of the JSONB→S3 migration for BIN analysis blobs.
--
-- Why: the CLI POSTs the entire Ghidra worker JSON in one application/json
-- request and Spring buffers it into a JsonNode tree (~5-10x heap of the
-- payload). For silentXMR-class binaries (50-200MB JSON) this brings the
-- backend to its knees at 10 concurrent ingests, and the resulting JSONB
-- row destroys Postgres autovacuum + replication.
--
-- New flow: CLI uploads to S3 directly via a presigned PUT URL; the backend
-- streams the metadata extract from S3 and stores only the S3 key here.
-- Frontend reads via a CloudFront signed URL minted at /api/projects/{id}.
--
-- This migration is DUAL-WRITE-COMPATIBLE: binary_analysis_jsonb stays
-- nullable and is still read as a fallback by ProjectResponse. Phase 5
-- drops it once dashboards confirm zero reads.

ALTER TABLE projects
    ADD COLUMN binary_analysis_s3_key  VARCHAR(512),
    ADD COLUMN binary_analysis_s3_etag VARCHAR(128),
    ADD COLUMN binary_analysis_size_bytes BIGINT;

-- Index on s3_key — used by the periodic orphan-cleanup job ("find
-- projects with INGEST_PENDING status older than 24h"). Partial index so
-- we don't blow up the row count for the common (already-finalized) case.
CREATE INDEX idx_projects_pending_s3_ingest
    ON projects (created_at)
    WHERE status = 'INGEST_PENDING' AND binary_analysis_s3_key IS NOT NULL;
