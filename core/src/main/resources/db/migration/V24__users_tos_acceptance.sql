-- Track Terms-of-Service acceptance per user. New accounts get NULLs;
-- the TOS gate trips for any user whose accepted version doesn't match
-- the current version configured in openapk.tos.current-version.
--
-- Versioning scheme is a YYYY-MM-DD date string (e.g. "2026-06-05") set
-- in application.yml. Bump the value whenever TOS terms change in any
-- material way and every user is forced to re-accept before the next
-- API call lands.

ALTER TABLE users
    ADD COLUMN tos_accepted_version VARCHAR(32),
    ADD COLUMN tos_accepted_at TIMESTAMPTZ;
