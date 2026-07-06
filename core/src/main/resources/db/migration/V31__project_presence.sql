-- Per-member presence for the in-project collaboration roster. One row per
-- (project, user) tracking when that user was last active in the project.
-- Covers the owner too (who is NOT in project_collaborators — ownership lives
-- on projects.user_id), so a single table gives uniform presence for owner +
-- collaborators + (later) the BINNY bot user.
--
-- Written by a lightweight heartbeat the frontend pings on project open and
-- periodically; read by the /members roster endpoint. Deliberately not a
-- write on every project read — presence is a coarse "active 2m ago" signal,
-- not an audit log.

CREATE TABLE project_presence (
    project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id        UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);

CREATE INDEX idx_project_presence_project
    ON project_presence (project_id, last_active_at DESC);
