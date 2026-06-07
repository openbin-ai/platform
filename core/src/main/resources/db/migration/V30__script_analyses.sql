-- SCRIPT project kind — first arc of the JS / scripting-language analyzer.
-- A SCRIPT project is an uploaded NPM tarball that the script-worker
-- Lambda statically analyzes for malicious supply-chain patterns
-- (postinstall hooks, secret theft, obfuscated payloads, known C2).
--
-- Storage split mirrors the BIN passthrough pattern (V22):
--   findings_jsonb     — the analyzer's per-file findings (5-50KB)
--                        kept in Postgres so the community feed can query
--                        and join against it without an S3 round-trip
--   bundle_s3_key      — the deobfuscated-source bundle (1-10MB)
--                        lives in S3, served via presigned URL to readers
--   findings_text      — concatenated suspicious snippets, indexed
--                        with a tsvector GIN so /community search can grep
--                        across published script reports
--
-- One row per project. Re-analysis (kicked off when the user re-uploads or
-- the rule set changes) updates this row in place; the row never spawns
-- siblings the way native_analyses does for multi-binary APKs.
CREATE TABLE script_analyses (
    project_id      UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    findings_jsonb  JSONB NOT NULL,
    bundle_s3_key   VARCHAR(512),
    findings_text   TEXT NOT NULL DEFAULT '',
    package_name    VARCHAR(255),
    package_version VARCHAR(64),
    finding_count   INTEGER NOT NULL DEFAULT 0,
    critical_count  INTEGER NOT NULL DEFAULT 0,
    high_count      INTEGER NOT NULL DEFAULT 0,
    medium_count    INTEGER NOT NULL DEFAULT 0,
    info_count      INTEGER NOT NULL DEFAULT 0,
    duration_ms     INTEGER,
    analyzed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- FTS index on the concatenated suspicious-snippet text. Used by the
-- community search bar to surface "show me reports that mention
-- discord.com/api/webhooks" and similar IOC queries without scanning
-- every JSONB blob. Postgres simple config — no language stemming
-- because finding text is hex / domains / function names, not prose.
CREATE INDEX idx_script_analyses_findings_text_fts
    ON script_analyses
    USING GIN (to_tsvector('simple', findings_text));

-- Common lookup paths: by-package-name for "is this package on the
-- platform?" community queries, and by-counts for sort orders on the
-- community feed.
CREATE INDEX idx_script_analyses_package_name
    ON script_analyses (package_name);

CREATE INDEX idx_script_analyses_critical
    ON script_analyses (critical_count DESC, analyzed_at DESC)
    WHERE critical_count > 0;
