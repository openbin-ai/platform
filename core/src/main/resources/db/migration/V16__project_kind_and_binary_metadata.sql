-- OpenBin.AI groundwork: projects can now be APK (jadx-decompiled) or BIN
-- (Ghidra-analyzed native executables — ELF / PE / Mach-O). One backend
-- serves both; the `kind` column drives which decompile pipeline runs and
-- which views the frontend renders.
--
-- All existing rows are APK by design (this migration runs on a DB that
-- predates OpenBin), so we default the column and let the NOT NULL apply
-- after backfill.
ALTER TABLE projects
    ADD COLUMN kind TEXT NOT NULL DEFAULT 'APK';

-- Binary-only metadata, populated by the Ghidra worker's `metadata` block
-- when a BIN project finishes analysis. NULL for APK projects.
--   arch              — caller-supplied or Ghidra-detected (e.g. "x86_64", "arm64-v8a")
--   executable_format — "ELF", "PE", "Mach-O", "Raw", ...
--   compiler          — Ghidra's compiler-spec guess ("gcc", "windows", ...)
--   language_id       — Ghidra language ID (e.g. "x86:LE:64:default")
--   image_base        — load address as a hex string
ALTER TABLE projects
    ADD COLUMN arch              TEXT,
    ADD COLUMN executable_format TEXT,
    ADD COLUMN compiler          TEXT,
    ADD COLUMN language_id       TEXT,
    ADD COLUMN image_base        TEXT;

-- Cached worker result for a BIN project: the full extract JSON
-- ({ functions: [...], strings: [...], imports: [...], metadata: {...} }).
-- One blob per project for v1 since a project owns a single binary.
-- Slice 5 will shred this into a binaries / binary_functions schema when we
-- support multi-binary corpora.
ALTER TABLE projects
    ADD COLUMN binary_analysis_jsonb JSONB;
