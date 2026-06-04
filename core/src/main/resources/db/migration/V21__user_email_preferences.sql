-- Per-user opt-out flags for transactional emails. One row per user, created
-- lazily on first PATCH; absence of a row means "all defaults" (everything ON).
-- Opt-out model — we send by default and the user disables per-category.
--
-- Categories tracked here are *transactional* (something the user explicitly
-- did or that affects their content). Anti-abuse / security mail is NOT in
-- this table — those go out regardless.
CREATE TABLE user_email_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    -- Fires when a project flips to READY (APK via JADX, BIN via CLI ingest).
    notify_decompile_complete BOOLEAN NOT NULL DEFAULT TRUE,
    -- Fires when the user publishes a project's report to the community feed.
    notify_report_published BOOLEAN NOT NULL DEFAULT TRUE,
    -- Fires when the user submits an abuse report and supplied their email
    -- (anonymous reporters get nothing — no email to send to).
    notify_abuse_confirmation BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
