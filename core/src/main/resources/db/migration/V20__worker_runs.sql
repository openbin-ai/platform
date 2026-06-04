-- Audit + quota tracking for cloud worker invocations (Ghidra, JADX).
-- These are the only operations the SaaS pays AWS for on the user's behalf
-- (AI is BYOK via user-supplied credentials), so every worker dispatch is
-- logged here. The same table backs the daily-cap quota gate — counting rows
-- in a UTC window per user is cheap given the index below.
--
-- Phase 0: a hardcoded per-user daily cap (configured in application config)
-- gates the dispatch. Phase 2 will swap this for a real credits ledger.
-- project_id is intentionally NOT a FK so deleting a project does not drop
-- its audit history (mirrors llm_audit_log).
CREATE TABLE worker_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id UUID,
    -- 'ghidra' | 'jadx' — free-form so adding a worker type later doesn't
    -- need a migration. Validated by the application layer.
    worker_type TEXT NOT NULL,
    success BOOLEAN,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hot path: "how many runs has this user done today" — count rows for
-- (user_id, created_at >= start_of_utc_day). Same index also serves the
-- per-user audit view.
CREATE INDEX worker_runs_user_created_idx ON worker_runs (user_id, created_at DESC);
CREATE INDEX worker_runs_project_idx ON worker_runs (project_id) WHERE project_id IS NOT NULL;
