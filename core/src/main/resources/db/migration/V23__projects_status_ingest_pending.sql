-- V22 introduced the S3 ingest flow with a new ProjectStatus enum value
-- INGEST_PENDING, but the original V2__projects.sql CHECK constraint
-- enumerated only ('UPLOADED','DECOMPILING','READY','FAILED'). Inserts
-- with the new status fail with a check_constraint violation at insert
-- time even though Hibernate/JPA accepts the value — and only after V22
-- ran in prod did we hit it (first /ingest/initiate call from the CLI).

ALTER TABLE projects DROP CONSTRAINT projects_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_status_check
    CHECK (status IN ('UPLOADED', 'DECOMPILING', 'READY', 'FAILED', 'INGEST_PENDING'));
