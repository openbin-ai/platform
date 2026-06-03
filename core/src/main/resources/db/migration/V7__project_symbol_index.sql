-- Cached coarse symbol index (class/method/field declarations) for the project's
-- decompiled tree. Rebuilt lazily on first symbol query and on explicit Rescan.
-- Usages are NOT indexed here — they are recomputed via live grep at query time
-- to keep this JSON small (declarations only).
ALTER TABLE projects ADD COLUMN symbol_index_jsonb JSONB;
