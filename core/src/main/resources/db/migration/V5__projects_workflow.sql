-- Slice 5c: project naming, workflow status, report publish lifecycle.
--
-- `name`: user-editable display name. Defaults to the uploaded filename so existing
-- rows aren't blank. The original_filename column is kept for forensic traceability.
--
-- `workflow_status`: case-management state (NEW / TRIAGING / ANALYZING /
-- DRAFTING_REPORT / PUBLISHED). Distinct from `status` which tracks the
-- decompile pipeline (UPLOADED / DECOMPILING / READY / FAILED). System
-- auto-advances forward; user can manually set anything except PUBLISHED
-- (which requires the publish endpoint).
--
-- `published_at` on project_reports: NULL = draft. Non-null = published; report
-- becomes read-only until unpublished.

ALTER TABLE projects ADD COLUMN name VARCHAR(200);
UPDATE projects SET name = original_filename;
ALTER TABLE projects ALTER COLUMN name SET NOT NULL;

ALTER TABLE projects ADD COLUMN workflow_status VARCHAR(40) NOT NULL DEFAULT 'NEW';

ALTER TABLE project_reports ADD COLUMN published_at TIMESTAMPTZ NULL;
