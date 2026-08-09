-- Scope rename uniqueness by source_path, not just by original name.
--
-- V6 made (project_id, original) unique. That is right for function/class
-- names, which are unique within a binary, but wrong for VARIABLES:
-- Ghidra reuses uVar1 / iVar2 / param_1 in nearly every function it
-- decompiles. Under the old constraint, renaming uVar1 inside function A
-- and then inside function B updated the SAME row — the second rename
-- silently moved the first (its source_path was overwritten), so function
-- A quietly reverted. That hit AI-suggested variable renames too; it just
-- went unnoticed because the suggest flow is per-function and users rarely
-- re-ran it on a second function with an overlapping name.
--
-- Variable rows already carry source_path = 'function:<name>' (set by the
-- suggest path); global renames leave it NULL. COALESCE to '' so the
-- NULL rows still collide with each other exactly as before — a project
-- still cannot hold two competing global renames of the same symbol.
ALTER TABLE project_renames DROP CONSTRAINT IF EXISTS project_renames_project_id_original_key;

CREATE UNIQUE INDEX IF NOT EXISTS ux_project_renames_scoped
    ON project_renames (project_id, original, COALESCE(source_path, ''));
