-- Project collaboration: sidecar table that lets the project owner grant
-- VIEWER or EDITOR access to additional users. Owner identity stays on
-- projects.user_id — having two sources of truth for ownership is the
-- exact shape of bug this whole feature wants to avoid, so OWNER is never
-- a valid role here.
--
-- Read path: ProjectAccessGuard joins (project owner OR collaborator row)
-- in a single SQL hit and returns the entity + role. List path:
-- `findByUserId` for "projects shared with me", joined with the existing
-- owner-keyed query for the unified dashboard.

CREATE TABLE project_collaborators (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('VIEWER', 'EDITOR')),
    -- Audit who added this collaborator. No cascade so a deleted inviter
    -- forces a deliberate decision rather than silently dropping rows; we
    -- soft-delete users in practice, but spelling it out is cheap.
    invited_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);

-- Reverse lookup: "what projects am I collaborating on?" Drives the
-- /api/projects list endpoint after collaboration ships.
CREATE INDEX idx_project_collaborators_user
    ON project_collaborators (user_id, created_at DESC);

-- Forward lookup: "who are the collaborators on this project?" Drives the
-- share modal's roster + the avatar stack in the project header.
CREATE INDEX idx_project_collaborators_project
    ON project_collaborators (project_id);
