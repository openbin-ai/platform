-- Fork lineage (Phase A). A fork is a new project that SHARES its source's
-- immutable sha256-keyed analysis blob (binary_analysis_s3_key) read-only, with
-- its own empty renames/highlights/report working layer. This records the
-- parent link + a denormalized direct-fork count for the source.
--
-- forked_from is SET NULL on parent delete (not CASCADE): deleting a source
-- must NOT destroy its forks — they simply become roots (their own copy of the
-- shared blob lives on via refcounting in ProjectService.delete). Takedown
-- cascade (a later slice) walks descendants explicitly via this column.

ALTER TABLE projects
    ADD COLUMN forked_from UUID REFERENCES projects(id) ON DELETE SET NULL;

-- Denormalized count of DIRECT forks of this project, maintained by the fork
-- endpoint (++ on fork) and delete (-- when a fork is removed). Cheap badge for
-- the UI without a COUNT(*) per project row.
ALTER TABLE projects
    ADD COLUMN fork_count INT NOT NULL DEFAULT 0;

-- Walk "show me the forks of X" cheaply.
CREATE INDEX idx_projects_forked_from
    ON projects (forked_from)
    WHERE forked_from IS NOT NULL;
