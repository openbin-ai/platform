-- Public project visibility (Phase A). A separate switch from report
-- community-publish (project_reports.community_published_at): a public project
-- exposes its READ workspace — function list, decompiled C / disasm, strings,
-- file tree, highlights, report — to anonymous viewers (GitHub-style "browse
-- the repo"), even if no report has been published to the community feed.
--
-- NULL = private (the default; today every project). Non-null = the instant
-- the owner made it publicly readable. Mirrors the community_published_at
-- pattern (V18): a nullable timestamp + a partial index for the anonymous
-- read path's existence checks.

ALTER TABLE projects
    ADD COLUMN public_read_at TIMESTAMPTZ NULL;

CREATE INDEX idx_projects_public_read_at
    ON projects (public_read_at)
    WHERE public_read_at IS NOT NULL;
