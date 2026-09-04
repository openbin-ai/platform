-- Multi-sample projects: one BIN project can hold decompile results for
-- SEVERAL samples (a dropper + its payloads, firmware revisions, the ABIs of
-- one library). The project's original binary stays exactly where it always
-- was (the scalar columns + binary_analysis_s3_key on projects) — this table
-- holds the ADDITIONAL samples, mirroring the native_analyses pattern (the
-- per-project child-analysis precedent, see V30's comment).
--
-- Deliberately NOT wired into renames / highlights / deobfuscations / reports:
-- those are keyed (project_id, symbol-name) and two samples routinely share
-- names like FUN_00401000, so scoping them per-sample is its own slice.
-- Extra samples are read-only side analyses, exactly like attached native
-- libs. Fork copies only the primary blob; the public surface exposes only
-- the primary sample.

CREATE TABLE project_samples (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- How the sample is listed in the project's sample switcher.
    label               VARCHAR(200) NOT NULL,
    original_filename   VARCHAR(512),
    sha256              TEXT NOT NULL,
    size_bytes          BIGINT NOT NULL DEFAULT 0,
    -- Ghidra-reported metadata, extracted at finalize (same stream-parse the
    -- primary ingest uses).
    arch                VARCHAR(64),
    executable_format   VARCHAR(128),
    compiler            VARCHAR(128),
    language_id         VARCHAR(128),
    image_base          VARCHAR(32),
    status              VARCHAR(32) NOT NULL,   -- INGEST_PENDING | READY | FAILED
    analysis_s3_key     VARCHAR(512),
    analysis_s3_etag    VARCHAR(128),
    analysis_size_bytes BIGINT,
    error_message       TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    analyzed_at         TIMESTAMPTZ,

    -- The same binary joins a project once. (It may still be the project's
    -- primary sample AND appear elsewhere as another project — dedup across
    -- projects stays advisory, as today.)
    CONSTRAINT uq_project_samples_project_sha UNIQUE (project_id, sha256)
);

CREATE INDEX idx_project_samples_project ON project_samples (project_id);

-- Orphan-ingest sweep target, mirroring V25's native index: INGEST_PENDING
-- rows whose CLI never finished the PUT (the S3 side is reaped by the
-- status=pending lifecycle rule after ~24h).
CREATE INDEX idx_project_samples_ingest_pending
    ON project_samples (created_at)
    WHERE status = 'INGEST_PENDING';
