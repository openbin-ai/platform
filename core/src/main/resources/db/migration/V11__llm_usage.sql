-- Audit trail of every LLM invocation. Kept forever (no retention policy yet);
-- one row per call is cheap and these are useful for cost forensics. project_id
-- is intentionally NOT a FK so deleting a project doesn't drop its audit history.
CREATE TABLE llm_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id UUID,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    -- Free-form label so we can slice usage by feature: analyze, ask, ask_stream,
    -- callchain_narrate, rename, crypto_analyze, etc.
    purpose TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    success BOOLEAN NOT NULL,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hot path: "what has this user spent today / this month" — index on (user_id, created_at)
-- covers both summary windows. project_id index covers the per-project audit view.
CREATE INDEX llm_audit_log_user_created_idx ON llm_audit_log (user_id, created_at DESC);
CREATE INDEX llm_audit_log_project_idx ON llm_audit_log (project_id) WHERE project_id IS NOT NULL;

-- Per-user budget caps. NULL = no limit (default for existing users so nothing
-- breaks). Combined input + output tokens, since that's what users actually
-- pay for and matches the audit rows.
CREATE TABLE llm_user_limits (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    daily_token_cap BIGINT,
    monthly_token_cap BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
