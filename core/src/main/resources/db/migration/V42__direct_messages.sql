-- Direct messages: private 1:1 conversations between researchers.
--
-- Shape is deliberately "conversation + members + messages" rather than
-- a flat (sender, recipient) message table, so the same tables can carry
-- group conversations later (CTF teams) without a rewrite: a team chat is
-- just a conversation with N members and a NULL pair_key.
--
-- Per-member read state lives on the membership row (last_read_at), so the
-- unread count for a conversation is "messages newer than my last read that
-- I didn't send" — one indexed range scan, no per-message read receipts.

CREATE TABLE dm_conversations (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Canonical identity of a 1:1 pair: "<lesser user uuid>:<greater user uuid>".
    -- UNIQUE so two users can only ever share one conversation; NULL for
    -- future group conversations.
    pair_key             TEXT UNIQUE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Denormalized from the newest message so the inbox list is one query.
    last_message_at      TIMESTAMPTZ,
    last_message_preview TEXT,
    last_sender_id       UUID
);

CREATE TABLE dm_members (
    conversation_id UUID NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- NULL = never opened the conversation.
    last_read_at    TIMESTAMPTZ,
    PRIMARY KEY (conversation_id, user_id)
);

-- "My inbox, newest activity first."
CREATE INDEX idx_dm_members_user ON dm_members (user_id);

CREATE TABLE dm_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
    sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body            TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Thread paging (newest first) and the unread range scan both use this.
CREATE INDEX idx_dm_messages_conv_created ON dm_messages (conversation_id, created_at DESC);
