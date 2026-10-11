-- Who may open a DM with me. Lives on users (not user_email_preferences)
-- because it gates behaviour, not a channel: the sender's request is
-- refused, not merely unnotified.
--   EVERYONE  — any signed-in researcher (default)
--   FOLLOWING — only people I follow (my explicit allowlist)
--   NOBODY    — DMs off; existing threads go read-only for the other side
ALTER TABLE users
    ADD COLUMN dm_policy TEXT NOT NULL DEFAULT 'EVERYONE'
        CHECK (dm_policy IN ('EVERYONE', 'FOLLOWING', 'NOBODY'));
