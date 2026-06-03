-- Slice 4: AI-assisted rename / deobfuscation.
--
-- Each row is one identifier the user wants to rename across the project.
-- status:
--   SUGGESTED — AI proposed it; sitting in the review panel, not active yet
--   APPLIED   — user accepted it; ProjectService.readFile rewrites this identifier
--               on the fly when serving any source file
--
-- (project_id, original) is unique because we can only rename one identifier
-- to one new name across the project. Re-running suggest on the same identifier
-- upserts the suggested name + rationale.

CREATE TABLE project_renames (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    original VARCHAR(500) NOT NULL,
    suggested VARCHAR(500) NOT NULL,
    scope VARCHAR(40) NOT NULL,
    status VARCHAR(20) NOT NULL,
    confidence VARCHAR(20) NOT NULL,
    source_path VARCHAR(500),
    rationale TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, original)
);

CREATE INDEX idx_project_renames_applied ON project_renames(project_id) WHERE status = 'APPLIED';
