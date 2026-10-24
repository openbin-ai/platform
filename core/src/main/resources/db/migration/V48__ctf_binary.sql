-- The challenge binary itself, for players who want their own tools. The
-- project only holds the decompiled output; the raw file is stored under
-- ctf/<challenge-id>/<name> in the same storage backend as media.
ALTER TABLE ctf_challenges
    ADD COLUMN binary_name   TEXT,
    ADD COLUMN binary_size   BIGINT,
    ADD COLUMN binary_sha256 TEXT;
