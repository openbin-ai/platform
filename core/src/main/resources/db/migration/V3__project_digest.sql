-- Cache the expensive-to-compute static digest (manifest + regex scan over decompiled
-- sources) so repeated /analyze calls don't re-scan thousands of files each time.
-- Stored as JSONB so we can index / query subfields later if needed.
ALTER TABLE projects ADD COLUMN digest_jsonb JSONB;
