-- Per-(project, native library) analysis results from the Ghidra worker.
-- One row per .so file we've ever kicked off an analysis for; status tracks
-- the lifecycle. result_jsonb is the worker's full extract (functions,
-- strings, imports, metadata) — null until READY.
CREATE TABLE native_analyses (
    id              UUID PRIMARY KEY,
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    lib_path        VARCHAR(512) NOT NULL,
    arch            VARCHAR(32) NOT NULL,
    size_bytes      BIGINT NOT NULL,
    status          VARCHAR(32) NOT NULL,
    result_jsonb    JSONB,
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    analyzed_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX ux_native_proj_lib ON native_analyses (project_id, lib_path);
CREATE INDEX ix_native_proj_status ON native_analyses (project_id, status);
