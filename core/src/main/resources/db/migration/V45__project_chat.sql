-- Project group chat: one conversation per project, shared by everyone on
-- the project's roster (owner + collaborators). Reuses the DM tables, as
-- V42 planned: a project conversation has project_id set and pair_key NULL.
--
-- Membership is NOT synced from project_collaborators. Access is checked
-- live against the roster on every read/send, and a dm_members row is
-- created lazily on first open (it only carries the per-user read cursor).
ALTER TABLE dm_conversations
    ADD COLUMN project_id UUID REFERENCES projects(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX uq_dm_conversations_project
    ON dm_conversations (project_id) WHERE project_id IS NOT NULL;
