-- Cache the latest analysis result on the project so the report editor can
-- populate sections without re-spending tokens on every page reload.
ALTER TABLE projects ADD COLUMN latest_analysis_jsonb JSONB;

-- One report per project. Sections live as JSON so the schema doesn't have to
-- change every time we tweak the default section list.
CREATE TABLE project_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    sections_jsonb JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
