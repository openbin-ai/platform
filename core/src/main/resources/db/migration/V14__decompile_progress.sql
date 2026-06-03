-- Lightweight progress signals for the decompile pipeline. Surfaced in the
-- Projects list so the user sees something other than a static "decompiling…"
-- chip during the 1-5 minute JADX run on a large APK.
--
-- `decompile_phase` is a free-form enum-ish string the backend updates at each
-- pipeline milestone (OPENING_APK, DECOMPILING, BUILDING_TREE, INDEXING_SYMBOLS,
-- INDEXING_USAGES). NULL until the first phase write.
--
-- `decompile_started_at` is the timestamp of the first phase write — used by
-- the UI to render elapsed time alongside the phase chip.
ALTER TABLE projects
    ADD COLUMN decompile_phase TEXT,
    ADD COLUMN decompile_started_at TIMESTAMPTZ;
