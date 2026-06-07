-- Discussion threads on community-published reports + the per-user opt-out
-- columns for the new transactional emails (follow, comment-on-my-report,
-- reply-to-my-comment, collaborator-invite). Bundled in one migration
-- because the comment-on-my-report and reply-to-my-comment notifications
-- can only fire after the comments table exists; keeping schema + prefs
-- together avoids a brief window where the boolean column is settable but
-- the table it gates doesn't exist yet.


-- ─── report_comments ───────────────────────────────────────────────────
-- One level of nesting via parent_comment_id (top-level comment = NULL).
-- We deliberately don't support arbitrarily-deep threads — Slack-style
-- one-level replies are the sweet spot for security-research discussion,
-- avoid the "reply to reply to reply" indentation creep that makes long
-- threads unreadable, and let the email-notify-on-reply path stay simple
-- (one parent author to ping, not a chain of ancestors).
--
-- Soft delete: setting deleted_at preserves the row so reply chains stay
-- intact; the body is hidden at the read layer and shown as "[deleted]".
CREATE TABLE report_comments (
    id                UUID PRIMARY KEY,
    report_id         UUID NOT NULL REFERENCES project_reports(id) ON DELETE CASCADE,
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_comment_id UUID REFERENCES report_comments(id) ON DELETE CASCADE,
    -- 4000 char cap matches a typical research-comment length without
    -- letting the column become an unbounded text dump. Enforced at the
    -- DB so a malicious client can't bypass the service-layer check.
    body              TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ
);

-- Hot path: "list all comments for this report, oldest first" — the
-- comments tree is read in one shot and assembled in app code. Index
-- ordered by created_at so the tree-build can iterate in arrival order.
CREATE INDEX idx_report_comments_report_created
    ON report_comments (report_id, created_at);

-- Reverse lookup: "how many replies does this top-level comment have?"
-- Partial index because most comments are top-level (parent IS NULL).
CREATE INDEX idx_report_comments_parent
    ON report_comments (parent_comment_id)
    WHERE parent_comment_id IS NOT NULL;


-- ─── new email-preference columns ─────────────────────────────────────
ALTER TABLE user_email_preferences
    -- Someone followed you.
    ADD COLUMN notify_new_follower            BOOLEAN NOT NULL DEFAULT TRUE,
    -- Someone left a top-level comment on a community report you authored.
    ADD COLUMN notify_comment_on_my_report    BOOLEAN NOT NULL DEFAULT TRUE,
    -- Someone replied to a comment YOU made (parent_comment_id = your row).
    ADD COLUMN notify_reply_to_my_comment     BOOLEAN NOT NULL DEFAULT TRUE,
    -- A project owner added you as a VIEWER/EDITOR on their project.
    ADD COLUMN notify_collaborator_invite     BOOLEAN NOT NULL DEFAULT TRUE;
