-- Pre-built nested FileNode JSON, populated when JADX decompile completes.
-- Lets GET /projects/{id}/files serve straight from one row instead of walking
-- the source tree (100k+ stat syscalls for a non-trivial APK). NULL for projects
-- created before this migration — populated lazily on next file-tree request.
ALTER TABLE projects ADD COLUMN file_tree_jsonb JSONB;
