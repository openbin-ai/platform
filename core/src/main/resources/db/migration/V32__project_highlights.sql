-- The Highlights board: a curated evidence layer over a project. Each row
-- pins a notable FUNCTION or FILE (or a standalone VISUAL annotated
-- screenshot) with a tag + note, optionally backed by an image in the
-- project's shared media store. Owner/editors curate; viewers (incl. public
-- read + forks) see it read-only. Auto-assembles the report's Highlights
-- section and each row is an attributed contribution (created_by) feeding the
-- report byline.

CREATE TABLE project_highlights (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type        TEXT NOT NULL CHECK (type IN ('FUNCTION', 'FILE', 'VISUAL')),
    -- Function name/address or file path. NULL only for VISUAL highlights.
    target_ref  TEXT,
    -- Filename of an annotated screenshot in the project media store
    -- (users/<owner>/projects/<id>/media/<file>). Nullable — a highlight can
    -- be text-only, and a screenshot can exist in the Gallery without one.
    media_key   TEXT,
    tag         TEXT,
    note        TEXT,
    position    INT NOT NULL DEFAULT 0,
    -- Attribution for the contributor byline. SET NULL (not CASCADE) so a
    -- highlight survives the author leaving; the project still owns it.
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Anchored highlights must carry a target; only VISUAL may omit it.
    CONSTRAINT highlight_anchor CHECK (type = 'VISUAL' OR target_ref IS NOT NULL)
);

CREATE INDEX idx_project_highlights_project
    ON project_highlights (project_id, position, created_at);
