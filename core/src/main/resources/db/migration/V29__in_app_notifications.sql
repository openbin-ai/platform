-- In-app notifications (the bell-icon dropdown). Companion surface to the
-- transactional emails that ship for the same events — when the email
-- gate fires, an in-app row gets created at the same time. Both channels
-- share the user's email-pref toggles, so opting out of a category mutes
-- both at once. We can split the toggles per-channel later if needed.

CREATE TABLE notifications (
    id         UUID PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Discriminator. Whitelisted at the service layer so the column stays
    -- a free-form TEXT rather than an enum that needs a migration every
    -- time we add a new notification type. Current values:
    --   NEW_FOLLOWER, COMMENT_ON_MY_REPORT, REPLY_TO_MY_COMMENT,
    --   COLLABORATOR_INVITE
    kind       TEXT NOT NULL,
    -- JSONB payload — shape depends on `kind`. Always includes
    -- actor_display_name + actor_email_md5 so the bell-dropdown row can
    -- render an avatar + name without a follow-up user lookup. Other
    -- fields (report_title, project_name, etc.) are kind-specific.
    payload    JSONB NOT NULL,
    -- Frontend route to navigate to when the row is clicked. Stored at
    -- write time so the read path doesn't have to switch on kind to
    -- construct the URL — cheaper to bake it in once.
    link       TEXT NOT NULL,
    -- Non-null = read. Mirrors the soft-delete pattern elsewhere so a
    -- "mark all read" sweep is one UPDATE with a fresh timestamp.
    read_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hot path: "last 20 notifications for this user, newest first" — drives
-- the bell-dropdown body.
CREATE INDEX idx_notifications_user_created
    ON notifications (user_id, created_at DESC);

-- Hot path: "how many unread for this user?" — drives the badge. Partial
-- index on the IS NULL branch keeps it tiny because the read-row count
-- vastly outgrows the unread-row count over time.
CREATE INDEX idx_notifications_user_unread
    ON notifications (user_id)
    WHERE read_at IS NULL;
