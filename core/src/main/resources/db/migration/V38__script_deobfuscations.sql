-- On-demand deobfuscation results, persisted so they survive a reload.
--
-- Upload-time deobfuscation lives in the analysis bundle in S3. THIS table
-- is the analyst-initiated kind: they pressed Deobfuscate on one file with
-- one engine, and expect that result to still be there tomorrow.
--
-- One row per (project, file, engine) — re-running the same engine on the
-- same file is deterministic, so the newest result replaces the old one
-- rather than accumulating history. That also bounds growth to
-- files × engines-actually-used rather than one row per click.
--
-- `source` is TEXT rather than an S3 pointer: this is a single file's
-- deobfuscated body (typically tens of KB, hard-capped by the worker's
-- response budget), which is much closer in size to findings_jsonb than to
-- the bundle tarball. TOAST compresses it out of line automatically.
CREATE TABLE script_deobfuscations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_path    VARCHAR(512) NOT NULL,
    -- The engine the caller ASKED for: auto | obfuscator-io | generic | caesar.
    -- Kept distinct from engine_used so an 'auto' result stays addressable
    -- as 'auto' when the view reloads, even though auto resolved to a
    -- specific engine at run time.
    engine       VARCHAR(32) NOT NULL,
    -- The engine auto actually settled on (equals `engine` for explicit runs).
    engine_used  VARCHAR(32) NOT NULL,
    source       TEXT NOT NULL,
    note         TEXT,
    score        DOUBLE PRECISION,
    baseline_score DOUBLE PRECISION,
    truncated    BOOLEAN NOT NULL DEFAULT FALSE,
    created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, file_path, engine)
);

-- The view loads every saved result for a project in one query on mount.
CREATE INDEX idx_script_deobf_project ON script_deobfuscations (project_id);
